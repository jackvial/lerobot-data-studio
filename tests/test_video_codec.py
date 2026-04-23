"""Regression tests for backend video codec overrides."""

from pathlib import Path
from types import SimpleNamespace

import pytest
from lerobot.datasets import dataset_tools

from lerobot_data_studio.backend import video_codec


def _make_video_dataset(tmp_path: Path):
    video_key = "observation.images.side"
    video_template = "videos/{video_key}/chunk-{chunk_index}/file-{file_index}.mp4"

    src_root = tmp_path / "src"
    dst_root = tmp_path / "dst"
    src_video_path = src_root / video_template.format(video_key=video_key, chunk_index=0, file_index=0)
    src_video_path.parent.mkdir(parents=True, exist_ok=True)
    src_video_path.write_bytes(b"source-video")

    src_dataset = SimpleNamespace(
        root=src_root,
        meta=SimpleNamespace(
            root=src_root,
            total_episodes=2,
            video_keys=[video_key],
            video_path=video_template,
            fps=30,
            episodes={
                0: {
                    f"videos/{video_key}/chunk_index": 0,
                    f"videos/{video_key}/file_index": 0,
                    f"videos/{video_key}/from_timestamp": 0.0,
                    f"videos/{video_key}/to_timestamp": 2.0,
                    "length": 60,
                },
                1: {
                    f"videos/{video_key}/chunk_index": 0,
                    f"videos/{video_key}/file_index": 0,
                    f"videos/{video_key}/from_timestamp": 2.0,
                    f"videos/{video_key}/to_timestamp": 5.0,
                    "length": 90,
                },
            },
        ),
    )
    dst_meta = SimpleNamespace(root=dst_root, video_path=video_template)
    return src_dataset, dst_meta, video_key


def test_copy_and_reindex_videos_defaults_to_configured_codec(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    src_dataset, dst_meta, video_key = _make_video_dataset(tmp_path)
    captured: dict[str, object] = {}

    def fake_keep(
        input_path: Path,
        output_path: Path,
        episodes_to_keep: list[tuple[float, float]],
        fps: float,
        vcodec: str | None = None,
        pix_fmt: str = "yuv420p",
    ) -> None:
        captured["input_path"] = input_path
        captured["output_path"] = output_path
        captured["episodes_to_keep"] = episodes_to_keep
        captured["fps"] = fps
        captured["vcodec"] = vcodec
        captured["pix_fmt"] = pix_fmt
        output_path.write_bytes(b"encoded-video")

    monkeypatch.setattr(video_codec, "keep_episodes_from_video_with_av", fake_keep)

    metadata = video_codec.copy_and_reindex_videos(src_dataset, dst_meta, {0: 0})

    assert captured["vcodec"] == video_codec.VIDEO_CODEC
    assert captured["pix_fmt"] == "yuv420p"
    assert captured["fps"] == src_dataset.meta.fps
    assert captured["episodes_to_keep"] == [(0.0, 2.0)]
    assert captured["input_path"] == src_dataset.root / src_dataset.meta.video_path.format(
        video_key=video_key, chunk_index=0, file_index=0
    )
    assert metadata[0][f"videos/{video_key}/chunk_index"] == 0
    assert metadata[0][f"videos/{video_key}/file_index"] == 0
    assert metadata[0][f"videos/{video_key}/from_timestamp"] == pytest.approx(0.0)
    assert metadata[0][f"videos/{video_key}/to_timestamp"] == pytest.approx(2.0)


def test_apply_video_codec_overrides_patches_dataset_tools_copy_helper():
    video_codec._OVERRIDES_APPLIED = False

    video_codec.apply_video_codec_overrides()

    assert dataset_tools._copy_and_reindex_videos is video_codec.copy_and_reindex_videos
    assert dataset_tools._keep_episodes_from_video_with_av is video_codec.keep_episodes_from_video_with_av
    assert dataset_tools.delete_episodes.__globals__["_copy_and_reindex_videos"] is video_codec.copy_and_reindex_videos


def test_copy_videos_with_timestamps_copies_bytes_and_rewrites_ranges(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    src_dataset, dst_meta, video_key = _make_video_dataset(tmp_path)

    def fail_keep(*_args, **_kwargs):
        raise AssertionError("re-encode helper should not be called")

    monkeypatch.setattr(video_codec, "keep_episodes_from_video_with_av", fail_keep)

    metadata = video_codec.copy_videos_with_timestamps(
        src_dataset,
        dst_meta,
        {0: 0, 1: 1},
        {
            0: (0.25, 1.75),
            1: (0.5, 2.0),
        },
    )

    copied_path = dst_meta.root / src_dataset.meta.video_path.format(
        video_key=video_key,
        chunk_index=0,
        file_index=0,
    )
    assert copied_path.read_bytes() == b"source-video"
    assert metadata[0][f"videos/{video_key}/from_timestamp"] == pytest.approx(0.25)
    assert metadata[0][f"videos/{video_key}/to_timestamp"] == pytest.approx(1.75)
    assert metadata[1][f"videos/{video_key}/from_timestamp"] == pytest.approx(2.5)
    assert metadata[1][f"videos/{video_key}/to_timestamp"] == pytest.approx(4.0)
