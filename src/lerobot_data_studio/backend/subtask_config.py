"""Configuration for the manual subtask annotation task list.

The task list is the single source of truth for the radio selector in the
frontend and for validating saves coming back from the UI. It can be
overridden at runtime by setting `LEROBOT_DATA_STUDIO_SUBTASKS_PATH` to a
path of a JSON file containing either a top-level array of strings or an
object with a `"subtasks"` array.
"""

import json
import logging
import os
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)


# Hardcoded default subtasks for phase 1. These intentionally reflect a
# generic robotic manipulation vocabulary; users can override via the env
# var below for project-specific lists.
DEFAULT_SUBTASKS: List[str] = [
    "approach",
    "grasp",
    "pick",
    "transport",
    "place",
    "release",
    "retract",
    "idle",
]

_OVERRIDE_ENV_VAR = "LEROBOT_DATA_STUDIO_SUBTASKS_PATH"


def _load_override(path: Path) -> List[str]:
    """Load and validate an override subtasks JSON file."""
    raw = json.loads(path.read_text())
    if isinstance(raw, dict):
        raw = raw.get("subtasks", [])
    if not isinstance(raw, list):
        raise ValueError(f"Expected list of strings or object with 'subtasks' key in {path}")

    items: List[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            raise ValueError(f"Subtask entries must be strings, got {type(item).__name__}: {item!r}")
        name = item.strip()
        if not name:
            continue
        if name in seen:
            continue
        seen.add(name)
        items.append(name)
    if not items:
        raise ValueError(f"Override file {path} contained no valid subtask names")
    return items


def get_subtask_task_list() -> List[str]:
    """Return the configured subtask task list.

    Returns the override list if `LEROBOT_DATA_STUDIO_SUBTASKS_PATH` points
    to a readable JSON file, otherwise returns `DEFAULT_SUBTASKS`.
    """
    override = os.getenv(_OVERRIDE_ENV_VAR)
    if not override:
        return list(DEFAULT_SUBTASKS)

    path = Path(override).expanduser()
    if not path.exists():
        logger.warning(
            "Subtask override path %s does not exist; falling back to defaults", path
        )
        return list(DEFAULT_SUBTASKS)

    try:
        return _load_override(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Failed to load subtask override from %s: %s", path, exc)
        return list(DEFAULT_SUBTASKS)
