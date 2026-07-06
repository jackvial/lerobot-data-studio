"""Tests for the FastAPI background task functions."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from lerobot_data_studio.backend import background_tasks
from lerobot_data_studio.backend.background_tasks import create_dataset_task, load_dataset_task
from lerobot_data_studio.backend.state_store import StateStore


def test_load_dataset_task_success(monkeypatch):
    store = StateStore()
    dataset = object()
    monkeypatch.setattr(background_tasks, "LeRobotDataset", lambda repo_id: dataset)

    load_dataset_task("ns/name", store)

    assert store.get_dataset("ns/name") is dataset
    status = store.get_loading_status("ns/name")
    assert status.status == "ready"
    assert status.progress == 1.0
    assert not store.is_dataset_loading("ns/name")


def test_load_dataset_task_invalid_format_error(monkeypatch):
    store = StateStore()

    def raise_value_error(repo_id):
        raise ValueError("bad codec")

    monkeypatch.setattr(background_tasks, "LeRobotDataset", raise_value_error)
    store.start_loading("ns/name")

    load_dataset_task("ns/name", store)

    status = store.get_loading_status("ns/name")
    assert status.status == "error"
    assert "Invalid dataset format" in status.message
    assert not store.is_dataset_loading("ns/name")


def test_load_dataset_task_file_error(monkeypatch):
    store = StateStore()

    def raise_file_error(repo_id):
        raise FileNotFoundError("missing")

    monkeypatch.setattr(background_tasks, "LeRobotDataset", raise_file_error)

    load_dataset_task("ns/name", store)

    assert "File access error" in store.get_loading_status("ns/name").message


def test_create_dataset_task_filters_and_pushes(monkeypatch):
    store = StateStore()
    dataset = SimpleNamespace(meta=SimpleNamespace(total_episodes=4))
    store.cache_dataset("ns/orig", dataset)

    filtered = MagicMock()
    delete_episodes = MagicMock(return_value=filtered)
    monkeypatch.setattr(background_tasks, "delete_episodes", delete_episodes)

    create_dataset_task("task-1", "ns/orig", "ns/new", [1, 3], None, store)

    delete_episodes.assert_called_once_with(dataset, episode_indices=[0, 2], repo_id="ns/new")
    filtered.push_to_hub.assert_called_once()
    status = store.get_creation_task("task-1")
    assert status.status == "completed"
    assert status.progress == 1.0
    assert status.new_repo_id == "ns/new"


def test_create_dataset_task_all_episodes_restores_cached_repo_id():
    store = StateStore()
    dataset = MagicMock()
    dataset.repo_id = "ns/orig"
    dataset.meta.total_episodes = 2
    pushed_as = []
    dataset.push_to_hub.side_effect = lambda **kwargs: pushed_as.append(dataset.repo_id)
    store.cache_dataset("ns/orig", dataset)

    create_dataset_task("task-1", "ns/orig", "ns/new", [0, 1], None, store)

    assert pushed_as == ["ns/new"]
    # The cached instance must not be left pointing at the new repo id.
    assert dataset.repo_id == "ns/orig"
    assert store.get_creation_task("task-1").status == "completed"


def test_create_dataset_task_restores_repo_id_when_push_fails():
    store = StateStore()
    dataset = MagicMock()
    dataset.repo_id = "ns/orig"
    dataset.meta.total_episodes = 1
    dataset.push_to_hub.side_effect = RuntimeError("hub down")
    store.cache_dataset("ns/orig", dataset)

    create_dataset_task("task-1", "ns/orig", "ns/new", [0], None, store)

    assert dataset.repo_id == "ns/orig"
    assert store.get_creation_task("task-1").status == "failed"


def test_create_dataset_task_fails_when_source_not_cached():
    store = StateStore()

    create_dataset_task("task-1", "ns/missing", "ns/new", [0], None, store)

    status = store.get_creation_task("task-1")
    assert status.status == "failed"
    assert "not found in cache" in status.message


def test_create_dataset_task_reports_push_failures(monkeypatch):
    store = StateStore()
    dataset = SimpleNamespace(meta=SimpleNamespace(total_episodes=2))
    store.cache_dataset("ns/orig", dataset)

    filtered = MagicMock()
    filtered.push_to_hub.side_effect = RuntimeError("hub unreachable")
    monkeypatch.setattr(background_tasks, "delete_episodes", MagicMock(return_value=filtered))

    create_dataset_task("task-1", "ns/orig", "ns/new", [0], None, store)

    status = store.get_creation_task("task-1")
    assert status.status == "failed"
    assert "hub unreachable" in status.message
