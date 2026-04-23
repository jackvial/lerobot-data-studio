import { describe, it, expect } from 'vitest';
import { createDatasetRequest } from '../src/utils/createDataset';

describe('createDatasetRequest', () => {
  it('should build payload with episode and available tasks', async () => {
    const datasetId = 'namespace/dataset';
    const newRepoId = 'namespace/new-dataset';
    const selectedEpisodes = [0, 1, 2];

    const payload = createDatasetRequest({
      datasetId,
      newRepoId,
      selectedEpisodes,
    });

    expect(payload.original_repo_id).toBe(datasetId);
    expect(payload.new_repo_id).toBe(newRepoId);
    expect(payload.selected_episodes).toEqual(selectedEpisodes);
  });

  it('should handle single episode selection', async () => {
    const payload = createDatasetRequest({
      datasetId: 'namespace/dataset',
      newRepoId: 'namespace/new-dataset',
      selectedEpisodes: [5],
    });

    expect(payload.selected_episodes).toEqual([5]);
  });

  it('includes trim bounds only for selected episodes', async () => {
    const payload = createDatasetRequest({
      datasetId: 'namespace/dataset',
      newRepoId: 'namespace/new-dataset',
      selectedEpisodes: [1, 3],
      episodeTrimMap: {
        1: { start_time: 0.5, end_time: 2.5 },
        2: { start_time: 1.0, end_time: 3.0 },
      },
    });

    expect(payload.episode_index_trim_map).toEqual({
      1: { start_time: 0.5, end_time: 2.5 },
    });
  });
}); 