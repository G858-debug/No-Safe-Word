#!/bin/bash
# start-wrapper.sh — Replaces /start.sh to download models before
# handing off to the original RunPod worker-comfyui start script.

# Move ComfyUI output + input dirs to the network volume so output
# images don't fill the container's limited local disk (~20GB, mostly
# consumed by the Docker image layers + custom nodes + InsightFace).
for DIR in output input; do
  VOLUME_DIR="/runpod-volume/comfyui-${DIR}"
  LOCAL_DIR="/comfyui/${DIR}"
  mkdir -p "${VOLUME_DIR}" 2>/dev/null
  if [ -d "${VOLUME_DIR}" ]; then
    rm -rf "${LOCAL_DIR}"
    ln -sf "${VOLUME_DIR}" "${LOCAL_DIR}"
    echo "[NSW] Symlinked /comfyui/${DIR} → ${VOLUME_DIR}"
  fi
done

/usr/local/bin/download-models.sh

exec /start-original.sh "$@"
