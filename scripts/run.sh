#!/usr/bin/env bash
#
# run.sh - Convenience wrapper to run the Discord bot using docker run.
#
# This script:
#   - Loads DISCORD_* variables from .env (if present)
#   - Builds the image if --build is passed
#   - Runs the container with the required environment variables
#
# Usage examples (run from the dbot/ directory or anywhere):
#   ./scripts/run.sh
#   ./scripts/run.sh --build
#   ./scripts/run.sh --build -d          # detached
#   IMAGE_NAME=my-bot ./scripts/run.sh
#
# Make sure you have copied .env.example → .env and filled in the values.

set -euo pipefail

# Resolve paths relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

# Configurable via environment
IMAGE_NAME="${IMAGE_NAME:-local-dbot}"
CONTAINER_NAME="${CONTAINER_NAME:-emby-history-transfer-bot}"

# Load .env if it exists (exports the variables for docker run)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Validate required variables
if [[ -z "${DISCORD_TOKEN:-}" ]]; then
  echo "❌ Error: DISCORD_TOKEN is not set."
  echo "   Copy .env.example to .env and add your bot token."
  exit 1
fi

if [[ -z "${DISCORD_CLIENT_ID:-}" ]]; then
  echo "❌ Error: DISCORD_CLIENT_ID is not set."
  echo "   Add your Discord application client ID to .env"
  exit 1
fi

# Parse simple flags
BUILD=0
DETACH=""
DOCKER_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)
      BUILD=1
      shift
      ;;
    -d|--detach)
      DETACH="-d"
      shift
      ;;
    --rm)
      # We always use --rm for docker run in this script
      shift
      ;;
    *)
      DOCKER_ARGS+=("$1")
      shift
      ;;
  esac
done

# Optional build step
if [[ $BUILD -eq 1 ]]; then
  echo "==> Building Docker image ($IMAGE_NAME) from Dockerfile.bot..."
  docker build -f Dockerfile.bot -t "$IMAGE_NAME" .
  echo
fi

echo "==> Starting Discord bot container..."

echo "    Image:   $IMAGE_NAME"

echo "    Name:    $CONTAINER_NAME"

echo "    Token:   ${DISCORD_TOKEN:0:10}... (truncated)"

echo

# Run the container
# We always pass the three main env vars explicitly (in case .env had extras)
exec docker run \
  --rm \
  --name "$CONTAINER_NAME" \
  $DETACH \
  -e DISCORD_TOKEN \
  -e DISCORD_CLIENT_ID \
  -e DISCORD_GUILD_ID="${DISCORD_GUILD_ID:-}" \
  "${DOCKER_ARGS[@]}" \
  "$IMAGE_NAME"
