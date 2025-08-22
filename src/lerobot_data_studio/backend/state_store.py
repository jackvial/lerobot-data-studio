"""Dataset caching and state management for the LeRobot Data Studio backend."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

from huggingface_hub.constants import HF_HOME
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from .models import CreateTaskStatus, DatasetLoadingStatus, MergeTaskStatus

default_cache_path = Path(HF_HOME) / "lerobot"
HF_LEROBOT_HOME = Path(os.getenv("HF_LEROBOT_HOME", default_cache_path)).expanduser()


@dataclass
class StateStore:
    """Simple global state management"""

    dataset_cache: Dict[str, LeRobotDataset] = field(default_factory=dict)
    dataset_loading_status: Dict[str, DatasetLoadingStatus] = field(default_factory=dict)
    loading_tasks: Dict[str, str] = field(default_factory=dict)
    creation_tasks: Dict[str, CreateTaskStatus] = field(default_factory=dict)
    merge_tasks: Dict[str, MergeTaskStatus] = field(default_factory=dict)

    def _update_or_create(self, store: dict, key: str, value: object, defaults: object = None):
        """Generic method to update or create entries with spreading pattern for Pydantic models"""
        if hasattr(value, "model_dump"):
            # It's a Pydantic model - get only the explicitly set fields
            existing = store.get(key)
            if existing:
                base = existing.model_dump()
            elif defaults:
                base = defaults.model_dump()
            else:
                base = {}
            updates = value.model_dump(exclude_unset=True)
            model_class = type(value) if existing is None else type(existing)
            store[key] = model_class(**{**base, **updates})
        else:
            # Full replacement with non-Pydantic object
            store[key] = value

    def is_dataset_cached(self, repo_id: str) -> bool:
        return repo_id in self.dataset_cache

    def is_dataset_loading(self, repo_id: str) -> bool:
        return repo_id in self.loading_tasks

    def get_dataset(self, repo_id: str) -> Optional[LeRobotDataset]:
        return self.dataset_cache.get(repo_id)

    def set_loading_status(self, repo_id: str, status: DatasetLoadingStatus):
        self._update_or_create(
            self.dataset_loading_status,
            repo_id,
            status,
            DatasetLoadingStatus(status="loading", progress=0.0),
        )

    def get_loading_status(self, repo_id: str) -> Optional[DatasetLoadingStatus]:
        return self.dataset_loading_status.get(repo_id)

    def start_loading(self, repo_id: str):
        self.loading_tasks[repo_id] = "loading"

    def finish_loading(self, repo_id: str):
        if repo_id in self.loading_tasks:
            del self.loading_tasks[repo_id]

    def cache_dataset(self, repo_id: str, dataset: LeRobotDataset):
        self.dataset_cache[repo_id] = dataset

    def get_creation_task(self, task_id: str) -> Optional[CreateTaskStatus]:
        return self.creation_tasks.get(task_id)

    def set_creation_task(self, task_id: str, status: CreateTaskStatus):
        self._update_or_create(
            self.creation_tasks,
            task_id,
            status,
            CreateTaskStatus(task_id=task_id, status="pending", progress=0.0),
        )

    def get_merge_task(self, task_id: str) -> Optional[MergeTaskStatus]:
        return self.merge_tasks.get(task_id)

    def set_merge_task(self, task_id: str, status: MergeTaskStatus):
        self._update_or_create(
            self.merge_tasks,
            task_id,
            status,
            MergeTaskStatus(task_id=task_id, status="pending", progress=0.0),
        )

    def clear_loading_tasks(self):
        self.loading_tasks.clear()


# Create a singleton instance for the application
_state_store = StateStore()


def get_state_store() -> StateStore:
    """Dependency injection function to get the task manager."""
    return _state_store
