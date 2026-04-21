import logging
import re
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import requests
import uvicorn
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, status as http_status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from huggingface_hub import HfApi
from lerobot import available_datasets
from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.utils.utils import init_logging

from .background_tasks import create_dataset_task, load_dataset_task
from .models import (
    CreateDatasetRequest,
    CreateDatasetResponse,
    CreateTaskStatus,
    DatasetInfo,
    DatasetListResponse,
    DatasetLoadingStatus,
    DatasetSearchResponse,
    DatasetValidationResponse,
    EpisodeData,
    FeaturedLocalDataset,
    FeaturedLocalDatasetsResponse,
    RegisterLocalDatasetRequest,
    RegisterLocalDatasetResponse,
    VideoInfo,
)
from .state_store import StateStore, get_state_store
from .utils import get_episode_data

LOCAL_NAMESPACE = "local"

FEATURED_LOCAL_DATASETS: list[str] = [
    "/home/jack/code/lerobot/outputs/so101_pickplace_success_120_v2_w_subtasks_v2",
]

init_logging()
logger = logging.getLogger(__name__)


def check_repo_id(repo_id: str) -> None:
    """
    Validate that a repo_id follows the HuggingFace format: namespace/name.

    Args:
        repo_id: The repository ID to validate.

    Raises:
        ValueError: If the repo_id format is invalid.
    """
    if not repo_id or not isinstance(repo_id, str):
        raise ValueError("repo_id must be a non-empty string")

    parts = repo_id.split("/")
    if len(parts) != 2:
        raise ValueError(f"Invalid repo_id format: '{repo_id}'. Expected format: 'namespace/name'")

    namespace, name = parts
    if not namespace or not name:
        raise ValueError(f"Invalid repo_id format: '{repo_id}'. Both namespace and name must be non-empty")

    # Validate characters (HuggingFace allows alphanumeric, hyphens, underscores, and dots)
    pattern = r"^[a-zA-Z0-9._-]+$"
    if not re.match(pattern, namespace):
        raise ValueError(
            f"Invalid namespace in repo_id: '{namespace}'. "
            "Only alphanumeric characters, dots, hyphens, and underscores are allowed"
        )
    if not re.match(pattern, name):
        raise ValueError(
            f"Invalid name in repo_id: '{name}'. "
            "Only alphanumeric characters, dots, hyphens, and underscores are allowed"
        )


def _sanitize_local_name(folder_name: str) -> str:
    """Sanitize a folder name to fit the repo_id name regex used by check_repo_id."""
    sanitized = re.sub(r"[^a-zA-Z0-9._-]", "_", folder_name)
    return sanitized or "dataset"


def _local_repo_id_for_path(path: Path) -> str:
    return f"{LOCAL_NAMESPACE}/{_sanitize_local_name(path.name)}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting LeRobot Data Studio API")
    state_store = get_state_store()
    yield
    logger.info("Shutting down LeRobot Data Studio API")
    state_store.clear_loading_tasks()


app = FastAPI(title="LeRobot Data Studio API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
    ],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/datasets", response_model=DatasetListResponse)
async def list_datasets():
    """Get list of available datasets."""
    featured_datasets = [
        "lerobot/svla_so100_sorting",
        "lerobot/svla_so100_stacking",
        "jackvial/screwdriver-391",
    ]
    return DatasetListResponse(featured_datasets=featured_datasets, lerobot_datasets=available_datasets)


@app.get("/api/datasets/{dataset_namespace}/{dataset_name}/status")
async def get_dataset_status(
    dataset_namespace: str,
    dataset_name: str,
    background_tasks: BackgroundTasks,
    state_store: StateStore = Depends(get_state_store),
    auto_load: bool = Query(False, description="Automatically start loading if not loaded"),
):
    """Get dataset loading status."""
    repo_id = f"{dataset_namespace}/{dataset_name}"
    loading_status = state_store.get_loading_status(repo_id)
    if loading_status:
        logger.info(f"Found loading status for {repo_id}: {loading_status.status}")
        return loading_status
    elif state_store.is_dataset_cached(repo_id):
        return DatasetLoadingStatus(status="ready", progress=1.0)
    else:
        if auto_load:
            if not state_store.is_dataset_loading(repo_id):
                logger.info(f"Auto-loading dataset: {repo_id}")
                state_store.start_loading(repo_id)
                state_store.set_loading_status(
                    repo_id, DatasetLoadingStatus(status="loading", message="Starting to load dataset...")
                )
                background_tasks.add_task(load_dataset_task, repo_id, state_store)
                return state_store.get_loading_status(repo_id)

            logger.info(f"Dataset {repo_id} is already being loaded")
            return state_store.get_loading_status(repo_id) or DatasetLoadingStatus(
                status="loading", progress=0.0
            )

        return DatasetLoadingStatus(status="not_loaded")


@app.get("/api/datasets/{dataset_namespace}/{dataset_name}/episodes/{episode_id}")
async def get_episode(
    dataset_namespace: str,
    dataset_name: str,
    episode_id: int,
    background_tasks: BackgroundTasks,
    state_store: StateStore = Depends(get_state_store),
):
    """Get episode data for a specific dataset and episode."""
    repo_id = f"{dataset_namespace}/{dataset_name}"
    logger.info(f"Getting episode {episode_id} for dataset: {repo_id}")

    if not state_store.is_dataset_cached(repo_id):
        if state_store.is_dataset_loading(repo_id):
            logger.info(f"Dataset {repo_id} is already being loaded")
        else:
            logger.info(f"Dataset not in cache, starting background load: {repo_id}")
            state_store.start_loading(repo_id)
            state_store.set_loading_status(
                repo_id,
                DatasetLoadingStatus(status="loading", message="Starting to load dataset..."),
            )
            background_tasks.add_task(load_dataset_task, repo_id, state_store)

        raise HTTPException(
            status_code=http_status.HTTP_202_ACCEPTED, detail="Dataset is being loaded. Please check status."
        )

    dataset = state_store.get_dataset(repo_id)
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset {repo_id} not found")

    if episode_id < 0 or episode_id >= dataset.num_episodes:
        raise HTTPException(status_code=404, detail=f"Episode {episode_id} not found")

    episode_data_items, feature_names, subtasks, subtask_labels = get_episode_data(dataset, episode_id)

    dataset_info = DatasetInfo(
        repo_id=repo_id,
        num_samples=dataset.num_frames,
        num_episodes=dataset.num_episodes,
        fps=dataset.fps,
        version=str(getattr(dataset.meta, "version", getattr(dataset.meta, "_version", None))),
    )

    episode_meta = dataset.meta.episodes[episode_id]
    videos_info: list[VideoInfo] = []
    for key in dataset.meta.video_keys:
        video_path = dataset.meta.get_video_file_path(episode_id, key)
        # In LeRobot v3, multiple episodes are concatenated into a single
        # video file. Extract the per-episode time range so the UI can
        # clip playback to the relevant segment.
        from_ts_raw = episode_meta.get(f"videos/{key}/from_timestamp", 0.0)
        to_ts_raw = episode_meta.get(f"videos/{key}/to_timestamp")
        from_ts = float(from_ts_raw) if from_ts_raw is not None else 0.0
        to_ts = float(to_ts_raw) if to_ts_raw is not None else None
        videos_info.append(
            VideoInfo(
                url=f"/api/videos/{repo_id}/{str(video_path)}",
                filename=f"{video_path.parent.parent.name} ({video_path.parent.name})",
                from_timestamp=from_ts,
                to_timestamp=to_ts,
            )
        )
    tasks = dataset.meta.episodes[episode_id]["tasks"]

    if videos_info:
        videos_info[0].language_instruction = tasks

    return EpisodeData(
        episode_id=episode_id,
        dataset_info=dataset_info,
        videos_info=videos_info,
        episode_data=episode_data_items,
        feature_names=feature_names,
        # Used to visually sanity check indices are aligned
        actual_episode_index=episode_data_items[0].episode_index,
        tasks=tasks,
        subtasks=subtasks,
        subtask_labels=subtask_labels,
    )


@app.get("/api/videos/{dataset_namespace}/{dataset_name}/{video_path:path}")
async def get_video(
    dataset_namespace: str,
    dataset_name: str,
    video_path: str,
    state_store: StateStore = Depends(get_state_store),
):
    """Serve mp4 video file from the local copy of the dataset. Serving the video files on demand for the currently selected episode helps reduce memory usage.
    The video files are usually not very long, usually tens of seconds at most."""
    repo_id = f"{dataset_namespace}/{dataset_name}"

    if not state_store.is_dataset_cached(repo_id):
        raise HTTPException(status_code=404, detail="Dataset not loaded")

    dataset = state_store.get_dataset(repo_id)
    if not isinstance(dataset, LeRobotDataset):
        raise HTTPException(status_code=400, detail="Video serving only available for local datasets")

    video_full_path = dataset.root / video_path
    if not video_full_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    return FileResponse(video_full_path, media_type="video/mp4")


@app.post("/api/datasets/create", response_model=CreateDatasetResponse)
async def create_dataset(
    request: CreateDatasetRequest,
    background_tasks: BackgroundTasks,
    state_store: StateStore = Depends(get_state_store),
):
    """Create a new dataset from selected episodes."""
    try:
        check_repo_id(request.new_repo_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if not state_store.is_dataset_cached(request.original_repo_id):
        raise HTTPException(status_code=400, detail="Original dataset must be loaded first")

    task_id = str(uuid.uuid4())
    state_store.set_creation_task(
        task_id,
        CreateTaskStatus(
            task_id=task_id,
            status="pending",
            message="Dataset creation task created, starting soon...",
            new_repo_id=request.new_repo_id,
        ),
    )

    background_tasks.add_task(
        create_dataset_task,
        task_id,
        request.original_repo_id,
        request.new_repo_id,
        request.selected_episodes,
        request.episode_index_task_map,
        state_store,
    )

    return CreateDatasetResponse(
        success=True,
        new_repo_id=request.new_repo_id,
        message=f"Dataset creation started with {len(request.selected_episodes)} episodes",
        task_id=task_id,
    )


@app.get("/api/datasets/{dataset_namespace}/{dataset_name}/episodes")
async def list_episodes(
    dataset_namespace: str, dataset_name: str, state_store: StateStore = Depends(get_state_store)
) -> dict[str, list[int]]:
    """List all episode IDs for a dataset."""
    repo_id = f"{dataset_namespace}/{dataset_name}"

    if not state_store.is_dataset_cached(repo_id):
        raise HTTPException(status_code=404, detail="Dataset not loaded")

    dataset = state_store.get_dataset(repo_id)
    num_episodes = dataset.num_episodes if isinstance(dataset, LeRobotDataset) else dataset.total_episodes

    return {"episodes": list(range(num_episodes))}


@app.post("/api/datasets/{dataset_namespace}/{dataset_name}/load")
async def load_dataset(
    dataset_namespace: str,
    dataset_name: str,
    background_tasks: BackgroundTasks,
    state_store: StateStore = Depends(get_state_store),
):
    """Trigger dataset loading."""
    repo_id = f"{dataset_namespace}/{dataset_name}"
    logger.info(f"Load request for dataset: {repo_id}")

    if state_store.is_dataset_cached(repo_id):
        logger.info(f"Dataset already loaded: {repo_id}")
        return {"status": "already_loaded", "message": "Dataset is already loaded"}

    if state_store.is_dataset_loading(repo_id):
        logger.info(f"Dataset already loading: {repo_id}")
        return {"status": "already_loading", "message": "Dataset is already being loaded"}

    state_store.start_loading(repo_id)
    state_store.set_loading_status(
        repo_id, DatasetLoadingStatus(status="loading", message="Starting to load dataset...")
    )
    background_tasks.add_task(load_dataset_task, repo_id, state_store)

    return {"status": "loading_started", "message": "Dataset loading has been started"}


@app.get("/api/datasets/local/featured", response_model=FeaturedLocalDatasetsResponse)
async def list_featured_local_datasets():
    """Return a hardcoded list of convenient local dataset paths.

    Entries whose folder no longer exists on disk are filtered out so the dropdown
    only shows actually-loadable datasets.
    """
    datasets: list[FeaturedLocalDataset] = []
    for raw_path in FEATURED_LOCAL_DATASETS:
        path = Path(raw_path).expanduser()
        if not path.exists() or not path.is_dir():
            logger.info(f"Skipping featured local dataset (missing): {path}")
            continue
        if not (path / "meta" / "info.json").exists():
            logger.info(f"Skipping featured local dataset (no meta/info.json): {path}")
            continue
        repo_id = _local_repo_id_for_path(path)
        datasets.append(FeaturedLocalDataset(repo_id=repo_id, path=str(path), label=path.name))
    return FeaturedLocalDatasetsResponse(datasets=datasets)


@app.post("/api/datasets/local/register", response_model=RegisterLocalDatasetResponse)
async def register_local_dataset(
    request: RegisterLocalDatasetRequest,
    background_tasks: BackgroundTasks,
    state_store: StateStore = Depends(get_state_store),
):
    """Register a local LeRobotDataset folder and start loading it in the background."""
    raw_path = request.path.strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="path must be a non-empty string")

    path = Path(raw_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Path does not exist or is not a directory: {path}")

    info_path = path / "meta" / "info.json"
    if not info_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Not a valid LeRobotDataset folder (missing meta/info.json): {path}",
        )

    repo_id = _local_repo_id_for_path(path)

    try:
        check_repo_id(repo_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    state_store.register_local_path(repo_id, path)

    if state_store.is_dataset_cached(repo_id):
        return RegisterLocalDatasetResponse(
            repo_id=repo_id, path=str(path), message="Dataset already loaded"
        )

    if not state_store.is_dataset_loading(repo_id):
        state_store.start_loading(repo_id)
        state_store.set_loading_status(
            repo_id,
            DatasetLoadingStatus(status="loading", message=f"Loading local dataset from {path}..."),
        )
        background_tasks.add_task(load_dataset_task, repo_id, state_store)

    return RegisterLocalDatasetResponse(
        repo_id=repo_id, path=str(path), message="Local dataset registered, loading started"
    )


@app.get("/api/datasets/search", response_model=DatasetSearchResponse)
async def search_datasets(prefix: str):
    """Search datasets on HuggingFace Hub by prefix match."""
    api = HfApi()
    results = api.list_datasets(search=prefix)
    repo_ids = [d.id for d in results]
    return DatasetSearchResponse(repo_ids=repo_ids)


@app.get("/api/datasets/user/{username}", response_model=DatasetSearchResponse)
async def list_user_datasets(username: str):
    """List datasets on HuggingFace Hub for a given user."""
    api = HfApi()
    results = api.list_datasets(author=username)
    repo_ids = [d.id for d in results]
    return DatasetSearchResponse(repo_ids=repo_ids)


@app.get(
    "/api/datasets/validate/{dataset_namespace}/{dataset_name}", response_model=DatasetValidationResponse
)
async def validate_dataset(dataset_namespace: str, dataset_name: str):
    """Check if a dataset exists on HuggingFace Hub."""
    repo_id = f"{dataset_namespace}/{dataset_name}"
    api = HfApi()

    try:
        api.dataset_info(repo_id)
        return DatasetValidationResponse(exists=True)
    except (ValueError, KeyError, requests.HTTPError) as e:
        return DatasetValidationResponse(
            exists=False, message=f"Dataset '{repo_id}' not found on HuggingFace Hub: {str(e)}"
        )
    except requests.RequestException as e:
        return DatasetValidationResponse(
            exists=False, message=f"Network error checking dataset '{repo_id}': {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error validating dataset {repo_id}: {str(e)}", exc_info=True)
        return DatasetValidationResponse(exists=False, message=f"Error validating dataset '{repo_id}'")


@app.get("/api/datasets/create/status/{task_id}", response_model=CreateTaskStatus)
async def get_create_status(task_id: str, state_store: StateStore = Depends(get_state_store)):
    """Get the status of a dataset creation task."""
    creation_task = state_store.get_creation_task(task_id)
    if not creation_task:
        raise HTTPException(status_code=404, detail="Task not found")
    return creation_task


@app.get("/api/user/whoami")
async def get_current_user():
    """Get current HuggingFace user information."""
    try:
        api = HfApi()
        user_info = api.whoami()
        return {
            "username": user_info["name"],
            "fullname": user_info.get("fullname", ""),
            "avatar_url": user_info.get("avatarUrl", ""),
        }
    except Exception as e:
        logger.warning(f"Could not get user info: {e}")
        return {"username": None, "error": "Not logged in to HuggingFace Hub"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
