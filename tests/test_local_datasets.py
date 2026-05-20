"""Tests for local LeRobot cache discovery and validation."""

from __future__ import annotations

import asyncio

import requests

from lerobot_data_studio.backend import main as backend_main, state_store


def _create_local_dataset(root, repo_id: str):
    dataset_root = root / repo_id
    (dataset_root / "meta").mkdir(parents=True)
    (dataset_root / "data").mkdir()
    (dataset_root / "meta" / "info.json").write_text("{}", encoding="utf-8")
    return dataset_root


def test_list_local_lerobot_datasets_only_returns_dataset_layouts(tmp_path):
    _create_local_dataset(tmp_path, "user/local-dataset")
    (tmp_path / "user" / "metadata-only" / "meta").mkdir(parents=True)
    (tmp_path / "calibration" / "robots" / "arm").mkdir(parents=True)

    assert state_store.list_local_lerobot_datasets(tmp_path) == ["user/local-dataset"]


def test_validate_dataset_prefers_local_dataset_when_hub_misses(tmp_path, monkeypatch):
    local_root = _create_local_dataset(tmp_path, "user/local-dataset")
    monkeypatch.setattr(state_store, "HF_LEROBOT_HOME", tmp_path)

    class MissingHubApi:
        def dataset_info(self, _repo_id):
            raise requests.HTTPError("404")

    monkeypatch.setattr(backend_main, "HfApi", MissingHubApi)

    response = asyncio.run(backend_main.validate_dataset("user", "local-dataset"))

    assert response.exists is True
    assert response.source == "local"
    assert response.warning == (f"Using local dataset at {local_root}. It was not found on HuggingFace Hub.")
