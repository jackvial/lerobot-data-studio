import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DatasetViewerController,
  DatasetViewerViewState,
  createInitialDatasetViewerViewState,
  parseRouteEpisodeId,
} from '../src/components/controllers/DatasetViewerController';
import { ApiError, datasetApi } from '../src/services/api';
import { EpisodeData } from '../src/types';

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    ...actual,
    datasetApi: {
      getDatasetStatus: vi.fn(),
      getEpisode: vi.fn(),
      listEpisodes: vi.fn(),
      createDataset: vi.fn(),
      getCreateStatus: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(datasetApi);

const apiError = (status: number, detail?: unknown): ApiError =>
  new ApiError(status, '', detail === undefined ? undefined : { detail });

const episodeData = (numEpisodes: number): EpisodeData => ({
  episode_id: 0,
  dataset_info: {
    repo_id: 'ns/name',
    num_samples: 100,
    num_episodes: numEpisodes,
    fps: 30,
  },
  videos_info: [],
  episode_data: [],
  feature_names: [],
  tasks: [],
});

describe('parseRouteEpisodeId', () => {
  it('parses valid ids and falls back to 0', () => {
    expect(parseRouteEpisodeId('7')).toBe(7);
    expect(parseRouteEpisodeId(undefined)).toBe(0);
    expect(parseRouteEpisodeId('not-a-number')).toBe(0);
  });
});

describe('DatasetViewerController', () => {
  let viewStates: DatasetViewerViewState[];
  let controller: DatasetViewerController;

  beforeEach(() => {
    vi.clearAllMocks();
    viewStates = [];
    controller = new DatasetViewerController({
      initialEpisodeId: '2',
      onViewStateChange: (state) => viewStates.push(state),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes view state from the route episode id', () => {
    expect(createInitialDatasetViewerViewState('2').currentEpisodeId).toBe(2);
  });

  it('computes the episode route only when it differs from the current route', () => {
    expect(
      controller.getEpisodeRoute({
        namespace: 'ns',
        name: 'name',
        routeEpisodeId: '2',
      })
    ).toBeNull();

    controller.setCurrentEpisodeId(5);
    expect(
      controller.getEpisodeRoute({
        namespace: 'ns',
        name: 'name',
        routeEpisodeId: '2',
      })
    ).toBe('/ns/name/episode/5');
  });

  it('navigates with arrow keys within bounds', () => {
    const toggleEpisode = vi.fn();
    const options = { episodeData: episodeData(4), toggleEpisode };

    controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
      options
    );
    expect(viewStates.at(-1)?.currentEpisodeId).toBe(3);

    // At the last episode, ArrowRight is a no-op.
    controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
      options
    );
    expect(viewStates.at(-1)?.currentEpisodeId).toBe(3);

    controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft' }),
      options
    );
    expect(viewStates.at(-1)?.currentEpisodeId).toBe(2);
  });

  it('toggles selection with cmd/ctrl+k and opens shortcuts with cmd/ctrl+p', () => {
    const toggleEpisode = vi.fn();
    controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
      { episodeData: episodeData(4), toggleEpisode }
    );
    expect(toggleEpisode).toHaveBeenCalledWith(2);

    controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'p', metaKey: true }),
      { episodeData: episodeData(4), toggleEpisode }
    );
    expect(viewStates.at(-1)?.isShortcutsModalVisible).toBe(true);
  });

  it('forwards video time straight to the chart playhead without view-state churn', () => {
    const setPlayhead = vi.fn();
    controller.setDataChart({ setPlayhead });
    setPlayhead.mockClear();

    controller.handleVideoTimeUpdate(1.5);
    controller.handleVideoTimeUpdate(2.5, { force: true });

    expect(setPlayhead).toHaveBeenNthCalledWith(1, 1.5);
    expect(setPlayhead).toHaveBeenNthCalledWith(2, 2.5);
    // Seek/time updates must never re-render the viewer tree.
    expect(viewStates).toHaveLength(0);
  });

  it('pushes the latest playback time to a chart that mounts late', () => {
    controller.handleVideoTimeUpdate(3.5);

    const setPlayhead = vi.fn();
    controller.setDataChart({ setPlayhead });

    expect(setPlayhead).toHaveBeenCalledWith(3.5);
  });

  it('auto-loads the dataset when the initial status probe reports not_loaded', async () => {
    mockedApi.getDatasetStatus
      .mockResolvedValueOnce({ status: 'not_loaded' })
      .mockResolvedValueOnce({ status: 'loading', progress: 0.1 });

    const status = await controller.loadDatasetStatus('ns', 'name');

    expect(status).toEqual({ status: 'loading', progress: 0.1 });
    expect(mockedApi.getDatasetStatus).toHaveBeenNthCalledWith(1, 'ns', 'name', false);
    expect(mockedApi.getDatasetStatus).toHaveBeenNthCalledWith(2, 'ns', 'name', true);
  });

  it('maps dataset status to a poll interval', () => {
    expect(controller.getDatasetStatusRefetchInterval({ status: 'loading' })).toBe(1000);
    expect(controller.getDatasetStatusRefetchInterval({ status: 'not_loaded' })).toBe(1000);
    expect(controller.getDatasetStatusRefetchInterval({ status: 'ready' })).toBe(5000);
    expect(controller.getDatasetStatusRefetchInterval({ status: 'error' })).toBe(false);
    expect(controller.getDatasetStatusRefetchInterval(undefined)).toBe(false);
  });

  it('does not retry episode loads rejected with 202 (dataset still loading)', () => {
    expect(controller.shouldRetryEpisodeQuery(1, apiError(202))).toBe(false);
    expect(controller.shouldRetryEpisodeQuery(1, apiError(500))).toBe(true);
    expect(controller.shouldRetryEpisodeQuery(2, apiError(500))).toBe(false);
    expect(controller.shouldInvalidateDatasetStatusForEpisodeError(apiError(202))).toBe(true);
    expect(controller.shouldInvalidateDatasetStatusForEpisodeError(new Error('x'))).toBe(false);
  });

  it('validates inputs before building a create-dataset payload', () => {
    expect(
      controller.prepareCreateDataset({
        values: { new_repo_id: 'me/new' },
        datasetId: 'ns/name',
        episodeData: undefined,
        selectedEpisodes: [1],
      }).error
    ).toBe('Episode data not loaded');

    expect(
      controller.prepareCreateDataset({
        values: { new_repo_id: 'me/new' },
        datasetId: 'ns/name',
        episodeData: episodeData(4),
        selectedEpisodes: [],
      }).error
    ).toBe('No episodes selected');

    const prepared = controller.prepareCreateDataset({
      values: { new_repo_id: 'me/new' },
      datasetId: 'ns/name',
      episodeData: episodeData(4),
      selectedEpisodes: [0, 2],
    });
    expect(prepared.error).toBeNull();
    expect(prepared.payload).toEqual({
      original_repo_id: 'ns/name',
      new_repo_id: 'me/new',
      selected_episodes: [0, 2],
    });
  });

  it('shows the status modal when creation starts a background task', () => {
    const handlers = {
      resetForm: vi.fn(),
      clearSelection: vi.fn(),
      notifyInfo: vi.fn(),
      notifySuccess: vi.fn(),
    };

    controller.handleCreateDatasetSuccess(
      { success: true, new_repo_id: 'me/new', message: 'ok', task_id: 'task-1' },
      handlers
    );

    expect(viewStates.at(-1)?.creationTaskId).toBe('task-1');
    expect(viewStates.at(-1)?.showStatusModal).toBe(true);
    expect(handlers.notifyInfo).toHaveBeenCalled();
    expect(handlers.resetForm).not.toHaveBeenCalled();
  });

  it('formats FastAPI validation errors on creation failure', () => {
    const notifyError = vi.fn();

    controller.handleCreateDatasetError(
      apiError(422, [
        { loc: ['body', 'new_repo_id'], msg: 'field required' },
      ]),
      { notifyError }
    );
    expect(notifyError).toHaveBeenCalledWith(
      'Validation errors:\nbody.new_repo_id: field required'
    );

    controller.handleCreateDatasetError(apiError(400, 'Bad repo id'), {
      notifyError,
    });
    expect(notifyError).toHaveBeenCalledWith('Bad repo id');

    controller.handleCreateDatasetError(new Error('network'), { notifyError });
    expect(notifyError).toHaveBeenCalledWith('Failed to create dataset');
  });

  describe('creation status polling', () => {
    const handlers = () => ({
      resetForm: vi.fn(),
      clearSelection: vi.fn(),
      notifyWarning: vi.fn(),
    });

    const startTask = (): void => {
      controller.handleCreateDatasetSuccess(
        { success: true, new_repo_id: 'me/new', message: 'ok', task_id: 'task-1' },
        {
          resetForm: vi.fn(),
          clearSelection: vi.fn(),
          notifyInfo: vi.fn(),
          notifySuccess: vi.fn(),
        }
      );
    };

    it('is a no-op without an active task', () => {
      const stop = controller.startCreationStatusPolling(handlers());
      stop();
      expect(mockedApi.getCreateStatus).not.toHaveBeenCalled();
    });

    it('clears the task and resets the form when creation completes', async () => {
      vi.useFakeTimers();
      startTask();
      const pollHandlers = handlers();
      mockedApi.getCreateStatus.mockResolvedValue({
        task_id: 'task-1',
        status: 'completed',
        progress: 1,
        new_repo_id: 'me/new',
      });

      const stop = controller.startCreationStatusPolling(pollHandlers);
      await vi.advanceTimersByTimeAsync(0);

      expect(viewStates.at(-1)?.creationTaskId).toBeNull();
      expect(viewStates.at(-1)?.isCreateModalVisible).toBe(false);
      expect(pollHandlers.resetForm).toHaveBeenCalled();
      expect(pollHandlers.clearSelection).toHaveBeenCalled();
      stop();
    });

    it('reports a failed task when the backend forgot the task id (restart)', async () => {
      vi.useFakeTimers();
      startTask();
      const pollHandlers = handlers();
      mockedApi.getCreateStatus.mockRejectedValue(apiError(404, 'Task not found'));

      const stop = controller.startCreationStatusPolling(pollHandlers);
      await vi.advanceTimersByTimeAsync(0);

      const finalState = viewStates.at(-1);
      expect(finalState?.creationTaskId).toBeNull();
      expect(finalState?.creationStatus?.status).toBe('failed');
      expect(pollHandlers.notifyWarning).toHaveBeenCalled();
      stop();
    });

    it('polls every two seconds until stopped', async () => {
      vi.useFakeTimers();
      startTask();
      mockedApi.getCreateStatus.mockResolvedValue({
        task_id: 'task-1',
        status: 'running',
        progress: 0.5,
      });

      const stop = controller.startCreationStatusPolling(handlers());
      await vi.advanceTimersByTimeAsync(0);
      expect(mockedApi.getCreateStatus).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4000);
      expect(mockedApi.getCreateStatus).toHaveBeenCalledTimes(3);
      expect(viewStates.at(-1)?.creationStatus?.status).toBe('running');

      stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockedApi.getCreateStatus).toHaveBeenCalledTimes(3);
    });
  });
});
