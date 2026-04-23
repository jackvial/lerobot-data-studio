"""Tests for explicit idle-trim dataset building."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from lerobot_data_studio.backend import idle_trim
from lerobot_data_studio.backend.models import EpisodeTrimBounds


class _FakeHfDataset:
    def __init__(self, frames: List[Dict[str, Any]]):
        self._frames = frames

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        return self._frames[idx]


class _FakeBuiltDataset:
    def __init__(self):
        self.current_episode: List[Dict[str, Any]] = []
        self.episodes: List[List[Dict[str, Any]]] = []
        self.finalized = False

    def add_frame(self, frame: Dict[str, Any]) -> None:
        self.current_episode.append(dict(frame))

    def save_episode(self) -> None:
        self.episodes.append(self.current_episode)
        self.current_episode = []

    def finalize(self) -> None:
        self.finalized = True


class _FakeSourceDataset:
    def __init__(self, tmp_path: Path):
        frames: List[Dict[str, Any]] = []
        for i in range(10):
            frames.append({"timestamp": i * 0.1, "custom": i})
        for i in range(5):
            frames.append({"timestamp": i * 0.1, "custom": 100 + i})

        self.root = tmp_path
        self.fps = 10
        self.num_episodes = 2
        self.features = {"custom": {"dtype": "float32"}}
        self.hf_dataset = _FakeHfDataset(frames)
        self.meta = SimpleNamespace(
            robot_type="test-bot",
            episodes={
                0: {
                    "dataset_from_index": 0,
                    "dataset_to_index": 10,
                    "tasks": ["pick"],
                },
                1: {
                    "dataset_from_index": 10,
                    "dataset_to_index": 15,
                    "tasks": ["place"],
                },
            },
        )

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        frame = self.hf_dataset[idx]
        return {"custom": frame["custom"]}


def _make_dataset(tmp_path: Path) -> _FakeSourceDataset:
    return _FakeSourceDataset(tmp_path)


def test_report_episode_trim_from_bounds_handles_leading_only(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    report = idle_trim.report_episode_trim_from_bounds(
        dataset,
        0,
        EpisodeTrimBounds(start_time=0.31, end_time=0.9),
    )

    assert report.keep_start == 3
    assert report.keep_end == 9
    assert report.leading_dropped == 3
    assert report.trailing_dropped == 0


def test_report_episode_trim_from_bounds_handles_trailing_only(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    report = idle_trim.report_episode_trim_from_bounds(
        dataset,
        0,
        EpisodeTrimBounds(start_time=0.0, end_time=0.64),
    )

    assert report.keep_start == 0
    assert report.keep_end == 6
    assert report.leading_dropped == 0
    assert report.trailing_dropped == 3


def test_report_episode_trim_from_bounds_handles_both_sides(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    report = idle_trim.report_episode_trim_from_bounds(
        dataset,
        0,
        EpisodeTrimBounds(start_time=0.21, end_time=0.64),
    )

    assert report.keep_start == 2
    assert report.keep_end == 6
    assert report.leading_dropped == 2
    assert report.trailing_dropped == 3


def test_report_episode_trim_from_bounds_keeps_full_episode_when_trim_missing(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    report = idle_trim.report_episode_trim_from_bounds(dataset, 1, None)

    assert report.keep_start == 0
    assert report.keep_end == 4
    assert report.leading_dropped == 0
    assert report.trailing_dropped == 0


def test_report_episode_trim_from_bounds_rejects_invalid_ranges(tmp_path: Path):
    dataset = _make_dataset(tmp_path)

    with pytest.raises(ValueError, match="greater than start_time"):
        idle_trim.report_episode_trim_from_bounds(
            dataset,
            0,
            EpisodeTrimBounds(start_time=0.4, end_time=0.4),
        )

    with pytest.raises(ValueError, match="outside the episode"):
        idle_trim.report_episode_trim_from_bounds(
            dataset,
            0,
            EpisodeTrimBounds(start_time=2.0, end_time=3.0),
        )


def test_trim_episodes_with_explicit_bounds_builds_trimmed_dataset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    dataset = _make_dataset(tmp_path)
    built_dataset = _FakeBuiltDataset()

    monkeypatch.setattr(
        idle_trim.LeRobotDataset,
        "create",
        staticmethod(lambda **_kwargs: built_dataset),
    )

    output_dataset, reports = idle_trim.trim_episodes_with_explicit_bounds(
        dataset,
        new_repo_id="namespace/trimmed",
        episode_indices=[0, 1],
        episode_trim_map={0: EpisodeTrimBounds(start_time=0.21, end_time=0.64)},
    )

    assert output_dataset is built_dataset
    assert built_dataset.finalized is True
    assert [frame["custom"] for frame in built_dataset.episodes[0]] == [2, 3, 4, 5, 6]
    assert [frame["task"] for frame in built_dataset.episodes[0]] == ["pick"] * 5
    assert [frame["custom"] for frame in built_dataset.episodes[1]] == [100, 101, 102, 103, 104]
    assert [report.episode_id for report in reports] == [0, 1]
