#!/bin/bash
# Build and push the Kohya trainer Docker image to GHCR
# Usage: ./build-and-push.sh [tag]
#
# Prerequisites:
#   docker login ghcr.io -u YOUR_GITHUB_USERNAME --password YOUR_PAT

set -euo pipefail

REGISTRY="ghcr.io/g858-debug"
IMAGE_NAME="nsw-kohya-trainer"
TAG="${1:-latest}"
FULL_TAG="${REGISTRY}/${IMAGE_NAME}:${TAG}"

echo "Building ${FULL_TAG}..."
docker build --platform linux/amd64 -t "${FULL_TAG}" .

echo ""
echo "Pushing ${FULL_TAG}..."
docker push "${FULL_TAG}"

echo ""
echo "Done: ${FULL_TAG}"
