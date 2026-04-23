import { EpisodeTrimBounds } from '@/types';

export interface CreateDatasetParams {
  datasetId: string;
  newRepoId: string;
  selectedEpisodes: number[];
  episodeTrimMap?: Record<number, EpisodeTrimBounds>;
}

/**
 * Build the CreateDatasetRequest payload for the backend.
 *
 */
export function createDatasetRequest({
  datasetId,
  newRepoId,
  selectedEpisodes,
  episodeTrimMap,
}: CreateDatasetParams) {
  // Validate inputs
  if (
    !datasetId ||
    !newRepoId ||
    !selectedEpisodes ||
    selectedEpisodes.length === 0
  ) {
    throw new Error(
      `Invalid parameters: datasetId=${datasetId}, newRepoId=${newRepoId}, selectedEpisodes=${
        selectedEpisodes?.length || 0
      }`
    );
  }


  const filteredTrimEntries = Object.entries(episodeTrimMap ?? {}).filter(
    ([episodeId]) => selectedEpisodes.includes(Number(episodeId))
  );

  const payload = {
    original_repo_id: datasetId,
    new_repo_id: newRepoId,
    selected_episodes: selectedEpisodes,
    ...(filteredTrimEntries.length > 0
      ? {
          episode_index_trim_map: Object.fromEntries(filteredTrimEntries),
        }
      : {}),
  };

  return payload;
}
