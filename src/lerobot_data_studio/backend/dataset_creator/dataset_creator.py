import json
import logging
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Optional

from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.datasets.utils import append_jsonlines, write_episode_stats, write_info

logger = logging.getLogger(__name__)


class DatasetCreator(ABC):
    """Base class for dataset creation operations."""

    supported_dataset_versions: List[str] = ["v2.1"]

    @abstractmethod
    def create(self, *args, **kwargs) -> bool:
        """Create the dataset.

        Returns:
            bool: True if successful, False otherwise
        """
        pass

    @staticmethod
    def update_dataset_indices(
        example: Dict,
        old_to_new_episode_index_map: Dict[int, int] = None,
        task_remapping: Dict[int, int] = None,
    ) -> Dict:
        """Update episode and task indices in a dataset example.

        Args:
            example: Dataset example with episode_index and optionally task_index
            old_to_new_episode_index_map: Mapping from old to new episode indices
            task_remapping: Mapping from old to new task indices

        Returns:
            Updated example
        """
        if old_to_new_episode_index_map is not None:
            old_ep_idx = example["episode_index"]
            if hasattr(old_ep_idx, "item"):
                old_ep_idx = old_ep_idx.item()

            if old_ep_idx in old_to_new_episode_index_map:
                example["episode_index"] = old_to_new_episode_index_map[old_ep_idx]

        if task_remapping is not None and "task_index" in example:
            old_task_idx = example.get("task_index", 0)
            if hasattr(old_task_idx, "item"):
                old_task_idx = old_task_idx.item()

            if old_task_idx in task_remapping:
                example["task_index"] = task_remapping[old_task_idx]

        return example

    @staticmethod
    def copy_episode_videos(
        dataset: LeRobotDataset,
        old_episode_idx: int,
        new_episode_idx: int,
        old_root: Path,
        new_root: Path,
        chunks_size: int,
        video_keys: Optional[List[str]] = None,
    ) -> None:
        """Copy video files for a single episode with chunk structure.

        Args:
            dataset: The dataset containing video metadata
            old_episode_idx: Original episode index
            new_episode_idx: New episode index in destination
            old_root: Root directory of source dataset
            new_root: Root directory of destination dataset
            chunks_size: Number of episodes per chunk
            video_keys: Optional list of video keys to use (defaults to dataset.meta.video_keys)
        """
        # Use provided video_keys or fall back to dataset.meta.video_keys
        if video_keys is None:
            video_keys = dataset.meta.video_keys

        if len(video_keys) == 0:
            return

        chunk_idx = new_episode_idx // chunks_size

        for video_key in video_keys:
            old_video_path = dataset.meta.get_video_file_path(old_episode_idx, video_key)
            old_full_path = old_root / old_video_path

            new_video_dir = new_root / "videos" / f"chunk-{chunk_idx:03d}" / video_key
            new_video_dir.mkdir(parents=True, exist_ok=True)
            new_full_path = new_video_dir / f"episode_{new_episode_idx:06d}.mp4"

            if old_full_path.exists():
                shutil.copy2(old_full_path, new_full_path)
            else:
                logger.warning(f"Video file not found: {old_full_path}")

    @staticmethod
    def write_metadata_files(
        temp_root: Path, info: Dict, episodes_metadata: Dict, episode_stats: Dict, tasks: dict
    ) -> None:
        """Write all metadata files to the temporary directory.

        Args:
            temp_root: Root directory to write metadata to
            episodes_metadata: Episode metadata dictionary
            episode_stats: Episode statistics dictionary
            tasks: Dict
        """

        # info.jsonl
        write_info(info, temp_root)

        def unlink_path_if_exists(p):
            if p.exists():
                p.unlink()

        # episode_stats.jsonl
        # use the built in lerobot helper to wrap construct an index
        unlink_path_if_exists(temp_root / "meta" / "episode_stats.jsonl")
        for episode_index, episode_stats_data in episode_stats.items():
            write_episode_stats(episode_index, episode_stats_data, temp_root)

        # episodes.jsonl
        episodes_path = temp_root / "meta" / "episodes.jsonl"
        unlink_path_if_exists(episodes_path)
        for _episode_index, episode_data in episodes_metadata.items():
            append_jsonlines(episode_data, episodes_path)

        # tasks.jsonl
        tasks_path = temp_root / "meta" / "tasks.jsonl"
        unlink_path_if_exists(tasks_path)
        for task_index, task in tasks.items():
            task_dict = {"task_index": task_index, "task": task}
            append_jsonlines(task_dict, tasks_path)

    @staticmethod
    def write_episode_data(dataset: LeRobotDataset, temp_root: Path, num_episodes: int) -> None:
        """Write the episode data as parquet files.

        Args:
            dataset: The dataset to save
            temp_root: Root directory to save to
            num_episodes: Number of episodes to save
        """
        logger.info("Saving dataset files...")
        for episode_idx in range(num_episodes):
            from_idx = dataset.episode_data_index["from"][episode_idx]
            to_idx = dataset.episode_data_index["to"][episode_idx]

            episode_data = dataset.hf_dataset.select(range(from_idx, to_idx))

            def map_episode_index(row, ep_idx=episode_idx):
                row["episode_index"] = ep_idx
                return row

            episode_data = episode_data.map(map_episode_index, batched=False, load_from_cache_file=False)

            chunk_idx = episode_idx // dataset.meta.info["chunks_size"]
            data_dir = temp_root / "data" / f"chunk-{chunk_idx:03d}"
            data_dir.mkdir(parents=True, exist_ok=True)

            episode_file = data_dir / f"episode_{episode_idx:06d}.parquet"
            episode_data.to_parquet(episode_file)

    @staticmethod
    def create_readme(
        temp_root: Path,
        repo_id: str,
        dataset_info: dict,
        is_merge: bool = False,
        source_datasets: List[str] = None,
    ) -> None:
        """Create README.md with dataset card.

        Args:
            temp_root: Root directory to write README to
            repo_id: Repository ID
            dataset_info: Dataset info dictionary
            is_merge: Whether this is a merged dataset
            source_datasets: List of source dataset IDs (for merge)
        """
        logger.info("Creating README.md with dataset card...")

        if is_merge and source_datasets:
            description = f"""# Merged LeRobot Dataset

This dataset was created by merging multiple LeRobot datasets using the [LeRobot Data Studio](https://github.com/jackvial/assembler0/packages/lerobot-data-studio) merge tool.

## Source Datasets

This merged dataset combines the following {len(source_datasets)} datasets:

{chr(10).join(f"- [{dataset_id}](https://huggingface.co/datasets/{dataset_id})" for dataset_id in source_datasets)}

## Merge Details

- **Merge Date**: Generated automatically
- **Source Count**: {len(source_datasets)} datasets
- **Episode Renumbering**: Episodes are renumbered sequentially starting from 0"""
        else:
            description = "This dataset was created using [LeRobot Data Studio](https://github.com/jackvial/assembler0/tree/main/packages/lerobot-data-studio)."

        readme_content = f"""---
license: apache-2.0
task_categories:
- robotics
tags:
- LeRobot
configs:
- config_name: default
  data_files: data/*/*.parquet
---

{description}

## Dataset Description

- **Homepage:** [More Information Needed]
- **Paper:** [More Information Needed]
- **License:** apache-2.0

## Dataset Structure

[meta/info.json](meta/info.json):
```json
{json.dumps(dataset_info, indent=4)}
```

## Citation

**BibTeX:**

```bibtex
[More Information Needed]
```
"""

        readme_path = temp_root / "README.md"
        with open(readme_path, "w") as f:
            f.write(readme_content)
