import logging

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
