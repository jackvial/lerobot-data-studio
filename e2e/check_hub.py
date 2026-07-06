"""Verify (and optionally clean up) a dataset repo on the HuggingFace Hub.

Usage:
    uv run python e2e/check_hub.py --repo-id ns/name --expect-episodes 10
    uv run python e2e/check_hub.py --repo-id ns/name --delete
"""

import argparse
import json
import sys

from huggingface_hub import HfApi, hf_hub_download


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--expect-episodes", type=int, default=None)
    parser.add_argument("--delete", action="store_true", help="delete the repo instead of checking")
    args = parser.parse_args()

    api = HfApi()

    if args.delete:
        api.delete_repo(args.repo_id, repo_type="dataset")
        print(f"Deleted hub repo {args.repo_id}")
        return 0

    info = api.dataset_info(args.repo_id)
    files = api.list_repo_files(args.repo_id, repo_type="dataset")
    print(f"Hub repo {args.repo_id}: {len(files)} files, sha {info.sha[:10]}")

    failures = []

    def check(condition, message):
        print(f"  {'PASS' if condition else 'FAIL'}  {message}")
        if not condition:
            failures.append(message)

    check("meta/info.json" in files, "meta/info.json uploaded")
    check(any(f.startswith("data/") and f.endswith(".parquet") for f in files),
          "at least one data parquet uploaded")
    check(any(f.startswith("meta/episodes/") and f.endswith(".parquet") for f in files),
          "episodes metadata uploaded")
    check(any(f.startswith("videos/") and f.endswith(".mp4") for f in files),
          "at least one video uploaded")

    if args.expect_episodes is not None:
        info_path = hf_hub_download(args.repo_id, "meta/info.json", repo_type="dataset")
        with open(info_path) as f:
            remote_info = json.load(f)
        check(remote_info.get("total_episodes") == args.expect_episodes,
              f"remote total_episodes == {args.expect_episodes}")

    if failures:
        print(f"RESULT: FAIL ({len(failures)})")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
