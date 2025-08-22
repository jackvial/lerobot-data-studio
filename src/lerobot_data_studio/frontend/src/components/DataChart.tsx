import React, { useEffect, useRef, useMemo } from 'react';
import { Card, Empty } from 'antd';
import Dygraph from 'dygraphs';
import 'dygraphs/dist/dygraph.css';

interface DataChartProps {
  episodeData: Record<string, number[]>[];
  featureNames: string[];
  currentTime?: number;
}

const DataChart: React.FC<DataChartProps> = ({
  episodeData,
  featureNames,
  currentTime,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const dygraphRef = useRef<Dygraph | null>(null);

  const chartData = useMemo(() => {
    if (!episodeData || episodeData.length === 0) return null;

    try {
      const data = episodeData.map((row: any) => {
        const timestamp = row['timestamp'] || 0;
        const observation = row['observation'] || [];

        // In Dygraph the first value is always the X axis
        // all other values will be plotted on the Y axis
        return [timestamp, ...observation];
      });

      return data;
    } catch (error) {
      console.error('Error converting JSON to array format:', error);
      return null;
    }
  }, [episodeData]);

  useEffect(() => {
    if (!chartRef.current || !chartData || chartData.length === 0) return;

    // Clean up previous chart
    if (dygraphRef.current) {
      dygraphRef.current.destroy();
    }

    try {
      dygraphRef.current = new Dygraph(chartRef.current, chartData, {
        labels: ['Time', ...featureNames],
        showRoller: true,
        rollPeriod: 1,
        animatedZooms: false,
        legend: 'always',
        labelsSeparateLines: true,
        highlightCircleSize: 5,
        strokeWidth: 1.5,
        gridLineColor: '#ddd',
        axisLineColor: '#999',
        axisLabelFontSize: 12,
        xLabelHeight: 18,
        yLabelWidth: 50,
        drawPoints: false,
        pointSize: 3,
        hideOverlayOnMouseOut: false,
        showRangeSelector: true,
        rangeSelectorHeight: 40,
        rangeSelectorPlotStrokeColor: '#666',
        rangeSelectorPlotFillColor: '#666',
        interactionModel: Dygraph.defaultInteractionModel,
        xValueParser: (x: string) => parseFloat(x),
        axes: {
          x: {
            axisLabelFormatter: (x: number | Date) => {
              // Handle both number and Date types
              if (typeof x === 'number') {
                return `${x.toFixed(2)}s`;
              }
              // This shouldn't happen with our xValueParser, but handle it gracefully
              return x.toString();
            },
            valueFormatter: (x: number) => {
              return `${x.toFixed(3)} seconds`;
            },
          },
        },
        xlabel: 'Time (seconds)',
      });
    } catch (error) {
      console.error('Error creating Dygraph:', error);
    }

    // Cleanup function
    return () => {
      if (dygraphRef.current) {
        dygraphRef.current.destroy();
        dygraphRef.current = null;
      }
    };
  }, [chartData, featureNames]);

  // Update vertical line when currentTime changes
  useEffect(() => {
    if (dygraphRef.current && currentTime !== undefined) {
      // Draw a vertical line at the current time
      dygraphRef.current.updateOptions({
        underlayCallback: (canvas, area, g) => {
          const x = g.toDomXCoord(currentTime);

          // Only draw if the time is within the visible range
          if (x >= area.x && x <= area.x + area.w) {
            canvas.strokeStyle = '#ff6b6b';
            canvas.lineWidth = 2;
            canvas.beginPath();
            canvas.moveTo(x, area.y);
            canvas.lineTo(x, area.y + area.h);
            canvas.stroke();
          }
        },
      });
    }
  }, [currentTime]);

  return (
    <Card title='Episode Data'>
      {chartData && chartData.length > 0 ? (
        <div ref={chartRef} style={{ width: '100%', height: '400px' }} />
      ) : (
        <Empty description='No data available for this episode' />
      )}
    </Card>
  );
};

export default DataChart;
