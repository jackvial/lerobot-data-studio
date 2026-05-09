from typing import Dict, List, Literal, Optional

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
    # Slice of the underlying video file (in seconds) that belongs to this
    # episode. v3 LeRobot datasets pack multiple episodes into a single mp4
    # so the player must clamp playback to this window. None when unavailable.
    from_timestamp: Optional[float] = None
    to_timestamp: Optional[float] = None


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


class EpisodeTrimBounds(BaseModel):
    start_time: float
    end_time: float


class CreateDatasetRequest(BaseModel):
    original_repo_id: str
    new_repo_id: str
    selected_episodes: List[int] = Field(..., min_length=1)

    # Episode ID -> Task name
    episode_index_task_map: Optional[Dict[int, str]] = None
    # Episode ID -> explicit kept time bounds inside the original episode
    episode_index_trim_map: Optional[Dict[int, EpisodeTrimBounds]] = None


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


class IdleSpan(BaseModel):
    start_time: float
    end_time: float


class IdleAnalysisResponse(BaseModel):
    episode_id: int
    spans: List[IdleSpan]
    threshold: float
    min_duration: float
    total_idle_seconds: float
    episode_duration: float


class SubtaskSegment(BaseModel):
    """A single labeled time range for an episode (mirrors reference `Skill`).

    Range bounds are not strictly validated here so the persistence helper can
    clamp out-of-range times against the actual episode duration.
    """

    name: str
    start: float
    end: float


class EpisodeSubtaskAnnotations(BaseModel):
    """All subtask segments for a single episode (mirrors reference `EpisodeSkills`)."""

    episode_index: int
    description: str = ""
    skills: List[SubtaskSegment] = Field(default_factory=list)


class SubtaskTaskListResponse(BaseModel):
    """List of allowed subtask names served to the frontend radio."""

    tasks: List[str]


class SubtaskAnnotationsResponse(BaseModel):
    """Full `skills.json` payload returned to the frontend."""

    coarse_description: str = ""
    skill_to_subtask_index: Dict[str, int] = Field(default_factory=dict)
    episodes: Dict[str, EpisodeSubtaskAnnotations] = Field(default_factory=dict)


class SaveSubtaskAnnotationsRequest(BaseModel):
    """Save payload for a single episode's subtask segments."""

    description: Optional[str] = None
    skills: List[SubtaskSegment] = Field(default_factory=list)


class EpisodeSubtaskSummary(BaseModel):
    has_annotations: bool
    segment_count: int


class SubtaskAnnotationsSummaryResponse(BaseModel):
    """Per-episode annotation status used by the sidebar badges."""

    episodes: Dict[int, EpisodeSubtaskSummary] = Field(default_factory=dict)


class CriticalSection(BaseModel):
    """A weighted time range marking the important grasp/contact phase.

    Range bounds are not strictly validated here so the persistence helper can
    clamp out-of-range times against the actual episode duration. `weight` is
    intended to drive training reweighting/oversampling and defaults to 5.0
    when callers omit it.
    """

    name: str = "critical"
    start: float
    end: float
    weight: float = 5.0


class EpisodeCriticalSections(BaseModel):
    """All critical sections for a single episode."""

    episode_index: int
    sections: List[CriticalSection] = Field(default_factory=list)


class CriticalSectionLabelsResponse(BaseModel):
    """Allowed critical-section labels served to the frontend radio."""

    labels: List[str]
    default_weight: float


class CriticalSectionsResponse(BaseModel):
    """Full `critical_sections.json` payload returned to the frontend."""

    default_label: str = "critical"
    default_weight: float = 5.0
    episodes: Dict[str, EpisodeCriticalSections] = Field(default_factory=dict)


class SaveCriticalSectionsRequest(BaseModel):
    """Save payload for a single episode's critical sections."""

    sections: List[CriticalSection] = Field(default_factory=list)


class EpisodeCriticalSectionSummary(BaseModel):
    has_annotations: bool
    section_count: int


class CriticalSectionsSummaryResponse(BaseModel):
    """Per-episode critical-section status used by the sidebar badges."""

    episodes: Dict[int, EpisodeCriticalSectionSummary] = Field(default_factory=dict)


class RltBufferFile(BaseModel):
    """Summary of a saved RLT replay buffer `.pt` file."""

    file_token: str
    path: str
    size_bytes: int
    mtime: float
    num_samples: int
    num_episodes: int


class RltBufferFilesResponse(BaseModel):
    files: List[RltBufferFile]
    source_path: str
    default_path: str


class RltEpisodeSummary(BaseModel):
    """Per-episode summary for the RLT buffer viewer sidebar."""

    episode_id: int
    num_transitions: int
    duration_s: float
    label: Literal["success", "failure", "open"]
    original_label: Literal["success", "failure", "open"]
    deleted: bool = False
    has_intervention: bool
    first_inference_ts: Optional[float] = None


class RltEpisodesResponse(BaseModel):
    file_token: str
    episodes: List[RltEpisodeSummary]


class SaveRltEpisodeReviewRequest(BaseModel):
    label: Literal["success", "failure", "open"]
    deleted: bool = False


class RltEpisodeReviewResponse(BaseModel):
    file_token: str
    episode_id: int
    label: Literal["success", "failure", "open"]
    deleted: bool


class RltTransitionInfo(BaseModel):
    """One inference transition inside an episode."""

    index: int
    ts: Optional[float] = None
    t_offset_s: float
    action_summary: List[float] = Field(default_factory=list)
    reward: float
    done: bool
    success: bool
    failure: bool
    is_intervention: bool
    image_keys: List[str] = Field(default_factory=list)


class RltTransitionsResponse(BaseModel):
    file_token: str
    episode_id: int
    transitions: List[RltTransitionInfo]
    has_inference_ts: bool
