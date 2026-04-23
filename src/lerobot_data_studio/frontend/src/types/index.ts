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
  from_timestamp?: number | null;
  to_timestamp?: number | null;
}

export interface EpisodeDataPoint {
  episode_index: number;
  action: number[];
  observation: number[];
  timestamp: number;
}

export interface EpisodeData {
  episode_id: number;
  dataset_info: DatasetInfo;
  videos_info: VideoInfo[];
  episode_data: EpisodeDataPoint[];
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
  episode_index_trim_map?: Record<number, EpisodeTrimBounds>;
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

export interface IdleSpan {
  start_time: number;
  end_time: number;
}

export interface EpisodeTrimBounds {
  start_time: number;
  end_time: number;
}

export interface IdleAnalysisResponse {
  episode_id: number;
  spans: IdleSpan[];
  threshold: number;
  min_duration: number;
  total_idle_seconds: number;
  episode_duration: number;
}

export interface SubtaskSegment {
  name: string;
  start: number;
  end: number;
}

export interface EpisodeSubtaskAnnotations {
  episode_index: number;
  description: string;
  skills: SubtaskSegment[];
}

export interface SubtaskAnnotationsResponse {
  coarse_description: string;
  skill_to_subtask_index: Record<string, number>;
  episodes: Record<string, EpisodeSubtaskAnnotations>;
}

export interface SubtaskTaskListResponse {
  tasks: string[];
}

export interface SaveSubtaskAnnotationsRequest {
  description?: string;
  skills: SubtaskSegment[];
}

export interface EpisodeSubtaskSummary {
  has_annotations: boolean;
  segment_count: number;
}

export interface SubtaskAnnotationsSummaryResponse {
  episodes: Record<number, EpisodeSubtaskSummary>;
}
