#!/bin/bash
# start-wrapper.sh — Replaces /start.sh to download models before
# handing off to the original RunPod worker-comfyui start script.

/usr/local/bin/download-models.sh

exec /start-original.sh "$@"
