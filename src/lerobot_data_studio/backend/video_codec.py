"""Override lerobot's video re-encoding to use H.265 (libx265) instead of AV1.

lerobot defaults to ``libsvtav1`` everywhere it re-encodes videos
(``LeRobotDataset.save_episode`` and ``delete_episodes``), and neither path
exposes a codec argument to callers. AV1 produces small files but encodes very
slowly; for our backend we prefer speed over storage.

This module ships near-verbatim copies of the two relevant helpers from
``lerobot/datasets/video_utils.py`` and ``lerobot/datasets/dataset_tools.py``
with the codec switched to ``hevc`` and ``preset=ultrafast`` /
``tune=zerolatency`` injected for libx264/libx265. Calling
:func:`apply_video_codec_overrides` rebinds the lerobot module-level names so
the high-level APIs transparently use our copies.

Codec/preset are configurable via env vars:
- ``LDS_VIDEO_CODEC``  (default ``"hevc"``; one of ``"hevc"``, ``"h264"``, ``"libsvtav1"``)
- ``LDS_VIDEO_PRESET`` (default ``"ultrafast"``; only applied for h264/hevc)
"""

from __future__ import annotations

import glob
import logging
import os
import shutil
from fractions import Fraction
from pathlib import Path

import av
from lerobot.datasets.utils import load_episodes
from PIL import Image
from tqdm import tqdm

logger = logging.getLogger(__name__)

_ALLOWED_CODECS = {"h264", "hevc", "libsvtav1"}
_DEFAULT_CODEC = "hevc"
_DEFAULT_PRESET = "ultrafast"


def _resolve_codec() -> str:
    codec = os.environ.get("LDS_VIDEO_CODEC", _DEFAULT_CODEC).strip().lower()
    if codec not in _ALLOWED_CODECS:
        logger.warning(
            "LDS_VIDEO_CODEC=%r is not one of %s; falling back to %r",
            codec,
            sorted(_ALLOWED_CODECS),
            _DEFAULT_CODEC,
        )
        codec = _DEFAULT_CODEC
    return codec


def _resolve_preset() -> str:
    return os.environ.get("LDS_VIDEO_PRESET", _DEFAULT_PRESET).strip() or _DEFAULT_PRESET


VIDEO_CODEC = _resolve_codec()
VIDEO_PRESET = _resolve_preset()


def _speed_options(vcodec: str) -> dict[str, str]:
    """Encoder options tuned for fastest encode on libx264/libx265."""
    if vcodec in ("hevc", "h264"):
        return {"preset": VIDEO_PRESET, "tune": "zerolatency"}
    return {}


def encode_video_frames(
    imgs_dir: Path | str,
    video_path: Path | str,
    fps: int,
    vcodec: str | None = None,
    pix_fmt: str = "yuv420p",
    g: int | None = 2,
    crf: int | None = 30,
    fast_decode: int = 0,
    log_level: int | None = av.logging.ERROR,
    overwrite: bool = False,
    preset: int | None = None,
) -> None:
    """Encode a directory of PNG frames into an mp4 video file.

    Adapted from ``lerobot.datasets.video_utils.encode_video_frames``; the only
    behavioural changes are:

    - ``vcodec`` defaults to :data:`VIDEO_CODEC` (env-configurable, default ``hevc``)
      instead of ``libsvtav1``.
    - For ``hevc``/``h264`` we inject ``preset=<VIDEO_PRESET>`` and ``tune=zerolatency``
      for fast encoding.

    The on-disk output (mp4 container, ``pix_fmt=yuv420p``, monotonic PTS,
    keyframe cadence ``g=2``) and the ``frame-XXXXXX.png`` input template are
    unchanged so ``LeRobotDataset`` can read the result.
    """
    if vcodec is None:
        vcodec = VIDEO_CODEC

    if vcodec not in _ALLOWED_CODECS:
        raise ValueError(
            f"Unsupported video codec: {vcodec}. Supported codecs are: {sorted(_ALLOWED_CODECS)}."
        )

    video_path = Path(video_path)
    imgs_dir = Path(imgs_dir)

    if video_path.exists() and not overwrite:
        logging.warning(f"Video file already exists: {video_path}. Skipping encoding.")
        return

    video_path.parent.mkdir(parents=True, exist_ok=True)

    if (vcodec == "libsvtav1" or vcodec == "hevc") and pix_fmt == "yuv444p":
        logging.warning(
            f"Incompatible pixel format 'yuv444p' for codec {vcodec}, auto-selecting format 'yuv420p'"
        )
        pix_fmt = "yuv420p"

    template = "frame-" + ("[0-9]" * 6) + ".png"
    input_list = sorted(
        glob.glob(str(imgs_dir / template)),
        key=lambda x: int(x.split("-")[-1].split(".")[0]),
    )

    if len(input_list) == 0:
        raise FileNotFoundError(f"No images found in {imgs_dir}.")
    with Image.open(input_list[0]) as dummy_image:
        width, height = dummy_image.size

    video_options: dict[str, str] = {}

    if g is not None:
        video_options["g"] = str(g)

    if crf is not None:
        video_options["crf"] = str(crf)

    if fast_decode:
        key = "svtav1-params" if vcodec == "libsvtav1" else "tune"
        value = f"fast-decode={fast_decode}" if vcodec == "libsvtav1" else "fastdecode"
        video_options[key] = value

    if vcodec == "libsvtav1":
        video_options["preset"] = str(preset) if preset is not None else "12"
    else:
        # libx264 / libx265 speed tuning. `tune=zerolatency` here would override
        # `tune=fastdecode` set above for fast_decode; that's intentional since
        # callers asking for hevc want speed over decode-time tuning.
        video_options.update(_speed_options(vcodec))

    if log_level is not None:
        # "While less efficient, it is generally preferable to modify logging with Python's logging"
        logging.getLogger("libav").setLevel(log_level)

    with av.open(str(video_path), "w") as output:
        output_stream = output.add_stream(vcodec, fps, options=video_options)
        output_stream.pix_fmt = pix_fmt
        output_stream.width = width
        output_stream.height = height

        for input_data in input_list:
            with Image.open(input_data) as input_image:
                input_image = input_image.convert("RGB")
                input_frame = av.VideoFrame.from_image(input_image)
                packet = output_stream.encode(input_frame)
                if packet:
                    output.mux(packet)

        packet = output_stream.encode()
        if packet:
            output.mux(packet)

    if log_level is not None:
        av.logging.restore_default_callback()

    if not video_path.exists():
        raise OSError(f"Video encoding did not work. File not found: {video_path}.")


def keep_episodes_from_video_with_av(
    input_path: Path,
    output_path: Path,
    episodes_to_keep: list[tuple[float, float]],
    fps: float,
    vcodec: str | None = None,
    pix_fmt: str = "yuv420p",
) -> None:
    """Keep only specified episodes from a video file using PyAV.

    Adapted from ``lerobot.datasets.dataset_tools._keep_episodes_from_video_with_av``;
    the only behavioural changes are:

    - ``vcodec`` defaults to :data:`VIDEO_CODEC` (env-configurable, default ``hevc``)
      instead of ``libsvtav1``.
    - For ``hevc``/``h264`` we pass ``preset=<VIDEO_PRESET>`` and ``tune=zerolatency``
      to ``add_stream`` for fast encoding.

    Timestamp resetting, ``time_base = 1/fps`` and the per-range frame filtering
    are preserved verbatim so the per-episode ``from_timestamp``/``to_timestamp``
    math in ``_copy_and_reindex_videos`` continues to line up.
    """
    if vcodec is None:
        vcodec = VIDEO_CODEC

    if not episodes_to_keep:
        raise ValueError("No episodes to keep")

    in_container = av.open(str(input_path))

    if not in_container.streams.video:
        raise ValueError(
            f"No video streams found in {input_path}. "
            "The video file may be corrupted or empty. "
            "Try re-downloading the dataset or checking the video file."
        )

    v_in = in_container.streams.video[0]

    out = av.open(str(output_path), mode="w")

    fps_fraction = Fraction(fps).limit_denominator(1000)
    stream_options = _speed_options(vcodec)
    if stream_options:
        v_out = out.add_stream(vcodec, rate=fps_fraction, options=stream_options)
    else:
        v_out = out.add_stream(vcodec, rate=fps_fraction)

    v_out.width = v_in.codec_context.width
    v_out.height = v_in.codec_context.height
    v_out.pix_fmt = pix_fmt

    v_out.time_base = Fraction(1, int(fps))

    out.start_encoding()

    time_ranges = sorted(episodes_to_keep)

    frame_count = 0
    range_idx = 0

    for packet in in_container.demux(v_in):
        for frame in packet.decode():
            if frame is None:
                continue

            frame_time = float(frame.pts * frame.time_base) if frame.pts is not None else 0.0

            while range_idx < len(time_ranges) and frame_time >= time_ranges[range_idx][1]:
                range_idx += 1

            if range_idx >= len(time_ranges):
                break

            start_ts, _end_ts = time_ranges[range_idx]
            if frame_time < start_ts:
                continue

            new_frame = frame.reformat(width=v_out.width, height=v_out.height, format=v_out.pix_fmt)
            new_frame.pts = frame_count
            new_frame.time_base = Fraction(1, int(fps))

            for pkt in v_out.encode(new_frame):
                out.mux(pkt)

            frame_count += 1

    for pkt in v_out.encode():
        out.mux(pkt)

    out.close()
    in_container.close()


def copy_and_reindex_videos(
    src_dataset,
    dst_meta,
    episode_mapping: dict[int, int],
    vcodec: str | None = None,
    pix_fmt: str = "yuv420p",
) -> dict[int, dict]:
    """Copy/filter videos while defaulting re-encodes to the configured codec.

    Adapted from ``lerobot.datasets.dataset_tools._copy_and_reindex_videos``; the
    behavioural change is that ``vcodec`` defaults to :data:`VIDEO_CODEC`
    (env-configurable, default ``hevc``) instead of ``libsvtav1``.
    """
    if vcodec is None:
        vcodec = VIDEO_CODEC

    if src_dataset.meta.episodes is None:
        src_dataset.meta.episodes = load_episodes(src_dataset.meta.root)

    episodes_video_metadata: dict[int, dict] = {new_idx: {} for new_idx in episode_mapping.values()}

    for video_key in src_dataset.meta.video_keys:
        logging.info(f"Processing videos for {video_key}")

        if dst_meta.video_path is None:
            raise ValueError("Destination metadata has no video_path defined")

        file_to_episodes: dict[tuple[int, int], list[int]] = {}
        for old_idx in episode_mapping:
            src_ep = src_dataset.meta.episodes[old_idx]
            chunk_idx = src_ep[f"videos/{video_key}/chunk_index"]
            file_idx = src_ep[f"videos/{video_key}/file_index"]
            file_key = (chunk_idx, file_idx)
            if file_key not in file_to_episodes:
                file_to_episodes[file_key] = []
            file_to_episodes[file_key].append(old_idx)

        for (src_chunk_idx, src_file_idx), episodes_in_file in tqdm(
            sorted(file_to_episodes.items()), desc=f"Processing {video_key} video files"
        ):
            all_episodes_in_file = [
                ep_idx
                for ep_idx in range(src_dataset.meta.total_episodes)
                if src_dataset.meta.episodes[ep_idx].get(f"videos/{video_key}/chunk_index") == src_chunk_idx
                and src_dataset.meta.episodes[ep_idx].get(f"videos/{video_key}/file_index") == src_file_idx
            ]

            episodes_to_keep_set = set(episodes_in_file)
            all_in_file_set = set(all_episodes_in_file)

            if all_in_file_set == episodes_to_keep_set:
                assert src_dataset.meta.video_path is not None
                src_video_path = src_dataset.root / src_dataset.meta.video_path.format(
                    video_key=video_key, chunk_index=src_chunk_idx, file_index=src_file_idx
                )
                dst_video_path = dst_meta.root / dst_meta.video_path.format(
                    video_key=video_key, chunk_index=src_chunk_idx, file_index=src_file_idx
                )
                dst_video_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(src_video_path, dst_video_path)

                for old_idx in episodes_in_file:
                    new_idx = episode_mapping[old_idx]
                    src_ep = src_dataset.meta.episodes[old_idx]
                    episodes_video_metadata[new_idx][f"videos/{video_key}/chunk_index"] = src_chunk_idx
                    episodes_video_metadata[new_idx][f"videos/{video_key}/file_index"] = src_file_idx
                    episodes_video_metadata[new_idx][f"videos/{video_key}/from_timestamp"] = src_ep[
                        f"videos/{video_key}/from_timestamp"
                    ]
                    episodes_video_metadata[new_idx][f"videos/{video_key}/to_timestamp"] = src_ep[
                        f"videos/{video_key}/to_timestamp"
                    ]
            else:
                sorted_keep_episodes = sorted(episodes_in_file, key=lambda x: episode_mapping[x])
                episodes_to_keep_ranges: list[tuple[float, float]] = []

                for old_idx in sorted_keep_episodes:
                    src_ep = src_dataset.meta.episodes[old_idx]
                    from_ts = src_ep[f"videos/{video_key}/from_timestamp"]
                    to_ts = src_ep[f"videos/{video_key}/to_timestamp"]
                    episodes_to_keep_ranges.append((from_ts, to_ts))

                assert src_dataset.meta.video_path is not None
                src_video_path = src_dataset.root / src_dataset.meta.video_path.format(
                    video_key=video_key, chunk_index=src_chunk_idx, file_index=src_file_idx
                )
                dst_video_path = dst_meta.root / dst_meta.video_path.format(
                    video_key=video_key, chunk_index=src_chunk_idx, file_index=src_file_idx
                )
                dst_video_path.parent.mkdir(parents=True, exist_ok=True)

                logging.info(
                    f"Re-encoding {video_key} (chunk {src_chunk_idx}, file {src_file_idx}) "
                    f"with {len(episodes_to_keep_ranges)} episodes"
                )
                keep_episodes_from_video_with_av(
                    src_video_path,
                    dst_video_path,
                    episodes_to_keep_ranges,
                    src_dataset.meta.fps,
                    vcodec,
                    pix_fmt,
                )

                cumulative_ts = 0.0
                for old_idx in sorted_keep_episodes:
                    new_idx = episode_mapping[old_idx]
                    src_ep = src_dataset.meta.episodes[old_idx]
                    ep_length = src_ep["length"]
                    ep_duration = ep_length / src_dataset.meta.fps

                    episodes_video_metadata[new_idx][f"videos/{video_key}/chunk_index"] = src_chunk_idx
                    episodes_video_metadata[new_idx][f"videos/{video_key}/file_index"] = src_file_idx
                    episodes_video_metadata[new_idx][f"videos/{video_key}/from_timestamp"] = cumulative_ts
                    episodes_video_metadata[new_idx][f"videos/{video_key}/to_timestamp"] = (
                        cumulative_ts + ep_duration
                    )

                    cumulative_ts += ep_duration

    return episodes_video_metadata


def copy_videos_with_timestamps(
    src_dataset,
    dst_meta,
    episode_mapping: dict[int, int],
    episode_time_ranges: dict[int, tuple[float, float]],
) -> dict[int, dict]:
    """Copy referenced source videos unchanged and rewrite per-episode time pointers."""
    if src_dataset.meta.episodes is None:
        src_dataset.meta.episodes = load_episodes(src_dataset.meta.root)

    episodes_video_metadata: dict[int, dict] = {new_idx: {} for new_idx in episode_mapping.values()}

    for video_key in src_dataset.meta.video_keys:
        logging.info(f"Copying videos for {video_key} without re-encoding")

        if dst_meta.video_path is None:
            raise ValueError("Destination metadata has no video_path defined")

        file_to_episodes: dict[tuple[int, int], list[int]] = {}
        for old_idx in episode_mapping:
            src_ep = src_dataset.meta.episodes[old_idx]
            chunk_idx = src_ep[f"videos/{video_key}/chunk_index"]
            file_idx = src_ep[f"videos/{video_key}/file_index"]
            file_key = (chunk_idx, file_idx)
            if file_key not in file_to_episodes:
                file_to_episodes[file_key] = []
            file_to_episodes[file_key].append(old_idx)

        for (src_chunk_idx, src_file_idx), episodes_in_file in tqdm(
            sorted(file_to_episodes.items()), desc=f"Copying {video_key} video files"
        ):
            assert src_dataset.meta.video_path is not None
            src_video_path = src_dataset.root / src_dataset.meta.video_path.format(
                video_key=video_key,
                chunk_index=src_chunk_idx,
                file_index=src_file_idx,
            )
            dst_video_path = dst_meta.root / dst_meta.video_path.format(
                video_key=video_key,
                chunk_index=src_chunk_idx,
                file_index=src_file_idx,
            )
            dst_video_path.parent.mkdir(parents=True, exist_ok=True)
            if not dst_video_path.exists():
                shutil.copy(src_video_path, dst_video_path)

            for old_idx in episodes_in_file:
                new_idx = episode_mapping[old_idx]
                start_offset, end_offset = episode_time_ranges[old_idx]
                src_ep = src_dataset.meta.episodes[old_idx]
                source_from_timestamp = float(src_ep[f"videos/{video_key}/from_timestamp"])
                episodes_video_metadata[new_idx][f"videos/{video_key}/chunk_index"] = src_chunk_idx
                episodes_video_metadata[new_idx][f"videos/{video_key}/file_index"] = src_file_idx
                episodes_video_metadata[new_idx][f"videos/{video_key}/from_timestamp"] = (
                    source_from_timestamp + float(start_offset)
                )
                episodes_video_metadata[new_idx][f"videos/{video_key}/to_timestamp"] = (
                    source_from_timestamp + float(end_offset)
                )

    return episodes_video_metadata


_OVERRIDES_APPLIED = False


def apply_video_codec_overrides() -> None:
    """Rebind lerobot's video re-encoding helpers to our hevc-fast copies.

    Idempotent: subsequent calls are a no-op. Safe to call once at backend
    startup; covers both ``LeRobotDataset.save_episode`` and ``delete_episodes``
    re-encode paths.
    """
    global _OVERRIDES_APPLIED
    if _OVERRIDES_APPLIED:
        return

    from lerobot.datasets import (  # noqa: PLC0415
        dataset_tools as _dataset_tools,
        lerobot_dataset as _lerobot_dataset,
        video_utils as _video_utils,
    )

    _video_utils.encode_video_frames = encode_video_frames
    # `lerobot_dataset.py` does `from .video_utils import encode_video_frames`,
    # capturing the symbol as a module-level name; rebind that too.
    _lerobot_dataset.encode_video_frames = encode_video_frames
    # `_copy_and_reindex_videos` defaulted `vcodec` to `libsvtav1`, so patch both
    # the caller and the lower-level helper used for the actual re-encode.
    _dataset_tools._copy_and_reindex_videos = copy_and_reindex_videos  # noqa: SLF001
    _dataset_tools._keep_episodes_from_video_with_av = keep_episodes_from_video_with_av  # noqa: SLF001

    _OVERRIDES_APPLIED = True
    logger.info(
        "Video codec overrides applied: vcodec=%s preset=%s (set LDS_VIDEO_CODEC / LDS_VIDEO_PRESET to override)",
        VIDEO_CODEC,
        VIDEO_PRESET,
    )
