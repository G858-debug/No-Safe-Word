#!/bin/bash
# download-models.sh — Downloads required models on first container startup.
# Skips files that already exist (e.g. persisted on a RunPod network volume).
set -e

COMFY_DIR="${COMFY_DIR:-/comfyui}"
MODELS_DIR="${COMFY_DIR}/models"

download_model() {
    local url="$1"
    local dir="$2"
    local filename="$3"
    local dest="${MODELS_DIR}/${dir}/${filename}"

    if [ -f "$dest" ]; then
        echo "[NSW] ✓ ${filename} (exists)"
        return 0
    fi

    echo "[NSW] Downloading ${filename}..."
    mkdir -p "${MODELS_DIR}/${dir}"
    wget -q -O "${dest}.tmp" "$url"
    mv "${dest}.tmp" "$dest"
    echo "[NSW] ✓ ${filename} (downloaded)"
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
echo "[NSW] All models ready."
echo "[NSW] ========================================="
