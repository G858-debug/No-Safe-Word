#!/bin/bash
# download-models.sh — Downloads required models on first container startup.
# Skips files that already exist (e.g. persisted on a RunPod network volume).
# Retries failed downloads up to 3 times. Continues past failures so all
# models get a chance to download even if one source is temporarily down.
# Uses Python urllib (not wget) to avoid wget's redirect URL-decoding bug
# that breaks AWS S3 signatures for files with spaces in their names.

COMFY_DIR="${COMFY_DIR:-/comfyui}"
MODELS_DIR="${COMFY_DIR}/models"
FAILED=0

download_model() {
    local url="$1"
    local dir="$2"
    local filename="$3"
    local max_retries=3
    local dest="${MODELS_DIR}/${dir}/${filename}"

    if [ -f "$dest" ]; then
        echo "[NSW] ✓ ${filename} (exists)"
        return 0
    fi

    mkdir -p "${MODELS_DIR}/${dir}"

    local attempt=1
    while [ $attempt -le $max_retries ]; do
        echo "[NSW] Downloading ${filename} (attempt ${attempt}/${max_retries})..."
        if python3 -c "
import urllib.request, sys
try:
    urllib.request.urlretrieve('${url}', '${dest}.tmp')
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1; then
            mv "${dest}.tmp" "$dest"
            echo "[NSW] ✓ ${filename} (downloaded)"
            return 0
        fi
        rm -f "${dest}.tmp"
        echo "[NSW] ✗ ${filename} attempt ${attempt} failed"
        attempt=$((attempt + 1))
        [ $attempt -le $max_retries ] && sleep 5
    done

    echo "[NSW] ✗✗ ${filename} FAILED after ${max_retries} attempts"
    FAILED=$((FAILED + 1))
    return 1
}

echo "[NSW] ========================================="
echo "[NSW] Checking models..."
echo "[NSW] ========================================="

# Juggernaut X v10 — SDXL photorealistic checkpoint
download_model \
    "https://huggingface.co/RunDiffusion/Juggernaut-X-v10/resolve/main/Juggernaut-X-RunDiffusion-NSFW.safetensors" \
    "checkpoints" \
    "juggernaut-x-v10.safetensors"

# detail-tweaker-xl — LoRA for fine detail enhancement
download_model \
    "https://huggingface.co/LyliaEngine/add-detail-xl/resolve/main/add-detail-xl.safetensors" \
    "loras" \
    "detail-tweaker-xl.safetensors"

# realistic-skin-xl — Skin Texture Style v4 by EauDeNoire (photorealistic skin pores/texture)
# Mirror from ford442/sdxl-vae-bf16 — original MarkBW/detailed-skin-xl has intermittent CDN auth issues
download_model \
    "https://huggingface.co/ford442/sdxl-vae-bf16/resolve/main/LoRA/skin_texture_style_v4.safetensors" \
    "loras" \
    "realistic-skin-xl.safetensors"

# eyes-detail-xl — DetailedEyes v3 by bdsqlsz (better eyes and gaze accuracy)
download_model \
    "https://huggingface.co/ffxvs/lora-effects-xl/resolve/main/detailedEyes_v3.safetensors" \
    "loras" \
    "eyes-detail-xl.safetensors"

# negative-hands-v2 — Hands XL v2.1 by EauDeNoire (reduce hand artifacts)
download_model \
    "https://huggingface.co/ffxvs/lora-effects-xl/resolve/main/hands_xl_v21.safetensors" \
    "loras" \
    "negative-hands-v2.safetensors"

# cinematic-lighting-xl — Cinematic lighting slider (subtle lighting enhancement)
download_model \
    "https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cinematic-lighting/resolve/main/cinematic%20lighting.safetensors" \
    "loras" \
    "cinematic-lighting-xl.safetensors"

# YOLO face detection — used by UltralyticsDetectorProvider / FaceDetailer
download_model \
    "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt" \
    "ultralytics/bbox" \
    "face_yolov8m.pt"

# SAM ViT-B — Segment Anything Model for face masking
download_model \
    "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth" \
    "sams" \
    "sam_vit_b_01ec64.pth"

echo "[NSW] ========================================="
if [ $FAILED -gt 0 ]; then
    echo "[NSW] WARNING: ${FAILED} model(s) failed to download."
    echo "[NSW] ComfyUI will start but some features may not work."
else
    echo "[NSW] All models ready."
fi
echo "[NSW] ========================================="
