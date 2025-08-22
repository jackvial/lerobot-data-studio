import logging
import shutil
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.datasets.utils import get_episode_data_index

from ..state_store import HF_LEROBOT_HOME
from .dataset_creator import DatasetCreator as BaseDatasetCreator
from .utils import update_progress

logger = logging.getLogger(__name__)


class FilteredDatasetCreator(BaseDatasetCreator):
    """Handles creation of new datasets from selected episodes."""

    def __init__(self, original_dataset: LeRobotDataset):
        """Initialize with the original dataset to filter from.

        Args:
            original_dataset: The source dataset to select episodes from
        """
        self.original_dataset = original_dataset

    def create(
        self,
        new_repo_id: str,
        selected_episodes: List[int],
        episode_index_task_map: Optional[Dict[int, str]] = None,
        task_id: Optional[str] = None,
    ) -> bool:
        """Create a new LeRobotDataset from selected episodes of the original dataset.

        Args:
            new_repo_id: Repository ID for the new dataset
            selected_episodes: List of episode indices to include in the new dataset
            episode_index_task_map: Dictionary mapping episode IDs to their assigned tasks
            task_id: Optional task ID for progress tracking

        Returns:
            bool: True if successful, False otherwise
        """

        selected_episodes = sorted(selected_episodes)

        update_progress(task_id, 0.2, "Loading selected episodes from original dataset...")

        # Create a dataset instance from the source dataset files on disk
        # but filter down to the episodes that we selected in the UI
        # this will serve as the base for our new dataset
        filtered_dataset = LeRobotDataset(
            repo_id=self.original_dataset.repo_id,
            # Assume the dataset we are filtering has been download when we hit the load_dataset endpoint and exists on disk
            root=self.original_dataset.root,
            episodes=selected_episodes,
        )

        # Update the repo id to the name we want for our new repo id
        filtered_dataset.repo_id = new_repo_id
        filtered_dataset.meta.repo_id = new_repo_id

        # We want to update the episode indices to be sequential
        # e.g. if we had a dataset with indices 0,1,2,3,4
        # and we selected 1,3,4, we want the new indices to be 0,1,2
        # This makes performing subsequent merging and filtering of
        # datasets simpler and it looks neater
        old_to_new_episode_index_map = {}
        for new_idx, old_episode_idx in enumerate(selected_episodes):
            old_to_new_episode_index_map[old_episode_idx] = new_idx

        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a temp directory for the new dataset
            temp_root = Path(temp_dir) / new_repo_id.replace("/", "_")
            temp_root.mkdir(parents=True, exist_ok=True)

            old_root = filtered_dataset.root
            filtered_dataset.root = temp_root

            # Create the meta sub dir
            (temp_root / "meta").mkdir(parents=True, exist_ok=True)
            filtered_dataset.meta.root = temp_root

            # The meta.info property on the dataset will be used to create meta/info.jsonl
            # see tests/template_datasets/v2_1/screwdriver_panel_ls_080225_4_e5/meta/info.json for an example
            filtered_dataset.meta.info["total_episodes"] = len(selected_episodes)
            filtered_dataset.meta.info["splits"] = {"train": f"0:{len(selected_episodes)}"}

            new_episodes, new_episode_stats = self._create_filtered_episodes_metadata(
                old_to_new_episode_index_map, episode_index_task_map
            )

            filtered_dataset.meta.episodes = new_episodes
            filtered_dataset.meta.episodes_stats = new_episode_stats

            index_to_task_name_map, task_name_to_index_map = self._build_task_maps(new_episodes)

            filtered_dataset.meta.tasks = index_to_task_name_map

            update_progress(task_id, 0.4, "Updating frame indices...")
            self._update_episode_data(filtered_dataset, old_to_new_episode_index_map, task_name_to_index_map)

            filtered_dataset.episode_data_index = get_episode_data_index(
                filtered_dataset.meta.episodes, list(range(len(selected_episodes)))
            )

            # Setup template paths for the new dataset.
            filtered_dataset.meta.info["data_path"] = (
                "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet"
            )
            # Check video_keys from info dict if meta.video_keys is empty
            video_keys = filtered_dataset.meta.video_keys or filtered_dataset.meta.info.get("video_keys", [])
            if len(video_keys) > 0:
                filtered_dataset.meta.info["video_path"] = (
                    "videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4"
                )

            total_frames = sum(
                episode_data["length"] for episode_data in filtered_dataset.meta.episodes.values()
            )
            filtered_dataset.meta.info["total_frames"] = total_frames

            self.write_metadata_files(
                temp_root, filtered_dataset.meta.info, new_episodes, new_episode_stats, index_to_task_name_map
            )
            update_progress(task_id, 0.5, "Saving episode data to parquet files...")
            self.write_episode_data(filtered_dataset, temp_root, len(selected_episodes))
            update_progress(task_id, 0.7, "Copying video files...")
            self._copy_selected_episode_video_files(filtered_dataset, old_root, temp_root, selected_episodes)
            self.create_readme(temp_root, new_repo_id, filtered_dataset.meta.info)
            update_progress(task_id, 0.85, "Pushing dataset to Hugging Face Hub...")
            filtered_dataset.push_to_hub(
                license="apache-2.0",
                tags=["LeRobot", "robotics"],
                dataset_name=new_repo_id.split("/")[-1],
                robot_type=filtered_dataset.meta.robot_type or "unknown",
            )

        new_dataset_cache = HF_LEROBOT_HOME / new_repo_id
        if new_dataset_cache.exists():
            shutil.rmtree(new_dataset_cache)

        update_progress(task_id, 1.0, f"Dataset successfully created: {new_repo_id}")
        return True

    def _create_filtered_episodes_metadata(
        self,
        old_to_new_episode_index_map: Dict[int, int],
        episode_index_task_map: Optional[Dict[int, str]] = None,
    ) -> tuple[dict, dict]:
        """Create new episode metadata with task assignments."""
        new_episodes = {}
        new_episode_stats = {}

        for old_episode_idx, new_idx in old_to_new_episode_index_map.items():
            assert old_episode_idx in self.original_dataset.meta.episodes, (
                f"Expected index {old_episode_idx} to exist in original dataset episode metadata"
            )

            episode_data = self.original_dataset.meta.episodes[old_episode_idx].copy()
            episode_data["episode_index"] = new_idx

            # Add any newly assigned task string if it doesn't already exist
            episode_data.setdefault("tasks", [])
            new_task = episode_index_task_map.get(old_episode_idx) if episode_index_task_map else None

            if new_task and new_task not in episode_data["tasks"]:
                episode_data["tasks"].append(new_task)

            new_episodes[new_idx] = episode_data

            assert old_episode_idx in self.original_dataset.meta.episodes_stats, (
                f"Expected index {old_episode_idx} to exist in original dataset episode stats"
            )

            new_episode_stats[new_idx] = self.original_dataset.meta.episodes_stats[old_episode_idx]

        return new_episodes, new_episode_stats

    def _build_task_maps(self, episodes_metadata: dict) -> tuple[Dict[int, str], Dict[str, int]]:
        """Find the set of unique tasks that have been assigned to episodes and construct and index to task name map and the inverse"""

        # Add episode metadata tasks from meta/episodes.jsonl
        episode_tasks = {task for episode in episodes_metadata.values() for task in episode.get("tasks", [])}

        # Deduplicate and reindex
        index_to_task_name_map = dict(enumerate(list(dict.fromkeys(episode_tasks))))

        task_name_to_index_map = {v: k for k, v in index_to_task_name_map.items()}

        return index_to_task_name_map, task_name_to_index_map

    def _update_episode_data(
        self,
        dataset: LeRobotDataset,
        old_to_new_episode_index_map: Dict[int, int],
        task_name_to_index_map: Dict[str, int] = None,
    ) -> None:
        """
        Update the episode and task indices in the episode data in memory.
        This will eventually be persisted to disk as a parquet file for each episode
        e.g. tests/template_datasets/v2_1/screwdriver_panel_ls_080225_4_e5/data/chunk-000/episode_000000.parquet
        """
        task_remapping = {}
        if task_name_to_index_map:
            for old_task_idx, task_name in self.original_dataset.meta.tasks.items():
                if task_name in task_name_to_index_map:
                    task_remapping[old_task_idx] = task_name_to_index_map[task_name]

        dataset.hf_dataset = dataset.hf_dataset.map(
            lambda item: self.update_dataset_indices(
                item,
                old_to_new_episode_index_map=old_to_new_episode_index_map,
                task_remapping=task_remapping if task_remapping else None,
            ),
            batched=False,
            load_from_cache_file=False,  # Force recomputation
        )

    def _copy_selected_episode_video_files(
        self, filtered_dataset: LeRobotDataset, old_root: Path, temp_root: Path, selected_episodes: List[int]
    ) -> None:
        """Copy video files for the selected episodes."""
        # Check video_keys from info dict if meta.video_keys is empty
        video_keys = filtered_dataset.meta.video_keys or filtered_dataset.meta.info.get("video_keys", [])
        if len(video_keys) == 0:
            return

        logger.info("Copying video files...")
        for new_idx, old_episode_idx in enumerate(selected_episodes):
            self.copy_episode_videos(
                dataset=filtered_dataset,
                old_episode_idx=old_episode_idx,
                new_episode_idx=new_idx,
                old_root=old_root,
                new_root=temp_root,
                chunks_size=filtered_dataset.meta.info["chunks_size"],
                video_keys=video_keys,  # Pass video_keys explicitly
            )
