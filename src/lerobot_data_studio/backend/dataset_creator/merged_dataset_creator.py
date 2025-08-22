import logging
import tempfile
from pathlib import Path
from typing import List

from datasets import concatenate_datasets
from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.datasets.utils import get_episode_data_index

from .dataset_creator import DatasetCreator

logger = logging.getLogger(__name__)


class MergedDatasetCreator(DatasetCreator):
    """Handles creation of merged datasets from multiple source datasets."""

    def create(
        self,
        dataset_ids: List[str],
        new_repo_id: str,
        tolerance_s: float = 1e-4,
        dataset_roots: List[Path] = None,
    ) -> bool:
        """Create a merged dataset from multiple LeRobot datasets.

        This is the main public method for dataset merging.

        Args:
            dataset_ids: List of dataset repository IDs to merge
            new_repo_id: Repository ID for the merged dataset
            tolerance_s: Tolerance for timestamp validation
            dataset_roots: Optional list of root paths for each dataset (for testing)
        """
        assert dataset_ids, "No datasets to merge"

        logging.info(f"Starting merge of {len(dataset_ids)} datasets")

        datasets = []
        for i, dataset_id in enumerate(dataset_ids):
            logging.info(f"Loading dataset: {dataset_id}")
            if dataset_roots and i < len(dataset_roots):
                dataset = LeRobotDataset(dataset_id, root=dataset_roots[i], tolerance_s=tolerance_s)
            else:
                dataset = LeRobotDataset(dataset_id, tolerance_s=tolerance_s)
            datasets.append(dataset)

        template_dataset = datasets[0]

        self._validate_dataset_compatibility(datasets, dataset_ids)

        logging.info("All datasets are compatible, proceeding with merge...")

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir) / new_repo_id.replace("/", "_")
            # Don't create the directory - LeRobotDataset.create() expects it not to exist

            merged_dataset = LeRobotDataset.create(
                repo_id=new_repo_id,
                root=temp_root,
                fps=template_dataset.fps,
                robot_type=template_dataset.meta.robot_type,
                features=template_dataset.meta.info["features"],
                use_videos=len(template_dataset.meta.video_keys) > 0,
            )

            all_episodes, all_episode_stats, all_tasks, merged_hf_dataset = self._merge_dataset_contents(
                datasets, dataset_ids
            )

            merged_dataset.meta.episodes = all_episodes
            merged_dataset.meta.episodes_stats = all_episode_stats
            merged_dataset.meta.tasks = all_tasks
            merged_dataset.meta.task_to_task_index = {task: idx for idx, task in all_tasks.items()}

            merged_dataset.meta.info["total_episodes"] = len(all_episodes)
            merged_dataset.meta.info["total_frames"] = len(merged_hf_dataset)
            merged_dataset.meta.info["total_tasks"] = len(all_tasks)
            merged_dataset.meta.info["splits"] = {"train": f"0:{len(all_episodes)}"}

            merged_dataset.hf_dataset = merged_hf_dataset

            merged_dataset.episode_data_index = get_episode_data_index(
                merged_dataset.meta.episodes, list(range(len(all_episodes)))
            )

            merged_dataset.meta.info["data_path"] = (
                "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet"
            )
            if len(template_dataset.meta.video_keys) > 0:
                merged_dataset.meta.info["video_path"] = (
                    "videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4"
                )

            self.write_metadata_files(
                temp_root,
                merged_dataset.meta.info,
                merged_dataset.meta.episodes,
                merged_dataset.meta.episodes_stats,
                merged_dataset.meta.tasks,
            )

            logging.info("Writing merged dataset files to parquet...")
            self.write_episode_data(merged_dataset, temp_root, len(all_episodes))

            if len(template_dataset.meta.video_keys) > 0:
                self._copy_merged_videos(datasets, temp_root, merged_dataset.meta.info["chunks_size"])

            self.create_readme(
                temp_root, new_repo_id, merged_dataset.meta.info, is_merge=True, source_datasets=dataset_ids
            )

            logging.info(f"Pushing merged dataset to hub: {new_repo_id}")
            merged_dataset.push_to_hub(
                license="apache-2.0",
                tags=["LeRobot", "robotics", "merged-dataset"],
            )

            logging.info(
                f"Successfully merged {len(dataset_ids)} datasets into {new_repo_id}Dataset is available at: https://huggingface.co/datasets/{new_repo_id}"
            )

        return True

    def _validate_dataset_compatibility(self, datasets: List[LeRobotDataset], dataset_ids: List[str]):
        """Validate that all datasets have compatible structure.

        Args:
            datasets: List of datasets to validate
            dataset_ids: List of dataset IDs for error messages
        """
        template_dataset = datasets[0]

        for i, dataset in enumerate(datasets[1:], 1):
            assert dataset.revision in self.supported_dataset_versions, (
                f"Dataset version {dataset.revision} is not supported"
            )

            assert dataset.fps == template_dataset.fps, (
                f"FPS mismatch: {dataset_ids[0]} has {template_dataset.fps}, {dataset_ids[i]} has {dataset.fps}"
            )

            assert dataset.features.keys() == template_dataset.features.keys(), (
                f"Feature mismatch between {dataset_ids[0]} and {dataset_ids[i]}"
            )

    def _merge_dataset_contents(
        self, datasets: List[LeRobotDataset], dataset_ids: List[str]
    ) -> tuple[dict, dict, dict, any]:
        """Merge the contents of multiple datasets.

        Args:
            datasets: List of datasets to merge
            dataset_ids: List of dataset IDs for logging

        Returns:
            Tuple of (all_episodes, all_episode_stats, all_tasks, merged_hf_dataset)
        """
        all_episodes = {}
        all_episode_stats = {}
        all_tasks = {}
        task_index_mapping = {}
        all_hf_datasets = []
        merged_episode_idx = 0

        for dataset_idx, dataset in enumerate(datasets):
            logging.info(f"Processing dataset {dataset_idx + 1}/{len(datasets)}: {dataset_ids[dataset_idx]}")

            for _task_idx, task in dataset.meta.tasks.items():
                if task not in task_index_mapping:
                    new_task_idx = len(task_index_mapping)
                    task_index_mapping[task] = new_task_idx
                    all_tasks[new_task_idx] = task

            for episode_idx in range(dataset.num_episodes):
                episode_data = dataset.meta.episodes[episode_idx].copy()
                episode_data["episode_index"] = merged_episode_idx
                all_episodes[merged_episode_idx] = episode_data

                if episode_idx in dataset.meta.episodes_stats:
                    all_episode_stats[merged_episode_idx] = dataset.meta.episodes_stats[episode_idx]

                from_idx = dataset.episode_data_index["from"][episode_idx]
                to_idx = dataset.episode_data_index["to"][episode_idx]

                episode_hf_data = dataset.hf_dataset.select(range(from_idx, to_idx))

                task_remap = {}
                for old_task_idx, task_name in dataset.meta.tasks.items():
                    task_remap[old_task_idx] = task_index_mapping[task_name]

                episode_hf_data = episode_hf_data.map(
                    lambda example,
                    ep_idx=episode_idx,
                    m_ep_idx=merged_episode_idx,
                    t_remap=task_remap: self.update_dataset_indices(
                        example, old_to_new_episode_index_map={ep_idx: m_ep_idx}, task_remapping=t_remap
                    ),
                    batched=False,
                    load_from_cache_file=False,
                )
                all_hf_datasets.append(episode_hf_data)

                merged_episode_idx += 1

        merged_hf_dataset = concatenate_datasets(all_hf_datasets)

        return all_episodes, all_episode_stats, all_tasks, merged_hf_dataset

    def _copy_merged_videos(self, datasets: List[LeRobotDataset], temp_root: Path, chunks_size: int) -> None:
        """Copy video files from all source datasets to the merged dataset.

        Args:
            datasets: List of source datasets
            temp_root: Root directory of the merged dataset
            chunks_size: Number of episodes per chunk
        """
        logging.info("Copying video files...")
        merged_episode_idx = 0

        for _dataset_idx, dataset in enumerate(datasets):
            for episode_idx in range(dataset.num_episodes):
                self.copy_episode_videos(
                    dataset=dataset,
                    old_episode_idx=episode_idx,
                    new_episode_idx=merged_episode_idx,
                    old_root=dataset.root,
                    new_root=temp_root,
                    chunks_size=chunks_size,
                )
                merged_episode_idx += 1
