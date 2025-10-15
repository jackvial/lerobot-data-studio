export interface CreateDatasetParams {
  datasetId: string;
  newRepoId: string;
  selectedEpisodes: number[];
}

/**
 * Build the CreateDatasetRequest payload for the backend.
 *
 */
export function createDatasetRequest({
  datasetId,
  newRepoId,
  selectedEpisodes,
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


  const payload = {
    original_repo_id: datasetId,
    new_repo_id: newRepoId,
    selected_episodes: selectedEpisodes,
  };

  return payload;
}
