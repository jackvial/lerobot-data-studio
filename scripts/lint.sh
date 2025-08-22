#!/bin/bash
# Lint script for running Ruff checks

set -e

echo "🔍 Running Ruff linter..."

# Default to checking src directory
TARGET="${1:-./src}"

# Check for private member access violations
echo "Checking private member access (SLF001)..."
uv run ruff check "$TARGET" --select SLF || true

# Run full check
echo -e "\nRunning full Ruff check..."
uv run ruff check "$TARGET"

# Show statistics
echo -e "\nIssue summary:"
uv run ruff check "$TARGET" --statistics 2>/dev/null | head -10

echo -e "\n💡 To auto-fix issues, run: uv run ruff check $TARGET --fix"
echo "💡 To format code, run: uv run ruff format $TARGET"