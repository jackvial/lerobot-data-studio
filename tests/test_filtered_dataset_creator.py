"""Tests for FilteredDatasetCreator using real file I/O."""

import json
import logging
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import pytest
import numpy as np
import pandas as pd

from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot_data_studio.backend.dataset_creator.filtered_dataset_creator import FilteredDatasetCreator
from tests.conftest import create_test_dataset_files
from tests.utils import get_episode_file_df

class TestFilteredDatasetCreator:
    """Test suite for FilteredDatasetCreator with real file I/O."""
    
    def test_filtered_dataset_creator(self, tmp_path):
        """Test that filtered dataset creator works as expected"""
        
        base_task_description = "Move towards the silver screw in the orange panel. Then place the screwdriver bit on the screw, and turn the screwdriver bit clockwise until the screw is has been fully screwed in."
        frames_per_episode = 244
        
        # Create actual test dataset files with videos
        original_dataset_path = tmp_path / "original_dataset"
        create_test_dataset_files(
            dataset_path=original_dataset_path
        )
        
        # Index key will be before the episode is remapped to the new index
        episode_index_task_map = {
            2: "custom_pick",
            4: "custom_rotate"
        }
        
        # Mock HuggingFace API calls to avoid trying to fetch from hub
        # Patch where it's actually used in lerobot_dataset module
        # Keep the mock active for the entire test since FilteredDatasetCreator also creates LeRobotDataset
        with patch('lerobot.datasets.lerobot_dataset.get_safe_version') as mock_get_version:
            mock_get_version.return_value = "v2.1"
            
            # Load the real dataset from the local path (avoiding hub fetch)
            # LeRobotDataset looks for meta/ directly under root
            original_dataset = LeRobotDataset(repo_id="test/original", root=original_dataset_path)
            
            creator = FilteredDatasetCreator(original_dataset)
            
            # Use our own temp directory
            test_dir = tmp_path / "test_output"
            test_dir.mkdir(exist_ok=True)
            
            from contextlib import contextmanager
            @contextmanager
            def mock_temp_dir():
                yield str(test_dir)
            
            # Only mock external dependencies - tempfile and hub push
            with patch('tempfile.TemporaryDirectory', mock_temp_dir):
                # Mock only the push_to_hub method on any LeRobotDataset instances
                with patch.object(LeRobotDataset, 'push_to_hub', return_value=True):
                    result = creator.create(
                        new_repo_id="test/filtered",
                        selected_episodes=[0, 2, 4],
                        episode_index_task_map=episode_index_task_map,
                        task_id="test-task-123"
                    )
        
        # Assert the create method succeeded (no error was logged)
        assert result is True, "Failed to create dataset from episodes"
        
        # Verify the actual files were written
        dataset_root = test_dir / "test_filtered"
        assert dataset_root.exists()
        
        # Check episodes.jsonl was written with correct episodes
        episodes_metadata_file = dataset_root / "meta" / "episodes.jsonl"
        assert episodes_metadata_file.exists()
        
        # Read episodes using pandas
        episodes_metadata_df = pd.read_json(episodes_metadata_file, lines=True)
        episodes = episodes_metadata_df.set_index('episode_index').to_dict('index')
        
        # Print contents of episode 0 parquet file
        episode_0_df = get_episode_file_df(dataset_root, 0) 
        print("episode_0_df metadata contents")
        print(episode_0_df.head())
        
        assert episode_0_df["episode_index"].iloc[0] == 0
        
        state_array = episode_0_df["observation.state"].to_numpy()
        print("state_array.shape", state_array.shape)
        assert len(state_array[0]) == 6
        
        # Check action has correct dims
        action_array = episode_0_df["action"].to_numpy()
        print("action_array.shape", action_array.shape)
        assert action_array.shape == (frames_per_episode,)
        
        assert len(action_array[0]) == 6
        
        # Assert there is no file for episode at index 5
        assert not (dataset_root / "data" / "chunk-000" / f"episode_000005.parquet").exists()
        
        # Should have 3 episodes with sequential indices
        assert len(episodes) == 3
        assert 0 in episodes
        assert 1 in episodes
        assert 2 in episodes
        
        # Should not have the filtered out episodes
        assert 3 not in episodes
        assert 4 not in episodes
        
        # Verify video files were copied for selected episodes
        video_dir = dataset_root / "videos" / "chunk-000" / "observation.images.side"
        
        # Expect the video directory to exist and the file names to have been updated to be sequential from 0
        assert video_dir.exists()
        assert (video_dir / "episode_000000.mp4").exists()
        assert (video_dir / "episode_000001.mp4").exists()
        assert (video_dir / "episode_000002.mp4").exists()
        assert not (video_dir / "episode_000003.mp4").exists()
        assert not (video_dir / "episode_000004.mp4").exists()
        
        # Assert the custom assigned tasks were added to the specific episodes
        # Note that the episode will have been remapped to new sequential indices
        assert "custom_pick" in episodes[1]["tasks"]
        assert "custom_rotate" in episodes[2]["tasks"]
        
        # Assert the episodes that had updated tasks still have the original tasks
        assert base_task_description in episodes[0]["tasks"]
        assert base_task_description in episodes[1]["tasks"]
        
        # Assert the episode stats file exists
        episode_stats_file = dataset_root / "meta" / "episodes_stats.jsonl"
        assert episode_stats_file.exists()
        
        # Assert the episode stats file has the correct number of episodes
        episode_stats_df = pd.read_json(episode_stats_file, lines=True)
        assert len(episode_stats_df) == 3