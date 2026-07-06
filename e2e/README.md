# End-to-end tests

Drives the real app (backend + frontend + headless Chrome) through the main
workflows, verifies results on the HuggingFace Hub and on disk, and records
every scenario as screenshots and a stitched video.

## Scenarios

| # | Flow | Verified against |
|---|------|------------------|
| A | Load `jackvial/so101_pickplace_failrecv20_0`, select the **odd** episodes (1,3,…,19), create a new dataset | Hub upload (files + episode count) **and** on-disk structure |
| B | Load a local dataset (`jackvial/so101_cube_wristscene_motortest0`), select the **even** episodes (0,2,4), create a new dataset | On-disk structure |
| C | Seeking & playback: slow scrub across the timeline, discrete seeks to 25/50/75%, Play/Pause/Stop | Video `currentTime` lands at each seek target; **the displayed video frame actually changes** (pixel-sampled from the `<video>` element); the chart playhead x-position tracks the seeks; time label follows drag, playback, pause, and stop |

The on-disk validator (`validate_dataset.py`) checks for the indexing bugs
that matter: target episodes re-indexed 0..N-1 with no duplicates, contiguous
`dataset_from_index`/`dataset_to_index` and global `index` columns,
per-episode `frame_index` restarting at 0, **content fingerprints proving each
target episode is exactly its selected source episode** (catches duplicated or
mis-mapped episodes), and video slice metadata consistent with episode
lengths (`(to - from) * fps ≈ length`) with all referenced mp4 files present.

## Requirements

- `uv` with the project venv (backend + validators)
- `npm install` done in `src/lerobot_data_studio/frontend`
- `npm install` done in `e2e/`
- Google Chrome (`/usr/bin/google-chrome`, override with `E2E_CHROME`)
- `ffmpeg` on PATH (for the videos)
- Logged in to HuggingFace (`huggingface-cli login`) — scenario A pushes a
  dataset to your account

## Run

```bash
cd e2e && npm install && cd ..
node e2e/run.mjs
```

Uses its own ports (backend 8300, vite 3100, Chrome CDP 9224) so a normal dev
setup on 8000/3000 can stay running.

Artifacts land in `e2e/artifacts/<run-timestamp>/`:

- `screenshots/` — numbered milestone screenshots per scenario (including one
  per seek stop in scenario C, so the changing video frames are reviewable)
- `videos/` — one mp4 per scenario, the full session (scenario C records at
  4 frames/second so the scrubbing reads clearly)
- `frames/` — raw frames (kept if ffmpeg is missing)

## Cleanup

The datasets the test creates (hub repos `<you>/e2e-odd-episodes-*` /
`<you>/e2e-even-episodes-*` and their local copies) are **deleted after the
run**. Set `E2E_KEEP_ARTIFACTS=1` to keep them for inspection. Screenshots and
videos are always kept.
