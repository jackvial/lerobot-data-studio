import Dygraph from 'dygraphs';
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

type DygraphDataRow = [number, ...number[]];

export const createInitialDataChartViewState = (
  episodeData: EpisodeDataPoint[]
): DataChartViewState => ({
  hasData: episodeData.length > 0,
});

export class DataChartController {
  private chartElement: HTMLDivElement | null = null;
  private playheadMarkerElement: HTMLDivElement | null = null;
  private dygraph: Dygraph | null = null;
  private chartData: DygraphDataRow[] | null = null;
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
  ): DygraphDataRow[] | null {
    if (episodeData.length === 0) {
      return null;
    }

    try {
      return episodeData.map((row) => {
        const timestamp = row.timestamp ?? 0;
        const observation = row.observation || [];
        return [timestamp, ...observation];
      });
    } catch (error) {
      console.error('Error converting JSON to array format:', error);
      return null;
    }
  }

  private renderChart(): void {
    if (!this.chartElement || !this.chartData?.length) {
      this.destroyChart();
      return;
    }

    this.destroyChart();

    try {
      this.dygraph = new Dygraph(this.chartElement, this.chartData, {
        labels: ['Time', ...this.featureNames],
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
          window.requestAnimationFrame(() => this.updatePlayheadMarker());
        },
        axes: {
          x: {
            axisLabelFormatter: (x: number | Date) => {
              if (typeof x === 'number') {
                return `${x.toFixed(2)}s`;
              }
              return x.toString();
            },
            valueFormatter: (x: number) => `${x.toFixed(3)} seconds`,
          },
        },
        xlabel: 'Time (seconds)',
      });
      window.requestAnimationFrame(() => this.updatePlayheadMarker());
    } catch (error) {
      console.error('Error creating Dygraph:', error);
    }
  }

  private updatePlayheadMarker(): void {
    const marker = this.playheadMarkerElement;

    if (!this.dygraph || !marker || this.currentTime === undefined) {
      if (marker) {
        marker.style.display = 'none';
      }
      return;
    }

    const area = this.dygraph.getArea();
    const markerX = this.dygraph.toDomXCoord(this.currentTime);

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
    if (!this.dygraph) {
      return;
    }

    this.dygraph.destroy();
    this.dygraph = null;
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
