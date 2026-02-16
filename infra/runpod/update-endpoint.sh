#!/usr/bin/env bash
#
# Update the RunPod serverless endpoint to use our custom ComfyUI Docker image.
#
# Usage:
#   RUNPOD_API_KEY=... ./update-endpoint.sh
#
# Prerequisites:
#   1. Build and push the Docker image (via GitHub Actions or manually)
#   2. Set RUNPOD_API_KEY environment variable
#
# The script updates the endpoint template to use the custom image from GHCR.
# After running, new workers will use the updated image on next cold start.

set -euo pipefail

ENDPOINT_ID="${RUNPOD_ENDPOINT_ID:-vj6jc0gd61l9ov}"
TEMPLATE_ID="${RUNPOD_TEMPLATE_ID:-b31bthjn1k}"
IMAGE_NAME="${DOCKER_IMAGE:-ghcr.io/g858-debug/nsw-comfyui-worker:latest}"

if [ -z "${RUNPOD_API_KEY:-}" ]; then
  echo "Error: RUNPOD_API_KEY not set"
  exit 1
fi

echo "Updating RunPod template ${TEMPLATE_ID} to use image: ${IMAGE_NAME}"

# Update the template's Docker image
RESULT=$(curl -s "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"mutation { saveTemplate(input: { id: \\\"${TEMPLATE_ID}\\\", name: \\\"nsw-image-gen__template__0mllfo\\\", imageName: \\\"${IMAGE_NAME}\\\", containerDiskInGb: 30, volumeInGb: 0, dockerArgs: \\\"\\\", env: [{ key: \\\"REFRESH_WORKER\\\", value: \\\"true\\\" }] }) { id imageName } }\"
  }")

echo "Response: ${RESULT}"

# Verify the update
echo ""
echo "Verifying endpoint configuration..."
curl -s "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"{ myself { endpoints { id name template { id name imageName containerDiskInGb } } } }\"}" | python3 -m json.tool

echo ""
echo "Done. New workers will use the updated image on next cold start."
echo "To force all workers to restart, scale to 0 and back up via the RunPod console."
