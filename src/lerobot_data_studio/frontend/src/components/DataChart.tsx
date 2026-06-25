import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Card, Empty } from 'antd';
import 'dygraphs/dist/dygraph.css';
import { EpisodeDataPoint } from '@/types';
import {
  DataChartController,
  createInitialDataChartViewState,
  type DataChartHandle,
  type DataChartViewState,
} from './controllers/DataChartController';

export type { DataChartHandle } from './controllers/DataChartController';

interface DataChartProps {
  episodeData: EpisodeDataPoint[];
  featureNames: string[];
  currentTime?: number;
}

const DataChart = forwardRef<DataChartHandle, DataChartProps>(
  ({ episodeData, featureNames, currentTime }, ref) => {
    const [viewState, setViewState] = useState<DataChartViewState>(() =>
      createInitialDataChartViewState(episodeData)
    );
    const controllerRef = useRef<DataChartController | null>(null);

    if (controllerRef.current === null) {
      controllerRef.current = new DataChartController({
        initialEpisodeData: episodeData,
        initialCurrentTime: currentTime,
        onViewStateChange: setViewState,
      });
    }

    const controller = controllerRef.current;

    useEffect(() => {
      controller.configure({ episodeData, featureNames });
    }, [controller, episodeData, featureNames]);

    useEffect(() => {
      controller.setPlayhead(currentTime);
    }, [controller, currentTime]);

    useEffect(() => () => controller.dispose(), [controller]);

    useImperativeHandle(
      ref,
      () => ({
        setPlayhead: (time: number | undefined) => {
          controller.setPlayhead(time);
        },
      }),
      [controller]
    );

    const handleChartRef = useCallback(
      (element: HTMLDivElement | null) => {
        controller.setChartElement(element);
      },
      [controller]
    );

    const handlePlayheadMarkerRef = useCallback(
      (element: HTMLDivElement | null) => {
        controller.setPlayheadMarkerElement(element);
      },
      [controller]
    );

    return (
      <Card title='Episode Data'>
        {viewState.hasData ? (
          <div style={{ position: 'relative', width: '100%', height: '400px' }}>
            <div ref={handleChartRef} style={{ width: '100%', height: '100%' }} />
            <div
              ref={handlePlayheadMarkerRef}
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
  }
);

DataChart.displayName = 'DataChart';

export default DataChart;
