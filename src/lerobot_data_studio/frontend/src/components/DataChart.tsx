import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
} from 'react';
import { Card, Empty } from 'antd';
import Dygraph from 'dygraphs';
import 'dygraphs/dist/dygraph.css';
import { EpisodeDataPoint } from '@/types';

interface DataChartProps {
  episodeData: EpisodeDataPoint[];
  featureNames: string[];
  currentTime?: number;
}

export interface DataChartHandle {
  setPlayhead: (time: number | undefined) => void;
}

const DataChart = forwardRef<DataChartHandle, DataChartProps>(({
  episodeData,
  featureNames,
  currentTime,
}, ref) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const playheadMarkerRef = useRef<HTMLDivElement>(null);
  const dygraphRef = useRef<Dygraph | null>(null);
  const currentTimeRef = useRef<number | undefined>(currentTime);

  const chartData = useMemo(() => {
    if (!episodeData || episodeData.length === 0) return null;

    try {
      const data = episodeData.map((row) => {
        const timestamp = row.timestamp ?? 0;
        const observation = row.observation || [];

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

  const updatePlayheadMarker = useCallback(() => {
    const graph = dygraphRef.current;
    const marker = playheadMarkerRef.current;
    if (!graph || !marker || currentTimeRef.current === undefined) {
      if (marker) {
        marker.style.display = 'none';
      }
      return;
    }

    const area = graph.getArea();
    const markerX = graph.toDomXCoord(currentTimeRef.current);
    if (markerX < area.x || markerX > area.x + area.w) {
      marker.style.display = 'none';
      return;
    }

    marker.style.display = 'block';
    marker.style.top = `${area.y}px`;
    marker.style.height = `${area.h}px`;
    marker.style.transform = `translateX(${markerX}px)`;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setPlayhead: (time: number | undefined) => {
        currentTimeRef.current = time;
        updatePlayheadMarker();
      },
    }),
    [updatePlayheadMarker]
  );

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
        drawCallback: () => {
          window.requestAnimationFrame(updatePlayheadMarker);
        },
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
      window.requestAnimationFrame(updatePlayheadMarker);
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
  }, [chartData, featureNames, updatePlayheadMarker]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
    updatePlayheadMarker();
  }, [currentTime, updatePlayheadMarker]);

  return (
    <Card title='Episode Data'>
      {chartData && chartData.length > 0 ? (
        <div
          style={{ position: 'relative', width: '100%', height: '400px' }}
        >
          <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
          <div
            ref={playheadMarkerRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 2,
              height: 0,
              backgroundColor: '#ff6b6b',
              display: 'none',
              pointerEvents: 'none',
              transform: 'translateX(0)',
              zIndex: 2,
            }}
          />
        </div>
      ) : (
        <Empty description='No data available for this episode' />
      )}
    </Card>
  );
});

DataChart.displayName = 'DataChart';

export default DataChart;
