#!/bin/bash
# Build and push the Kohya trainer Docker image to GHCR
# Usage: ./build-and-push.sh [tag]
#   Default tag: v5-ragnarok
#
# Prerequisites:
#   docker login ghcr.io -u YOUR_GITHUB_USERNAME --password YOUR_PAT
#   (PAT needs write:packages scope)

set -euo pipefail

REGISTRY="ghcr.io/g858-debug"
IMAGE_NAME="nsw-kohya-trainer"
TAG="${1:-v5-ragnarok}"
FULL_TAG="${REGISTRY}/${IMAGE_NAME}:${TAG}"

echo "Building ${FULL_TAG}..."
docker build --platform linux/amd64 -t "${FULL_TAG}" .

echo ""
echo "Pushing ${FULL_TAG}..."
docker push "${FULL_TAG}"

echo ""
echo "Done: ${FULL_TAG}"
echo ""
echo "Update KOHYA_TRAINER_IMAGE in .env.local:"
echo "  KOHYA_TRAINER_IMAGE=${FULL_TAG}"
