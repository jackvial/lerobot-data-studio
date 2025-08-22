"""
FastAPI async background tasks
docs: https://fastapi.tiangolo.com/tutorial/background-tasks/
"""

import logging
from typing import List

import numpy as np
import psutil
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from .dataset_creator.filtered_dataset_creator import FilteredDatasetCreator
from .dataset_creator.merged_dataset_creator import MergedDatasetCreator
from .models import CreateTaskStatus, DatasetLoadingStatus, MergeTaskStatus
from .state_store import (
    StateStore,
)

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
    episode_index_task_map: dict,
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

        FilteredDatasetCreator(dataset).create(
            new_repo_id, selected_episodes, episode_index_task_map, task_id
        )

        state_store.set_creation_task(
            task_id,
            CreateTaskStatus(
                status="completed",
                progress=1.0,
                message=f"Successfully created dataset '{new_repo_id}'",
            ),
        )

    except Exception as e:
        state_store.set_creation_task(
            task_id,
            CreateTaskStatus(
                status="failed",
                message=f"Error creating dataset: {str(e)}",
            ),
        )


def merge_datasets_task(
    task_id: str, dataset_ids: List[str], new_repo_id: str, tolerance_s: float, state_store: StateStore = None
):
    """Background task to merge datasets.

    Args:
        task_id: Unique task identifier
        dataset_ids: List of dataset IDs to merge
        new_repo_id: Target dataset repository ID
        tolerance_s: Tolerance in seconds for merging
        state_store: StateStore instance for state management
    """
    try:
        state_store.set_merge_task(
            task_id,
            MergeTaskStatus(
                task_id=task_id,
                status="running",
                progress=0.1,
                message=f"Starting to merge {len(dataset_ids)} datasets...",
            ),
        )

        MergedDatasetCreator().create(dataset_ids, new_repo_id, tolerance_s)

        state_store.set_merge_task(
            task_id,
            MergeTaskStatus(
                status="completed",
                progress=1.0,
                message=f"Successfully merged {len(dataset_ids)} datasets",
                new_repo_id=new_repo_id,
            ),
        )
    except Exception as e:
        state_store.set_merge_task(
            task_id,
            MergeTaskStatus(status="failed", message=f"Error during merge: {str(e)}"),
        )
