"""Tests for MergedDatasetCreator using real file I/O."""

import json
from pathlib import Path
from unittest.mock import patch
import pandas as pd

from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot_data_studio.backend.dataset_creator.merged_dataset_creator import MergedDatasetCreator
from tests.conftest import create_test_dataset_files
from .utils import get_episode_file_df

class TestMergedDatasetCreator:
    """Test suite for MergedDatasetCreator."""
    
    def test_merged_dataset_creator(self, tmp_path):
        """Test that merged dataset creator successfully merges two datasets"""
        
        # Create first test dataset
        dataset1_path = tmp_path / "dataset1"
        create_test_dataset_files(
            dataset_path=dataset1_path,
            tasks=["pick object", "place object"],
        )
        
        # Create second test dataset  
        dataset2_path = tmp_path / "dataset2"
        create_test_dataset_files(
            dataset_path=dataset2_path,
            tasks=["rotate handle", "push button"],
        )
        
        creator = MergedDatasetCreator()
        
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
                    dataset_ids=["test/dataset1", "test/dataset2"],
                    new_repo_id="test/merged",
                    dataset_roots=[dataset1_path, dataset2_path]
                )
        
        assert result is True
        
        # Verify the merged dataset was created
        dataset_root = test_dir / "test_merged"
        assert dataset_root.exists()
        
        # Check that meta directory exists
        meta_dir = dataset_root / "meta"
        assert meta_dir.exists()
        
        # Check episodes.jsonl was written with correct total episodes
        episodes_file = meta_dir / "episodes.jsonl"
        assert episodes_file.exists()
        
        # Read episodes using pandas
        episodes_df = pd.read_json(episodes_file, lines=True)
        episodes = episodes_df.set_index('episode_index').to_dict('index')
        
        # Should have 10 total episodes (5 from dataset1 + 5 from dataset2)
        assert len(episodes) == 10
        
        # Check episode indices are sequential from 0 to 9
        for i in range(10):
            assert i in episodes
        
        # Check tasks.jsonl was written with all unique tasks
        tasks_file = meta_dir / "tasks.jsonl"
        assert tasks_file.exists()
        
        tasks_df = pd.read_json(tasks_file, lines=True)
        tasks = tasks_df.set_index('task_index').to_dict('index')
        
        # Should have 4 unique tasks
        task_names = [task['task'] for task in tasks.values()]
        assert "pick object" in task_names
        assert "place object" in task_names
        assert "rotate handle" in task_names
        assert "push button" in task_names
        
        # Verify video files were copied for all episodes
        video_dir = dataset_root / "videos" / "chunk-000" / "observation.images.side"
        assert video_dir.exists()
        
        # Check that all 10 video files exist with sequential naming
        for i in range(10):
            video_file = video_dir / f"episode_{i:06d}.mp4"
            assert video_file.exists(), f"Missing video file: {video_file}"
        
        # Episode from dataset 1
        episode_0_df = get_episode_file_df(dataset_root, 0) 
        print("episode_0_df metadata contents")
        print(episode_0_df.head())
        
        assert episode_0_df["episode_index"].iloc[0] == 0
        
        episode_0_state_array = episode_0_df["observation.state"].to_numpy()
        print("episode_0_state_array.shape", episode_0_state_array.shape)
        assert len(episode_0_state_array[0]) == 6
        
        # Check action has correct dims
        episode_0_action_array = episode_0_df["action"].to_numpy()
        print("episode_0_action_array.shape", episode_0_action_array.shape)
        assert episode_0_action_array.shape == (244,)
        
        assert len(episode_0_action_array[0]) == 6
        
        # Episode from dataset 2
        episode_6_df = get_episode_file_df(dataset_root, 6) 
        print("episode_6_df metadata contents")
        print(episode_6_df.head())
        
        assert episode_6_df["episode_index"].iloc[0] == 6
        
        episode_6_state_array = episode_6_df["observation.state"].to_numpy()
        print("episode_6_state_array.shape", episode_6_state_array.shape)
        assert len(episode_6_state_array[0]) == 6
        
        # Check action has correct dims
        episode_6_action_array = episode_6_df["action"].to_numpy()
        print("episode_6_action_array.shape", episode_6_action_array.shape)
        assert episode_6_action_array.shape == (244,)
        
        assert len(episode_6_action_array[0]) == 6
        
        # Verify episode_stats.jsonl exists
        episode_stats_file = meta_dir / "episodes_stats.jsonl"
        assert episode_stats_file.exists()
        
        # Check episode stats has correct number of entries
        episode_stats_df = pd.read_json(episode_stats_file, lines=True)
        assert len(episode_stats_df) == 10
        
        # Verify info.json exists
        info_file = dataset_root / "meta" / "info.json"
        assert info_file.exists()
        
        # Read and check info.json contents
        with open(info_file, 'r') as f:
            info = json.load(f)
        
        assert info["total_episodes"] == 10
        assert info["total_tasks"] == 4
        
        # Verify README.md was created
        readme_file = dataset_root / "README.md"
        assert readme_file.exists()
        
        # Verify data files were copied for all episodes
        data_dir = dataset_root / "data" / "chunk-000"
        assert data_dir.exists()
        
        # Check that all 10 parquet files exist with sequential naming
        for i in range(10):
            data_file = data_dir / f"episode_{i:06d}.parquet"
            assert data_file.exists(), f"Missing data file: {data_file}"
            
            # Verify episode index in parquet file matches
            df = pd.read_parquet(data_file)
            assert df["episode_index"].iloc[0] == i