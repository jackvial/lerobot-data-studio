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


class EpisodeDataItem(BaseModel):
    episode_index: int
    action: List[float]
    observation: List[float]
    timestamp: float


class EpisodeData(BaseModel):
    episode_id: int
    dataset_info: DatasetInfo
    videos_info: List[VideoInfo]
    episode_data: List[EpisodeDataItem]
    feature_names: List[str]
    actual_episode_index: Optional[int] = None
    tasks: List[str]


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


class MergeDatasetRequest(BaseModel):
    dataset_ids: List[str] = Field(..., min_length=2)
    new_repo_id: str
    tolerance_s: float = Field(default=1e-4)


class MergeTaskStatus(BaseModel):
    task_id: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[float] = None
    message: Optional[str] = None
    new_repo_id: Optional[str] = None


class CreateTaskStatus(BaseModel):
    task_id: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[float] = None
    message: Optional[str] = None
    new_repo_id: Optional[str] = None
