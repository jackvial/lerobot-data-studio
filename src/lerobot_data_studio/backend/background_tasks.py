"""
FastAPI async background tasks
docs: https://fastapi.tiangolo.com/tutorial/background-tasks/
"""

import logging
from typing import Dict, List

import numpy as np
import psutil
from lerobot.datasets.dataset_tools import delete_episodes
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from .idle_trim import trim_episodes_with_explicit_bounds
from .models import CreateTaskStatus, DatasetLoadingStatus, EpisodeTrimBounds
from .state_store import StateStore
from .trimmed_dataset_export import build_trimmed_dataset_with_copied_videos

logger = logging.getLogger(__name__)


def get_process_memory_mb():
    """Get current process memory usage in MB."""
    process = psutil.Process()
    memory_info = process.memory_info()
    return round(memory_info.rss / (1024 * 1024), 2)


def load_dataset_task(repo_id: str, state_store: StateStore = None):
    """
    Background task to load dataset

    Args:
        repo_id: The repository ID of the dataset to load
        state_store: StateStore instance for state management
    """

    try:
        memory_before = get_process_memory_mb()
        logger.info(f"Memory before loading {repo_id}: {memory_before} MB")

        state_store.set_loading_status(
            repo_id,
            DatasetLoadingStatus(progress=0.3, message=f"Downloading dataset {repo_id}..."),
        )

        dataset = LeRobotDataset(repo_id)
        state_store.cache_dataset(repo_id, dataset)

        memory_after = get_process_memory_mb()
        memory_used = np.around(memory_after - memory_before, 2).item()
        logger.info(f"Memory after loading {repo_id}: {memory_after} MB (used: {memory_used} MB)")

        state_store.set_loading_status(
            repo_id,
            DatasetLoadingStatus(
                status="ready",
                progress=1.0,
                message="Dataset loaded successfully",
                memory_usage_mb=memory_used,
            ),
        )

    except (FileNotFoundError, PermissionError) as e:
        state_store.set_loading_status(
            repo_id, DatasetLoadingStatus(status="error", message=f"File access error: {str(e)}")
        )
    except (ValueError, KeyError) as e:
        state_store.set_loading_status(
            repo_id, DatasetLoadingStatus(status="error", message=f"Invalid dataset format: {str(e)}")
        )
    except Exception as e:
        state_store.set_loading_status(
            repo_id, DatasetLoadingStatus(status="error", message=f"Failed to load dataset: {str(e)}")
        )
    finally:
        state_store.finish_loading(repo_id)


def create_dataset_task(
    task_id: str,
    original_repo_id: str,
    new_repo_id: str,
    selected_episodes: List[int],
    episode_index_task_map: Dict[int, str] | None,
    episode_index_trim_map: Dict[int, EpisodeTrimBounds] | None,
    state_store: StateStore = None,
):
    """Background task to create filtered dataset.

    Args:
        task_id: Unique task identifier
        original_repo_id: Source dataset repository ID
        new_repo_id: Target dataset repository ID
        selected_episodes: List of episode indices to include
        episode_index_task_map: Mapping of episode indices to tasks
        state_store: StateStore instance for state management
    """

    try:
        state_store.set_creation_task(
            task_id,
            CreateTaskStatus(
                task_id=task_id,
                status="running",
                progress=0.1,
                message=f"Starting to create dataset with {len(selected_episodes)} episodes...",
                new_repo_id=new_repo_id,
            ),
        )

        dataset = state_store.get_dataset(original_repo_id)
        if not dataset:
            raise ValueError(f"Dataset {original_repo_id} not found in cache")

        trim_map = episode_index_trim_map or {}

        state_store.set_creation_task(
            task_id,
            CreateTaskStatus(
                task_id=task_id,
                status="running",
                progress=0.3,
                message="Building trimmed dataset..." if trim_map else "Filtering episodes...",
                new_repo_id=new_repo_id,
            ),
        )

        if trim_map:
            filtered_dataset, _reports = build_trimmed_dataset_with_copied_videos(
                dataset,
                new_repo_id=new_repo_id,
                episode_indices=selected_episodes,
                episode_trim_map=trim_map,
            )
        else:
            # Create filtered dataset by deleting unselected episodes
            all_episodes = list(range(dataset.meta.total_episodes))
            episodes_to_delete = [ep for ep in all_episodes if ep not in selected_episodes]

            if episodes_to_delete:
                filtered_dataset = delete_episodes(
                    dataset, episode_indices=episodes_to_delete, repo_id=new_repo_id
                )
            else:
                filtered_dataset, _reports = trim_episodes_with_explicit_bounds(
                    dataset,
                    new_repo_id=new_repo_id,
                    episode_indices=selected_episodes,
                    episode_trim_map=None,
                )

        state_store.set_creation_task(
            task_id,
            CreateTaskStatus(
                task_id=task_id,
                status="running",
                progress=0.7,
                message="Pushing dataset to hub...",
                new_repo_id=new_repo_id,
            ),
        )

        # TODO: Handle episode_index_task_map for custom task assignments
        # This might require using the add_feature API or updating metadata after creation
        if episode_index_task_map:
            logger.warning("Custom task assignment is not yet implemented with the new API")

        # Push to hub
        filtered_dataset.push_to_hub(
            license="apache-2.0",
            tags=["LeRobot", "robotics"],
        )

        state_store.set_creation_task(
            task_id,
            CreateTaskStatus(
                task_id=task_id,
                status="completed",
                progress=1.0,
                message=f"Successfully created dataset '{new_repo_id}'",
                new_repo_id=new_repo_id,
            ),
        )

    except Exception as e:
        logger.error(f"Error creating dataset: {str(e)}", exc_info=True)
        state_store.set_creation_task(
            task_id,
            CreateTaskStatus(
                task_id=task_id,
                status="failed",
                message=f"Error creating dataset: {str(e)}",
                new_repo_id=new_repo_id,
            ),
        )
