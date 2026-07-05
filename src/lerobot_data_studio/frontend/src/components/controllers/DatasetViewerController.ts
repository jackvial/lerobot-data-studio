import { datasetApi, getApiErrorDetail, getApiErrorStatus } from '@/services/api';
import {
  CreateDatasetRequest,
  CreateDatasetResponse,
  CreateTaskStatus,
  DatasetLoadingStatus,
  EpisodeData,
} from '@/types';
import { createDatasetRequest } from '@/utils/createDataset';
import type { DataChartHandle } from './DataChartController';
import type { VideoTimeUpdateOptions } from './VideoPlayerController';

export interface DatasetViewerViewState {
  currentEpisodeId: number;
  isCreateModalVisible: boolean;
  isShortcutsModalVisible: boolean;
  creationTaskId: string | null;
  creationStatus: CreateTaskStatus | null;
  showStatusModal: boolean;
}

interface DatasetViewerControllerOptions {
  initialEpisodeId: string | undefined;
  onViewStateChange: (state: DatasetViewerViewState) => void;
}

interface EpisodeRouteParams {
  namespace: string | undefined;
  name: string | undefined;
  routeEpisodeId: string | undefined;
}

interface CreateDatasetFormValues {
  new_repo_id: string;
}

interface CreateDatasetInput {
  values: CreateDatasetFormValues;
  datasetId: string;
  episodeData: EpisodeData | undefined;
  selectedEpisodes: number[];
}

interface CreateDatasetPreparation {
  error: string | null;
  payload: CreateDatasetRequest | null;
}

interface CreationSuccessHandlers {
  resetForm: () => void;
  clearSelection: () => void;
  notifyInfo: (content: string) => void;
  notifySuccess: (content: string) => void;
}

interface CreationErrorHandlers {
  notifyError: (content: string) => void;
}

interface CreationPollingHandlers {
  resetForm: () => void;
  clearSelection: () => void;
  notifyWarning: (content: string) => void;
}

export const parseRouteEpisodeId = (episodeId: string | undefined): number => {
  if (!episodeId) {
    return 0;
  }

  const parsedEpisodeId = Number.parseInt(episodeId, 10);
  return Number.isFinite(parsedEpisodeId) ? parsedEpisodeId : 0;
};

export const createInitialDatasetViewerViewState = (
  episodeId: string | undefined
): DatasetViewerViewState => ({
  currentEpisodeId: parseRouteEpisodeId(episodeId),
  isCreateModalVisible: false,
  isShortcutsModalVisible: false,
  creationTaskId: null,
  creationStatus: null,
  showStatusModal: false,
});

export class DatasetViewerController {
  private viewState: DatasetViewerViewState;
  private dataChart: DataChartHandle | null = null;
  private currentVideoTime = 0;
  private readonly onViewStateChange: (state: DatasetViewerViewState) => void;

  constructor({
    initialEpisodeId,
    onViewStateChange,
  }: DatasetViewerControllerOptions) {
    this.viewState = createInitialDatasetViewerViewState(initialEpisodeId);
    this.onViewStateChange = onViewStateChange;
  }

  setDataChart(handle: DataChartHandle | null): void {
    this.dataChart = handle;
    this.dataChart?.setPlayhead(this.currentVideoTime);
  }

  syncRouteEpisodeId(episodeId: string | undefined): void {
    const currentEpisodeId = parseRouteEpisodeId(episodeId);
    if (currentEpisodeId !== this.viewState.currentEpisodeId) {
      this.setViewState({ currentEpisodeId });
    }
  }

  getDatasetId(namespace: string | undefined, name: string | undefined): string {
    return `${namespace}/${name}`;
  }

  canLoadDataset(
    namespace: string | undefined,
    name: string | undefined
  ): boolean {
    return Boolean(namespace && name);
  }

  async loadDatasetStatus(
    namespace: string,
    name: string
  ): Promise<DatasetLoadingStatus> {
    const initialStatus = await datasetApi.getDatasetStatus(
      namespace,
      name,
      false
    );

    if (initialStatus.status === 'not_loaded') {
      return datasetApi.getDatasetStatus(namespace, name, true);
    }

    return initialStatus;
  }

  getDatasetStatusRefetchInterval(
    status: DatasetLoadingStatus | undefined
  ): number | false {
    if (status?.status === 'loading' || status?.status === 'not_loaded') {
      return 1000;
    }

    if (status?.status === 'ready') {
      return 5000;
    }

    return false;
  }

  canLoadEpisode(
    namespace: string | undefined,
    name: string | undefined,
    status: DatasetLoadingStatus | undefined
  ): boolean {
    return Boolean(namespace && name && status?.status === 'ready');
  }

  loadEpisode(
    namespace: string,
    name: string,
    episodeId = this.viewState.currentEpisodeId
  ): Promise<EpisodeData> {
    return datasetApi.getEpisode(namespace, name, episodeId);
  }

  shouldRetryEpisodeQuery(failureCount: number, error: unknown): boolean {
    if (getApiErrorStatus(error) === 202) {
      return false;
    }

    return failureCount < 2;
  }

  shouldInvalidateDatasetStatusForEpisodeError(error: unknown): boolean {
    return getApiErrorStatus(error) === 202;
  }

  listEpisodes(
    namespace: string,
    name: string
  ): Promise<{ episodes: number[] }> {
    return datasetApi.listEpisodes(namespace, name);
  }

  getEpisodeRoute({
    namespace,
    name,
    routeEpisodeId,
  }: EpisodeRouteParams): string | null {
    if (!namespace || !name) {
      return null;
    }

    if (this.viewState.currentEpisodeId === parseRouteEpisodeId(routeEpisodeId)) {
      return null;
    }

    return `/${namespace}/${name}/episode/${this.viewState.currentEpisodeId}`;
  }

  setCurrentEpisodeId(currentEpisodeId: number): void {
    this.setViewState({ currentEpisodeId });
  }

  resetPlaybackTime(): void {
    this.currentVideoTime = 0;
    this.dataChart?.setPlayhead(0);
  }

  // Playback time flows straight to the chart handle; it deliberately never
  // touches the view state so seeking cannot re-render the viewer tree.
  handleVideoTimeUpdate(time: number, _options?: VideoTimeUpdateOptions): void {
    this.currentVideoTime = time;
    this.dataChart?.setPlayhead(time);
  }

  handleKeyboardEvent(
    event: KeyboardEvent,
    options: {
      episodeData: EpisodeData | undefined;
      toggleEpisode: (episodeId: number) => void;
    }
  ): void {
    if (this.shouldIgnoreKeyboardEvent(event)) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (this.viewState.currentEpisodeId > 0) {
        this.setCurrentEpisodeId(this.viewState.currentEpisodeId - 1);
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const totalEpisodes = options.episodeData?.dataset_info.num_episodes;
      if (
        totalEpisodes != null &&
        this.viewState.currentEpisodeId < totalEpisodes - 1
      ) {
        this.setCurrentEpisodeId(this.viewState.currentEpisodeId + 1);
      }
      return;
    }

    if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      options.toggleEpisode(this.viewState.currentEpisodeId);
      return;
    }

    if (event.key === 'p' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.openShortcutsModal();
    }
  }

  openCreateModal(): void {
    this.setViewState({ isCreateModalVisible: true });
  }

  closeCreateModal(): void {
    this.setViewState({ isCreateModalVisible: false });
  }

  openShortcutsModal(): void {
    this.setViewState({ isShortcutsModalVisible: true });
  }

  closeShortcutsModal(): void {
    this.setViewState({ isShortcutsModalVisible: false });
  }

  closeStatusModal(): void {
    this.setViewState({
      showStatusModal: false,
      creationStatus: null,
    });
  }

  prepareCreateDataset({
    values,
    datasetId,
    episodeData,
    selectedEpisodes,
  }: CreateDatasetInput): CreateDatasetPreparation {
    if (!episodeData) {
      return { error: 'Episode data not loaded', payload: null };
    }

    if (selectedEpisodes.length === 0) {
      return { error: 'No episodes selected', payload: null };
    }

    return {
      error: null,
      payload: createDatasetRequest({
        datasetId,
        newRepoId: values.new_repo_id,
        selectedEpisodes,
      }),
    };
  }

  createDataset(
    payload: CreateDatasetRequest
  ): Promise<CreateDatasetResponse> {
    return datasetApi.createDataset(payload);
  }

  handleCreateDatasetSuccess(
    data: CreateDatasetResponse,
    handlers: CreationSuccessHandlers
  ): void {
    if (data.task_id) {
      this.setViewState({
        creationTaskId: data.task_id,
        showStatusModal: true,
      });
      handlers.notifyInfo('Dataset creation started. Please wait...');
      return;
    }

    handlers.notifySuccess(data.message);
    this.setViewState({ isCreateModalVisible: false });
    handlers.resetForm();
    handlers.clearSelection();
  }

  handleCreateDatasetError(
    error: unknown,
    handlers: CreationErrorHandlers
  ): void {
    console.error('Create dataset error:', error);
    handlers.notifyError(this.formatCreateDatasetError(error));
  }

  startCreationStatusPolling(
    handlers: CreationPollingHandlers
  ): () => void {
    const taskId = this.viewState.creationTaskId;
    if (!taskId) {
      return () => undefined;
    }

    const pollStatus = async () => {
      try {
        const status = await datasetApi.getCreateStatus(taskId);
        this.setViewState({ creationStatus: status });

        if (status.status === 'completed') {
          this.setViewState({
            creationTaskId: null,
            isCreateModalVisible: false,
          });
          handlers.resetForm();
          handlers.clearSelection();
        } else if (status.status === 'failed') {
          this.setViewState({ creationTaskId: null });
        }
      } catch (error) {
        if (getApiErrorStatus(error) === 404) {
          this.setViewState({
            creationTaskId: null,
            creationStatus: {
              task_id: taskId,
              status: 'failed',
              progress: 0,
              message: [
                'The backend restarted while tracking this dataset creation.',
                'Start the creation again to continue.',
              ].join(' '),
            },
          });
          handlers.notifyWarning(
            'Backend reloaded while creating the dataset, so progress tracking was reset.'
          );
          return;
        }

        console.error('Error polling creation status:', error);
      }
    };

    const interval = window.setInterval(pollStatus, 2000);
    void pollStatus();

    return () => window.clearInterval(interval);
  }

  private formatCreateDatasetError(error: unknown): string {
    const detail = getApiErrorDetail(error);

    if (Array.isArray(detail)) {
      const validationErrors = detail
        .map((err) => `${err.loc.join('.')}: ${err.msg}`)
        .join('\n');
      return `Validation errors:\n${validationErrors}`;
    }

    if (typeof detail === 'string') {
      return detail;
    }

    return 'Failed to create dataset';
  }

  private shouldIgnoreKeyboardEvent(event: KeyboardEvent): boolean {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
  }

  private setViewState(partialState: Partial<DatasetViewerViewState>): void {
    const nextState = {
      ...this.viewState,
      ...partialState,
    };

    if (
      nextState.currentEpisodeId === this.viewState.currentEpisodeId &&
      nextState.isCreateModalVisible ===
        this.viewState.isCreateModalVisible &&
      nextState.isShortcutsModalVisible ===
        this.viewState.isShortcutsModalVisible &&
      nextState.creationTaskId === this.viewState.creationTaskId &&
      nextState.creationStatus === this.viewState.creationStatus &&
      nextState.showStatusModal === this.viewState.showStatusModal
    ) {
      return;
    }

    this.viewState = nextState;
    this.onViewStateChange(nextState);
  }
}
