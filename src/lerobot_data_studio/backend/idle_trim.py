"""Bulk-trim leading/trailing idle frames from a LeRobotDataset's episodes."""

import logging
import math
from dataclasses import dataclass
from typing import Optional

import torch
from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.datasets.utils import DEFAULT_FEATURES

from .idle_analysis import analyze_idle_time
from .models import EpisodeTrimBounds, IdleSpan

logger = logging.getLogger(__name__)

# lerobot manages these columns automatically via add_frame/save_episode and
# they must NOT be passed back in. `task` is required by add_frame and is
# added by us per-frame from the source episode metadata.
_MANAGED_KEYS = set(DEFAULT_FEATURES.keys())


@dataclass
class EpisodeTrimReport:
    episode_id: int
    n_frames: int
    keep_start: int
    keep_end: int
    keep_start_time: float
    keep_end_time: float
    leading_dropped: int
    trailing_dropped: int
    skipped: bool = False
    skip_reason: Optional[str] = None

    @property
    def kept_frames(self) -> int:
        if self.skipped:
            return 0
        return self.keep_end - self.keep_start + 1


def compute_trim_bounds(
    spans: list[IdleSpan], n_frames: int, fps: float
) -> tuple[int, int]:
    """Convert idle-span timestamps into frame indices for the kept range.

    Returns ``(keep_start, keep_end)`` (inclusive). With the start/end-only
    constraint enforced by `analyze_idle_time`, every span will touch either
    frame 0 or the last frame of the episode.
    """
    keep_start = 0
    keep_end = n_frames - 1
    last_frame = n_frames - 1
    for span in spans:
        start_frame = int(round(span.start_time * fps))
        end_frame = int(round(span.end_time * fps))
        start_frame = max(0, min(start_frame, last_frame))
        end_frame = max(0, min(end_frame, last_frame))
        if start_frame <= 0:
            keep_start = max(keep_start, end_frame + 1)
        if end_frame >= last_frame:
            keep_end = min(keep_end, start_frame - 1)
    return keep_start, keep_end


def _get_episode_timestamps(source: LeRobotDataset, episode_id: int) -> list[float]:
    info = source.meta.episodes[episode_id]
    from_idx = int(info["dataset_from_index"])
    to_idx = int(info["dataset_to_index"])
    return [float(source.hf_dataset[int(global_idx)]["timestamp"]) for global_idx in range(from_idx, to_idx)]


def compute_keep_indices_from_trim_bounds(
    trim_bounds: Optional[EpisodeTrimBounds], timestamps: list[float], fps: float
) -> tuple[int, int]:
    """Translate explicit kept timestamps into inclusive frame indices.

    A half-frame tolerance absorbs frontend rounding and floating-point drift.
    """
    if not timestamps:
        raise ValueError("Episode has no frames")

    if trim_bounds is None:
        return 0, len(timestamps) - 1

    start_time = float(trim_bounds.start_time)
    end_time = float(trim_bounds.end_time)
    if not math.isfinite(start_time) or not math.isfinite(end_time):
        raise ValueError("Trim bounds must be finite")
    if end_time <= start_time:
        raise ValueError("Trim end_time must be greater than start_time")

    tolerance = 0.5 / float(fps) if fps > 0 else 0.0
    first_timestamp = timestamps[0]
    last_timestamp = timestamps[-1]
    if end_time < first_timestamp - tolerance or start_time > last_timestamp + tolerance:
        raise ValueError("Trim bounds fall outside the episode")

    keep_start = next(
        (idx for idx, timestamp in enumerate(timestamps) if timestamp >= start_time - tolerance),
        None,
    )
    keep_end = next(
        (
            len(timestamps) - 1 - offset
            for offset, timestamp in enumerate(reversed(timestamps))
            if timestamp <= end_time + tolerance
        ),
        None,
    )
    if keep_start is None or keep_end is None or keep_end < keep_start:
        raise ValueError("Trim bounds produce an empty kept range")

    return keep_start, keep_end


def report_episode_trim(source: LeRobotDataset, episode_id: int) -> EpisodeTrimReport:
    """Compute (but do not apply) the idle-analysis trim plan for a single episode."""
    info = source.meta.episodes[episode_id]
    from_idx = info["dataset_from_index"]
    to_idx = info["dataset_to_index"]
    n = to_idx - from_idx
    timestamps = _get_episode_timestamps(source, episode_id)
    analysis = analyze_idle_time(source, episode_id)
    keep_start, keep_end = compute_trim_bounds(analysis.spans, n, float(source.fps))
    start_idx = max(0, min(keep_start, len(timestamps) - 1))
    end_idx = max(0, min(keep_end, len(timestamps) - 1))
    keep_start_time = timestamps[start_idx]
    keep_end_time = timestamps[end_idx]
    leading = keep_start
    trailing = (n - 1) - keep_end if keep_end < n - 1 else 0
    if keep_end - keep_start + 1 < 2:
        return EpisodeTrimReport(
            episode_id=episode_id,
            n_frames=n,
            keep_start=keep_start,
            keep_end=keep_end,
            keep_start_time=keep_start_time,
            keep_end_time=keep_end_time,
            leading_dropped=leading,
            trailing_dropped=trailing,
            skipped=True,
            skip_reason="kept range < 2 frames",
        )
    return EpisodeTrimReport(
        episode_id=episode_id,
        n_frames=n,
        keep_start=keep_start,
        keep_end=keep_end,
        keep_start_time=keep_start_time,
        keep_end_time=keep_end_time,
        leading_dropped=leading,
        trailing_dropped=trailing,
    )


def report_episode_trim_from_bounds(
    source: LeRobotDataset,
    episode_id: int,
    trim_bounds: Optional[EpisodeTrimBounds],
) -> EpisodeTrimReport:
    """Compute the kept frame window for an explicit user-selected trim."""
    info = source.meta.episodes[episode_id]
    from_idx = int(info["dataset_from_index"])
    to_idx = int(info["dataset_to_index"])
    n_frames = to_idx - from_idx
    timestamps = _get_episode_timestamps(source, episode_id)
    keep_start, keep_end = compute_keep_indices_from_trim_bounds(
        trim_bounds=trim_bounds,
        timestamps=timestamps,
        fps=float(source.fps),
    )
    if trim_bounds is not None and keep_end - keep_start + 1 < 2:
        raise ValueError(f"Episode {episode_id} trim would keep fewer than 2 frames")

    leading = keep_start
    trailing = (n_frames - 1) - keep_end if keep_end < n_frames - 1 else 0
    return EpisodeTrimReport(
        episode_id=episode_id,
        n_frames=n_frames,
        keep_start=keep_start,
        keep_end=keep_end,
        keep_start_time=timestamps[keep_start],
        keep_end_time=timestamps[keep_end],
        leading_dropped=leading,
        trailing_dropped=trailing,
    )


def _frame_for_add(sample: dict, feature_keys: set[str], task: str) -> dict:
    """Convert a `LeRobotDataset.__getitem__` sample into an add_frame payload.

    Strips lerobot-managed columns, drops any extra keys (e.g. `task`/`index_*`)
    that are not declared features, converts torch tensors of image features
    from CHW float [0,1] to HWC uint8 numpy as expected by `_save_image`.
    """
    frame: dict = {}
    for key, value in sample.items():
        if key in _MANAGED_KEYS:
            continue
        if key not in feature_keys:
            continue
        frame[key] = value
    frame["task"] = task
    return frame


def _is_image_feature(feature: dict) -> bool:
    return feature.get("dtype") in ("image", "video")


def _convert_image_tensor(tensor: torch.Tensor) -> torch.Tensor:
    """`__getitem__` returns image features as CHW float in [0,1]; convert to
    HWC uint8 which is what `LeRobotDataset._save_image` (PIL) wants."""
    if tensor.ndim == 3 and tensor.shape[0] in (1, 3, 4):
        tensor = tensor.permute(1, 2, 0)
    if tensor.dtype.is_floating_point:
        tensor = (tensor.clamp(0, 1) * 255.0).to(torch.uint8)
    return tensor


def _build_dataset_from_reports(
    source: LeRobotDataset,
    new_repo_id: str,
    reports: list[EpisodeTrimReport],
) -> tuple[LeRobotDataset, list[EpisodeTrimReport]]:
    new_dataset = LeRobotDataset.create(
        repo_id=new_repo_id,
        fps=source.fps,
        features={k: v for k, v in source.features.items() if k not in _MANAGED_KEYS},
        robot_type=source.meta.robot_type,
        use_videos=True,
    )

    feature_keys = {k for k in source.features.keys() if k not in _MANAGED_KEYS}
    image_keys = {k for k in feature_keys if _is_image_feature(source.features[k])}

    for report in reports:
        if report.skipped:
            logger.warning(
                "Skipping episode %d: %s (n_frames=%d, leading=%d, trailing=%d)",
                report.episode_id,
                report.skip_reason,
                report.n_frames,
                report.leading_dropped,
                report.trailing_dropped,
            )
            continue

        info = source.meta.episodes[report.episode_id]
        from_idx = int(info["dataset_from_index"])
        tasks = info["tasks"]
        if len(tasks) > 1:
            logger.warning(
                "Episode %d has multiple tasks %r; using only the first.",
                report.episode_id,
                tasks,
            )
        task = tasks[0]

        logger.info(
            "ep %d: keep frames %d..%d of 0..%d (dropped %d leading + %d trailing)",
            report.episode_id,
            report.keep_start,
            report.keep_end,
            report.n_frames - 1,
            report.leading_dropped,
            report.trailing_dropped,
        )

        for global_idx in range(from_idx + report.keep_start, from_idx + report.keep_end + 1):
            sample = source[int(global_idx)]
            frame = _frame_for_add(sample, feature_keys, task)
            for image_key in image_keys:
                if image_key in frame and isinstance(frame[image_key], torch.Tensor):
                    frame[image_key] = _convert_image_tensor(frame[image_key])
            new_dataset.add_frame(frame)
        new_dataset.save_episode()

    new_dataset.finalize()
    return new_dataset, reports


def trim_episodes(
    source: LeRobotDataset,
    new_repo_id: str,
    episode_indices: Optional[list[int]] = None,
) -> tuple[LeRobotDataset, list[EpisodeTrimReport]]:
    """Build a new LeRobotDataset using idle-analysis-derived trim windows."""
    indices = list(episode_indices) if episode_indices is not None else list(range(source.num_episodes))
    reports = [report_episode_trim(source, episode_id) for episode_id in indices]
    return _build_dataset_from_reports(source, new_repo_id, reports)


def trim_episodes_with_explicit_bounds(
    source: LeRobotDataset,
    new_repo_id: str,
    episode_indices: Optional[list[int]] = None,
    episode_trim_map: Optional[dict[int, EpisodeTrimBounds]] = None,
) -> tuple[LeRobotDataset, list[EpisodeTrimReport]]:
    """Build a new dataset from explicit per-episode kept time bounds."""
    indices = list(episode_indices) if episode_indices is not None else list(range(source.num_episodes))
    trim_map = episode_trim_map or {}
    reports = [
        report_episode_trim_from_bounds(source, episode_id, trim_map.get(episode_id))
        for episode_id in indices
    ]
    return _build_dataset_from_reports(source, new_repo_id, reports)
