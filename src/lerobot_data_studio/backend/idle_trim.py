"""Bulk-trim leading/trailing idle frames from a LeRobotDataset's episodes."""

import logging
from dataclasses import dataclass
from typing import Optional

import torch
from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.datasets.utils import DEFAULT_FEATURES

from .idle_analysis import analyze_idle_time
from .models import IdleSpan

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


def report_episode_trim(source: LeRobotDataset, episode_id: int) -> EpisodeTrimReport:
    """Compute (but do not apply) the trim plan for a single episode."""
    info = source.meta.episodes[episode_id]
    from_idx = info["dataset_from_index"]
    to_idx = info["dataset_to_index"]
    n = to_idx - from_idx
    analysis = analyze_idle_time(source, episode_id)
    keep_start, keep_end = compute_trim_bounds(analysis.spans, n, float(source.fps))
    leading = keep_start
    trailing = (n - 1) - keep_end if keep_end < n - 1 else 0
    if keep_end - keep_start + 1 < 2:
        return EpisodeTrimReport(
            episode_id=episode_id,
            n_frames=n,
            keep_start=keep_start,
            keep_end=keep_end,
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


def trim_episodes(
    source: LeRobotDataset,
    new_repo_id: str,
    episode_indices: Optional[list[int]] = None,
) -> tuple[LeRobotDataset, list[EpisodeTrimReport]]:
    """Build a new LeRobotDataset that excludes leading/trailing idle frames."""
    indices = (
        list(episode_indices) if episode_indices is not None else list(range(source.num_episodes))
    )

    new_dataset = LeRobotDataset.create(
        repo_id=new_repo_id,
        fps=source.fps,
        features={k: v for k, v in source.features.items() if k not in _MANAGED_KEYS},
        robot_type=source.meta.robot_type,
        use_videos=True,
    )

    feature_keys = {k for k in source.features.keys() if k not in _MANAGED_KEYS}
    image_keys = {
        k for k in feature_keys if _is_image_feature(source.features[k])
    }

    reports: list[EpisodeTrimReport] = []
    for ep_idx in indices:
        report = report_episode_trim(source, ep_idx)
        reports.append(report)
        if report.skipped:
            logger.warning(
                "Skipping episode %d: %s (n_frames=%d, leading=%d, trailing=%d)",
                ep_idx,
                report.skip_reason,
                report.n_frames,
                report.leading_dropped,
                report.trailing_dropped,
            )
            continue

        info = source.meta.episodes[ep_idx]
        from_idx = info["dataset_from_index"]
        tasks = info["tasks"]
        if len(tasks) > 1:
            logger.warning(
                "Episode %d has multiple tasks %r; using only the first.", ep_idx, tasks
            )
        task = tasks[0]

        logger.info(
            "ep %d: keep frames %d..%d of 0..%d (dropped %d leading + %d trailing)",
            ep_idx,
            report.keep_start,
            report.keep_end,
            report.n_frames - 1,
            report.leading_dropped,
            report.trailing_dropped,
        )

        for global_i in range(from_idx + report.keep_start, from_idx + report.keep_end + 1):
            sample = source[global_i]
            frame = _frame_for_add(sample, feature_keys, task)
            for img_key in image_keys:
                if img_key in frame and isinstance(frame[img_key], torch.Tensor):
                    frame[img_key] = _convert_image_tensor(frame[img_key])
            new_dataset.add_frame(frame)
        new_dataset.save_episode()

    new_dataset.finalize()
    return new_dataset, reports
