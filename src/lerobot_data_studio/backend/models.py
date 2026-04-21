from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class DatasetInfo(BaseModel):
    repo_id: str
    num_samples: int
    num_episodes: int
    fps: int
    version: Optional[str] = None


class VideoInfo(BaseModel):
    url: str
    filename: str
    language_instruction: Optional[List[str]] = None
    # Time range (in seconds) within the underlying video file that
    # corresponds to this episode. In LeRobot v3, multiple episodes are
    # concatenated into a single video file, so playback must be clipped
    # to the [from_timestamp, to_timestamp) range.
    from_timestamp: float = 0.0
    to_timestamp: Optional[float] = None


class EpisodeDataItem(BaseModel):
    episode_index: int
    action: List[float]
    observation: List[float]
    timestamp: float


class SubtaskSegment(BaseModel):
    subtask_index: int
    subtask: str
    start_time: float
    end_time: float
    start_frame: int
    end_frame: int


class EpisodeData(BaseModel):
    episode_id: int
    dataset_info: DatasetInfo
    videos_info: List[VideoInfo]
    episode_data: List[EpisodeDataItem]
    feature_names: List[str]
    actual_episode_index: Optional[int] = None
    tasks: List[str]
    subtasks: List[SubtaskSegment] = Field(default_factory=list)
    subtask_labels: Dict[int, str] = Field(default_factory=dict)


class DatasetListResponse(BaseModel):
    featured_datasets: List[str]
    lerobot_datasets: List[str]


class CreateDatasetRequest(BaseModel):
    original_repo_id: str
    new_repo_id: str
    selected_episodes: List[int] = Field(..., min_length=1)

    # Episode ID -> Task name
    episode_index_task_map: Optional[Dict[int, str]] = None


class CreateDatasetResponse(BaseModel):
    success: bool
    new_repo_id: str
    message: str
    task_id: Optional[str] = None


class DatasetLoadingStatus(BaseModel):
    status: Optional[str] = None
    progress: Optional[float] = None
    message: Optional[str] = None
    memory_usage_mb: Optional[float] = None


class DatasetSearchResponse(BaseModel):
    repo_ids: List[str]


class DatasetValidationResponse(BaseModel):
    exists: bool
    message: Optional[str] = None


class CreateTaskStatus(BaseModel):
    task_id: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[float] = None
    message: Optional[str] = None
    new_repo_id: Optional[str] = None


class RegisterLocalDatasetRequest(BaseModel):
    path: str


class RegisterLocalDatasetResponse(BaseModel):
    repo_id: str
    path: str
    message: Optional[str] = None


class FeaturedLocalDataset(BaseModel):
    repo_id: str
    path: str
    label: Optional[str] = None


class FeaturedLocalDatasetsResponse(BaseModel):
    datasets: List[FeaturedLocalDataset]
