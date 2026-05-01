"""Tests for the critical-section annotation persistence helper.

The fake dataset mirrors `test_subtask_annotations.py` so the helpers exercise
the same `dataset.root`/`dataset.meta.episodes`/`hf_dataset` surface.
"""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

import pandas as pd
import pytest

from lerobot_data_studio.backend.critical_section_annotations import (
    CRITICAL_SECTIONS_FILENAME,
    CRITICAL_WEIGHT_COLUMN,
    CRITICAL_WEIGHT_FEATURE,
    build_summary,
    load_critical_sections,
    materialize_critical_weight_feature,
    normalize_sections,
    save_episode_critical_sections,
)
from lerobot_data_studio.backend.models import CriticalSection


class _FakeHfDataset:
    def __init__(self, frames: List[Dict[str, Any]]):
        self._frames = frames

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        return self._frames[idx]


def _make_dataset(tmp_path: Path) -> Any:
    frames: List[Dict[str, Any]] = []
    # Episode 0: 5 frames at 10 fps starting at t=0.0
    for i in range(5):
        frames.append({"timestamp": i * 0.1, "episode_index": 0})
    # Episode 1: 11 frames at 10 fps starting at t=10.0
    for i in range(11):
        frames.append({"timestamp": 10.0 + i * 0.1, "episode_index": 1})

    episodes = {
        0: {
            "dataset_from_index": 0,
            "dataset_to_index": 5,
            "tasks": ["pick the screwdriver"],
        },
        1: {
            "dataset_from_index": 5,
            "dataset_to_index": 16,
            "tasks": ["pick the screwdriver"],
        },
    }

    return SimpleNamespace(
        root=tmp_path,
        meta=SimpleNamespace(episodes=episodes, features={}),
        hf_dataset=_FakeHfDataset(frames),
        num_episodes=2,
        features={},
    )


def test_normalize_sections_clamps_filters_and_fills_default_weight():
    sections = [
        CriticalSection(name="critical grasp", start=-1.0, end=0.5, weight=4.0),
        CriticalSection(name="critical contact", start=0.6, end=2.0, weight=0.0),
        CriticalSection(name="  ", start=0.0, end=0.5, weight=3.0),
        CriticalSection(name="ignored", start=0.0, end=0.5, weight=2.0),
        CriticalSection(name="critical grasp", start=0.5, end=0.5, weight=2.0),
    ]

    cleaned = normalize_sections(
        sections,
        episode_duration=1.0,
        allowed_names=["critical grasp", "critical contact"],
    )

    assert [(s.name, s.start, s.end, s.weight) for s in cleaned] == [
        ("critical grasp", 0.0, 0.5, 4.0),
        # Empty/whitespace name -> default "critical" -> rejected by allow list.
        # Zero weight -> falls back to default 5.0.
        ("critical contact", 0.6, 1.0, 5.0),
    ]


def test_save_then_load_round_trips_sections(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    sections = [
        CriticalSection(name="critical grasp", start=0.0, end=0.2, weight=5.0),
        CriticalSection(name="critical contact", start=0.2, end=0.4, weight=7.5),
    ]

    payload, json_path = save_episode_critical_sections(
        dataset=dataset,
        episode_index=0,
        sections=sections,
        allowed_names=["critical grasp", "critical contact"],
    )

    assert json_path == tmp_path / "meta" / CRITICAL_SECTIONS_FILENAME
    assert json_path.exists()
    # Subtask files must not be touched by the critical-section helper.
    assert not (tmp_path / "meta" / "skills.json").exists()
    assert not (tmp_path / "meta" / "subtasks.parquet").exists()

    raw = json.loads(json_path.read_text())
    assert raw["default_label"] == "critical"
    assert raw["default_weight"] == 5.0
    assert raw["episodes"]["0"]["episode_index"] == 0
    assert raw["episodes"]["0"]["sections"] == [
        {"name": "critical grasp", "start": 0.0, "end": 0.2, "weight": 5.0},
        {"name": "critical contact", "start": 0.2, "end": 0.4, "weight": 7.5},
    ]

    reloaded = load_critical_sections(dataset)
    assert set(reloaded.episodes.keys()) == {"0"}
    assert payload.episodes["0"].sections == reloaded.episodes["0"].sections


def test_save_clamps_sections_outside_episode_duration(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    payload, _ = save_episode_critical_sections(
        dataset=dataset,
        episode_index=0,
        sections=[CriticalSection(name="critical grasp", start=-0.5, end=2.0, weight=4.0)],
        allowed_names=["critical grasp"],
    )

    saved = payload.episodes["0"].sections
    assert len(saved) == 1
    assert saved[0].start == pytest.approx(0.0)
    assert saved[0].end == pytest.approx(0.4)
    assert saved[0].weight == pytest.approx(4.0)


def test_save_clears_episode_when_sections_empty(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    save_episode_critical_sections(
        dataset=dataset,
        episode_index=0,
        sections=[CriticalSection(name="critical grasp", start=0.0, end=0.2)],
        allowed_names=["critical grasp"],
    )
    save_episode_critical_sections(
        dataset=dataset,
        episode_index=1,
        sections=[CriticalSection(name="critical grasp", start=0.0, end=0.5)],
        allowed_names=["critical grasp"],
    )

    merged = load_critical_sections(dataset)
    assert set(merged.episodes.keys()) == {"0", "1"}

    save_episode_critical_sections(
        dataset=dataset,
        episode_index=0,
        sections=[],
        allowed_names=["critical grasp"],
    )

    after_clear = load_critical_sections(dataset)
    assert set(after_clear.episodes.keys()) == {"1"}


def test_summary_reflects_saved_episodes(tmp_path: Path):
    dataset = _make_dataset(tmp_path)
    save_episode_critical_sections(
        dataset=dataset,
        episode_index=1,
        sections=[
            CriticalSection(name="critical grasp", start=0.0, end=0.2, weight=5.0),
            CriticalSection(name="critical contact", start=0.3, end=0.5, weight=4.0),
        ],
        allowed_names=["critical grasp", "critical contact"],
    )

    summary = build_summary(dataset)
    assert set(summary.episodes.keys()) == {1}
    assert summary.episodes[1].has_annotations is True
    assert summary.episodes[1].section_count == 2


def test_materialize_critical_weight_feature_writes_frame_column(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    save_episode_critical_sections(
        dataset=dataset,
        episode_index=0,
        sections=[
            CriticalSection(name="critical grasp", start=0.05, end=0.25, weight=5.0),
            # Overlapping section with a higher weight wins.
            CriticalSection(name="critical contact", start=0.15, end=0.35, weight=8.0),
        ],
        allowed_names=["critical grasp", "critical contact"],
    )

    meta_dir = dataset.root / "meta"
    (meta_dir / "info.json").write_text(
        json.dumps(
            {
                "features": {
                    "timestamp": {"dtype": "float32", "shape": [1], "names": None},
                }
            }
        )
    )
    data_path = dataset.root / "data/chunk-000/file-000.parquet"
    data_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(
        {
            "episode_index": [0, 0, 0, 0, 0],
            "timestamp": [0.0, 0.1, 0.2, 0.3, 0.4],
            "frame_index": [0, 1, 2, 3, 4],
        }
    ).to_parquet(data_path)

    payload = load_critical_sections(dataset)
    materialize_critical_weight_feature(dataset, payload)

    info = json.loads((meta_dir / "info.json").read_text())
    assert info["features"][CRITICAL_WEIGHT_COLUMN] == CRITICAL_WEIGHT_FEATURE
    assert dataset.meta.features[CRITICAL_WEIGHT_COLUMN] == CRITICAL_WEIGHT_FEATURE

    df = pd.read_parquet(data_path)
    assert CRITICAL_WEIGHT_COLUMN in df.columns
    # t=0.0 is outside any section -> baseline 1.0
    # t=0.1 is inside grasp only -> 5.0
    # t=0.2 is inside both, max(5,8) = 8.0
    # t=0.3 is outside grasp, outside contact (end=0.35 exclusive includes 0.3) -> 8.0
    # t=0.4 is outside both -> 1.0
    assert df[CRITICAL_WEIGHT_COLUMN].tolist() == [1.0, 5.0, 8.0, 8.0, 1.0]
