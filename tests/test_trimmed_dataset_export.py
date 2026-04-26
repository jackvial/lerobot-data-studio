"""Integration tests for metadata-only trimmed dataset export."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import av
import numpy as np
import pandas as pd
import pytest
from lerobot.datasets.utils import DEFAULT_FEATURES
from PIL import Image

from lerobot_data_studio.backend import video_codec
from lerobot_data_studio.backend.idle_trim import exclusive_keep_time_range
from lerobot_data_studio.backend.models import EpisodeTrimBounds, SubtaskSegment
from lerobot_data_studio.backend.subtask_annotations import (
    export_subtask_annotations,
    materialize_subtask_index_feature,
    save_episode_annotations,
)
from lerobot_data_studio.backend.trimmed_dataset_export import (
    build_trimmed_dataset_with_copied_videos,
)


class _FakeHfDataset:
    def __init__(self, frames: list[dict[str, Any]]):
        self._frames = frames

    def __getitem__(self, idx: int) -> dict[str, Any]:
        return self._frames[idx]


class _FakeMeta:
    def __init__(self, root: Path, video_key: str):
        self.root = root
        self.fps = 10
        self.robot_type = "test-bot"
        self.video_keys = [video_key]
        self.video_path = "videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4"
        self.chunks_size = 1000
        self.data_files_size_in_mb = 100
        self.video_files_size_in_mb = 100
        self.tasks = pd.DataFrame({"task_index": [0, 1]}, index=["pick", "place"])
        self.features = {
            **DEFAULT_FEATURES,
            "observation.state": {
                "dtype": "float32",
                "shape": (1,),
                "names": ["joint_0"],
            },
            video_key: {
                "dtype": "video",
                "shape": (2, 2, 3),
                "names": ["height", "width", "channels"],
            },
        }
        self.episodes = {
            0: {
                "dataset_from_index": 0,
                "dataset_to_index": 4,
                "data/chunk_index": 0,
                "data/file_index": 0,
                f"videos/{video_key}/chunk_index": 0,
                f"videos/{video_key}/file_index": 0,
                f"videos/{video_key}/from_timestamp": 0.0,
                f"videos/{video_key}/to_timestamp": 0.4,
                "tasks": ["pick"],
                "length": 4,
            },
            1: {
                "dataset_from_index": 4,
                "dataset_to_index": 7,
                "data/chunk_index": 0,
                "data/file_index": 0,
                f"videos/{video_key}/chunk_index": 0,
                f"videos/{video_key}/file_index": 0,
                f"videos/{video_key}/from_timestamp": 1.0,
                f"videos/{video_key}/to_timestamp": 1.3,
                "tasks": ["place"],
                "length": 3,
            },
        }

    @property
    def total_episodes(self) -> int:
        return len(self.episodes)

    def get_data_file_path(self, ep_index: int) -> Path:
        episode = self.episodes[ep_index]
        return Path(
            f"data/chunk-{episode['data/chunk_index']:03d}/file-{episode['data/file_index']:03d}.parquet"
        )


class _FakeSourceDataset:
    def __init__(self, root: Path, video_key: str):
        self.root = root
        self.repo_id = "namespace/source"
        self.meta = _FakeMeta(root, video_key)
        self.fps = self.meta.fps
        self.image_transforms = None
        self.delta_timestamps = None
        self.tolerance_s = 0.0001

        frames = [
            {"timestamp": 0.0},
            {"timestamp": 0.1},
            {"timestamp": 0.2},
            {"timestamp": 0.3},
            {"timestamp": 0.0},
            {"timestamp": 0.1},
            {"timestamp": 0.2},
        ]
        self.hf_dataset = _FakeHfDataset(frames)


def _write_source_data(root: Path) -> None:
    data_path = root / "data/chunk-000/file-000.parquet"
    data_path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(
        {
            "timestamp": [0.0, 0.1, 0.2, 0.3, 0.0, 0.1, 0.2],
            "frame_index": [0, 1, 2, 3, 0, 1, 2],
            "episode_index": [0, 0, 0, 0, 1, 1, 1],
            "index": [0, 1, 2, 3, 4, 5, 6],
            "task_index": [0, 0, 0, 0, 1, 1, 1],
            "observation.state": [
                np.array([0.0], dtype=np.float32),
                np.array([1.0], dtype=np.float32),
                np.array([2.0], dtype=np.float32),
                np.array([3.0], dtype=np.float32),
                np.array([10.0], dtype=np.float32),
                np.array([11.0], dtype=np.float32),
                np.array([12.0], dtype=np.float32),
            ],
        }
    )
    df.to_parquet(data_path)


def _patch_source_video_stats(
    monkeypatch: pytest.MonkeyPatch,
    source: _FakeSourceDataset,
    video_key: str,
) -> None:
    monkeypatch.setattr(
        "lerobot_data_studio.backend.trimmed_dataset_export._load_episode_with_stats",
        lambda _source, episode_id: {
            f"stats/{video_key}/min": np.zeros((3, 1, 1), dtype=np.float64),
            f"stats/{video_key}/max": np.ones((3, 1, 1), dtype=np.float64),
            f"stats/{video_key}/mean": np.full((3, 1, 1), 0.5, dtype=np.float64),
            f"stats/{video_key}/std": np.full((3, 1, 1), 0.1, dtype=np.float64),
            f"stats/{video_key}/count": np.array([source.meta.episodes[episode_id]["length"]]),
        },
    )


def _write_source_video(video_path: Path, fps: int) -> None:
    frames_dir = video_path.parent / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for frame_idx in range(7):
        color = (frame_idx * 30, frame_idx * 10, frame_idx * 5)
        Image.new("RGB", (2, 2), color).save(frames_dir / f"frame-{frame_idx:06d}.png")
    video_codec.encode_video_frames(frames_dir, video_path, fps=fps, vcodec="h264", overwrite=True)


def _decoded_video_frame_count(video_path: Path) -> int:
    frame_count = 0
    with av.open(str(video_path)) as container:
        stream = container.streams.video[0]
        for _frame in container.decode(stream):
            frame_count += 1
    return frame_count


def test_build_trimmed_dataset_with_copied_videos(tmp_path: Path, monkeypatch):
    video_key = "observation.images.side"
    source_root = tmp_path / "source"
    source_root.mkdir(parents=True, exist_ok=True)
    _write_source_data(source_root)

    video_path = source_root / "videos/observation.images.side/chunk-000/file-000.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(b"video-bytes")

    source = _FakeSourceDataset(source_root, video_key)

    _patch_source_video_stats(monkeypatch, source, video_key)

    output_dir = tmp_path / "trimmed"
    trimmed_dataset, reports = build_trimmed_dataset_with_copied_videos(
        source,
        new_repo_id="namespace/trimmed",
        episode_indices=[0, 1],
        episode_trim_map={0: EpisodeTrimBounds(start_time=0.1, end_time=0.2)},
        output_dir=output_dir,
    )

    assert trimmed_dataset.root == output_dir
    assert [report.episode_id for report in reports] == [0, 1]

    trimmed_df = pd.read_parquet(output_dir / "data/chunk-000/file-000.parquet")
    assert trimmed_df["episode_index"].tolist() == [0, 0, 1, 1, 1]
    assert trimmed_df["frame_index"].tolist() == [0, 1, 0, 1, 2]
    assert trimmed_df["index"].tolist() == [0, 1, 2, 3, 4]
    assert trimmed_df["timestamp"].tolist() == pytest.approx([0.0, 0.1, 0.0, 0.1, 0.2])
    assert trimmed_df["observation.state"].tolist() == pytest.approx([1.0, 2.0, 10.0, 11.0, 12.0])

    copied_video_path = output_dir / "videos/observation.images.side/chunk-000/file-000.mp4"
    assert copied_video_path.read_bytes() == b"video-bytes"

    episodes_df = pd.read_parquet(output_dir / "meta/episodes/chunk-000/file-000.parquet")
    first_episode = episodes_df[episodes_df["episode_index"] == 0].iloc[0]
    second_episode = episodes_df[episodes_df["episode_index"] == 1].iloc[0]
    assert first_episode["length"] == 2
    assert first_episode[f"videos/{video_key}/from_timestamp"] == pytest.approx(0.1)
    assert first_episode[f"videos/{video_key}/to_timestamp"] == pytest.approx(0.3)
    assert second_episode["length"] == 3
    assert second_episode[f"videos/{video_key}/from_timestamp"] == pytest.approx(1.0)
    assert second_episode[f"videos/{video_key}/to_timestamp"] == pytest.approx(1.3)


def test_trimmed_export_video_end_is_exclusive_for_follow_up_reencode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video_key = "observation.images.side"
    source_root = tmp_path / "source"
    source_root.mkdir(parents=True, exist_ok=True)
    _write_source_data(source_root)

    video_path = source_root / "videos/observation.images.side/chunk-000/file-000.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)
    _write_source_video(video_path, fps=10)

    source = _FakeSourceDataset(source_root, video_key)
    _patch_source_video_stats(monkeypatch, source, video_key)

    trimmed_dataset, _reports = build_trimmed_dataset_with_copied_videos(
        source,
        new_repo_id="namespace/trimmed",
        episode_indices=[0, 1],
        episode_trim_map={0: EpisodeTrimBounds(start_time=0.1, end_time=0.2)},
        output_dir=tmp_path / "trimmed",
    )

    filtered_meta = SimpleNamespace(root=tmp_path / "filtered", video_path=trimmed_dataset.meta.video_path)
    video_codec.copy_and_reindex_videos(
        trimmed_dataset,
        filtered_meta,
        {0: 0},
        vcodec="h264",
    )

    filtered_video_path = filtered_meta.root / trimmed_dataset.meta.video_path.format(
        video_key=video_key,
        chunk_index=0,
        file_index=0,
    )
    decoded_frame_count = _decoded_video_frame_count(filtered_video_path)

    assert decoded_frame_count == trimmed_dataset.meta.episodes[0]["length"]


def test_trimmed_export_materializes_rebased_subtask_index(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video_key = "observation.images.side"
    source_root = tmp_path / "source"
    source_root.mkdir(parents=True, exist_ok=True)
    _write_source_data(source_root)

    video_path = source_root / "videos/observation.images.side/chunk-000/file-000.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(b"video-bytes")

    source = _FakeSourceDataset(source_root, video_key)
    _patch_source_video_stats(monkeypatch, source, video_key)
    save_episode_annotations(
        dataset=source,
        episode_index=0,
        description="episode zero",
        skills=[
            SubtaskSegment(name="approach", start=0.0, end=0.2),
            SubtaskSegment(name="grasp", start=0.2, end=0.4),
        ],
        allowed_names=["approach", "grasp"],
    )

    output_dir = tmp_path / "trimmed"
    trimmed_dataset, reports = build_trimmed_dataset_with_copied_videos(
        source,
        new_repo_id="namespace/trimmed",
        episode_indices=[0],
        episode_trim_map={0: EpisodeTrimBounds(start_time=0.1, end_time=0.2)},
        output_dir=output_dir,
    )
    keep_time_ranges = {
        report.episode_id: exclusive_keep_time_range(report, float(source.meta.fps))
        for report in reports
    }

    exported = export_subtask_annotations(
        source_dataset=source,
        destination_dataset=trimmed_dataset,
        episode_mapping={0: 0},
        keep_time_ranges=keep_time_ranges,
    )
    materialize_subtask_index_feature(trimmed_dataset, exported)

    trimmed_df = pd.read_parquet(output_dir / "data/chunk-000/file-000.parquet")
    assert trimmed_df["timestamp"].tolist() == pytest.approx([0.0, 0.1])
    assert trimmed_df["subtask_index"].tolist() == [0, 1]
