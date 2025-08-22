#!/bin/bash

# Exit on error
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting LeRobot Data Studio...${NC}"

# Function to cleanup on exit
cleanup() {
    echo -e "\n${BLUE}Shutting down servers...${NC}"
    # Kill all child processes
    pkill -P $$ || true
    exit
}

# Set up trap to cleanup on Ctrl+C
trap cleanup INT TERM

# Start backend server
echo -e "${GREEN}Starting backend server...${NC}"
uv run uvicorn lerobot_data_studio.backend.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 2

# Start frontend server
echo -e "${GREEN}Starting frontend server...${NC}"
cd src/lerobot_data_studio/frontend
npm run build && npm run dev &
FRONTEND_PID=$!
cd ../../..

echo -e "${GREEN}LeRobot Data Studio is running!${NC}"
echo -e "${BLUE}Backend API: http://localhost:8000${NC}"
echo -e "${BLUE}Frontend UI: http://localhost:3000${NC}"
echo -e "${RED}Press Ctrl+C to stop all servers${NC}"

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID 