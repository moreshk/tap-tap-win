"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, ISeriesApi, IChartApi, MouseEventParams, Time } from "lightweight-charts";

interface Tile {
  id: string;
  price: number;
  timestamp: number;
  x: number;
  y: number;
}

interface PriceData {
  time: Time;
  value: number;
}

export default function TapTapGame() {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceBufferRef = useRef<PriceData[]>([]);
  const lastUpdateTimeRef = useRef<number>(0);
  
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'reconnecting'>('connecting');
  const [tiles, setTiles] = useState<Tile[]>([]);

  // Cache management
  const BUFFER_SIZE = 1000; // Keep last 1000 data points
  const UPDATE_INTERVAL = 250; // Update chart every 250ms

  useEffect(() => {
    if (!chartContainerRef.current) {
      console.log('Chart container not ready'); // Debug log
      return;
    }

    console.log('Creating chart...'); // Debug log

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#333",
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        rightOffset: 12,
        fixLeftEdge: false,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
        tickMarkMaxCharacterLength: 8,
      },
      grid: {
        vertLines: { color: "#f0f0f0" },
        horzLines: { color: "#f0f0f0" },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          width: 1,
          color: '#758696',
          style: 2,
        },
        horzLine: {
          width: 1,
          color: '#758696',
          style: 2,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
        axisDoubleClickReset: {
          time: true,
          price: true,
        },
        mouseWheel: true,
        pinch: true,
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    });

    const series = chart.addLineSeries({
      color: '#f7931a',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 6,
      crosshairMarkerBorderColor: '#f7931a',
      crosshairMarkerBackgroundColor: '#f7931a',
    });

    seriesRef.current = series;
    chartRef.current = chart;
    
    console.log('Chart and series created successfully'); // Debug log

    // Buffer management functions
    const addToBuffer = (data: PriceData) => {
      priceBufferRef.current.push(data);
      // Keep only last BUFFER_SIZE data points
      if (priceBufferRef.current.length > BUFFER_SIZE) {
        priceBufferRef.current = priceBufferRef.current.slice(-BUFFER_SIZE);
      }
    };

    const initializeChartData = (initialPrice: number, timestamp: Time) => {
      const baseTime = timestamp as number;
      const historicalData: PriceData[] = [];
      
      // Create 10 minutes of historical data
      for (let i = 10; i >= 0; i--) {
        const time = (baseTime - (i * 30)) as Time; // Every 30 seconds
        const priceVariation = (Math.random() - 0.5) * 100; // Random variation ±50
        historicalData.push({
          time,
          value: initialPrice + priceVariation
        });
      }
      
      // Add to buffer
      priceBufferRef.current = historicalData;
      
      // Set initial data
      if (seriesRef.current) {
        console.log('Setting initial chart data with', historicalData.length, 'points');
        seriesRef.current.setData(historicalData);
      }
    };

    // Smooth chart update function
    let isUserInteracting = false;
    const updateChartSmooth = () => {
      const now = Date.now();
      if (now - lastUpdateTimeRef.current >= UPDATE_INTERVAL && seriesRef.current) {
        const buffer = priceBufferRef.current;
        if (buffer.length > 0) {
          // Get the latest data point
          const latestData = buffer[buffer.length - 1];
          seriesRef.current.update(latestData);
          
          // Only auto-scroll if user is not manually panning
          if (chartRef.current && !isUserInteracting) {
            const timeScale = chartRef.current.timeScale();
            const logicalRange = timeScale.getVisibleLogicalRange();
            
            // Check if we're near the end (within 10% of the range)
            if (logicalRange) {
              const bufferLength = buffer.length;
              const endThreshold = bufferLength - (bufferLength * 0.1);
              if (logicalRange.to >= endThreshold) {
                timeScale.scrollToRealTime();
              }
            }
          }
        }
        lastUpdateTimeRef.current = now;
      }
    };

    // Track user interaction
    if (chartRef.current) {
      chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(() => {
        // User is interacting with the chart
        isUserInteracting = true;
        // Reset the flag after 2 seconds of no interaction
        setTimeout(() => {
          isUserInteracting = false;
        }, 2000);
      });
    }

    // Handle chart clicks for tile placement
    chart.subscribeClick((param: MouseEventParams) => {
      console.log('Chart clicked!', { point: param.point, currentPrice }); // Debug log
      
      if (param.point) {
        const price = series.coordinateToPrice(param.point.y);
        const time = chart.timeScale().coordinateToTime(param.point.x);
        
        console.log('Click coordinates:', { price, time }); // Debug log
        
        if (price !== null && time !== null) {
          const newTile: Tile = {
            id: Date.now().toString(),
            price: Number(price.toFixed(2)),
            timestamp: typeof time === 'number' ? time : Math.floor(Date.now() / 1000),
            x: param.point.x,
            y: param.point.y,
          };
          
          console.log('Creating tile:', newTile); // Debug log
          setTiles(prev => [...prev, newTile]);
        }
      }
    });

    // WebSocket connection with reconnection logic
    let ws: WebSocket;
    let hasInitialData = false; // Track if we've set initial data
    let reconnectTimeout: NodeJS.Timeout;
    let isCleanupCalled = false;

    const connectWebSocket = () => {
      if (isCleanupCalled) return;
      
      console.log('Connecting to WebSocket...'); // Debug log
      setConnectionStatus('connecting');
      
      ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

      ws.onopen = () => {
        console.log('WebSocket connected'); // Debug log
        setConnectionStatus('connected');
        // Clear any existing reconnection timeout
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected'); // Debug log
        if (!isCleanupCalled) {
          setConnectionStatus('disconnected');
          // Attempt to reconnect after 3 seconds
          reconnectTimeout = setTimeout(() => {
            if (!isCleanupCalled) {
              console.log('Attempting to reconnect...'); // Debug log
              setConnectionStatus('reconnecting');
              connectWebSocket();
            }
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error); // Debug log
        if (!isCleanupCalled) {
          setConnectionStatus('disconnected');
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const price = parseFloat(data.p);
          const timestamp = Math.floor(data.T / 1000) as Time; // Convert to seconds
          
          // Initialize chart data on first price received
          if (!hasInitialData) {
            initializeChartData(price, timestamp);
            hasInitialData = true;
          }
          
          // Add new data point to buffer
          const newDataPoint: PriceData = { time: timestamp, value: price };
          addToBuffer(newDataPoint);
          
          // Update current price in UI
          setCurrentPrice(price);
        } catch (error) {
          console.error('Error parsing WebSocket data:', error);
        }
      };
    };

    // Initial connection
    connectWebSocket();

    // Smooth update interval
    const updateInterval = setInterval(updateChartSmooth, UPDATE_INTERVAL);

    // Cleanup
    return () => {
      console.log('Cleaning up WebSocket and chart'); // Debug log
      isCleanupCalled = true;
      
      // Clear update interval
      clearInterval(updateInterval);
      
      // Clear reconnection timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      
      // Close WebSocket connection
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      
      chart.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps - Remove currentPrice dependency to prevent re-renders

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      case 'reconnecting': return 'text-orange-500';
      case 'disconnected': return 'text-red-500';
    }
  };

  const removeTile = (tileId: string) => {
    setTiles(prev => prev.filter(tile => tile.id !== tileId));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
            Bitcoin Tap-Tap Game
          </h1>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Status:</span>
              <span className={`text-sm font-medium ${getConnectionStatusColor()}`}>
                {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
              </span>
            </div>
            {currentPrice && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Current BTC Price:</span>
                <span className="text-lg font-bold text-orange-500">
                  ${currentPrice.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Chart Container */}
        <div className="bg-white rounded-lg shadow-lg p-4 mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">
              Live Bitcoin Price Chart
            </h2>
            <p className="text-sm text-gray-600 mb-2">
              Click anywhere on the chart to place a tile. Your tiles will appear below.
            </p>
            <p className="text-xs text-gray-500">
              💡 Use mouse wheel to zoom, drag to pan left/right, or double-click to reset view
            </p>
          </div>
          
          <div 
            ref={chartContainerRef} 
            className="w-full h-[400px] border border-gray-200 rounded bg-white"
          />
        </div>

        {/* Tiles Section */}
        <div className="bg-white rounded-lg shadow-lg p-4">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">
            Your Tiles ({tiles.length})
          </h3>
          
          {tiles.length === 0 ? (
            <p className="text-gray-600 text-center py-8">
              No tiles placed yet. Click on the chart to place your first tile!
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tiles.map((tile) => (
                <div
                  key={tile.id}
                  className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="text-lg font-bold text-orange-500">
                      ${tile.price.toLocaleString()}
                    </div>
                    <button
                      onClick={() => removeTile(tile.id)}
                      className="text-red-500 hover:text-red-700 text-sm font-medium"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="text-sm text-gray-600">
                    Placed: {new Date(tile.timestamp * 1000).toLocaleTimeString()}
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    Position: ({Math.round(tile.x)}, {Math.round(tile.y)})
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
