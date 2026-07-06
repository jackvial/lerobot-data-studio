"""Structural validation of a dataset created by LeRobot Data Studio.

Compares a target dataset on disk against the source dataset it was derived
from, given the list of source episodes that were selected. Catches indexing
bugs: duplicated episodes, wrong episode mapping, non-contiguous global
indices, broken video slice metadata, and frame-count mismatches.

Usage:
    uv run python e2e/validate_dataset.py \
        --source-root ~/.cache/huggingface/lerobot/ns/source \
        --target-root ~/.cache/huggingface/lerobot/ns/target \
        --selected 1,3,5,7
"""

import argparse
import glob
import json
import os
import sys

import numpy as np
import pandas as pd

FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  PASS  {message}")
    else:
        print(f"  FAIL  {message}")
        FAILURES.append(message)


def load_concat_parquet(root: str, pattern: str) -> pd.DataFrame:
    paths = sorted(glob.glob(os.path.join(root, pattern)))
    if not paths:
        raise FileNotFoundError(f"No parquet files matching {pattern} under {root}")
    return pd.concat([pd.read_parquet(p) for p in paths], ignore_index=True)


def episode_fingerprint(data: pd.DataFrame, episode_index: int) -> dict:
    """Content fingerprint of an episode: values at first/middle/last frames."""
    rows = data[data["episode_index"] == episode_index].sort_values("frame_index")
    picks = [0, len(rows) // 2, len(rows) - 1]
    return {
        "length": len(rows),
        "action": np.stack([np.asarray(rows.iloc[i]["action"]) for i in picks]),
        "state": np.stack([np.asarray(rows.iloc[i]["observation.state"]) for i in picks]),
        "timestamps": np.array([rows.iloc[i]["timestamp"] for i in picks]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--target-root", required=True)
    parser.add_argument("--selected", required=True, help="comma-separated source episode indices")
    args = parser.parse_args()

    source_root = os.path.expanduser(args.source_root)
    target_root = os.path.expanduser(args.target_root)
    selected = [int(x) for x in args.selected.split(",") if x != ""]

    print(f"Validating {target_root}")
    print(f"  (episodes {selected} of {source_root})")

    with open(os.path.join(source_root, "meta/info.json")) as f:
        source_info = json.load(f)
    with open(os.path.join(target_root, "meta/info.json")) as f:
        target_info = json.load(f)

    source_data = load_concat_parquet(source_root, "data/chunk-*/file-*.parquet")
    target_data = load_concat_parquet(target_root, "data/chunk-*/file-*.parquet")
    source_eps = load_concat_parquet(source_root, "meta/episodes/chunk-*/file-*.parquet")
    target_eps = load_concat_parquet(target_root, "meta/episodes/chunk-*/file-*.parquet")

    n = len(selected)
    source_lengths = {
        int(row["episode_index"]): int(row["length"]) for _, row in source_eps.iterrows()
    }
    expected_frames = sum(source_lengths[ep] for ep in selected)

    print("\n[info.json]")
    check(target_info.get("codebase_version") == source_info.get("codebase_version"),
          f"codebase_version matches source ({source_info.get('codebase_version')})")
    check(target_info["total_episodes"] == n, f"total_episodes == {n}")
    check(target_info["total_frames"] == expected_frames, f"total_frames == {expected_frames}")
    check(target_info["fps"] == source_info["fps"], "fps matches source")

    print("\n[episodes metadata]")
    ep_indices = sorted(target_eps["episode_index"].tolist())
    check(ep_indices == list(range(n)), f"episode_index re-indexed to 0..{n - 1} with no gaps")
    check(len(set(ep_indices)) == len(ep_indices), "no duplicated episode_index values")

    target_eps_sorted = target_eps.sort_values("episode_index").reset_index(drop=True)
    expected_from = 0
    contiguous = True
    for _, row in target_eps_sorted.iterrows():
        if int(row["dataset_from_index"]) != expected_from:
            contiguous = False
        if int(row["dataset_to_index"]) - int(row["dataset_from_index"]) != int(row["length"]):
            contiguous = False
        expected_from = int(row["dataset_to_index"])
    check(contiguous, "dataset_from_index/dataset_to_index are contiguous and match lengths")
    check(expected_from == expected_frames, "final dataset_to_index equals total_frames")

    lengths_match = [
        int(target_eps_sorted.iloc[i]["length"]) == source_lengths[selected[i]] for i in range(n)
    ]
    check(all(lengths_match),
          "per-episode frame counts match the selected source episodes, in order")

    print("\n[data parquet]")
    global_index = sorted(target_data["index"].tolist())
    check(global_index == list(range(expected_frames)),
          "global 'index' column is contiguous 0..total_frames-1 (no dupes/gaps)")
    for i in range(n):
        rows = target_data[target_data["episode_index"] == i].sort_values("frame_index")
        if list(rows["frame_index"]) != list(range(len(rows))):
            check(False, f"episode {i}: frame_index contiguous from 0")
            break
    else:
        check(True, "frame_index restarts at 0 and is contiguous within every episode")

    print("\n[content mapping] (catches duplicated/mis-mapped episodes)")
    all_ok = True
    for i in range(n):
        src_fp = episode_fingerprint(source_data, selected[i])
        tgt_fp = episode_fingerprint(target_data, i)
        ok = (
            src_fp["length"] == tgt_fp["length"]
            and np.allclose(src_fp["action"], tgt_fp["action"], atol=1e-5)
            and np.allclose(src_fp["state"], tgt_fp["state"], atol=1e-5)
            and np.allclose(src_fp["timestamps"], tgt_fp["timestamps"], atol=1e-3)
        )
        if not ok:
            all_ok = False
            check(False, f"target episode {i} content matches source episode {selected[i]}")
    check(all_ok, f"all {n} target episodes match their expected source episodes exactly")

    # If the mapping holds and the selected source episodes are distinct, no
    # target episode can be a duplicate of another. Double-check anyway.
    fps_seen = {}
    dup_free = True
    for i in range(n):
        fp = episode_fingerprint(target_data, i)
        key = (fp["length"], fp["action"].tobytes())
        if key in fps_seen:
            dup_free = False
            check(False, f"episode {i} duplicates episode {fps_seen[key]}")
        fps_seen[key] = i
    check(dup_free, "no two target episodes have identical content")

    print("\n[videos]")
    video_keys = [k for k in target_info.get("features", {}) if k.startswith("observation.images.")]
    fps = target_info["fps"]
    for key in video_keys:
        col_from = f"videos/{key}/from_timestamp"
        col_to = f"videos/{key}/to_timestamp"
        if col_from not in target_eps.columns:
            check(False, f"{key}: slice timestamp columns present in episodes metadata")
            continue
        slices_ok = True
        files_ok = True
        for _, row in target_eps_sorted.iterrows():
            frm, to = float(row[col_from]), float(row[col_to])
            duration_frames = (to - frm) * fps
            if not (to > frm and abs(duration_frames - int(row["length"])) <= 2):
                slices_ok = False
            chunk = int(row[f"videos/{key}/chunk_index"])
            file_idx = int(row[f"videos/{key}/file_index"])
            path = os.path.join(
                target_root, f"videos/{key}/chunk-{chunk:03d}/file-{file_idx:03d}.mp4"
            )
            if not os.path.exists(path):
                files_ok = False
        check(slices_ok, f"{key}: every episode's video slice duration ≈ length/fps")
        check(files_ok, f"{key}: every referenced video file exists on disk")

    print()
    if FAILURES:
        print(f"RESULT: FAIL ({len(FAILURES)} checks failed)")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
