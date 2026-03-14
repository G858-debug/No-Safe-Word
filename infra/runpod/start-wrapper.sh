#!/bin/bash
# start-wrapper.sh — Replaces /start.sh to download models before
# handing off to the original RunPod worker-comfyui start script.

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
