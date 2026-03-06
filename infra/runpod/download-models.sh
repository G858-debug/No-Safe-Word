#!/bin/bash
# download-models.sh — Downloads required models on first container startup.
# Skips files that already exist (e.g. persisted on a RunPod network volume).
# Retries failed downloads up to 3 times. Continues past failures so all
# models get a chance to download even if one source is temporarily down.
# Uses Python urllib (not wget) to avoid wget's redirect URL-decoding bug
# that breaks AWS S3 signatures for files with spaces in their names.

COMFY_DIR="${COMFY_DIR:-/comfyui}"
MODELS_DIR="${COMFY_DIR}/models"
VOLUME_LORAS_DIR="/runpod-volume/models/loras"
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
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${url}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=600)
    with open('${dest}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
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

download_to_volume() {
    # Download a file directly to the network volume (/runpod-volume/models/loras/).
    # Files here persist across container restarts.
    # Usage: download_to_volume <civitai_version_id> <filename> [<token>]
    local version_id="$1"
    local filename="$2"
    local token="${3:-${CIVITAI_API_KEY:-}}"
    local dest="${VOLUME_LORAS_DIR}/${filename}"

    if [ -f "$dest" ]; then
        echo "[NSW] ✓ ${filename} (volume, exists)"
        return 0
    fi

    if [ ! -d "${VOLUME_LORAS_DIR}" ]; then
        echo "[NSW] Volume loras dir not mounted — skipping ${filename}"
        return 0
    fi

    local url="https://civitai.com/api/download/models/${version_id}"
    [ -n "$token" ] && url="${url}?token=${token}"

    echo "[NSW] Downloading ${filename} to volume..."
    local tmp_path="${dest}.tmp"
    local attempt=1
    while [ $attempt -le 3 ]; do
        if python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${url}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=600)
    with open('${tmp_path}', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1; then
            mv "${tmp_path}" "$dest"
            echo "[NSW] ✓ ${filename} (volume, downloaded)"
            return 0
        fi
        rm -f "${tmp_path}"
        echo "[NSW] ✗ ${filename} attempt ${attempt} failed"
        attempt=$((attempt + 1))
        [ $attempt -le 3 ] && sleep 5
    done

    echo "[NSW] ✗✗ ${filename} FAILED — will be missing from pipeline"
    return 0  # non-fatal: LoRA is optional, pipeline skips uninstalled LoRAs
}

echo "[NSW] ========================================="
echo "[NSW] Checking models..."
echo "[NSW] ========================================="

# ---- One-time SDXL model cleanup ----
# Deletes SDXL-only model files from the network volume to free ~20GB.
# Safe to re-run: rm -f is a no-op if the file is already gone.
# Kontext/Flux uses diffusion_models/, clip/, vae/ — not checkpoints/.

VOLUME_MODELS="${VOLUME_LORAS_DIR%/loras}"  # /runpod-volume/models

echo "[NSW] Cleaning up SDXL model files..."

# Checkpoints dir: SDXL only (Juggernaut XL, RealVisXL, Lustify). Flux uses diffusion_models/.
if [ -d "${VOLUME_MODELS}/checkpoints" ]; then
  rm -f "${VOLUME_MODELS}/checkpoints/"*.safetensors
  rm -f "${VOLUME_MODELS}/checkpoints/"*.ckpt
  echo "[NSW] ✓ Cleared checkpoints/ (SDXL checkpoints removed)"
fi

# FaceDetailer / YOLO detection models (no longer used with Kontext)
if [ -d "${VOLUME_MODELS}/ultralytics" ]; then
  rm -rf "${VOLUME_MODELS}/ultralytics"
  echo "[NSW] ✓ Cleared ultralytics/ (YOLO face/person detection removed)"
fi

# SAM segmentation models (used by FaceDetailer, no longer needed)
if [ -d "${VOLUME_MODELS}/sams" ]; then
  rm -rf "${VOLUME_MODELS}/sams"
  echo "[NSW] ✓ Cleared sams/ (SAM segmentation removed)"
fi

# CLIP Vision (used by IPAdapter, no longer needed)
if [ -d "${VOLUME_MODELS}/clip_vision" ]; then
  rm -rf "${VOLUME_MODELS}/clip_vision"
  echo "[NSW] ✓ Cleared clip_vision/ (IPAdapter CLIP Vision removed)"
fi

# IPAdapter models (no longer used)
if [ -d "${VOLUME_MODELS}/ipadapter" ]; then
  rm -rf "${VOLUME_MODELS}/ipadapter"
  echo "[NSW] ✓ Cleared ipadapter/ (IPAdapter models removed)"
fi

# SDXL LoRAs from /runpod-volume/models/loras/ — delete all non-Kontext LoRAs
# Keep: flux_realism_lora, flux-add-details, fc-flux-perfect-busts, hourglassv32_FLUX,
#        flux-two-people-kissing, flux_lustly-ai_v1, boudoir-style-flux,
#        flux-fashion-editorial, flux-oiled-skin, flux-sweat-v2, flux-beauty-skin,
#        characters/ (trained character LoRAs)
KEEP_LORAS=(
  "flux_realism_lora.safetensors"
  "flux-add-details.safetensors"
  "fc-flux-perfect-busts.safetensors"
  "hourglassv32_FLUX.safetensors"
  "flux-two-people-kissing.safetensors"
  "flux_lustly-ai_v1.safetensors"
  "boudoir-style-flux.safetensors"
  "flux-fashion-editorial.safetensors"
  "flux-oiled-skin.safetensors"
  "flux-sweat-v2.safetensors"
  "flux-beauty-skin.safetensors"
)

if [ -d "${VOLUME_LORAS_DIR}" ]; then
  for lora_file in "${VOLUME_LORAS_DIR}"/*.safetensors; do
    [ -f "$lora_file" ] || continue
    basename_file=$(basename "$lora_file")
    keep=false
    for keep_name in "${KEEP_LORAS[@]}"; do
      if [ "$basename_file" = "$keep_name" ]; then
        keep=true
        break
      fi
    done
    if [ "$keep" = false ]; then
      echo "[NSW] Removing SDXL LoRA: $basename_file"
      rm -f "$lora_file"
    fi
  done
  echo "[NSW] ✓ SDXL LoRAs removed from loras/"
fi

echo "[NSW] SDXL cleanup complete."
echo "[NSW] ========================================="

# ---- Kontext LoRAs on persistent volume ----
# Downloaded to /runpod-volume/models/loras/ so they survive container restarts.
# Requires CIVITAI_API_KEY env var for NSFW/restricted models.
download_to_volume "1261874" "boudoir-style-flux.safetensors"
download_to_volume "2418642" "flux-fashion-editorial.safetensors"
download_to_volume "861452"  "flux-oiled-skin.safetensors"
download_to_volume "1188867" "flux-sweat-v2.safetensors"
download_to_volume "2585889" "flux-beauty-skin.safetensors"

# Kontext LoRAs — downloaded at runtime (small files, < 200MB each).
# Larger models (Flux Kontext UNET ~8GB, CLIP encoders, VAE) live on the
# network volume and are managed via scripts/download-kontext-models.mjs

echo "[NSW] ========================================="
if [ $FAILED -gt 0 ]; then
    echo "[NSW] WARNING: ${FAILED} model(s) failed to download."
    echo "[NSW] ComfyUI will start but some features may not work."
else
    echo "[NSW] All models ready."
fi
echo "[NSW] ========================================="
