import { describe, it, expect } from 'vitest';
import { createDatasetRequest } from '../src/utils/createDataset';

describe('createDatasetRequest', () => {
  it('should build payload with episode and available tasks', async () => {
    const datasetId = 'namespace/dataset';
    const newRepoId = 'namespace/new-dataset';
    const selectedEpisodes = [0, 1, 2];

    const mockGetEpisodeTask = (id: number) => (id === 1 ? 'override' : undefined);

    const payload = createDatasetRequest({
      datasetId,
      newRepoId,
      selectedEpisodes,
      getEpisodeTask: mockGetEpisodeTask,
    });

    expect(payload.original_repo_id).toBe(datasetId);
    expect(payload.new_repo_id).toBe(newRepoId);
    expect(payload.selected_episodes).toEqual(selectedEpisodes);
    expect(payload.episode_index_task_map).toEqual({ 1: 'override' });
  });

  it('should omit episode_index_task_map when none are assigned', async () => {
    const payload = createDatasetRequest({
      datasetId: 'repo',
      newRepoId: 'repo/new',
      selectedEpisodes: [0, 1],
      getEpisodeTask: () => undefined,
    });

    expect(payload.episode_index_task_map).toBeUndefined();
  });

  it('should handle multiple episode task assignments', async () => {
    const selectedEpisodes = [0, 1, 2, 3, 4];
    const mockGetEpisodeTask = (id: number) => {
      switch (id) {
        case 1:
          return 'taskA';
        case 3:
          return 'taskB';
        case 4:
          return 'taskA';
        default:
          return undefined;
      }
    };

    const payload = createDatasetRequest({
      datasetId: 'test/dataset',
      newRepoId: 'test/new-dataset',
      selectedEpisodes,
      getEpisodeTask: mockGetEpisodeTask,
    });

    expect(payload.episode_index_task_map).toEqual({
      1: 'taskA',
      3: 'taskB',
      4: 'taskA',
    });
  });

  it('should handle single episode selection', async () => {
    const payload = createDatasetRequest({
      datasetId: 'namespace/dataset',
      newRepoId: 'namespace/new-dataset',
      selectedEpisodes: [5],
      getEpisodeTask: (id) => (id === 5 ? 'singleTask' : undefined),
    });

    expect(payload.episode_index_task_map).toEqual({ 5: 'singleTask' });
    expect(payload.selected_episodes).toEqual([5]);
  });
}); 