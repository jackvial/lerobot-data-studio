"""Tests for the FastAPI endpoints and request validation helpers."""

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from lerobot_data_studio.backend import main
from lerobot_data_studio.backend.main import _maybe_scalar, app, check_repo_id
from lerobot_data_studio.backend.models import DatasetLoadingStatus
from lerobot_data_studio.backend.state_store import StateStore, get_state_store


class _FakeSelectDataset:
    def __init__(self, rows):
        self._rows = rows

    def select(self, indices):
        return _FakeSelectDataset([self._rows[index] for index in indices])

    def select_columns(self, _columns):
        return self

    def __iter__(self):
        return iter(self._rows)


class _Tolist:
    """Mimics a numpy scalar/array wrapper exposing tolist()."""

    def __init__(self, value):
        self._value = value

    def tolist(self):
        return self._value


def _make_fake_dataset():
    rows = [
        {
            "episode_index": 0,
            "action": [1.234],
            "observation.state": [2.345, 3.456],
            "timestamp": 0.0,
        },
        {
            "episode_index": 0,
            "action": [1.5],
            "observation.state": [2.5, 3.5],
            "timestamp": 0.033,
        },
    ]
    meta = SimpleNamespace(
        episodes={
            0: {
                "dataset_from_index": 0,
                "dataset_to_index": 2,
                "tasks": ["pick up the block"],
                "videos/observation.images.cam/from_timestamp": 12.5,
                "videos/observation.images.cam/to_timestamp": _Tolist([18.75]),
            }
        },
        video_keys=["observation.images.cam"],
        get_video_file_path=lambda episode_id, video_key: Path(
            f"videos/{video_key}/chunk-000/file-000.mp4"
        ),
        version="v3.0",
    )
    return SimpleNamespace(
        num_episodes=1,
        num_frames=2,
        fps=30,
        meta=meta,
        hf_dataset=_FakeSelectDataset(rows),
        features={"observation.state": {"names": ["joint_0", "joint_1"]}},
    )


@pytest.fixture
def store():
    return StateStore()


@pytest.fixture
def client(store):
    app.dependency_overrides[get_state_store] = lambda: store
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


class TestCheckRepoId:
    def test_accepts_valid_repo_ids(self):
        check_repo_id("user/dataset")
        check_repo_id("user-name/data.set_v2")

    @pytest.mark.parametrize(
        "repo_id",
        ["", "nodivider", "a/b/c", "/name", "namespace/", "user/data set", "user!/data"],
    )
    def test_rejects_invalid_repo_ids(self, repo_id):
        with pytest.raises(ValueError):
            check_repo_id(repo_id)

    def test_rejects_non_string(self):
        with pytest.raises(ValueError):
            check_repo_id(None)


class TestMaybeScalar:
    def test_passes_through_floats(self):
        assert _maybe_scalar(1.5) == 1.5

    def test_none(self):
        assert _maybe_scalar(None) is None

    def test_unwraps_tolist_wrappers(self):
        assert _maybe_scalar(_Tolist([12.5])) == 12.5
        assert _maybe_scalar(_Tolist(3.25)) == 3.25

    def test_unwraps_lists_and_tuples(self):
        assert _maybe_scalar([4.5]) == 4.5
        assert _maybe_scalar((2.5, 99)) == 2.5
        assert _maybe_scalar([]) is None

    def test_invalid_values_return_none(self):
        assert _maybe_scalar("not-a-number") is None
        assert _maybe_scalar(object()) is None


class TestDatasetStatus:
    def test_not_loaded(self, client):
        response = client.get("/api/datasets/ns/name/status")
        assert response.status_code == 200
        assert response.json()["status"] == "not_loaded"

    def test_ready_when_cached(self, client, store):
        store.cache_dataset("ns/name", object())
        response = client.get("/api/datasets/ns/name/status")
        assert response.json()["status"] == "ready"
        assert response.json()["progress"] == 1.0

    def test_reports_existing_loading_status(self, client, store):
        store.set_loading_status(
            "ns/name", DatasetLoadingStatus(status="loading", progress=0.4, message="Downloading")
        )
        body = client.get("/api/datasets/ns/name/status").json()
        assert body["status"] == "loading"
        assert body["progress"] == 0.4

    def test_auto_load_starts_background_task(self, client, store, monkeypatch):
        started = []
        monkeypatch.setattr(main, "load_dataset_task", lambda repo_id, s: started.append(repo_id))

        body = client.get("/api/datasets/ns/name/status", params={"auto_load": True}).json()

        assert body["status"] == "loading"
        assert started == ["ns/name"]


class TestGetEpisode:
    def test_returns_202_and_starts_load_when_not_cached(self, client, monkeypatch):
        started = []
        monkeypatch.setattr(main, "load_dataset_task", lambda repo_id, s: started.append(repo_id))

        response = client.get("/api/datasets/ns/name/episodes/0")

        assert response.status_code == 202
        assert started == ["ns/name"]

    def test_returns_episode_payload(self, client, store):
        store.cache_dataset("ns/name", _make_fake_dataset())

        response = client.get("/api/datasets/ns/name/episodes/0")

        assert response.status_code == 200
        body = response.json()
        assert body["episode_id"] == 0
        assert body["dataset_info"]["num_episodes"] == 1
        assert body["feature_names"] == ["joint_0", "joint_1"]
        assert body["actual_episode_index"] == 0
        assert body["tasks"] == ["pick up the block"]
        video = body["videos_info"][0]
        assert video["url"].startswith("/api/videos/ns/name/")
        assert video["from_timestamp"] == 12.5
        assert video["to_timestamp"] == 18.75
        assert video["language_instruction"] == ["pick up the block"]

    def test_out_of_range_episode(self, client, store):
        store.cache_dataset("ns/name", _make_fake_dataset())
        assert client.get("/api/datasets/ns/name/episodes/5").status_code == 404
        assert client.get("/api/datasets/ns/name/episodes/-1").status_code == 404


class TestListEpisodes:
    def test_requires_loaded_dataset(self, client):
        assert client.get("/api/datasets/ns/name/episodes").status_code == 404

    def test_lists_episode_ids(self, client, store):
        store.cache_dataset("ns/name", SimpleNamespace(total_episodes=3))
        body = client.get("/api/datasets/ns/name/episodes").json()
        assert body == {"episodes": [0, 1, 2]}


class TestGetVideo:
    @pytest.fixture
    def video_dataset(self, tmp_path):
        dataset = LeRobotDataset.__new__(LeRobotDataset)
        dataset.root = tmp_path / "dataset"
        video_dir = dataset.root / "videos"
        video_dir.mkdir(parents=True)
        (video_dir / "clip.mp4").write_bytes(b"fake-mp4")
        (tmp_path / "secret.txt").write_text("top secret")
        return dataset

    def test_serves_video_from_dataset_root(self, client, store, video_dataset):
        store.cache_dataset("ns/name", video_dataset)

        response = client.get("/api/videos/ns/name/videos/clip.mp4")

        assert response.status_code == 200
        assert response.content == b"fake-mp4"

    def test_rejects_path_traversal(self, client, store, video_dataset):
        store.cache_dataset("ns/name", video_dataset)

        response = client.get("/api/videos/ns/name/..%2F..%2Fsecret.txt")

        assert response.status_code == 404

    def test_missing_video(self, client, store, video_dataset):
        store.cache_dataset("ns/name", video_dataset)
        assert client.get("/api/videos/ns/name/videos/other.mp4").status_code == 404

    def test_requires_loaded_dataset(self, client):
        assert client.get("/api/videos/ns/name/videos/clip.mp4").status_code == 404


class TestCreateDataset:
    def _payload(self, **overrides):
        payload = {
            "original_repo_id": "ns/orig",
            "new_repo_id": "me/new",
            "selected_episodes": [0, 1],
        }
        payload.update(overrides)
        return payload

    def test_rejects_invalid_new_repo_id(self, client, store):
        store.cache_dataset("ns/orig", object())
        response = client.post("/api/datasets/create", json=self._payload(new_repo_id="bad id"))
        assert response.status_code == 400

    def test_requires_cached_original(self, client):
        response = client.post("/api/datasets/create", json=self._payload())
        assert response.status_code == 400
        assert "must be loaded" in response.json()["detail"]

    def test_rejects_empty_episode_selection(self, client, store):
        store.cache_dataset("ns/orig", object())
        response = client.post("/api/datasets/create", json=self._payload(selected_episodes=[]))
        assert response.status_code == 422

    def test_starts_creation_task(self, client, store, monkeypatch):
        store.cache_dataset("ns/orig", object())
        calls = []
        monkeypatch.setattr(
            main, "create_dataset_task", lambda *args: calls.append(args)
        )

        response = client.post("/api/datasets/create", json=self._payload())

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["task_id"]
        assert len(calls) == 1

        status = client.get(f"/api/datasets/create/status/{body['task_id']}")
        assert status.status_code == 200
        assert status.json()["status"] == "pending"

    def test_unknown_task_status_is_404(self, client):
        assert client.get("/api/datasets/create/status/nope").status_code == 404
