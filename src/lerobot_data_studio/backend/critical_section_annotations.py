"""Persistence helpers for critical-section annotations.

Critical sections mark the important grasp/contact phase of an episode for
later training reweighting or oversampling. We deliberately keep them in their
own files so they cannot accidentally collide with the LeRobot subtask/skills
workflow:

- `dataset.root/meta/critical_sections.json` - human-readable, mergeable spans
- optional materialized `critical_weight` frame feature in the data parquets

This module owns reading, merging, validating, and writing the JSON file plus
the optional frame-level materialization. API routes stay thin.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from .critical_section_config import DEFAULT_CRITICAL_WEIGHT
from .models import (
    CriticalSection,
    CriticalSectionsResponse,
    CriticalSectionsSummaryResponse,
    EpisodeCriticalSections,
    EpisodeCriticalSectionSummary,
)

logger = logging.getLogger(__name__)


CRITICAL_SECTIONS_FILENAME = "critical_sections.json"
CRITICAL_WEIGHT_FEATURE = {
    "dtype": "float64",
    "shape": [1],
    "names": None,
}
CRITICAL_WEIGHT_COLUMN = "critical_weight"
DEFAULT_CRITICAL_LABEL = "critical"
DEFAULT_BASELINE_WEIGHT = 1.0


def _meta_dir(dataset: LeRobotDataset) -> Path:
    return Path(dataset.root) / "meta"


def _critical_sections_path(dataset: LeRobotDataset) -> Path:
    return _meta_dir(dataset) / CRITICAL_SECTIONS_FILENAME


def _info_path(dataset: LeRobotDataset) -> Path:
    return _meta_dir(dataset) / "info.json"


def _get_episode_duration(dataset: LeRobotDataset, episode_index: int) -> float:
    """Return the wall-clock duration of an episode in seconds.

    Mirrors `subtask_annotations.get_episode_duration` so save-time clamping
    matches the timestamp space the frontend uses for the timeline.
    """
    info = dataset.meta.episodes[episode_index]
    from_idx = info["dataset_from_index"]
    to_idx = info["dataset_to_index"]
    if to_idx - from_idx < 2:
        return 0.0
    first = float(dataset.hf_dataset[int(from_idx)]["timestamp"])
    last = float(dataset.hf_dataset[int(to_idx) - 1]["timestamp"])
    return max(last - first, 0.0)


def _coerce_section(raw: dict) -> Optional[CriticalSection]:
    """Tolerantly coerce a raw section dict from `critical_sections.json`."""
    try:
        weight = raw.get("weight", DEFAULT_CRITICAL_WEIGHT)
        return CriticalSection(
            name=str(raw.get("name", DEFAULT_CRITICAL_LABEL) or DEFAULT_CRITICAL_LABEL),
            start=float(raw["start"]),
            end=float(raw["end"]),
            weight=float(weight) if weight is not None else DEFAULT_CRITICAL_WEIGHT,
        )
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("Skipping malformed critical-section entry %r: %s", raw, exc)
        return None


def _coerce_episode(raw: dict) -> EpisodeCriticalSections:
    sections_raw = raw.get("sections", []) or []
    sections: List[CriticalSection] = []
    for entry in sections_raw:
        if not isinstance(entry, dict):
            continue
        coerced = _coerce_section(entry)
        if coerced is not None:
            sections.append(coerced)
    return EpisodeCriticalSections(
        episode_index=int(raw.get("episode_index", 0)),
        sections=sections,
    )


def load_critical_sections(dataset: LeRobotDataset) -> CriticalSectionsResponse:
    """Read `meta/critical_sections.json`; return an empty response if absent."""
    path = _critical_sections_path(dataset)
    if not path.exists():
        return CriticalSectionsResponse()

    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning(
            "Could not read %s, returning empty critical sections: %s", path, exc
        )
        return CriticalSectionsResponse()

    episodes_raw = raw.get("episodes", {}) or {}
    episodes: Dict[str, EpisodeCriticalSections] = {}
    for key, value in episodes_raw.items():
        if not isinstance(value, dict):
            continue
        episodes[str(key)] = _coerce_episode(value)

    default_label = str(raw.get("default_label", DEFAULT_CRITICAL_LABEL) or DEFAULT_CRITICAL_LABEL)
    try:
        default_weight = float(raw.get("default_weight", DEFAULT_CRITICAL_WEIGHT))
    except (TypeError, ValueError):
        default_weight = DEFAULT_CRITICAL_WEIGHT

    return CriticalSectionsResponse(
        default_label=default_label,
        default_weight=default_weight,
        episodes=episodes,
    )


def _normalize_section(
    section: CriticalSection,
    episode_duration: float,
    allowed_names: Optional[List[str]],
) -> Optional[CriticalSection]:
    """Validate, clamp, and return a section, or `None` if it should be dropped.

    Names outside `allowed_names` (when provided) are rejected. Times are
    clamped to `[0, episode_duration]` and empty/inverted ranges are dropped.
    Missing/non-positive weights fall back to `DEFAULT_CRITICAL_WEIGHT`.
    """
    name = (section.name or DEFAULT_CRITICAL_LABEL).strip()
    if not name:
        name = DEFAULT_CRITICAL_LABEL
    if allowed_names is not None and name not in allowed_names:
        logger.warning("Dropping critical section with unknown label %r", name)
        return None

    upper = max(episode_duration, 0.0)
    start = max(0.0, float(section.start))
    end = max(0.0, float(section.end))
    if upper > 0:
        start = min(start, upper)
        end = min(end, upper)

    if end <= start:
        return None

    try:
        weight = float(section.weight)
    except (TypeError, ValueError):
        weight = DEFAULT_CRITICAL_WEIGHT
    if not weight or weight <= 0:
        weight = DEFAULT_CRITICAL_WEIGHT

    return CriticalSection(name=name, start=start, end=end, weight=weight)


def normalize_sections(
    sections: List[CriticalSection],
    episode_duration: float,
    allowed_names: Optional[List[str]] = None,
) -> List[CriticalSection]:
    """Apply `_normalize_section` to each entry and sort by start time.

    Unlike subtasks, critical sections may overlap and may leave gaps, so we
    only sort here and do not enforce coverage.
    """
    cleaned: List[CriticalSection] = []
    for section in sections:
        normalized = _normalize_section(section, episode_duration, allowed_names)
        if normalized is not None:
            cleaned.append(normalized)
    cleaned.sort(key=lambda s: (s.start, s.end, s.name))
    return cleaned


def write_critical_sections_json(
    dataset: LeRobotDataset,
    payload: CriticalSectionsResponse,
) -> Path:
    """Write the merged `critical_sections.json` payload to disk."""
    path = _critical_sections_path(dataset)
    path.parent.mkdir(parents=True, exist_ok=True)

    serializable = {
        "default_label": payload.default_label,
        "default_weight": payload.default_weight,
        "episodes": {
            key: {
                "episode_index": ep.episode_index,
                "sections": [s.model_dump() for s in ep.sections],
            }
            for key, ep in payload.episodes.items()
        },
    }
    path.write_text(json.dumps(serializable, indent=2))
    return path


def save_episode_critical_sections(
    dataset: LeRobotDataset,
    episode_index: int,
    sections: List[CriticalSection],
    allowed_names: Optional[List[str]],
) -> Tuple[CriticalSectionsResponse, Path]:
    """Merge an episode's critical sections into the JSON file and rewrite it.

    An empty `sections` list clears the episode entry. Returns the merged
    payload plus the path that was written.
    """
    episode_duration = _get_episode_duration(dataset, episode_index)
    cleaned = normalize_sections(sections, episode_duration, allowed_names)

    existing = load_critical_sections(dataset)
    key = str(episode_index)

    if cleaned:
        existing.episodes[key] = EpisodeCriticalSections(
            episode_index=episode_index,
            sections=cleaned,
        )
    else:
        existing.episodes.pop(key, None)

    path = write_critical_sections_json(dataset, existing)
    return existing, path


def build_summary(dataset: LeRobotDataset) -> CriticalSectionsSummaryResponse:
    """Per-episode summary of critical-section presence for the sidebar."""
    payload = load_critical_sections(dataset)
    summary: Dict[int, EpisodeCriticalSectionSummary] = {}
    for key, ep in payload.episodes.items():
        try:
            episode_index = int(key)
        except (TypeError, ValueError):
            continue
        count = len(ep.sections)
        summary[episode_index] = EpisodeCriticalSectionSummary(
            has_annotations=count > 0,
            section_count=count,
        )
    return CriticalSectionsSummaryResponse(episodes=summary)


def _critical_weight_for_timestamp(
    episode: EpisodeCriticalSections,
    timestamp: float,
) -> float:
    """Return max overlapping section weight, or the baseline if none overlap.

    Critical sections may overlap, so we take the max so the most important
    weight wins. Frames outside any section keep the baseline (1.0).
    """
    weight = DEFAULT_BASELINE_WEIGHT
    for section in episode.sections:
        if float(section.start) <= timestamp < float(section.end):
            weight = max(weight, float(section.weight))
    return weight


def _update_critical_weight_metadata(dataset: LeRobotDataset) -> None:
    info_path = _info_path(dataset)
    try:
        info = json.loads(info_path.read_text())
    except FileNotFoundError:
        logger.warning(
            "Cannot declare critical_weight feature because %s is missing", info_path
        )
        info = None
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Cannot update %s with critical_weight feature: %s", info_path, exc)
        info = None

    if info is not None:
        features = info.setdefault("features", {})
        if CRITICAL_WEIGHT_COLUMN not in features:
            features[CRITICAL_WEIGHT_COLUMN] = CRITICAL_WEIGHT_FEATURE.copy()
            info_path.write_text(json.dumps(info, indent=2) + "\n")

    meta = getattr(dataset, "meta", None)
    features = getattr(meta, "features", None)
    if features is not None and CRITICAL_WEIGHT_COLUMN not in features:
        features[CRITICAL_WEIGHT_COLUMN] = CRITICAL_WEIGHT_FEATURE.copy()

    dataset_features = getattr(dataset, "features", None)
    if dataset_features is not None and CRITICAL_WEIGHT_COLUMN not in dataset_features:
        dataset_features[CRITICAL_WEIGHT_COLUMN] = CRITICAL_WEIGHT_FEATURE.copy()


def materialize_critical_weight_feature(
    dataset: LeRobotDataset,
    payload: Optional[CriticalSectionsResponse],
) -> None:
    """Write a `critical_weight` column into the dataset's frame parquets.

    Frames inside any annotated critical section receive the section's weight
    (the max when overlapping); frames outside any section keep
    `DEFAULT_BASELINE_WEIGHT`. Updates `meta/info.json` features so downstream
    consumers see the new column.
    """
    if payload is None or not payload.episodes:
        return

    _update_critical_weight_metadata(dataset)

    data_root = Path(dataset.root) / "data"
    parquet_paths = sorted(data_root.glob("*/*.parquet"))
    if not parquet_paths:
        logger.warning(
            "No frame parquet files found under %s for critical_weight materialization",
            data_root,
        )
        return

    for parquet_path in parquet_paths:
        df = pd.read_parquet(parquet_path)
        if "episode_index" not in df.columns or "timestamp" not in df.columns:
            logger.warning(
                "Skipping %s because it lacks episode_index or timestamp", parquet_path
            )
            continue

        weights: List[float] = []
        for row in df[["episode_index", "timestamp"]].itertuples(index=False):
            episode_index = int(row.episode_index)
            timestamp = float(row.timestamp)
            episode = payload.episodes.get(str(episode_index))
            if episode is None:
                weights.append(DEFAULT_BASELINE_WEIGHT)
                continue
            weights.append(_critical_weight_for_timestamp(episode, timestamp))

        df[CRITICAL_WEIGHT_COLUMN] = pd.Series(weights, dtype="float64", index=df.index)
        df.to_parquet(parquet_path, engine="pyarrow", compression="snappy")
