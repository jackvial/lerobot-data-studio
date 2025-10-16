"""Utility functions for the backend."""

import logging

from lerobot.datasets.lerobot_dataset import LeRobotDataset

from .models import EpisodeDataItem

logger = logging.getLogger(__name__)


def get_episode_data(dataset: LeRobotDataset, episode_index: int):
    """Extract episode data for display in the UI.

    Args:
        dataset: The LeRobotDataset to extract data from
        episode_index: The episode index to extract

    Returns:
        Tuple of (episode_data_items, feature_names)
    """
    # Get episode boundaries from meta.episodes
    episode_info = dataset.meta.episodes[episode_index]
    from_idx = episode_info["dataset_from_index"]
    to_idx = episode_info["dataset_to_index"]
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
