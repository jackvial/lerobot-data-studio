export interface CreateDatasetParams {
  datasetId: string;
  newRepoId: string;
  selectedEpisodes: number[];
  getEpisodeTask: (episodeId: number) => string | undefined;
}

/**
 * Build the CreateDatasetRequest payload for the backend.
 *
 * Collect episode-level task assignments by calling `getEpisodeTask` for each selected episode.
 * Include `episode_index_task_map` only when at least one episode has a custom assignment.
 */
export function createDatasetRequest({
  datasetId,
  newRepoId,
  selectedEpisodes,
  getEpisodeTask,
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

  // Collect explicit episode-level assignments
  const episodeTasks: Record<number, string> = {};
  selectedEpisodes.forEach((ep) => {
    const task = getEpisodeTask(ep);
    if (task) {
      episodeTasks[ep] = task;
    }
  });

  const hasCustomEpisodeTasks = Object.keys(episodeTasks).length > 0;

  const payload = {
    original_repo_id: datasetId,
    new_repo_id: newRepoId,
    selected_episodes: selectedEpisodes,
    episode_index_task_map: hasCustomEpisodeTasks ? episodeTasks : undefined,
  };

  return payload;
}
