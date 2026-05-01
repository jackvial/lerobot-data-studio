"""Configuration for the manual critical-section annotation labels.

Mirrors `subtask_config` so the frontend can render a small radio of suggested
labels for the critical-grasp/contact phase. Override at runtime by setting
`LEROBOT_DATA_STUDIO_CRITICAL_LABELS_PATH` to a path of a JSON file containing
either a top-level array of strings or an object with a `"labels"` array.
"""

import json
import logging
import os
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)


# Hardcoded default critical-section labels. Kept short and intentionally
# generic; users can override via the env var below for project-specific lists.
DEFAULT_CRITICAL_LABELS: List[str] = [
    "critical grasp",
    "critical contact",
    "critical handoff",
]

DEFAULT_CRITICAL_WEIGHT: float = 5.0

_OVERRIDE_ENV_VAR = "LEROBOT_DATA_STUDIO_CRITICAL_LABELS_PATH"


def _load_override(path: Path) -> List[str]:
    """Load and validate an override critical-labels JSON file."""
    raw = json.loads(path.read_text())
    if isinstance(raw, dict):
        raw = raw.get("labels", [])
    if not isinstance(raw, list):
        raise ValueError(f"Expected list of strings or object with 'labels' key in {path}")

    items: List[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            raise ValueError(f"Critical labels must be strings, got {type(item).__name__}: {item!r}")
        name = item.strip()
        if not name:
            continue
        if name in seen:
            continue
        seen.add(name)
        items.append(name)
    if not items:
        raise ValueError(f"Override file {path} contained no valid critical-section labels")
    return items


def get_critical_section_labels() -> List[str]:
    """Return the configured critical-section label list."""
    override = os.getenv(_OVERRIDE_ENV_VAR)
    if not override:
        return list(DEFAULT_CRITICAL_LABELS)

    path = Path(override).expanduser()
    if not path.exists():
        logger.warning(
            "Critical-labels override path %s does not exist; falling back to defaults", path
        )
        return list(DEFAULT_CRITICAL_LABELS)

    try:
        return _load_override(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Failed to load critical-labels override from %s: %s", path, exc)
        return list(DEFAULT_CRITICAL_LABELS)
