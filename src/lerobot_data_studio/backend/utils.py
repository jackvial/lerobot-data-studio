"""Utility functions for the backend."""

import logging
from functools import lru_cache
from pathlib import Path

import pyarrow.parquet as pq
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from .models import EpisodeDataItem, SubtaskSegment

logger = logging.getLogger(__name__)


@lru_cache(maxsize=32)
def _read_subtask_labels(subtasks_parquet: str) -> dict[int, str]:
    """Read meta/subtasks.parquet and return a {subtask_index: subtask} mapping.

    Cached by absolute path so repeated episode loads don't re-read the file.
    """
    table = pq.read_table(subtasks_parquet)
    df = table.to_pandas().reset_index()
    if "subtask_index" not in df.columns or "subtask" not in df.columns:
        return {}
    return {int(row["subtask_index"]): str(row["subtask"]) for _, row in df.iterrows()}


def _get_subtask_labels(dataset: LeRobotDataset) -> dict[int, str]:
    root = getattr(dataset, "root", None)
    if root is None:
        return {}
    subtasks_path = Path(root) / "meta" / "subtasks.parquet"
    if not subtasks_path.exists():
        return {}
    try:
        return _read_subtask_labels(str(subtasks_path.resolve()))
    except (OSError, ValueError, KeyError) as e:
        logger.warning(f"Failed to read subtasks parquet at {subtasks_path}: {e}")
        return {}


def _build_subtask_segments(
    subtask_indices: list[int],
    frame_indices: list[int],
    timestamps: list[float],
    fps: int,
    labels: dict[int, str],
) -> list[SubtaskSegment]:
    """Group consecutive equal subtask_index values into Gantt-style segments."""
    if not subtask_indices:
        return []

    segments: list[SubtaskSegment] = []
    frame_period = 1.0 / fps if fps else 0.0

    start = 0
    for i in range(1, len(subtask_indices) + 1):
        if i == len(subtask_indices) or subtask_indices[i] != subtask_indices[start]:
            sub_idx = int(subtask_indices[start])
            start_frame = int(frame_indices[start])
            end_frame = int(frame_indices[i - 1])
            start_time = float(timestamps[start])
            end_time = float(timestamps[i - 1]) + frame_period
            segments.append(
                SubtaskSegment(
                    subtask_index=sub_idx,
                    subtask=labels.get(sub_idx, f"subtask_{sub_idx}"),
                    start_time=round(start_time, 4),
                    end_time=round(end_time, 4),
                    start_frame=start_frame,
                    end_frame=end_frame,
                )
            )
            start = i

    return segments


def get_episode_data(dataset: LeRobotDataset, episode_index: int):
    """Extract episode data for display in the UI.

    Args:
        dataset: The LeRobotDataset to extract data from
        episode_index: The episode index to extract

    Returns:
        Tuple of (episode_data_items, feature_names, subtasks, subtask_labels)
    """
    episode_info = dataset.meta.episodes[episode_index]
    from_idx = episode_info["dataset_from_index"]
    to_idx = episode_info["dataset_to_index"]

    available_columns = set(dataset.hf_dataset.column_names)
    base_columns = ["episode_index", "action", "observation.state", "timestamp"]
    extra_columns = [c for c in ("frame_index", "subtask_index") if c in available_columns]
    columns = base_columns + extra_columns

    data = dataset.hf_dataset.select(range(from_idx, to_idx)).select_columns(columns)

    episode_data_items = []
    subtask_indices: list[int] = []
    frame_indices: list[int] = []
    timestamps: list[float] = []
    has_subtask = "subtask_index" in extra_columns
    has_frame = "frame_index" in extra_columns

    for offset, sample in enumerate(data):
        action_values = (
            sample["action"].tolist() if hasattr(sample["action"], "tolist") else list(sample["action"])
        )
        action_rounded = [round(val, 2) for val in action_values]

        observation_values = (
            sample["observation.state"].tolist()
            if hasattr(sample["observation.state"], "tolist")
            else list(sample["observation.state"])
        )
        observation_rounded = [round(val, 2) for val in observation_values]

        ts = round(float(sample["timestamp"]), 2)

        episode_data_items.append(
            EpisodeDataItem(
                episode_index=sample["episode_index"],
                action=action_rounded,
                observation=observation_rounded,
                timestamp=ts,
            )
        )

        if has_subtask:
            subtask_indices.append(int(sample["subtask_index"]))
            timestamps.append(float(sample["timestamp"]))
            frame_indices.append(
                int(sample["frame_index"]) if has_frame else offset
            )

    subtask_labels: dict[int, str] = {}
    subtasks: list[SubtaskSegment] = []
    if has_subtask:
        subtask_labels = _get_subtask_labels(dataset)
        subtasks = _build_subtask_segments(
            subtask_indices=subtask_indices,
            frame_indices=frame_indices,
            timestamps=timestamps,
            fps=dataset.fps,
            labels=subtask_labels,
        )
        if not subtask_labels and subtasks:
            subtask_labels = {seg.subtask_index: seg.subtask for seg in subtasks}

    return (
        episode_data_items,
        dataset.features["observation.state"]["names"],
        subtasks,
        subtask_labels,
    )
