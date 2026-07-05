import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  DataChartController,
  DataChartViewState,
  createInitialDataChartViewState,
} from '../src/components/controllers/DataChartController';
import { LineChart } from '../src/lib/lineChart';
import { EpisodeDataPoint } from '../src/types';

vi.mock('@/lib/lineChart', () => ({
  LineChart: vi.fn().mockImplementation(() => ({
    getArea: vi.fn(() => ({ x: 60, y: 10, w: 700, h: 300 })),
    toDomXCoord: vi.fn((time: number) => 60 + time * 100),
    destroy: vi.fn(),
  })),
}));

const MockedLineChart = LineChart as unknown as Mock;

const dataPoint = (timestamp: number): EpisodeDataPoint => ({
  episode_index: 0,
  action: [0],
  observation: [1, 2],
  timestamp,
});

describe('DataChartController', () => {
  let rafQueue: FrameRequestCallback[];
  let viewStates: DataChartViewState[];
  let controller: DataChartController;
  let chartElement: HTMLDivElement;
  let marker: HTMLDivElement;

  const flushRaf = (): void => {
    const queue = rafQueue;
    rafQueue = [];
    queue.forEach((callback) => callback(performance.now()));
  };

  const latestChart = () =>
    MockedLineChart.mock.results.at(-1)?.value as {
      getArea: Mock;
      toDomXCoord: Mock;
      destroy: Mock;
    };

  beforeEach(() => {
    vi.clearAllMocks();
    rafQueue = [];
    viewStates = [];
    chartElement = document.createElement('div');
    marker = document.createElement('div');
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    controller = new DataChartController({
      initialEpisodeData: [dataPoint(0)],
      onViewStateChange: (state) => viewStates.push(state),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports hasData from the initial payload', () => {
    expect(createInitialDataChartViewState([])).toEqual({ hasData: false });
    expect(createInitialDataChartViewState([dataPoint(0)])).toEqual({
      hasData: true,
    });
  });

  it('creates a chart once both element and data are present', () => {
    controller.configure({
      episodeData: [dataPoint(0), dataPoint(1)],
      featureNames: ['a', 'b'],
    });
    expect(MockedLineChart).not.toHaveBeenCalled();

    controller.setChartElement(chartElement);
    expect(MockedLineChart).toHaveBeenCalledTimes(1);
    const [element, rows, options] = MockedLineChart.mock.calls[0];
    expect(element).toBe(chartElement);
    expect(rows).toEqual([
      [0, 1, 2],
      [1, 1, 2],
    ]);
    expect(options.labels).toEqual(['a', 'b']);
  });

  it('destroys the previous chart when reconfigured, and flags empty data', () => {
    controller.setChartElement(chartElement);
    controller.configure({
      episodeData: [dataPoint(0)],
      featureNames: ['a', 'b'],
    });
    const firstChart = latestChart();

    controller.configure({ episodeData: [], featureNames: [] });
    expect(firstChart.destroy).toHaveBeenCalled();
    expect(viewStates.at(-1)?.hasData).toBe(false);
  });

  it('positions the playhead marker inside the plot area', () => {
    controller.setChartElement(chartElement);
    controller.setPlayheadMarkerElement(marker);
    controller.configure({
      episodeData: [dataPoint(0), dataPoint(5)],
      featureNames: ['a', 'b'],
    });

    controller.setPlayhead(2);
    flushRaf();

    expect(marker.style.display).toBe('block');
    expect(marker.style.transform).toBe('translateX(260px)');
    expect(marker.style.top).toBe('10px');
    expect(marker.style.height).toBe('300px');
  });

  it('hides the marker when the playhead leaves the visible area', () => {
    controller.setChartElement(chartElement);
    controller.setPlayheadMarkerElement(marker);
    controller.configure({
      episodeData: [dataPoint(0), dataPoint(5)],
      featureNames: ['a', 'b'],
    });

    // 60 + 100*time beyond area.x + area.w (760) is off-screen.
    controller.setPlayhead(20);
    expect(marker.style.display).toBe('none');

    controller.setPlayhead(undefined);
    expect(marker.style.display).toBe('none');
  });

  it('destroys the chart on dispose', () => {
    controller.setChartElement(chartElement);
    controller.configure({
      episodeData: [dataPoint(0)],
      featureNames: ['a', 'b'],
    });
    const chart = latestChart();

    controller.dispose();
    expect(chart.destroy).toHaveBeenCalled();
  });
});
