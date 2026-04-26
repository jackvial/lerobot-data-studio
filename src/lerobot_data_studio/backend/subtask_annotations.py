"""Persistence helpers for manual subtask annotations.

The on-disk format mirrors
`lerobot.policies.pi05_full.annotate.subtask_annotate`:

- `dataset.root/meta/skills.json`  - human-readable, mergeable annotations
- `dataset.root/meta/subtasks.parquet` - sorted unique subtask name -> index

This module owns reading, merging, validating, and writing both files so the
API routes stay thin. We deliberately keep the JSON shape compatible with the
upstream script so annotations created here can flow into the LeRobot skills
pipeline unchanged.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from .models import (
    EpisodeSubtaskAnnotations,
    EpisodeSubtaskSummary,
    SubtaskAnnotationsResponse,
    SubtaskAnnotationsSummaryResponse,
    SubtaskSegment,
)

logger = logging.getLogger(__name__)


SKILLS_FILENAME = "skills.json"
SUBTASKS_FILENAME = "subtasks.parquet"
SUBTASK_INDEX_FEATURE = {
    "dtype": "int64",
    "shape": [1],
    "names": None,
}
_SUBTASK_TIMESTAMP_TOLERANCE_S = 1e-6


def _meta_dir(dataset: LeRobotDataset) -> Path:
    return Path(dataset.root) / "meta"


def _skills_path(dataset: LeRobotDataset) -> Path:
    return _meta_dir(dataset) / SKILLS_FILENAME


def _subtasks_path(dataset: LeRobotDataset) -> Path:
    return _meta_dir(dataset) / SUBTASKS_FILENAME


def _info_path(dataset: LeRobotDataset) -> Path:
    return _meta_dir(dataset) / "info.json"


def get_episode_duration(dataset: LeRobotDataset, episode_index: int) -> float:
    """Return the wall-clock duration of an episode in seconds.

    We use the difference between the first and last `timestamp` of the
    episode, matching the convention used in `analyze_idle_time` and the
    frontend's `getEpisodeTimeRange`.
    """
    info = dataset.meta.episodes[episode_index]
    from_idx = info["dataset_from_index"]
    to_idx = info["dataset_to_index"]
    if to_idx - from_idx < 2:
        return 0.0
    first = float(dataset.hf_dataset[int(from_idx)]["timestamp"])
    last = float(dataset.hf_dataset[int(to_idx) - 1]["timestamp"])
    return max(last - first, 0.0)


def _coerce_episode(raw: dict) -> EpisodeSubtaskAnnotations:
    """Tolerantly coerce a raw episode dict from `skills.json` into our model."""
    skills_raw = raw.get("skills", []) or []
    skills: List[SubtaskSegment] = []
    for entry in skills_raw:
        try:
            skills.append(
                SubtaskSegment(
                    name=str(entry["name"]),
                    start=float(entry["start"]),
                    end=float(entry["end"]),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("Skipping malformed skill entry %r: %s", entry, exc)

    return EpisodeSubtaskAnnotations(
        episode_index=int(raw.get("episode_index", 0)),
        description=str(raw.get("description", "") or ""),
        skills=skills,
    )


def load_skills_json(dataset: LeRobotDataset) -> SubtaskAnnotationsResponse:
    """Read `meta/skills.json`; return an empty response if absent or invalid."""
    path = _skills_path(dataset)
    if not path.exists():
        return SubtaskAnnotationsResponse()

    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not read %s, returning empty annotations: %s", path, exc)
        return SubtaskAnnotationsResponse()

    episodes_raw = raw.get("episodes", {}) or {}
    episodes: Dict[str, EpisodeSubtaskAnnotations] = {}
    for key, value in episodes_raw.items():
        if not isinstance(value, dict):
            continue
        episodes[str(key)] = _coerce_episode(value)

    skill_to_idx_raw = raw.get("skill_to_subtask_index", {}) or {}
    skill_to_idx: Dict[str, int] = {}
    for name, idx in skill_to_idx_raw.items():
        try:
            skill_to_idx[str(name)] = int(idx)
        except (TypeError, ValueError):
            continue

    return SubtaskAnnotationsResponse(
        coarse_description=str(raw.get("coarse_description", "") or ""),
        skill_to_subtask_index=skill_to_idx,
        episodes=episodes,
    )


def _normalize_segment(
    segment: SubtaskSegment,
    episode_duration: float,
    allowed_names: Optional[List[str]],
) -> Optional[SubtaskSegment]:
    """Validate, clamp, and return a segment, or `None` if it should be dropped.

    - Names outside `allowed_names` (when provided) are rejected.
    - Times are clamped to `[0, episode_duration]`.
    - Empty/inverted ranges (end <= start after clamp) are dropped.
    """
    name = segment.name.strip()
    if not name:
        return None
    if allowed_names is not None and name not in allowed_names:
        logger.warning("Dropping segment with unknown subtask name %r", name)
        return None

    upper = max(episode_duration, 0.0)
    start = max(0.0, float(segment.start))
    end = max(0.0, float(segment.end))
    if upper > 0:
        start = min(start, upper)
        end = min(end, upper)

    if end <= start:
        return None

    return SubtaskSegment(name=name, start=start, end=end)


def normalize_segments(
    segments: List[SubtaskSegment],
    episode_duration: float,
    allowed_names: Optional[List[str]] = None,
) -> List[SubtaskSegment]:
    """Apply `_normalize_segment` to each entry and sort by start time."""
    cleaned: List[SubtaskSegment] = []
    for seg in segments:
        normalized = _normalize_segment(seg, episode_duration, allowed_names)
        if normalized is not None:
            cleaned.append(normalized)
    cleaned.sort(key=lambda s: (s.start, s.end, s.name))
    return cleaned


def _build_skill_to_subtask_index(
    episodes: Dict[str, EpisodeSubtaskAnnotations],
) -> Dict[str, int]:
    """Sorted unique skill names -> integer index (matches reference script)."""
    names: set[str] = set()
    for ep in episodes.values():
        for skill in ep.skills:
            names.add(skill.name)
    return {name: idx for idx, name in enumerate(sorted(names))}


def write_subtasks_parquet(
    dataset: LeRobotDataset,
    skill_to_subtask_index: Dict[str, int],
) -> Path:
    """Write `meta/subtasks.parquet` with the same shape the reference script uses."""
    path = _subtasks_path(dataset)
    path.parent.mkdir(parents=True, exist_ok=True)

    rows = [
        {"subtask": name, "subtask_index": idx}
        for name, idx in sorted(skill_to_subtask_index.items(), key=lambda kv: kv[1])
    ]
    df = pd.DataFrame(rows, columns=["subtask", "subtask_index"])
    if not df.empty:
        df = df.set_index("subtask")
    df.to_parquet(path, engine="pyarrow", compression="snappy")
    if hasattr(dataset, "meta"):
        dataset.meta.subtasks = df
    return path


def write_skills_json(
    dataset: LeRobotDataset,
    payload: SubtaskAnnotationsResponse,
) -> Path:
    """Write the merged `skills.json` payload to disk."""
    path = _skills_path(dataset)
    path.parent.mkdir(parents=True, exist_ok=True)

    serializable = {
        "coarse_description": payload.coarse_description,
        "skill_to_subtask_index": payload.skill_to_subtask_index,
        "episodes": {
            key: {
                "episode_index": ep.episode_index,
                "description": ep.description,
                "skills": [s.model_dump() for s in ep.skills],
            }
            for key, ep in payload.episodes.items()
        },
    }
    path.write_text(json.dumps(serializable, indent=2))
    return path


def save_episode_annotations(
    dataset: LeRobotDataset,
    episode_index: int,
    description: Optional[str],
    skills: List[SubtaskSegment],
    allowed_names: Optional[List[str]],
) -> Tuple[SubtaskAnnotationsResponse, Path, Path]:
    """Merge an episode's segments into `skills.json` and rewrite both files.

    Returns the merged payload plus the two written paths.
    """
    episode_duration = get_episode_duration(dataset, episode_index)
    cleaned = normalize_segments(skills, episode_duration, allowed_names)

    existing = load_skills_json(dataset)
    key = str(episode_index)

    if cleaned:
        prior_description = ""
        if key in existing.episodes:
            prior_description = existing.episodes[key].description
        new_description = description if description is not None else prior_description
        existing.episodes[key] = EpisodeSubtaskAnnotations(
            episode_index=episode_index,
            description=new_description or "",
            skills=cleaned,
        )
    else:
        # Empty save clears the episode's annotations.
        existing.episodes.pop(key, None)

    existing.skill_to_subtask_index = _build_skill_to_subtask_index(existing.episodes)

    if not existing.coarse_description:
        try:
            tasks = dataset.meta.episodes[episode_index].get("tasks") or []
            if tasks:
                existing.coarse_description = str(tasks[0])
        except (KeyError, IndexError, TypeError):
            pass

    skills_path = write_skills_json(dataset, existing)
    subtasks_path = write_subtasks_parquet(dataset, existing.skill_to_subtask_index)
    return existing, skills_path, subtasks_path


def _get_episode_timestamp_bounds(
    dataset: LeRobotDataset,
    episode_index: int,
) -> Tuple[float, float]:
    """Return the first/last frame timestamps for an episode."""
    info = dataset.meta.episodes[episode_index]
    from_idx = int(info["dataset_from_index"])
    to_idx = int(info["dataset_to_index"])
    if to_idx <= from_idx:
        return 0.0, 0.0

    first = float(dataset.hf_dataset[from_idx]["timestamp"])
    last = float(dataset.hf_dataset[to_idx - 1]["timestamp"])
    return first, last


def _get_relative_keep_bounds(
    dataset: LeRobotDataset,
    episode_index: int,
    keep_time_range: Optional[Tuple[float, float]],
) -> Tuple[float, float]:
    """Convert an absolute keep range into episode-relative seconds."""
    episode_start, episode_end = _get_episode_timestamp_bounds(dataset, episode_index)
    episode_duration = max(episode_end - episode_start, 0.0)

    if keep_time_range is None:
        return 0.0, episode_duration

    keep_start, keep_end = keep_time_range
    relative_start = max(0.0, min(float(keep_start) - episode_start, episode_duration))
    relative_end = max(0.0, min(float(keep_end) - episode_start, episode_duration))
    if relative_end < relative_start:
        relative_end = relative_start
    return relative_start, relative_end


def _rebase_episode_skills(
    source_episode: EpisodeSubtaskAnnotations,
    new_episode_index: int,
    keep_start: float,
    keep_end: float,
) -> EpisodeSubtaskAnnotations:
    """Clamp source skills to the kept window and rebase them to t=0."""
    rebased_skills: List[SubtaskSegment] = []
    for skill in source_episode.skills:
        start = max(float(skill.start), keep_start)
        end = min(float(skill.end), keep_end)
        if end <= start:
            continue
        rebased_skills.append(
            SubtaskSegment(
                name=skill.name,
                start=start - keep_start,
                end=end - keep_start,
            )
        )

    return EpisodeSubtaskAnnotations(
        episode_index=new_episode_index,
        description=source_episode.description,
        skills=normalize_segments(
            rebased_skills,
            episode_duration=max(keep_end - keep_start, 0.0),
            allowed_names=None,
        ),
    )


def export_subtask_annotations(
    source_dataset: LeRobotDataset,
    destination_dataset: LeRobotDataset,
    episode_mapping: Dict[int, int],
    keep_time_ranges: Optional[Dict[int, Tuple[float, float]]] = None,
) -> Optional[SubtaskAnnotationsResponse]:
    """Project source `skills.json` onto a newly created dataset and persist it.

    `episode_mapping` maps source episode indices to destination episode indices.
    `keep_time_ranges`, when provided, contains kept windows in the source
    dataset's timestamp space for trimmed exports.
    """
    source_payload = load_skills_json(source_dataset)
    if not source_payload.episodes:
        return None

    keep_ranges = keep_time_ranges or {}
    exported_episodes: Dict[str, EpisodeSubtaskAnnotations] = {}

    for source_episode_index, destination_episode_index in episode_mapping.items():
        source_episode = source_payload.episodes.get(str(source_episode_index))
        if source_episode is None:
            continue

        keep_start, keep_end = _get_relative_keep_bounds(
            source_dataset,
            source_episode_index,
            keep_ranges.get(source_episode_index),
        )
        exported_episode = _rebase_episode_skills(
            source_episode,
            destination_episode_index,
            keep_start,
            keep_end,
        )
        if not exported_episode.skills:
            continue
        exported_episodes[str(destination_episode_index)] = exported_episode

    if not exported_episodes:
        return None

    payload = SubtaskAnnotationsResponse(
        coarse_description=source_payload.coarse_description,
        skill_to_subtask_index=_build_skill_to_subtask_index(exported_episodes),
        episodes=exported_episodes,
    )
    write_skills_json(destination_dataset, payload)
    write_subtasks_parquet(destination_dataset, payload.skill_to_subtask_index)
    return payload


def _subtask_index_for_timestamp(
    episode: EpisodeSubtaskAnnotations,
    skill_to_subtask_index: Dict[str, int],
    timestamp: float,
) -> tuple[int | None, bool]:
    """Return the subtask index for an episode-relative timestamp.

    The boolean indicates whether the assignment used a tolerance-based gap fill
    instead of a direct segment match.
    """
    skills = episode.skills
    if not skills:
        return None, False

    for skill in skills:
        if float(skill.start) <= timestamp < float(skill.end):
            return skill_to_subtask_index.get(skill.name), False

    last_skill = skills[-1]
    if abs(timestamp - float(last_skill.end)) <= _SUBTASK_TIMESTAMP_TOLERANCE_S:
        return skill_to_subtask_index.get(last_skill.name), False

    nearest_skill: SubtaskSegment | None = None
    nearest_distance = float("inf")
    for skill in skills:
        start = float(skill.start)
        end = float(skill.end)
        if timestamp < start:
            distance = start - timestamp
        elif timestamp > end:
            distance = timestamp - end
        else:
            distance = 0.0
        if distance < nearest_distance:
            nearest_skill = skill
            nearest_distance = distance

    if nearest_skill is not None and nearest_distance <= _SUBTASK_TIMESTAMP_TOLERANCE_S:
        return skill_to_subtask_index.get(nearest_skill.name), True

    return None, False


def _update_subtask_index_metadata(dataset: LeRobotDataset) -> None:
    info_path = _info_path(dataset)
    try:
        info = json.loads(info_path.read_text())
    except FileNotFoundError:
        logger.warning("Cannot declare subtask_index feature because %s is missing", info_path)
        info = None
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Cannot update %s with subtask_index feature: %s", info_path, exc)
        info = None

    if info is not None:
        features = info.setdefault("features", {})
        if "subtask_index" not in features:
            features["subtask_index"] = SUBTASK_INDEX_FEATURE.copy()
            info_path.write_text(json.dumps(info, indent=2) + "\n")

    meta = getattr(dataset, "meta", None)
    features = getattr(meta, "features", None)
    if features is not None and "subtask_index" not in features:
        features["subtask_index"] = SUBTASK_INDEX_FEATURE.copy()

    dataset_features = getattr(dataset, "features", None)
    if dataset_features is not None and "subtask_index" not in dataset_features:
        dataset_features["subtask_index"] = SUBTASK_INDEX_FEATURE.copy()


def materialize_subtask_index_feature(
    dataset: LeRobotDataset,
    payload: Optional[SubtaskAnnotationsResponse],
) -> None:
    """Write exported subtask annotations into frame parquet and feature metadata."""
    if payload is None or not payload.episodes:
        return

    _update_subtask_index_metadata(dataset)

    data_root = Path(dataset.root) / "data"
    parquet_paths = sorted(data_root.glob("*/*.parquet"))
    if not parquet_paths:
        logger.warning("No frame parquet files found under %s for subtask_index materialization", data_root)
        return

    for parquet_path in parquet_paths:
        df = pd.read_parquet(parquet_path)
        if "episode_index" not in df.columns or "timestamp" not in df.columns:
            logger.warning("Skipping %s because it lacks episode_index or timestamp", parquet_path)
            continue

        subtask_indices: List[int] = []
        gap_fill_count = 0
        unassigned_count = 0
        for row in df[["episode_index", "timestamp"]].itertuples(index=False):
            episode_index = int(row.episode_index)
            timestamp = float(row.timestamp)
            episode = payload.episodes.get(str(episode_index))
            if episode is None:
                subtask_indices.append(-1)
                unassigned_count += 1
                continue

            subtask_index, gap_filled = _subtask_index_for_timestamp(
                episode,
                payload.skill_to_subtask_index,
                timestamp,
            )
            if subtask_index is None:
                subtask_indices.append(-1)
                unassigned_count += 1
                continue

            subtask_indices.append(int(subtask_index))
            if gap_filled:
                gap_fill_count += 1

        if gap_fill_count:
            logger.warning(
                "Filled %d subtask_index timestamp gap(s) in %s using nearest skill",
                gap_fill_count,
                parquet_path,
            )
        if unassigned_count:
            logger.warning(
                "Assigned -1 subtask_index to %d frame(s) in %s without matching annotations",
                unassigned_count,
                parquet_path,
            )

        df["subtask_index"] = pd.Series(subtask_indices, dtype="int64", index=df.index)
        df.to_parquet(parquet_path, engine="pyarrow", compression="snappy")


def sync_subtask_metadata_from_repo(dataset: LeRobotDataset) -> None:
    """Fetch optional subtask metadata files when they are missing locally."""
    allow_patterns: List[str] = []
    skills_path = _skills_path(dataset)
    subtasks_path = _subtasks_path(dataset)

    if not skills_path.exists():
        allow_patterns.append(f"meta/{SKILLS_FILENAME}")
    if not subtasks_path.exists():
        allow_patterns.append(f"meta/{SUBTASKS_FILENAME}")

    if allow_patterns:
        try:
            dataset.pull_from_repo(allow_patterns=allow_patterns)
        except Exception as exc:
            logger.info("Optional subtask metadata sync skipped for %s: %s", dataset.repo_id, exc)

    try:
        dataset.meta.subtasks = pd.read_parquet(subtasks_path) if subtasks_path.exists() else None
    except Exception as exc:
        logger.warning("Failed to refresh subtasks metadata from %s: %s", subtasks_path, exc)


def build_summary(
    dataset: LeRobotDataset,
) -> SubtaskAnnotationsSummaryResponse:
    """Per-episode summary of annotation presence for the sidebar."""
    payload = load_skills_json(dataset)
    summary: Dict[int, EpisodeSubtaskSummary] = {}
    for key, ep in payload.episodes.items():
        try:
            episode_index = int(key)
        except (TypeError, ValueError):
            continue
        count = len(ep.skills)
        summary[episode_index] = EpisodeSubtaskSummary(
            has_annotations=count > 0,
            segment_count=count,
        )
    return SubtaskAnnotationsSummaryResponse(episodes=summary)
