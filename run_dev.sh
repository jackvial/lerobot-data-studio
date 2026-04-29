#!/bin/bash

set -euo pipefail

# Skip Git LFS downloads (we don't need test artifacts)
export GIT_LFS_SKIP_SMUDGE=1

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting LeRobot Data Studio...${NC}"

BACKEND_RELOAD=true

while (($# > 0)); do
    case "$1" in
        --no-backend-reload)
            BACKEND_RELOAD=false
            ;;
        --backend-reload)
            BACKEND_RELOAD=true
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            echo "Usage: ./run_dev.sh [--no-backend-reload]"
            exit 1
            ;;
    esac
    shift
done

cleanup() {
    local exit_code=$?
    trap - INT TERM EXIT

    echo -e "\n${BLUE}Shutting down servers...${NC}"

    if [[ -n "${BACKEND_PID:-}" ]]; then
        kill "${BACKEND_PID}" 2>/dev/null || true
    fi

    if [[ -n "${FRONTEND_PID:-}" ]]; then
        kill "${FRONTEND_PID}" 2>/dev/null || true
    fi

    # Also clean up any direct child processes the script launched.
    pkill -P $$ 2>/dev/null || true
    wait 2>/dev/null || true

    exit "${exit_code}"
}

trap cleanup INT TERM EXIT

# Start backend server
if [[ "${BACKEND_RELOAD}" == "true" ]]; then
    echo -e "${GREEN}Starting backend server with auto-reload...${NC}"
    uv run uvicorn lerobot_data_studio.backend.main:app --reload --host 0.0.0.0 --port 8000 &
else
    echo -e "${GREEN}Starting backend server without auto-reload...${NC}"
    uv run uvicorn lerobot_data_studio.backend.main:app --host 0.0.0.0 --port 8000 &
fi
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 2

# Start frontend server
echo -e "${GREEN}Starting frontend server...${NC}"
cd src/lerobot_data_studio/frontend
npm run dev &
FRONTEND_PID=$!
cd ../../..

echo -e "${GREEN}LeRobot Data Studio is running!${NC}"
echo -e "${BLUE}Backend API: http://localhost:8000${NC}"
echo -e "${BLUE}Frontend UI: http://localhost:3000${NC}"
if [[ "${BACKEND_RELOAD}" == "false" ]]; then
    echo -e "${BLUE}Backend reload is disabled for this session.${NC}"
fi
echo -e "${RED}Press Ctrl+C to stop all servers${NC}"

# Wait for both processes
wait "$BACKEND_PID" "$FRONTEND_PID"