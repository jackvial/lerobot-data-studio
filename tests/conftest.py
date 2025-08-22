#!/usr/bin/env python

"""Pytest configuration and fixtures for lerobot_data_studio tests."""

import json
import shutil
from functools import partial
from pathlib import Path
from typing import Dict, List, Optional
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from lerobot.datasets.lerobot_dataset import LeRobotDataset

# Constants from lerobot test fixtures
DEFAULT_FPS = 30
DUMMY_REPO_ID = "lerobot/dummy"

def create_test_dataset_files(
    dataset_path: Path,
    tasks: List[str] = None,
) -> Path:
    """Create a new copy of dataset tests/template_datasets/v2_1/screwdriver_panel_ls_080225_4_e5
    
    Args:
        dataset_path: Path where to create the dataset
        tasks: List of task names (if provided, updates tasks.jsonl)
        
    Returns:
        Path to the created dataset
    """
    
    # Get the template dataset path
    template_path = Path(__file__).parent / "template_datasets" / "v2_1" / "screwdriver_panel_ls_080225_4_e5"
    
    # Copy the entire template structure
    if dataset_path.exists():
        shutil.rmtree(dataset_path)
    shutil.copytree(template_path, dataset_path)
    
    # Get the reference video file
    ref_video = dataset_path / "videos" / "chunk-000" / "observation.images.side" / "episode_000000.mp4"
    
    # Create video files for all episodes and cameras (5 episodes, 3 cameras)
    cameras = ["side", "top", "screwdriver"]
    
    for camera in cameras:
        video_dir = dataset_path / "videos" / "chunk-000" / f"observation.images.{camera}"
        video_dir.mkdir(parents=True, exist_ok=True)
        
        for episode_idx in range(5):  # Fixed to 5 episodes as in template
            video_file = video_dir / f"episode_{episode_idx:06d}.mp4"
            if not video_file.exists():
                # Copy the reference video as a stub
                shutil.copy(ref_video, video_file)
    
    # Update tasks.jsonl if custom tasks provided
    if tasks:
        tasks_file = dataset_path / "meta" / "tasks.jsonl"
        tasks_data = []
        for idx, task_name in enumerate(tasks):
            tasks_data.append({"task_index": idx, "task": task_name})
        
        with open(tasks_file, 'w') as f:
            for task in tasks_data:
                f.write(json.dumps(task) + '\n')
    
    return dataset_path


def pytest_configure(config):
    """Configure pytest with custom markers."""
    # Add custom markers
    config.addinivalue_line(
        "markers", "requires_internet: mark test as requiring internet access"
    )
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )


def pytest_collection_modifyitems(config, items):
    """Modify test collection to add markers."""
    # Skip internet tests if --offline flag is used
    if config.getoption("--offline", default=False):
        skip_internet = pytest.mark.skip(reason="--offline flag used")
        for item in items:
            if "requires_internet" in item.keywords:
                item.add_marker(skip_internet)


def pytest_addoption(parser):
    """Add custom command line options."""
    parser.addoption(
        "--offline", 
        action="store_true", 
        default=False, 
        help="Skip tests requiring internet access"
    )
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="Run integration tests (they are skipped by default)"
    )