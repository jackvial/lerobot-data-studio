"""Per-episode idle-time analysis based on trajectory signal magnitudes."""

import logging

import numpy as np
from lerobot.datasets.lerobot_dataset import LeRobotDataset
from scipy.ndimage import label
from scipy.signal import savgol_filter

from .models import IdleAnalysisResponse, IdleSpan

logger = logging.getLogger(__name__)

_EPS = 1e-6


def _to_array(values) -> np.ndarray:
    """Convert a list of array-like rows to a 2D numpy array."""
    rows = []
    for row in values:
        if hasattr(row, "tolist"):
            rows.append(row.tolist())
        else:
            rows.append(list(row))
    return np.asarray(rows, dtype=np.float64)


def analyze_idle_time(
    dataset: LeRobotDataset,
    episode_id: int,
    threshold: float = 0.15,
    min_duration: float = 0.5,
) -> IdleAnalysisResponse:
    """Detect contiguous spans of low motion in an episode.

    The motion signal is built from the per-feature velocity of `observation.state`,
    normalized by each feature's episode std so units don't matter, then reduced to a
    scalar via L2 norm and smoothed with a Savitzky-Golay filter.
    """
    episode_info = dataset.meta.episodes[episode_id]
    from_idx = episode_info["dataset_from_index"]
    to_idx = episode_info["dataset_to_index"]
    fps = float(dataset.fps)

    data = dataset.hf_dataset.select(range(from_idx, to_idx)).select_columns(
        ["observation.state", "timestamp"]
    )

    state = _to_array(data["observation.state"])
    timestamps = np.asarray(data["timestamp"], dtype=np.float64)
    n_frames = state.shape[0]

    episode_duration = float(timestamps[-1] - timestamps[0]) if n_frames > 1 else 0.0

    if n_frames < 3:
        return IdleAnalysisResponse(
            episode_id=episode_id,
            spans=[],
            threshold=threshold,
            min_duration=min_duration,
            total_idle_seconds=0.0,
            episode_duration=episode_duration,
        )

    velocity = np.gradient(state, axis=0) * fps
    feature_std = np.std(velocity, axis=0)
    velocity_normalized = velocity / (feature_std + _EPS)
    motion = np.linalg.norm(velocity_normalized, axis=1)

    window_target = max(int(round(0.5 * fps)), 5)
    if window_target % 2 == 0:
        window_target += 1
    window = min(window_target, n_frames if n_frames % 2 == 1 else n_frames - 1)
    if window < 5:
        smoothed = motion
    else:
        polyorder = min(2, window - 1)
        smoothed = savgol_filter(motion, window, polyorder)

    idle_mask = smoothed < threshold
    labeled, num_runs = label(idle_mask)

    min_frames = max(int(round(min_duration * fps)), 1)
    spans: list[IdleSpan] = []
    total_idle = 0.0
    for run_idx in range(1, num_runs + 1):
        indices = np.where(labeled == run_idx)[0]
        if indices.size < min_frames:
            continue
        start_frame = int(indices[0])
        end_frame = int(indices[-1])
        start_time = float(timestamps[start_frame])
        end_time = float(timestamps[end_frame])
        spans.append(IdleSpan(start_time=start_time, end_time=end_time))
        total_idle += end_time - start_time

    return IdleAnalysisResponse(
        episode_id=episode_id,
        spans=spans,
        threshold=threshold,
        min_duration=min_duration,
        total_idle_seconds=total_idle,
        episode_duration=episode_duration,
    )
