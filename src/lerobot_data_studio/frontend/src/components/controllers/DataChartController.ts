import { LineChart } from '@/lib/lineChart';
import { EpisodeDataPoint } from '@/types';

export interface DataChartHandle {
  setPlayhead: (time: number | undefined) => void;
}

export interface DataChartViewState {
  hasData: boolean;
}

interface DataChartControllerOptions {
  initialEpisodeData: EpisodeDataPoint[];
  initialCurrentTime?: number;
  onViewStateChange: (state: DataChartViewState) => void;
}

interface DataChartSourceConfig {
  episodeData: EpisodeDataPoint[];
  featureNames: string[];
}

type ChartDataRow = [number, ...number[]];

export const createInitialDataChartViewState = (
  episodeData: EpisodeDataPoint[]
): DataChartViewState => ({
  hasData: episodeData.length > 0,
});

export class DataChartController {
  private chartElement: HTMLDivElement | null = null;
  private playheadMarkerElement: HTMLDivElement | null = null;
  private chart: LineChart | null = null;
  private chartData: ChartDataRow[] | null = null;
  private featureNames: string[] = [];
  private currentTime: number | undefined;
  private viewState: DataChartViewState;
  private readonly onViewStateChange: (state: DataChartViewState) => void;

  constructor({
    initialEpisodeData,
    initialCurrentTime,
    onViewStateChange,
  }: DataChartControllerOptions) {
    this.currentTime = initialCurrentTime;
    this.onViewStateChange = onViewStateChange;
    this.viewState = createInitialDataChartViewState(initialEpisodeData);
  }

  setChartElement(element: HTMLDivElement | null): void {
    this.chartElement = element;
    this.renderChart();
  }

  setPlayheadMarkerElement(element: HTMLDivElement | null): void {
    this.playheadMarkerElement = element;
    this.updatePlayheadMarker();
  }

  configure({ episodeData, featureNames }: DataChartSourceConfig): void {
    this.featureNames = featureNames;
    this.chartData = this.createChartData(episodeData);
    this.setViewState({ hasData: Boolean(this.chartData?.length) });
    this.renderChart();
  }

  setPlayhead(time: number | undefined): void {
    this.currentTime = time;
    this.updatePlayheadMarker();
  }

  dispose(): void {
    this.destroyChart();
  }

  private createChartData(
    episodeData: EpisodeDataPoint[]
  ): ChartDataRow[] | null {
    if (episodeData.length === 0) {
      return null;
    }

    return episodeData.map((row) => {
      const timestamp = row.timestamp ?? 0;
      const observation = row.observation || [];
      return [timestamp, ...observation];
    });
  }

  private renderChart(): void {
    this.destroyChart();

    if (!this.chartElement || !this.chartData?.length) {
      return;
    }

    this.chart = new LineChart(this.chartElement, this.chartData, {
      labels: this.featureNames,
      xLabel: 'Time (seconds)',
      onDraw: () => {
        window.requestAnimationFrame(() => this.updatePlayheadMarker());
      },
    });
    window.requestAnimationFrame(() => this.updatePlayheadMarker());
  }

  private updatePlayheadMarker(): void {
    const marker = this.playheadMarkerElement;

    if (!this.chart || !marker || this.currentTime === undefined) {
      if (marker) {
        marker.style.display = 'none';
      }
      return;
    }

    const area = this.chart.getArea();
    const markerX = this.chart.toDomXCoord(this.currentTime);

    if (markerX < area.x || markerX > area.x + area.w) {
      marker.style.display = 'none';
      return;
    }

    marker.style.display = 'block';
    marker.style.top = `${area.y}px`;
    marker.style.height = `${area.h}px`;
    marker.style.transform = `translateX(${markerX}px)`;
  }

  private destroyChart(): void {
    if (!this.chart) {
      return;
    }

    this.chart.destroy();
    this.chart = null;
  }

  private setViewState(partialState: Partial<DataChartViewState>): void {
    const nextState = {
      ...this.viewState,
      ...partialState,
    };

    if (nextState.hasData === this.viewState.hasData) {
      return;
    }

    this.viewState = nextState;
    this.onViewStateChange(nextState);
  }
}
