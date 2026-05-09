"""RLT replay-buffer viewer support.

Loads `.pt` files saved by the lerobot policy server's RLT review archive,
groups samples by `episode_id`, and exposes lightweight summaries plus
per-camera JPEG bytes.

The on-disk format is a `dict` produced by `RLTReplayBuffer.state_dict()` with
fields documented in `lerobot.rl.rlt_buffer`. v2 of that format adds optional
fields used by the viewer: ``images_jpeg``, ``inference_ts``, ``episode_id``,
``success``, ``failure``, and ``chunk_start_step``. Older v1 buffers are still
accepted; missing fields surface as ``None`` and the UI falls back gracefully
(see :class:`LoadedSample` for defaults).

We deliberately avoid importing :mod:`lerobot.rl.rlt_buffer` here so the studio
can read review archives without forcing a hard dependency on the exact
lerobot version that wrote them — we only need to ``torch.load`` the dict.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import torch

logger = logging.getLogger(__name__)


DEFAULT_BUFFER_PATH = "/home/jack/code/lerobot/outputs/rlt_tinypi05v2_online/rlt_online_replay.pt"
DEFAULT_BUFFER_ROOT_ENV = "LEROBOT_RLT_BUFFER_ROOT"
DEFAULT_BUFFER_ROOT = "outputs/rlt_review"
MAX_LOADED_BUFFERS = 4


def get_buffer_root() -> Path:
    """Legacy fallback root used when no explicit path is supplied."""
    root = os.environ.get(DEFAULT_BUFFER_ROOT_ENV, DEFAULT_BUFFER_ROOT)
    return Path(root).expanduser().resolve()


def get_default_buffer_path() -> Path:
    return Path(DEFAULT_BUFFER_PATH).expanduser().resolve()


@dataclass
class LoadedSample:
    """Subset of `RLTReplaySample` needed by the viewer.

    All fields beyond the executed action / reward / done / is_intervention are
    optional so v1 buffers (pre-review-archive) still load. ``images_jpeg`` is
    a plain dict keyed by camera name (e.g. ``observation.images.front``).
    """

    executed_chunk: torch.Tensor
    reward: float
    done: bool
    is_intervention: bool
    images_jpeg: dict[str, bytes] | None = None
    inference_ts: float | None = None
    episode_id: int | None = None
    success: bool | None = None
    failure: bool | None = None
    chunk_start_step: int | None = None


@dataclass
class LoadedBuffer:
    path: Path
    samples: list[LoadedSample]
    episode_indices: dict[int, list[int]] = field(default_factory=dict)
    has_inference_ts: bool = False
    version: int = 1

    @property
    def num_samples(self) -> int:
        return len(self.samples)

    @property
    def num_episodes(self) -> int:
        return len(self.episode_indices)


@dataclass
class EpisodeReview:
    """User-maintained review metadata stored outside the replay buffer."""

    label: str | None = None
    deleted: bool = False


class RltBufferStore:
    """LRU cache of loaded `.pt` review buffers keyed by resolved path.

    The store is the source of truth for `file_token` <-> path mapping. Tokens
    are URL-safe base64 of the resolved path string; we still validate that
    the resolved path lives under the configured root before opening it, so a
    crafted token cannot be used to read arbitrary files.
    """

    def __init__(self, max_loaded: int = MAX_LOADED_BUFFERS):
        self._max_loaded = max_loaded
        self._lock = threading.Lock()
        self._cache: OrderedDict[Path, LoadedBuffer] = OrderedDict()

    @staticmethod
    def encode_token(path: Path) -> str:
        return base64.urlsafe_b64encode(str(path).encode("utf-8")).decode("ascii")

    @staticmethod
    def decode_token(token: str) -> Path:
        try:
            decoded = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError(f"Invalid file token: {token}") from exc
        return Path(decoded)

    def resolve_token(self, token: str) -> Path:
        candidate = self.decode_token(token).resolve()
        if not candidate.exists():
            raise FileNotFoundError(f"RLT buffer file not found: {candidate}")
        if not candidate.is_file() or candidate.suffix != ".pt":
            raise ValueError(f"RLT buffer token does not resolve to a .pt file: {candidate}")
        return candidate

    def get(self, path: Path) -> LoadedBuffer:
        path = path.resolve()
        with self._lock:
            cached = self._cache.get(path)
            if cached is not None:
                self._cache.move_to_end(path)
                return cached

        loaded = load_buffer_file(path)

        with self._lock:
            self._cache[path] = loaded
            self._cache.move_to_end(path)
            while len(self._cache) > self._max_loaded:
                self._cache.popitem(last=False)
        return loaded

    def evict(self, path: Path) -> None:
        with self._lock:
            self._cache.pop(path.resolve(), None)


_store_singleton: RltBufferStore | None = None


def get_rlt_buffer_store() -> RltBufferStore:
    global _store_singleton
    if _store_singleton is None:
        _store_singleton = RltBufferStore()
    return _store_singleton


def list_buffer_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    seen: set[Path] = set()
    files: list[Path] = []
    for path in sorted(root.glob("**/*.pt")):
        if not path.is_file():
            continue
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        files.append(path)
    return files


def resolve_buffer_selection(path_value: str | None = None) -> tuple[Path, list[Path]]:
    """Resolve a user-entered replay-buffer file or directory.

    If the path is a file, the response contains exactly that file. If it is a
    directory, all `**/*.pt` files below it are returned with resolved-path
    dedupe. When omitted, prefer the tinypi05v2 default replay file and fall
    back to the legacy env/root scan if the file is not present.
    """

    if path_value:
        source = Path(path_value).expanduser().resolve()
    else:
        default_file = get_default_buffer_path()
        if default_file.exists():
            source = default_file
        else:
            source = get_buffer_root()

    if not source.exists():
        raise FileNotFoundError(f"RLT buffer path not found: {source}")
    if source.is_file():
        if source.suffix != ".pt":
            raise ValueError(f"RLT buffer file must end with .pt: {source}")
        return source, [source]
    if source.is_dir():
        return source, list_buffer_files(source)
    raise ValueError(f"RLT buffer path must be a file or directory: {source}")


def review_path_for_buffer(path: Path) -> Path:
    return path.with_suffix(".review.json")


def load_episode_reviews(path: Path) -> dict[int, EpisodeReview]:
    review_path = review_path_for_buffer(path)
    if not review_path.exists():
        return {}
    try:
        with review_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not load RLT review metadata %s: %s", review_path, exc)
        return {}

    raw_episodes = payload.get("episodes", {}) if isinstance(payload, dict) else {}
    reviews: dict[int, EpisodeReview] = {}
    if not isinstance(raw_episodes, dict):
        return reviews
    for raw_episode_id, raw_review in raw_episodes.items():
        try:
            episode_id = int(raw_episode_id)
        except (TypeError, ValueError):
            continue
        if not isinstance(raw_review, dict):
            continue
        label = raw_review.get("label")
        if label not in {"success", "failure", "open", None}:
            label = None
        reviews[episode_id] = EpisodeReview(
            label=label,
            deleted=bool(raw_review.get("deleted", False)),
        )
    return reviews


def save_episode_review(path: Path, episode_id: int, review: EpisodeReview) -> EpisodeReview:
    reviews = load_episode_reviews(path)
    reviews[episode_id] = review
    review_path = review_path_for_buffer(path)
    payload = {
        "version": 1,
        "buffer_path": str(path.resolve()),
        "episodes": {
            str(ep_id): {
                "label": ep_review.label,
                "deleted": ep_review.deleted,
            }
            for ep_id, ep_review in sorted(reviews.items())
        },
    }
    review_path.parent.mkdir(parents=True, exist_ok=True)
    with review_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    return review


def _coerce_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_optional_bool(value: Any) -> bool | None:
    if value is None:
        return None
    return bool(value)


def _coerce_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_images(value: Any) -> dict[str, bytes] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        return None
    out: dict[str, bytes] = {}
    for key, payload in value.items():
        if isinstance(payload, (bytes, bytearray)) and isinstance(key, str):
            out[key] = bytes(payload)
    return out or None


def _decode_sample(state: dict[str, Any]) -> LoadedSample:
    executed_chunk = state.get("executed_chunk")
    if not isinstance(executed_chunk, torch.Tensor):
        executed_chunk = torch.zeros(0)
    return LoadedSample(
        executed_chunk=executed_chunk,
        reward=float(state.get("reward", 0.0) or 0.0),
        done=bool(state.get("done", False)),
        is_intervention=bool(state.get("is_intervention", False)),
        images_jpeg=_coerce_images(state.get("images_jpeg")),
        inference_ts=_coerce_optional_float(state.get("inference_ts")),
        episode_id=_coerce_optional_int(state.get("episode_id")),
        success=_coerce_optional_bool(state.get("success")),
        failure=_coerce_optional_bool(state.get("failure")),
        chunk_start_step=_coerce_optional_int(state.get("chunk_start_step")),
    )


def load_buffer_file(path: Path) -> LoadedBuffer:
    state_dict = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(state_dict, dict) or "samples" not in state_dict:
        raise ValueError(f"File {path} is not a valid RLT replay buffer state dict")

    version = int(state_dict.get("version", 1))
    raw_samples = state_dict.get("samples") or []
    samples = [_decode_sample(s) for s in raw_samples]

    episode_indices: dict[int, list[int]] = {}
    fallback_episode_id = 0
    seen_done_in_fallback = False
    has_any_episode_id = any(s.episode_id is not None for s in samples)

    for idx, sample in enumerate(samples):
        if sample.episode_id is not None:
            episode_id = sample.episode_id
        elif has_any_episode_id:
            episode_id = -1
        else:
            episode_id = fallback_episode_id
            if sample.done:
                seen_done_in_fallback = True
        episode_indices.setdefault(episode_id, []).append(idx)
        if sample.episode_id is None and not has_any_episode_id and seen_done_in_fallback:
            fallback_episode_id += 1
            seen_done_in_fallback = False

    has_inference_ts = any(s.inference_ts is not None for s in samples)
    if has_inference_ts:
        for indices in episode_indices.values():
            indices.sort(
                key=lambda i: (
                    samples[i].inference_ts if samples[i].inference_ts is not None else float("inf"),
                    i,
                )
            )

    logger.info(
        "Loaded RLT buffer %s (version=%d, samples=%d, episodes=%d, has_inference_ts=%s)",
        path,
        version,
        len(samples),
        len(episode_indices),
        has_inference_ts,
    )

    return LoadedBuffer(
        path=path.resolve(),
        samples=samples,
        episode_indices=episode_indices,
        has_inference_ts=has_inference_ts,
        version=version,
    )


def episode_label(samples: list[LoadedSample], indices: list[int]) -> str:
    """Classify an episode as success / failure / open based on its samples.

    Priority: explicit ``success`` flag wins, then explicit ``failure``, else
    "open" — covers in-progress trailing episodes and legacy v1 buffers that
    don't carry the labels.
    """

    has_success = False
    has_failure = False
    for idx in indices:
        sample = samples[idx]
        if sample.success:
            has_success = True
        if sample.failure:
            has_failure = True
    if has_success:
        return "success"
    if has_failure:
        return "failure"
    return "open"


def episode_duration_seconds(samples: list[LoadedSample], indices: list[int]) -> float:
    timestamps = [samples[i].inference_ts for i in indices if samples[i].inference_ts is not None]
    if len(timestamps) < 2:
        return 0.0
    return float(max(timestamps) - min(timestamps))


def _action_summary(executed_chunk: torch.Tensor) -> list[float]:
    """Mean per action-dim across the executed chunk.

    ``executed_chunk`` is shape ``(chunk_len, action_dim)``. We collapse the
    time axis to a single per-dim mean for compact charting.
    """

    if executed_chunk.numel() == 0:
        return []
    if executed_chunk.dim() == 1:
        return [float(executed_chunk.mean().item())]
    return executed_chunk.mean(dim=0).tolist()


def build_transition_info(
    samples: list[LoadedSample],
    indices: list[int],
) -> tuple[list[dict[str, Any]], bool]:
    """Convert the per-episode sample indices into JSON-friendly dicts.

    Returns the list plus a flag indicating whether any sample carried a real
    ``inference_ts`` so the UI can display a "fallback spacing" warning when
    none is present.
    """

    if not indices:
        return [], False

    has_inference_ts = any(samples[i].inference_ts is not None for i in indices)

    if has_inference_ts:
        first_ts: float | None = None
        for idx in indices:
            ts = samples[idx].inference_ts
            if ts is not None:
                first_ts = ts
                break
        base_ts = first_ts or 0.0
    else:
        base_ts = 0.0

    out: list[dict[str, Any]] = []
    for order_idx, sample_idx in enumerate(indices):
        sample = samples[sample_idx]
        if has_inference_ts and sample.inference_ts is not None:
            t_offset = float(sample.inference_ts - base_ts)
        else:
            t_offset = float(order_idx)

        image_keys = sorted(sample.images_jpeg.keys()) if sample.images_jpeg else []
        out.append(
            {
                "index": sample_idx,
                "ts": sample.inference_ts,
                "t_offset_s": t_offset,
                "action_summary": _action_summary(sample.executed_chunk),
                "reward": float(sample.reward),
                "done": bool(sample.done),
                "success": bool(sample.success) if sample.success is not None else False,
                "failure": bool(sample.failure) if sample.failure is not None else False,
                "is_intervention": bool(sample.is_intervention),
                "image_keys": image_keys,
            }
        )

    return out, has_inference_ts
