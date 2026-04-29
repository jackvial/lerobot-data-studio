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