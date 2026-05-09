# LeRobot Data Studio - Unofficial LeRobot Dataset Editor

A web-based GUI for editing LeRobot datasets build on the LeRobot [dataset tools api](https://huggingface.co/docs/lerobot/using_dataset_tools)

*Note: This is an unofficial tool and is not affiliated with Huggingface, LeRobot or the LeRobot team.*

## Main Features
- Easily remove episodes and create new clean datasets
- Speed control and keyboard shortcuts to streamline dataset cleaning

![Dataset Editor](media/dataset_editor.png)

## Quick Start

### Step 1: Prerequisites
- [UV Python package and project manager](https://astral.sh/uv/): `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Python 3.10+ (You can use uv to install and manage python versions e.g. `uv python install 3.12`)
- Node.js 24+ (Install using nvm - see instructions below)
- A Huggingface account (free)
- [Huggingface CLI](https://huggingface.co/docs/huggingface_hub/en/guides/cli)

#### Installing Node.js with nvm

```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Reload your shell configuration
source ~/.bashrc  # or ~/.zshrc if using zsh

# Install and use Node.js 24
nvm install 24
nvm use 24

# Verify installation
node --version
```

### Step 2: Installation

```bash
git clone https://github.com/jackvial/lerobot-data-studio
cd lerobot-data-studio

# Create a virtual environment with UV
uv venv

# Activate the virtual environment
source .venv/bin/activate

# Install all packages using UV
uv sync
```

### Step 3: Install Frontend Dependencies

After completing the python installation, install frontend dependencies:

```bash
cd src/lerobot-data-studio/frontend
npm install
```

### Step 4: Running the App

Use the provided script to start both frontend and backend servers:

```bash
./run_dev.sh
```

If you are downloading or creating a dataset and want to avoid backend restarts
while editing code, run:

```bash
./run_dev.sh --no-backend-reload
```

## RLT Rollout Viewer

The studio also ships a viewer for **RLT replay buffers** — the `.pt`
files saved by the lerobot policy server when
`rlt_review_capture_enabled` / `rlt_review_archive_path` are set on a DRTC
collection run. The viewer groups transitions by episode, replays them at
real wall-clock cadence using each transition's stored `inference_ts`, and
shows the JPEG frames the policy actually saw alongside a per-action-dim
chart.

### Opening a replay buffer

Start the app normally:

```bash
./run_dev.sh
```

Open <http://localhost:3000/rlt-buffer> (or click the **Open RLT Rollout
Viewer** button on the home page). The replay-buffer path box is prefilled
with:

```text
/home/jack/code/lerobot/outputs/rlt_tinypi05v2_online/rlt_online_replay.pt
```

Click **Load** to open that file, or paste any local `.pt` replay-buffer file
or directory. If you enter a directory, the backend scans it for readable
`**/*.pt` replay buffers and dedupes files that resolve to the same path.

### What you'll see

For `/home/jack/code/lerobot/outputs/rlt_tinypi05v2_online`, useful files
include:

| File | Purpose |
| --- | --- |
| `rlt_review_archive.pt` | Append-only review archive — open this one. |
| `rlt_online_replay.pt` | Training replay buffer — also viewable but bounded by the buffer's capacity (older transitions get evicted). |
| `rlt_head_*.pt` | RLT head checkpoints — these are model weights, not replay buffers, and will be skipped with a log warning. |

Click `rlt_review_archive.pt` and pick an episode in the sidebar. Each
episode is tagged `success`, `failure`, or `open`, and an `intv` chip marks
episodes that contained a human intervention.

### Inside an episode

- **Timeline** — one tick per transition. The horizontal position is
  proportional to the stored `t_offset_s` (the wall-clock time relative to
  the first inference of the episode), so visually irregular spacing is
  honest.
- **Play / Pause / Speed** — playback advances by wall-clock: at `1.0x` the
  viewer sleeps for the real `Δt` between adjacent transitions. Lower the
  speed to slow down dense regions, raise it to skim. Press **Space** to
  play/pause.
- **Cameras** — one image per stored camera key (e.g.
  `observation.images.front`, `observation.images.wrist`). JPEGs are streamed
  on demand; nothing is decoded into memory until you scrub to a transition.
- **Action summary** — mean per action-dim across the executed chunk for
  each transition. Click a point to jump the timeline to that transition.
- **Review controls** — change an episode's outcome to `success`, `failure`,
  or `open`, and mark episodes as soft-deleted. These edits are written to a
  sidecar file next to the replay buffer, e.g.
  `rlt_online_replay.review.json`; the original `.pt` is not modified.

### Legacy / partial buffers

Buffers written before the v2 schema landed (or transitions where the JPEG
encoder lagged) still load. When `inference_ts` is missing for an episode,
the timeline falls back to even spacing and shows a small `fallback spacing`
warning chip.

## Dataset Creation
Dataset creation for filtered (AKA edited) datasets is always none destructive and will always create a new dataset and upload it to the Huggingface Hub.

### Filtered Dataset Creation
Editing/filtering a dataset creates a new dataset that only excludes the episodes that were selected in the UI.

### Merging Datasets
If you need to merge multiple datasets we recommend using the [LeRobot datasets tool CLI](https://huggingface.co/docs/lerobot/using_dataset_tools#lerobot.datasets.merge_datasets)

## Development

### Run Backend Tests

```bash
uv run pytest
```

### Run Frontend Tests

```bash
cd src/lerobot_data_studio/frontend
npm run test
```

### Contributing

Contributions are welcome!

### License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.