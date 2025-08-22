export interface DatasetInfo {
  repo_id: string;
  num_samples: number;
  num_episodes: number;
  fps: number;
  version?: string;
}

export interface VideoInfo {
  url: string;
  filename: string;
  language_instruction?: string[];
}

export interface EpisodeData {
  episode_id: number;
  dataset_info: DatasetInfo;
  videos_info: VideoInfo[];
  episode_data: Record<string, number[]>[];
  feature_names: string[];
  tasks: string[];
  actual_episode_index?: number | null;
}

export interface DatasetListResponse {
  featured_datasets: string[];
  lerobot_datasets: string[];
}

export interface CreateDatasetRequest {
  original_repo_id: string;
  new_repo_id: string;
  selected_episodes: number[];
  episode_index_task_map?: Record<number, string>;
  ui_custom_task_list?: string[];
}

export interface CreateDatasetResponse {
  success: boolean;
  new_repo_id: string;
  message: string;
  task_id?: string;
}

export interface CreateTaskStatus {
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  message?: string;
  new_repo_id?: string;
}

export interface DatasetLoadingStatus {
  status: 'loading' | 'ready' | 'error' | 'not_loaded';
  progress?: number;
  message?: string;
}
