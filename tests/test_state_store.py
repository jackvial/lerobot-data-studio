"""Tests for the backend state store."""

from lerobot_data_studio.backend.models import CreateTaskStatus, DatasetLoadingStatus
from lerobot_data_studio.backend.state_store import StateStore


def test_dataset_cache_roundtrip():
    store = StateStore()
    assert not store.is_dataset_cached("ns/name")

    dataset = object()
    store.cache_dataset("ns/name", dataset)

    assert store.is_dataset_cached("ns/name")
    assert store.get_dataset("ns/name") is dataset
    assert store.get_dataset("ns/other") is None


def test_loading_task_lifecycle():
    store = StateStore()
    assert not store.is_dataset_loading("ns/name")

    store.start_loading("ns/name")
    assert store.is_dataset_loading("ns/name")

    store.finish_loading("ns/name")
    assert not store.is_dataset_loading("ns/name")

    # finish_loading is idempotent
    store.finish_loading("ns/name")


def test_clear_loading_tasks():
    store = StateStore()
    store.start_loading("a/b")
    store.start_loading("c/d")

    store.clear_loading_tasks()

    assert not store.is_dataset_loading("a/b")
    assert not store.is_dataset_loading("c/d")


def test_set_loading_status_merges_partial_updates():
    store = StateStore()
    store.set_loading_status(
        "ns/name", DatasetLoadingStatus(status="loading", progress=0.3, message="Downloading...")
    )

    # A partial update should preserve previously set fields.
    store.set_loading_status("ns/name", DatasetLoadingStatus(progress=0.6))

    status = store.get_loading_status("ns/name")
    assert status.status == "loading"
    assert status.progress == 0.6
    assert status.message == "Downloading..."


def test_set_loading_status_applies_defaults_for_new_entries():
    store = StateStore()
    store.set_loading_status("ns/name", DatasetLoadingStatus(message="hello"))

    status = store.get_loading_status("ns/name")
    assert status.status == "loading"
    assert status.progress == 0.0
    assert status.message == "hello"


def test_creation_task_merges_partial_updates():
    store = StateStore()
    store.set_creation_task(
        "task-1",
        CreateTaskStatus(task_id="task-1", status="running", progress=0.1, new_repo_id="ns/new"),
    )
    store.set_creation_task("task-1", CreateTaskStatus(task_id="task-1", progress=0.7))

    status = store.get_creation_task("task-1")
    assert status.status == "running"
    assert status.progress == 0.7
    assert status.new_repo_id == "ns/new"

    assert store.get_creation_task("missing") is None
