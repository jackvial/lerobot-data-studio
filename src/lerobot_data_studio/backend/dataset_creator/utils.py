import json
import logging
from itertools import accumulate
from pathlib import Path

import jsonlines
import numpy as np
import torch
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from lerobot_data_studio.backend.models import CreateTaskStatus, EpisodeDataItem
from lerobot_data_studio.backend.state_store import get_state_store

logger = logging.getLogger(__name__)


def get_episode_data(dataset: LeRobotDataset, episode_index: int):
    from_idx = dataset.episode_data_index["from"][episode_index]
    to_idx = dataset.episode_data_index["to"][episode_index]
    data = dataset.hf_dataset.select(range(from_idx, to_idx)).select_columns(
        ["episode_index", "action", "observation.state", "timestamp"]
    )

    episode_data_items = []
    for sample in data:
        # Round action and observation values to 2 decimal places
        action_values = (
            sample["action"].tolist() if hasattr(sample["action"], "tolist") else list(sample["action"])
        )
        action_rounded = [round(val, 2) for val in action_values]

        observation_values = (
            sample["observation.state"].tolist()
            if hasattr(sample["observation.state"], "tolist")
            else list(sample["observation.state"])
        )
        observation_rounded = [round(val, 2) for val in observation_values]

        episode_data_items.append(
            EpisodeDataItem(
                episode_index=sample["episode_index"],
                action=action_rounded,
                observation=observation_rounded,
                timestamp=round(float(sample["timestamp"]), 2),
            )
        )

    return episode_data_items, dataset.features["observation.state"]["names"]


def update_progress(task_id: str, progress: float, message: str):
    assert task_id, "task_id not found for update_progress"

    state_store = get_state_store()
    # Use partial Pydantic model for updates
    state_store.set_creation_task(task_id, CreateTaskStatus(progress=progress, message=message))
    logger.info(f"[Task {task_id}] {message}")


def get_episode_data_index(
    episode_dicts: dict[dict], episodes: list[int] | None = None
) -> dict[str, torch.Tensor]:
    """
    Used for datasets v2.1 support
    The datasets v3 PR removed this function from `src/lerobot/datasets/utils.py`
    """
    episode_lengths = {ep_idx: ep_dict["length"] for ep_idx, ep_dict in episode_dicts.items()}
    if episodes is not None:
        episode_lengths = {ep_idx: episode_lengths[ep_idx] for ep_idx in episodes}

    cumulative_lengths = list(accumulate(episode_lengths.values()))
    return {
        "from": torch.LongTensor([0] + cumulative_lengths[:-1]),
        "to": torch.LongTensor(cumulative_lengths),
    }


def append_jsonlines(data: dict, fpath: Path) -> None:
    """
    Used for datasets v2.1 support
    The datasets v3 PR removed this function from `src/lerobot/datasets/utils.py`
    """
    fpath.parent.mkdir(exist_ok=True, parents=True)
    with jsonlines.open(fpath, "a") as writer:
        writer.write(data)


EPISODES_STATS_PATH = "meta/episodes_stats.jsonl"
INFO_PATH = "meta/info.json"


def flatten_dict(d: dict, parent_key: str = "", sep: str = "/") -> dict:
    """Flatten a nested dictionary structure by collapsing nested keys into one key with a separator.

    For example:
    ```
    >>> dct = {"a": {"b": 1, "c": {"d": 2}}, "e": 3}`
    >>> print(flatten_dict(dct))
    {"a/b": 1, "a/c/d": 2, "e": 3}
    """
    items = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep=sep).items())
        else:
            items.append((new_key, v))
    return dict(items)


def unflatten_dict(d: dict, sep: str = "/") -> dict:
    outdict = {}
    for key, value in d.items():
        parts = key.split(sep)
        d = outdict
        for part in parts[:-1]:
            if part not in d:
                d[part] = {}
            d = d[part]
        d[parts[-1]] = value
    return outdict


def serialize_dict(stats: dict[str, torch.Tensor | np.ndarray | dict]) -> dict:
    serialized_dict = {}
    for key, value in flatten_dict(stats).items():
        if isinstance(value, (torch.Tensor, np.ndarray)):
            serialized_dict[key] = value.tolist()
        elif isinstance(value, np.generic):
            serialized_dict[key] = value.item()
        elif isinstance(value, (int, float)):
            serialized_dict[key] = value
        else:
            raise NotImplementedError(f"The value '{value}' of type '{type(value)}' is not supported.")
    return unflatten_dict(serialized_dict)


def write_json(data: dict, fpath: Path) -> None:
    fpath.parent.mkdir(exist_ok=True, parents=True)
    with open(fpath, "w") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


def write_episode_stats(episode_index: int, episode_stats: dict, local_dir: Path):
    """
    Used for datasets v2.1 support
    The datasets v3 PR removed this function from `src/lerobot/datasets/utils.py`
    """
    # We wrap episode_stats in a dictionary since `episode_stats["episode_index"]`
    # is a dictionary of stats and not an integer.
    episode_stats = {"episode_index": episode_index, "stats": serialize_dict(episode_stats)}
    append_jsonlines(episode_stats, local_dir / EPISODES_STATS_PATH)


def write_info(info: dict, local_dir: Path):
    write_json(info, local_dir / INFO_PATH)
