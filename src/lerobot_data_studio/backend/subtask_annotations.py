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


def _meta_dir(dataset: LeRobotDataset) -> Path:
    return Path(dataset.root) / "meta"


def _skills_path(dataset: LeRobotDataset) -> Path:
    return _meta_dir(dataset) / SKILLS_FILENAME


def _subtasks_path(dataset: LeRobotDataset) -> Path:
    return _meta_dir(dataset) / SUBTASKS_FILENAME


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
