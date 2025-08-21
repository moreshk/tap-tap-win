'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartEvent,
  ActiveElement,
  TooltipItem,
  LegendItem
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin
);

// Types
interface PriceData {
  x: Date;
  y: number;
}

interface Tile {
  id: string;
  price: number;
  date: Date;
  x: number;
  y: number;
}

const TapTapGame = () => {
  // State management
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [priceData, setPriceData] = useState<PriceData[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const chartRef = useRef<ChartJS<'line', PriceData[]> | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const priceBufferRef = useRef<PriceData[]>([]);
  const lastUpdateTimeRef = useRef<number>(0);

  // Configuration
  const UPDATE_INTERVAL = 500; // Update chart every 500ms
  const INITIAL_DATA_POINTS = 50;

  // Generate initial historical data
  const generateInitialData = useCallback((latestPrice: number): PriceData[] => {
    const data: PriceData[] = [];
    const now = new Date();
    let price = latestPrice;
    
    for (let i = INITIAL_DATA_POINTS; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 2000); // 2 second intervals for better spread
      const change = (Math.random() - 0.5) * 200; // More price movement for visual interest
      price += change;
      
      data.push({
        x: date,
        y: Math.max(price, latestPrice * 0.95) // Prevent too low prices
      });
    }
    
    return data;
  }, []);

  // WebSocket connection and data handling
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus('connecting');
    console.log('🔗 Connecting to Binance WebSocket...');

    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('✅ WebSocket connected');
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const price = parseFloat(data.p);
        
        if (!isNaN(price)) {
          const newDataPoint: PriceData = {
            x: new Date(),
            y: price
          };
          
          // Add to buffer for smooth updates
          priceBufferRef.current.push(newDataPoint);
          setCurrentPrice(price);
        }
      } catch (error) {
        console.error('❌ Error parsing WebSocket data:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      setConnectionStatus('disconnected');
    };

    ws.onclose = () => {
      console.log('🔌 WebSocket disconnected');
      setConnectionStatus('disconnected');
      
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    };
  }, []);

  // Process buffered data and update chart
  const processBufferedData = useCallback(() => {
    const now = Date.now();
    if (now - lastUpdateTimeRef.current >= UPDATE_INTERVAL && priceBufferRef.current.length > 0) {
      const buffer = [...priceBufferRef.current];
      priceBufferRef.current = [];
      
      setPriceData(prevData => {
        const newData = [...prevData];
        
        // Add new data points
        buffer.forEach(point => {
          newData.push(point);
        });
        
        // Keep all data from the session - no trimming
        return newData;
      });
      
      // Just update chart data - let user control panning manually
      if (chartRef.current) {
        chartRef.current.update('none'); // Update data only without animation
      }
      
      lastUpdateTimeRef.current = now;
    }
  }, []);

  // Handle chart clicks for tile placement
  const handleChartClick = useCallback((event: ChartEvent, elements: ActiveElement[], chart: ChartJS) => {
    if (!chart || !event.native) {
      return;
    }

    console.log('🎯 Chart clicked!');

    const rect = (event.native.target as HTMLCanvasElement).getBoundingClientRect();
    const canvasPosition = {
      x: (event.native as MouseEvent).clientX - rect.left,
      y: (event.native as MouseEvent).clientY - rect.top
    };
    
    console.log('📍 Canvas position:', canvasPosition);
    
    const dataX = chart.scales.x.getValueForPixel(canvasPosition.x);
    const dataY = chart.scales.y.getValueForPixel(canvasPosition.y);
    
    console.log('🔄 Raw coordinates:', { dataX, dataY, type: typeof dataX, typeY: typeof dataY });

    if (dataX && dataY && typeof dataX === 'number' && typeof dataY === 'number') {
      const clickTime = new Date(dataX);
      const currentTime = new Date();
      
      console.log('⏰ Time conversion:', {
        clickTime: clickTime.toLocaleString(),
        currentTime: currentTime.toLocaleString(),
        diff: clickTime.getTime() - currentTime.getTime(),
        diffSeconds: (clickTime.getTime() - currentTime.getTime()) / 1000
      });
      
      // Allow placing tiles anywhere - remove future restriction for testing
      // if (clickTime.getTime() <= currentTime.getTime() + 2000) {
      //   alert('⚠️ Tiles can only be placed 2+ seconds in the future!');
      //   return;
      // }
      
      // Create new tile
      const newTile: Tile = {
        id: Date.now().toString(),
        price: dataY,
        date: clickTime,
        x: canvasPosition.x,
        y: canvasPosition.y
      };
      
      setTiles(prev => [...prev, newTile]);
      console.log('✅ Added tile:', {
        price: dataY.toFixed(2),
        time: clickTime.toLocaleString(),
        relativeTime: clickTime > currentTime ? 'future' : 'past',
        timeDiff: Math.round((clickTime.getTime() - currentTime.getTime()) / 1000)
      });
    } else {
      console.log('❌ Invalid coordinates - could not convert click to chart data');
    }
  }, []);

  // Remove tile
  const removeTile = useCallback((id: string) => {
    setTiles(prev => prev.filter(tile => tile.id !== id));
  }, []);

  // Add test tile at future time
  const addTestTile = useCallback(() => {
    if (currentPrice > 0) {
      const futureDate = new Date(Date.now() + 15000); // 15 seconds in future
      const testPrice = currentPrice + (Math.random() - 0.5) * 500; // Random price around current
      
      const newTile: Tile = {
        id: Date.now().toString(),
        price: testPrice,
        date: futureDate,
        x: 0, // Will be positioned correctly by Chart.js
        y: 0
      };
      
      setTiles(prev => [...prev, newTile]);
    }
  }, [currentPrice]);

  // Initialize data and WebSocket
  useEffect(() => {
    // Generate initial data when we first get a price
    if (currentPrice > 0 && priceData.length === 0) {
      const initialData = generateInitialData(currentPrice);
      setPriceData(initialData);
    }
  }, [currentPrice, priceData.length, generateInitialData]);

  useEffect(() => {
    connectWebSocket();

    // Process buffered data regularly
    const processingInterval = setInterval(processBufferedData, UPDATE_INTERVAL);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clearInterval(processingInterval);
    };
  }, [connectWebSocket, processBufferedData]);

  // Connection status styling
  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      case 'disconnected': return 'text-red-500';
    }
  };

  // Chart configuration
  const chartData = {
    datasets: [
      // Price line dataset
      {
        label: 'BTC/USDT',
        data: priceData,
        borderColor: '#f7931a',
        backgroundColor: 'rgba(247, 147, 26, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.1,
        pointRadius: 0, // Hide points on the main line
        pointHoverRadius: 4
      },
      // Tiles dataset (future target points)
      {
        label: 'Target Tiles',
        data: tiles.map(tile => ({
          x: tile.date,
          y: tile.price
        })),
        borderColor: '#ef4444',
        backgroundColor: '#ef4444',
        borderWidth: 3,
        fill: false,
        showLine: false, // Show only points, no connecting lines
        pointRadius: 24, // 3x bigger tiles
        pointHoverRadius: 24, // No hover size change
        pointStyle: 'rect', // Square shape lying on side
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0, // Disable all animations to prevent snapping
    },
    animations: {
      tension: {
        duration: 0 // Disable line tension animations
      },
      x: {
        duration: 0 // Disable x-axis animations
      },
      y: {
        duration: 0 // Disable y-axis animations  
      }
    },
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
    onClick: handleChartClick,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          filter: function(legendItem: LegendItem) {
            // Only show the price line in legend
            return legendItem.datasetIndex === 0;
          }
        }
      },
      title: {
        display: true,
        text: '🎯 Bitcoin Price - Click to Place Future Tiles',
        font: {
          size: 16,
          weight: 'bold' as const
        }
      },
      tooltip: {
        callbacks: {
          title: function(tooltipItems: TooltipItem<'line'>[]) {
            const date = new Date(tooltipItems[0].parsed.x);
            return date.toLocaleString();
          },
          label: function(context: TooltipItem<'line'>) {
            if (context.datasetIndex === 0) {
              return `Price: $${context.parsed.y.toFixed(2)}`;
            } else {
              const isFuture = new Date(context.parsed.x) > new Date();
              return `🎯 Target: $${context.parsed.y.toFixed(2)} ${isFuture ? '(Future)' : '(Past)'}`;
            }
          }
        }
      },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x' as const,
          modifierKey: undefined, // Allow drag without modifier keys
        },
        zoom: {
          wheel: {
            enabled: true,
          },
          pinch: {
            enabled: true
          },
          mode: 'x' as const,
        }
      }
    },
    scales: {
      x: {
        type: 'time' as const,
        display: true,
        title: {
          display: true,
          text: 'Time (Pan to explore full session history) →'
        },
        min: Date.now() - 60000, // Start showing last 60 seconds
        max: Date.now() + 60000, // Plus 60 seconds future
        time: {
          displayFormats: {
            second: 'HH:mm:ss',
            minute: 'HH:mm',
            hour: 'HH:mm'
          },
          tooltipFormat: 'MMM dd, HH:mm:ss',
          unit: 'second' as const
        },
        ticks: {
          source: 'auto' as const,
          maxTicksLimit: 8,
          stepSize: 5 // Show ticks every 5 seconds
        }
      },
      y: {
        display: true,
        title: {
          display: true,
          text: 'Price (USD)'
        },
        ticks: {
          callback: function(value: string | number) {
            return '$' + Number(value).toLocaleString();
          }
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-4 mb-6">
          <div className="mb-4">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              🎯 Tap Tap Win - Bitcoin Price Game
            </h1>
            <p className="text-sm text-gray-600 mb-2">
              Drag to pan left/right • Wheel to zoom • Click anywhere to place squares • Pan right for future tiles
            </p>
            
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
              <p className="text-xs text-gray-500">
                💡 Shows ~2min window • Pan to see full session history • Data never deleted • No auto-jumping
              </p>
              <div className="flex gap-2">
                <button
                  onClick={addTestTile}
                  className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                >
                  Add Test Tile
                </button>
                <button
                  onClick={() => {
                    if (chartRef.current) {
                      chartRef.current.resetZoom();
                    }
                  }}
                  className="px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 transition-colors"
                >
                  Reset View
                </button>
              </div>
            </div>
            
            <div className="text-xs text-blue-600 mb-2">
              📍 Drag to pan • Click chart → Places 🟥 red square • Zoom with wheel • Pan right for future placement area
            </div>
          </div>
          
          {/* Chart Container */}
          <div className="w-full h-[500px]">
            {priceData.length > 0 ? (
              <Line 
                ref={chartRef}
                data={chartData} 
                options={chartOptions}
              />
            ) : (
              <div className="w-full h-full border border-gray-200 rounded bg-white flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                  <p className="text-gray-500">Loading Bitcoin price data...</p>
                  <p className="text-xs text-gray-400">Status: {connectionStatus}</p>
                </div>
              </div>
            )}
          </div>

          {/* Status */}
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="text-sm">
              <span className="text-gray-600">Status: </span>
              <span className={`font-semibold ${getConnectionStatusColor()}`}>
                {connectionStatus}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600">Current BTC Price: </span>
              <span className="font-bold text-green-600">
                ${currentPrice.toFixed(2)}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600">Data Points: </span>
              <span className="font-semibold text-blue-600">
                {priceData.length}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600">Active Tiles: </span>
              <span className="font-semibold text-red-600">
                {tiles.length}
              </span>
            </div>
          </div>
        </div>

        {/* Tiles List */}
        {tiles.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-4">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              🟥 Active Target Squares ({tiles.length})
            </h2>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {tiles.map((tile) => {
                const isFuture = tile.date > new Date();
                const timeToTarget = isFuture 
                  ? Math.round((tile.date.getTime() - Date.now()) / 1000)
                  : Math.round((Date.now() - tile.date.getTime()) / 1000);
                
                return (
                  <div key={tile.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-red-400 rounded-sm"></div>
                      <div>
                        <p className="font-semibold text-gray-800">
                          ${tile.price.toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {tile.date.toLocaleString()}
                        </p>
                        <p className={`text-xs font-medium ${isFuture ? 'text-blue-600' : 'text-orange-600'}`}>
                          {isFuture ? `⏳ ${timeToTarget}s remaining` : `⏰ ${timeToTarget}s ago`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeTile(tile.id)}
                      className="px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TapTapGame;