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

# Test PuLID import at startup (runs with CUDA available on RunPod).
# Output goes to /tmp/pulid_import.log for diagnostic jobs to read.
python3 - <<'PYEOF' > /tmp/pulid_import.log 2>&1
import sys
sys.path.insert(0, '/comfyui')
try:
    import folder_paths
    from custom_nodes.ComfyUI_PuLID_Flux_ll import pulidflux
    print("SUCCESS nodes:", list(pulidflux.NODE_CLASS_MAPPINGS.keys()))
except Exception as e:
    import traceback
    print("FAILED:", e)
    traceback.print_exc()
PYEOF
echo "[NSW] PuLID import test: $(head -1 /tmp/pulid_import.log)"

exec /start-original.sh "$@"
