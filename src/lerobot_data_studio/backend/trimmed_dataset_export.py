"""Build trimmed datasets without re-encoding source video files."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd
from lerobot.datasets.compute_stats import compute_episode_stats
from lerobot.datasets.dataset_tools import _load_episode_with_stats, _write_parquet
from lerobot.datasets.lerobot_dataset import LeRobotDataset, LeRobotDatasetMetadata
from lerobot.datasets.utils import DEFAULT_DATA_PATH

from .idle_trim import EpisodeTrimReport, report_episode_trim_from_bounds
from .models import EpisodeTrimBounds
from .video_codec import copy_videos_with_timestamps

logger = logging.getLogger(__name__)


def _build_task_mapping(
    source: LeRobotDataset,
    destination_meta: LeRobotDatasetMetadata,
    episode_indices: list[int],
) -> dict[int, int]:
    task_names: list[str] = []
    for episode_id in episode_indices:
        for task_name in source.meta.episodes[episode_id]["tasks"]:
            if task_name not in task_names:
                task_names.append(task_name)

    if task_names:
        destination_meta.save_episode_tasks(task_names)

    task_mapping: dict[int, int] = {}
    if source.meta.tasks is None or destination_meta.tasks is None:
        return task_mapping

    for old_task_idx in range(len(source.meta.tasks)):
        task_name = source.meta.tasks.iloc[old_task_idx].name
        new_task_idx = destination_meta.get_task_index(task_name)
        if new_task_idx is not None:
            task_mapping[old_task_idx] = new_task_idx

    return task_mapping


def _build_stats_input_for_feature(episode_df: pd.DataFrame, feature_name: str, feature: dict):
    if feature_name not in episode_df.columns:
        return None

    values = episode_df[feature_name].tolist()
    if feature["dtype"] == "string":
        return values
    if feature["shape"] == (1,):
        return np.asarray(values)
    return np.stack(values)


def _extract_source_video_stats(source: LeRobotDataset, episode_id: int) -> dict[str, dict]:
    episode_row = _load_episode_with_stats(source, episode_id)
    video_stats: dict[str, dict] = {}

    for feature_name in source.meta.video_keys:
        feature_stats: dict[str, np.ndarray] = {}
        prefix = f"stats/{feature_name}/"
        for key, value in episode_row.items():
            if not key.startswith(prefix):
                continue

            stat_name = key.removeprefix(prefix)
            if isinstance(value, np.ndarray) and value.dtype == object:
                flattened_values = []
                for item in value:
                    while isinstance(item, np.ndarray):
                        item = item.flatten()[0]
                    flattened_values.append(item)
                value = np.array(flattened_values, dtype=np.float64).reshape(3, 1, 1)
            elif isinstance(value, np.ndarray) and value.shape == (3,) and stat_name != "count":
                value = value.reshape(3, 1, 1)

            feature_stats[stat_name] = value

        if feature_stats:
            video_stats[feature_name] = feature_stats

    return video_stats


def _compute_trimmed_episode_stats(
    source: LeRobotDataset,
    episode_df: pd.DataFrame,
    source_episode_id: int,
) -> dict[str, dict]:
    non_video_features = {
        key: feature
        for key, feature in source.meta.features.items()
        if feature["dtype"] != "video"
    }

    episode_data = {}
    for feature_name, feature in non_video_features.items():
        stats_input = _build_stats_input_for_feature(episode_df, feature_name, feature)
        if stats_input is not None:
            episode_data[feature_name] = stats_input

    episode_stats = compute_episode_stats(episode_data, non_video_features)
    episode_stats.update(_extract_source_video_stats(source, source_episode_id))
    return episode_stats


def _copy_trimmed_data(
    source: LeRobotDataset,
    destination_meta: LeRobotDatasetMetadata,
    episode_mapping: dict[int, int],
    reports: list[EpisodeTrimReport],
    task_mapping: dict[int, int],
) -> tuple[dict[int, dict], dict[int, dict]]:
    report_by_episode = {report.episode_id: report for report in reports}
    file_to_episodes: dict[Path, list[int]] = {}
    for old_episode_id in sorted(episode_mapping, key=lambda episode_id: episode_mapping[episode_id]):
        file_path = source.meta.get_data_file_path(old_episode_id)
        if file_path not in file_to_episodes:
            file_to_episodes[file_path] = []
        file_to_episodes[file_path].append(old_episode_id)

    global_index = 0
    episode_data_metadata: dict[int, dict] = {}
    episode_stats: dict[int, dict] = {}

    for src_path in sorted(file_to_episodes.keys(), key=lambda path: min(episode_mapping[idx] for idx in file_to_episodes[path])):
        df = pd.read_parquet(source.root / src_path)
        trimmed_episode_dfs: list[pd.DataFrame] = []

        for old_episode_id in sorted(file_to_episodes[src_path], key=lambda episode_id: episode_mapping[episode_id]):
            report = report_by_episode[old_episode_id]
            new_episode_id = episode_mapping[old_episode_id]

            episode_df = (
                df[df["episode_index"] == old_episode_id]
                .copy()
                .reset_index(drop=True)
                .iloc[report.keep_start : report.keep_end + 1]
                .reset_index(drop=True)
            )

            if episode_df.empty:
                raise ValueError(f"Episode {old_episode_id} trim produced no frame rows")

            episode_df["episode_index"] = new_episode_id
            episode_df["frame_index"] = np.arange(len(episode_df), dtype=np.int64)
            episode_df["timestamp"] = episode_df["timestamp"].astype(float) - float(report.keep_start_time)
            if "task_index" in episode_df.columns and task_mapping:
                episode_df["task_index"] = episode_df["task_index"].replace(task_mapping)
            episode_df["index"] = np.arange(global_index, global_index + len(episode_df), dtype=np.int64)
            global_index += len(episode_df)

            source_episode = source.meta.episodes[old_episode_id]
            episode_data_metadata[new_episode_id] = {
                "data/chunk_index": source_episode["data/chunk_index"],
                "data/file_index": source_episode["data/file_index"],
            }
            episode_stats[new_episode_id] = _compute_trimmed_episode_stats(
                source,
                episode_df,
                old_episode_id,
            )
            trimmed_episode_dfs.append(episode_df)

        if not trimmed_episode_dfs:
            continue

        first_episode_id = file_to_episodes[src_path][0]
        source_episode = source.meta.episodes[first_episode_id]
        chunk_idx = source_episode["data/chunk_index"]
        file_idx = source_episode["data/file_index"]
        destination_df = pd.concat(trimmed_episode_dfs, ignore_index=True)
        destination_path = destination_meta.root / DEFAULT_DATA_PATH.format(
            chunk_index=chunk_idx,
            file_index=file_idx,
        )
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        _write_parquet(destination_df, destination_path, destination_meta)

    return episode_data_metadata, episode_stats


def build_trimmed_dataset_with_copied_videos(
    source: LeRobotDataset,
    new_repo_id: str,
    episode_indices: list[int],
    episode_trim_map: dict[int, EpisodeTrimBounds] | None = None,
    output_dir: str | Path | None = None,
) -> tuple[LeRobotDataset, list[EpisodeTrimReport]]:
    """Create a trimmed dataset by filtering frame rows and copying source videos unchanged."""
    selected_episode_indices = list(episode_indices)
    trim_map = episode_trim_map or {}
    reports = [
        report_episode_trim_from_bounds(source, episode_id, trim_map.get(episode_id))
        for episode_id in selected_episode_indices
    ]
    episode_mapping = {
        old_episode_id: new_episode_id
        for new_episode_id, old_episode_id in enumerate(selected_episode_indices)
    }

    destination_meta = LeRobotDatasetMetadata.create(
        repo_id=new_repo_id,
        fps=source.meta.fps,
        features=source.meta.features,
        robot_type=source.meta.robot_type,
        root=output_dir,
        use_videos=len(source.meta.video_keys) > 0,
        chunks_size=source.meta.chunks_size,
        data_files_size_in_mb=source.meta.data_files_size_in_mb,
        video_files_size_in_mb=source.meta.video_files_size_in_mb,
    )

    task_mapping = _build_task_mapping(source, destination_meta, selected_episode_indices)
    data_metadata, per_episode_stats = _copy_trimmed_data(
        source,
        destination_meta,
        episode_mapping,
        reports,
        task_mapping,
    )

    video_time_ranges = {
        report.episode_id: (float(report.keep_start_time), float(report.keep_end_time))
        for report in reports
    }
    video_metadata = (
        copy_videos_with_timestamps(
            source,
            destination_meta,
            episode_mapping,
            video_time_ranges,
        )
        if source.meta.video_keys
        else None
    )

    for report in reports:
        new_episode_id = episode_mapping[report.episode_id]
        episode_metadata = data_metadata[new_episode_id].copy()
        if video_metadata is not None:
            episode_metadata.update(video_metadata[new_episode_id])
        destination_meta.save_episode(
            new_episode_id,
            report.kept_frames,
            source.meta.episodes[report.episode_id]["tasks"],
            per_episode_stats[new_episode_id],
            episode_metadata,
        )

    destination_meta._close_writer()

    trimmed_dataset = LeRobotDataset(
        repo_id=new_repo_id,
        root=destination_meta.root,
        image_transforms=getattr(source, "image_transforms", None),
        delta_timestamps=getattr(source, "delta_timestamps", None),
        tolerance_s=getattr(source, "tolerance_s", 0.0001),
    )
    return trimmed_dataset, reports
