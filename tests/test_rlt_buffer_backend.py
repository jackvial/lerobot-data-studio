"""Backend tests for the RLT buffer viewer endpoints.

We synthesize a `.pt` review buffer in the v2 format that matches
`RLTReplayBuffer.state_dict()` so we don't depend on the in-progress
lerobot-side change. The endpoints under test only care about the dict shape.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
import torch
from fastapi.testclient import TestClient
from PIL import Image

from lerobot_data_studio.backend import main as backend_main, rlt_buffer as rlt_buffer_module


def _make_jpeg(width: int = 32, height: int = 32, color: tuple[int, int, int] = (200, 100, 50)) -> bytes:
    """Return a tiny but valid JPEG for use in synthetic buffers."""
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


def _make_sample(
    *,
    episode_id: int,
    inference_ts: float,
    success: bool = False,
    failure: bool = False,
    done: bool = False,
    is_intervention: bool = False,
    images: dict[str, bytes] | None = None,
) -> dict:
    return {
        "rl_token": torch.zeros(1, 4),
        "proprio": torch.zeros(1, 6),
        "reference_chunk": torch.zeros(2, 6),
        "executed_chunk": torch.full((2, 6), float(episode_id)),
        "next_rl_token": torch.zeros(1, 4),
        "next_proprio": torch.zeros(1, 6),
        "next_reference_chunk": torch.zeros(2, 6),
        "reward": 1.0 if success else (-1.0 if failure else 0.0),
        "done": done,
        "is_intervention": is_intervention,
        "images_jpeg": images or {},
        "inference_ts": inference_ts,
        "episode_id": episode_id,
        "success": success,
        "failure": failure,
        "chunk_start_step": episode_id * 10,
    }


def _write_synthetic_buffer(path: Path) -> dict[str, bytes]:
    front = _make_jpeg(color=(10, 200, 10))
    wrist = _make_jpeg(color=(10, 10, 200))
    images = {
        "observation.images.front": front,
        "observation.images.wrist": wrist,
    }

    samples = [
        # Episode 0: success, irregular timing.
        _make_sample(episode_id=0, inference_ts=100.0, images=images),
        _make_sample(episode_id=0, inference_ts=100.4, images=images),
        _make_sample(episode_id=0, inference_ts=101.2, success=True, done=True, images=images),
        # Episode 1: failure with an intervention along the way.
        _make_sample(episode_id=1, inference_ts=200.0, is_intervention=True, images=images),
        _make_sample(episode_id=1, inference_ts=200.5, failure=True, done=True, images=images),
        # Episode 2: in-progress (no success/failure flag yet).
        _make_sample(episode_id=2, inference_ts=300.0, images=images),
    ]

    state_dict = {"version": 2, "capacity": len(samples), "samples": samples}
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(state_dict, path)
    return images


@pytest.fixture
def rlt_buffer_root(tmp_path, monkeypatch):
    root = tmp_path / "rlt_review"
    # Reset the module-level singleton so each test sees a fresh cache. The
    # cache keys on resolved paths so leftover entries from prior tests under
    # different `tmp_path` would otherwise persist.
    monkeypatch.setattr(rlt_buffer_module, "_store_singleton", None)
    return root


@pytest.fixture
def client():
    return TestClient(backend_main.app)


def _list_files(client, path: Path):
    return client.get("/api/rlt_buffer/files", params={"path": str(path)})


def test_list_files_returns_summary_for_each_pt_file(rlt_buffer_root, client):
    buffer_path = rlt_buffer_root / "run_a.pt"
    _write_synthetic_buffer(buffer_path)

    response = _list_files(client, buffer_path)
    assert response.status_code == 200
    payload = response.json()
    assert payload["source_path"].endswith("run_a.pt")
    assert payload["default_path"].endswith("rlt_online_replay.pt")
    assert len(payload["files"]) == 1

    file_info = payload["files"][0]
    assert file_info["num_samples"] == 6
    assert file_info["num_episodes"] == 3
    assert file_info["path"].endswith("run_a.pt")
    assert file_info["file_token"]


def test_episodes_endpoint_classifies_outcomes(rlt_buffer_root, client):
    buffer_path = rlt_buffer_root / "run_a.pt"
    _write_synthetic_buffer(buffer_path)

    files = _list_files(client, buffer_path).json()["files"]
    token = files[0]["file_token"]

    response = client.get(f"/api/rlt_buffer/{token}/episodes")
    assert response.status_code == 200
    episodes = response.json()["episodes"]
    assert [e["episode_id"] for e in episodes] == [0, 1, 2]

    by_id = {e["episode_id"]: e for e in episodes}
    assert by_id[0]["label"] == "success"
    assert by_id[0]["original_label"] == "success"
    assert by_id[0]["deleted"] is False
    assert by_id[0]["num_transitions"] == 3
    assert by_id[0]["duration_s"] == pytest.approx(1.2, rel=1e-3)
    assert by_id[0]["has_intervention"] is False

    assert by_id[1]["label"] == "failure"
    assert by_id[1]["has_intervention"] is True

    assert by_id[2]["label"] == "open"


def test_transitions_endpoint_returns_relative_offsets(rlt_buffer_root, client):
    buffer_path = rlt_buffer_root / "run_a.pt"
    _write_synthetic_buffer(buffer_path)

    files = _list_files(client, buffer_path).json()["files"]
    token = files[0]["file_token"]

    response = client.get(f"/api/rlt_buffer/{token}/episodes/0/transitions")
    assert response.status_code == 200
    payload = response.json()
    assert payload["has_inference_ts"] is True

    transitions = payload["transitions"]
    assert [t["t_offset_s"] for t in transitions] == pytest.approx([0.0, 0.4, 1.2])
    assert all(set(t["image_keys"]) == {"observation.images.front", "observation.images.wrist"} for t in transitions)
    assert transitions[-1]["done"] is True
    assert transitions[-1]["success"] is True


def test_transition_image_endpoint_returns_jpeg(rlt_buffer_root, client):
    buffer_path = rlt_buffer_root / "run_a.pt"
    images = _write_synthetic_buffer(buffer_path)

    files = _list_files(client, buffer_path).json()["files"]
    token = files[0]["file_token"]
    transitions = client.get(f"/api/rlt_buffer/{token}/episodes/0/transitions").json()["transitions"]
    sample_index = transitions[0]["index"]

    response = client.get(
        f"/api/rlt_buffer/{token}/transitions/{sample_index}/image/observation.images.front"
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content[:2] == b"\xff\xd8"
    assert response.content == images["observation.images.front"]


def test_transition_image_endpoint_404_for_unknown_camera(rlt_buffer_root, client):
    buffer_path = rlt_buffer_root / "run_a.pt"
    _write_synthetic_buffer(buffer_path)

    files = _list_files(client, buffer_path).json()["files"]
    token = files[0]["file_token"]
    transitions = client.get(f"/api/rlt_buffer/{token}/episodes/0/transitions").json()["transitions"]
    sample_index = transitions[0]["index"]

    response = client.get(
        f"/api/rlt_buffer/{token}/transitions/{sample_index}/image/observation.images.unknown"
    )
    assert response.status_code == 404


def test_invalid_token_rejected(rlt_buffer_root, client):
    response = client.get("/api/rlt_buffer/!!!notbase64!!!/episodes")
    assert response.status_code == 400


def test_explicit_file_path_can_be_loaded_outside_legacy_root(rlt_buffer_root, client, tmp_path):
    """Users can enter an arbitrary local replay-buffer path."""
    outside = tmp_path / "outside.pt"
    _write_synthetic_buffer(outside)

    files_response = _list_files(client, outside)
    assert files_response.status_code == 200
    token = files_response.json()["files"][0]["file_token"]
    response = client.get(f"/api/rlt_buffer/{token}/episodes")
    assert response.status_code == 200


def test_list_files_dedupes_same_resolved_path(rlt_buffer_root, client):
    buffer_path = rlt_buffer_root / "run_a.pt"
    _write_synthetic_buffer(buffer_path)
    symlink_path = rlt_buffer_root / "also_run_a.pt"
    symlink_path.symlink_to(buffer_path)

    response = _list_files(client, rlt_buffer_root)
    assert response.status_code == 200
    files = response.json()["files"]
    assert len(files) == 1
    assert files[0]["path"].endswith("also_run_a.pt") or files[0]["path"].endswith("run_a.pt")


def test_episode_review_overrides_label_and_deleted_state(rlt_buffer_root, client):
    buffer_path = rlt_buffer_root / "run_a.pt"
    _write_synthetic_buffer(buffer_path)

    token = _list_files(client, buffer_path).json()["files"][0]["file_token"]
    response = client.put(
        f"/api/rlt_buffer/{token}/episodes/2/review",
        json={"label": "success", "deleted": True},
    )
    assert response.status_code == 200
    assert response.json()["label"] == "success"
    assert response.json()["deleted"] is True

    episodes = client.get(f"/api/rlt_buffer/{token}/episodes").json()["episodes"]
    by_id = {e["episode_id"]: e for e in episodes}
    assert by_id[2]["original_label"] == "open"
    assert by_id[2]["label"] == "success"
    assert by_id[2]["deleted"] is True

    transitions = client.get(f"/api/rlt_buffer/{token}/episodes/2/transitions").json()["transitions"]
    assert transitions[-1]["success"] is True
    assert transitions[-1]["failure"] is False


def test_legacy_v1_buffer_falls_back(rlt_buffer_root, client):
    """A v1 state_dict (no images / inference_ts) loads with `None` defaults."""
    samples = []
    for _ep in range(2):
        for _ in range(2):
            samples.append(
                {
                    "rl_token": torch.zeros(1, 4),
                    "proprio": torch.zeros(1, 6),
                    "reference_chunk": torch.zeros(2, 6),
                    "executed_chunk": torch.zeros(2, 6),
                    "next_rl_token": torch.zeros(1, 4),
                    "next_proprio": torch.zeros(1, 6),
                    "next_reference_chunk": torch.zeros(2, 6),
                    "reward": 0.0,
                    "done": False,
                    "is_intervention": False,
                }
            )
        samples[-1]["done"] = True

    state_dict = {"version": 1, "capacity": len(samples), "samples": samples}
    legacy_path = rlt_buffer_root / "legacy.pt"
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(state_dict, legacy_path)

    files = _list_files(client, legacy_path).json()["files"]
    token = files[0]["file_token"]
    episodes = client.get(f"/api/rlt_buffer/{token}/episodes").json()["episodes"]
    # Two `done=True` markers should split the buffer into two episodes when
    # `episode_id` is not stored.
    assert len(episodes) == 2
    assert all(ep["label"] == "open" for ep in episodes)

    transitions = client.get(
        f"/api/rlt_buffer/{token}/episodes/{episodes[0]['episode_id']}/transitions"
    ).json()
    assert transitions["has_inference_ts"] is False
    # Without inference_ts, t_offset_s is the index-order fallback.
    assert [t["t_offset_s"] for t in transitions["transitions"]] == [0.0, 1.0]


