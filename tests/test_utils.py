"""Tests for backend utility helpers."""

from types import SimpleNamespace

import pytest

from lerobot_data_studio.backend.utils import get_episode_data


class _FakeSelectDataset:
    def __init__(self, rows):
        self._rows = rows

    def select(self, indices):
        return _FakeSelectDataset([self._rows[index] for index in indices])

    def select_columns(self, _columns):
        return self

    def __iter__(self):
        return iter(self._rows)


def test_get_episode_data_preserves_timestamp_precision():
    dataset = SimpleNamespace(
        meta=SimpleNamespace(
            episodes={
                0: {
                    "dataset_from_index": 0,
                    "dataset_to_index": 2,
                }
            }
        ),
        hf_dataset=_FakeSelectDataset(
            [
                {
                    "episode_index": 0,
                    "action": [1.234],
                    "observation.state": [2.345],
                    "timestamp": 1.0049,
                },
                {
                    "episode_index": 0,
                    "action": [3.456],
                    "observation.state": [4.567],
                    "timestamp": 1.3351,
                },
            ]
        ),
        features={"observation.state": {"names": ["joint_0"]}},
    )

    episode_data, feature_names = get_episode_data(dataset, 0)

    assert feature_names == ["joint_0"]
    assert episode_data[0].timestamp == pytest.approx(1.0049)
    assert episode_data[1].timestamp == pytest.approx(1.3351)
