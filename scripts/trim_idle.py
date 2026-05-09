"""CLI to bulk-trim leading/trailing idle frames from a LeRobotDataset.

python scripts/trim_idle.py --repo-id jackvial/so101_pickplace_recap_pickplace_20260429_e20 --new-repo-id jackvial/so101_pickplace_recap_pickplace_20260429_e20_trimmed
python scripts/trim_idle.py --repo-id jackvial/jackvial/so101_pickplace_failrecv20_0 --new-repo-id jackvial/jackvial/so101_pickplace_failrecv20_0_trimmed


Usage:
    uv run python scripts/trim_idle.py \\
        --repo-id lerobot/svla_so100_sorting \\
        --new-repo-id myuser/svla_so100_sorting_trimmed \\
        [--episodes 0,1,2,5] \\
        [--license apache-2.0] \\
        [--tags LeRobot,robotics] \\
        [--dry-run]

Idle-detection tunables (threshold, min duration, smoothing) live as module-level
constants in src/lerobot_data_studio/backend/idle_analysis.py.
"""

import argparse
import logging
import sys

from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.utils.utils import init_logging

from lerobot_data_studio.backend.idle_trim import (
    EpisodeTrimReport,
    report_episode_trim,
    trim_episodes,
)

logger = logging.getLogger(__name__)


def _parse_episodes(raw: str | None, num_episodes: int) -> list[int] | None:
    if raw is None or raw.strip() == "":
        return None
    indices: list[int] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        idx = int(chunk)
        if idx < 0 or idx >= num_episodes:
            raise ValueError(f"Episode index {idx} out of range [0, {num_episodes})")
        indices.append(idx)
    return indices


def _format_report_line(report: EpisodeTrimReport, fps: float) -> str:
    if report.skipped:
        return (
            f"ep {report.episode_id:>4}: SKIP ({report.skip_reason}); "
            f"n_frames={report.n_frames}, leading={report.leading_dropped}, "
            f"trailing={report.trailing_dropped}"
        )
    effective_end = report.truncated_to if report.truncated_to is not None else report.keep_end
    line = (
        f"ep {report.episode_id:>4}: kept frames {report.keep_start}..{effective_end} "
        f"of 0..{report.n_frames - 1}, dropped "
        f"{report.leading_dropped} leading + {report.trailing_dropped} trailing "
        f"({report.leading_dropped / fps:.2f}s + {report.trailing_dropped / fps:.2f}s @ {fps:g}fps)"
    )
    if report.truncated_to is not None:
        line += f" [TRUNCATED at frame {report.truncated_to}: {report.truncation_reason}]"
    return line


def _print_report(reports: list[EpisodeTrimReport], fps: float) -> None:
    total_in = 0
    total_kept = 0
    total_leading = 0
    total_trailing = 0
    skipped = 0
    for report in reports:
        print(_format_report_line(report, fps))
        total_in += report.n_frames
        total_kept += report.kept_frames
        total_leading += report.leading_dropped
        total_trailing += report.trailing_dropped
        if report.skipped:
            skipped += 1
    dropped = total_in - total_kept
    pct = (dropped / total_in * 100.0) if total_in else 0.0
    print(
        f"\nTotal: {len(reports)} episodes, {skipped} skipped. "
        f"Frames in={total_in}, kept={total_kept}, dropped={dropped} ({pct:.1f}%). "
        f"Leading dropped={total_leading} ({total_leading / fps:.2f}s), "
        f"trailing dropped={total_trailing} ({total_trailing / fps:.2f}s)."
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bulk-trim leading/trailing idle frames from a LeRobotDataset."
    )
    parser.add_argument("--repo-id", required=True, help="Source dataset repo id (namespace/name)")
    parser.add_argument(
        "--new-repo-id",
        required=False,
        help="Target dataset repo id (namespace/name). Required unless --dry-run.",
    )
    parser.add_argument(
        "--episodes",
        default=None,
        help="Comma-separated episode indices to process. Default: all episodes.",
    )
    parser.add_argument("--license", default="apache-2.0", help="License for the new dataset.")
    parser.add_argument(
        "--tags",
        default="LeRobot,robotics",
        help="Comma-separated tags for the new dataset.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only analyze and print the trim plan; do not build or push.",
    )
    parser.add_argument(
        "--no-push",
        action="store_true",
        help="Build the trimmed dataset locally but skip pushing to the Hub.",
    )
    return parser.parse_args()


def main() -> int:
    init_logging()
    args = _parse_args()

    if not args.dry_run and not args.new_repo_id:
        logger.error("--new-repo-id is required unless --dry-run is set.")
        return 2

    logger.info("Loading source dataset %s ...", args.repo_id)
    source = LeRobotDataset(args.repo_id)
    logger.info(
        "Loaded %s: %d episodes, %d frames @ %d fps.",
        args.repo_id,
        source.num_episodes,
        source.num_frames,
        source.fps,
    )

    episode_indices = _parse_episodes(args.episodes, source.num_episodes)
    selected = episode_indices if episode_indices is not None else list(range(source.num_episodes))

    if args.dry_run:
        logger.info("Dry run: analyzing %d episodes.", len(selected))
        reports = [report_episode_trim(source, ep_idx) for ep_idx in selected]
        _print_report(reports, float(source.fps))
        return 0

    logger.info(
        "Building trimmed dataset %s from %d source episodes.",
        args.new_repo_id,
        len(selected),
    )
    new_dataset, reports = trim_episodes(source, args.new_repo_id, selected)
    _print_report(reports, float(source.fps))

    if args.no_push:
        logger.info("Skipping push (--no-push). Trimmed dataset saved locally.")
        return 0

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    logger.info("Pushing %s to the Hub (tags=%s, license=%s).", args.new_repo_id, tags, args.license)
    new_dataset.push_to_hub(license=args.license, tags=tags)
    logger.info("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
