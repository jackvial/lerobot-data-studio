"""Tests for the subtask annotation persistence helper.

We stub `LeRobotDataset` with a minimal namespace because the helper only
touches `dataset.root`, `dataset.meta.episodes`, and the per-row
`hf_dataset[i]["timestamp"]` lookup.
"""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

import pandas as pd
import pytest

from lerobot_data_studio.backend.models import SubtaskSegment
from lerobot_data_studio.backend.subtask_annotations import (
    SKILLS_FILENAME,
    SUBTASKS_FILENAME,
    build_summary,
    get_episode_duration,
    load_skills_json,
    normalize_segments,
    save_episode_annotations,
)


class _FakeHfDataset:
    def __init__(self, frames: List[Dict[str, Any]]):
        self._frames = frames

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        return self._frames[idx]


def _make_dataset(tmp_path: Path) -> Any:
    frames = []
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
        meta=SimpleNamespace(episodes=episodes),
        hf_dataset=_FakeHfDataset(frames),
        num_episodes=2,
    )


def test_get_episode_duration_uses_first_and_last_timestamp(tmp_path: Path):
    dataset = _make_dataset(tmp_path)
    assert get_episode_duration(dataset, 0) == pytest.approx(0.4)
    assert get_episode_duration(dataset, 1) == pytest.approx(1.0)


def test_normalize_segments_clamps_and_filters():
    segments = [
        SubtaskSegment(name="pick", start=-1.0, end=0.5),
        SubtaskSegment(name="place", start=0.6, end=2.0),
        SubtaskSegment(name=" ", start=0.0, end=1.0),
        SubtaskSegment(name="unknown", start=0.0, end=1.0),
        SubtaskSegment(name="grasp", start=0.5, end=0.5),
    ]

    cleaned = normalize_segments(segments, episode_duration=1.0, allowed_names=["pick", "place"])

    assert [(s.name, s.start, s.end) for s in cleaned] == [
        ("pick", 0.0, 0.5),
        ("place", 0.6, 1.0),
    ]


def test_save_then_load_round_trips_segments(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    segments = [
        SubtaskSegment(name="pick", start=0.0, end=0.2),
        SubtaskSegment(name="place", start=0.2, end=0.4),
    ]

    payload, skills_path, subtasks_path = save_episode_annotations(
        dataset=dataset,
        episode_index=0,
        description=None,
        skills=segments,
        allowed_names=["pick", "place", "release"],
    )

    assert skills_path == tmp_path / "meta" / SKILLS_FILENAME
    assert subtasks_path == tmp_path / "meta" / SUBTASKS_FILENAME
    assert skills_path.exists()
    assert subtasks_path.exists()

    raw = json.loads(skills_path.read_text())
    assert raw["coarse_description"] == "pick the screwdriver"
    assert raw["skill_to_subtask_index"] == {"pick": 0, "place": 1}
    assert raw["episodes"]["0"]["episode_index"] == 0
    assert raw["episodes"]["0"]["skills"] == [
        {"name": "pick", "start": 0.0, "end": 0.2},
        {"name": "place", "start": 0.2, "end": 0.4},
    ]

    df = pd.read_parquet(subtasks_path)
    assert df.index.tolist() == ["pick", "place"]
    assert df["subtask_index"].tolist() == [0, 1]

    reloaded = load_skills_json(dataset)
    assert set(reloaded.episodes.keys()) == {"0"}
    assert payload.episodes["0"].skills == reloaded.episodes["0"].skills


def test_save_merges_episodes_and_clears_when_empty(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    save_episode_annotations(
        dataset=dataset,
        episode_index=0,
        description="ep0 notes",
        skills=[SubtaskSegment(name="pick", start=0.0, end=0.2)],
        allowed_names=["pick", "place"],
    )
    save_episode_annotations(
        dataset=dataset,
        episode_index=1,
        description=None,
        skills=[SubtaskSegment(name="place", start=0.0, end=0.5)],
        allowed_names=["pick", "place"],
    )

    merged = load_skills_json(dataset)
    assert set(merged.episodes.keys()) == {"0", "1"}
    assert merged.episodes["0"].description == "ep0 notes"
    assert merged.skill_to_subtask_index == {"pick": 0, "place": 1}

    df = pd.read_parquet(tmp_path / "meta" / SUBTASKS_FILENAME)
    assert df.index.tolist() == ["pick", "place"]

    save_episode_annotations(
        dataset=dataset,
        episode_index=0,
        description=None,
        skills=[],
        allowed_names=["pick", "place"],
    )

    after_clear = load_skills_json(dataset)
    assert set(after_clear.episodes.keys()) == {"1"}
    assert after_clear.skill_to_subtask_index == {"place": 0}

    df_after = pd.read_parquet(tmp_path / "meta" / SUBTASKS_FILENAME)
    assert df_after.index.tolist() == ["place"]
    assert df_after["subtask_index"].tolist() == [0]


def test_save_clamps_segments_outside_episode_duration(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    payload, _, _ = save_episode_annotations(
        dataset=dataset,
        episode_index=0,
        description=None,
        skills=[SubtaskSegment(name="pick", start=-0.5, end=2.0)],
        allowed_names=["pick"],
    )

    saved = payload.episodes["0"].skills
    assert len(saved) == 1
    assert saved[0].start == pytest.approx(0.0)
    assert saved[0].end == pytest.approx(0.4)


def test_summary_reflects_saved_episodes(tmp_path: Path):
    dataset = _make_dataset(tmp_path)
    save_episode_annotations(
        dataset=dataset,
        episode_index=1,
        description=None,
        skills=[
            SubtaskSegment(name="pick", start=0.0, end=0.2),
            SubtaskSegment(name="place", start=0.2, end=0.4),
        ],
        allowed_names=["pick", "place"],
    )

    summary = build_summary(dataset)
    assert set(summary.episodes.keys()) == {1}
    assert summary.episodes[1].has_annotations is True
    assert summary.episodes[1].segment_count == 2
