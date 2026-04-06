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
    # Download a file directly to the network volume.
    # Usage: download_to_volume <url> <filename> <dest_dir>
    #   dest_dir defaults to /runpod-volume/models/loras/
    local url="$1"
    local filename="$2"
    local dest_dir="${3:-${VOLUME_LORAS_DIR}}"
    local dest="${dest_dir}/${filename}"

    if [ -f "$dest" ]; then
        echo "[NSW] ✓ ${filename} (volume, exists)"
        return 0
    fi

    if [ ! -d "${dest_dir}" ]; then
        mkdir -p "${dest_dir}" 2>/dev/null || {
            echo "[NSW] Volume dir not writable — skipping ${filename}"
            return 0
        }
    fi

    echo "[NSW] Downloading ${filename} to volume..."
    local tmp_path="${dest}.tmp"
    local attempt=1
    while [ $attempt -le 3 ]; do
        if python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${url}')
    req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    resp = urllib.request.urlopen(req, timeout=900)
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

    echo "[NSW] ✗✗ ${filename} FAILED after 3 attempts — will be missing from pipeline"
    FAILED=$((FAILED + 1))
    return 1
}

echo "[NSW] ========================================="
echo "[NSW] Checking models (Juggernaut Ragnarok pipeline)..."
echo "[NSW] ========================================="

# Log to network volume for remote diagnostics
NSW_LOG="/runpod-volume/nsw-download.log"
if [ -d "/runpod-volume" ]; then
    exec > >(tee -a "$NSW_LOG") 2>&1
    echo ""
    echo "[NSW] === Download run at $(date -u) ==="
fi

# ---- One-time model cleanup ----
# Deletes stale model files from the network volume to free disk space.
# Safe to re-run: rm -f is a no-op if the file is already gone.

VOLUME_MODELS="${VOLUME_LORAS_DIR%/loras}"  # /runpod-volume/models

echo "[NSW] Cleaning up old model files..."

# Checkpoints dir: keep only Juggernaut Ragnarok
if [ -d "${VOLUME_MODELS}/checkpoints" ]; then
  for ckpt_file in "${VOLUME_MODELS}/checkpoints/"*.safetensors "${VOLUME_MODELS}/checkpoints/"*.ckpt; do
    [ -f "$ckpt_file" ] || continue
    ckpt_name=$(basename "$ckpt_file")
    case "$ckpt_name" in
      Juggernaut-Ragnarok.safetensors)
        ;; # keep — inference checkpoint
      sd_xl_base_1.0.safetensors)
        ;; # keep — LoRA training base
      *)
        echo "[NSW] Removing old checkpoint: $ckpt_name"
        rm -f "$ckpt_file"
        ;;
    esac
  done
  echo "[NSW] ✓ Old checkpoints cleaned (kept Juggernaut-Ragnarok, sd_xl_base_1.0)"
fi

# SAM segmentation models (used by FaceDetailer, no longer needed)
if [ -d "${VOLUME_MODELS}/sams" ]; then
  rm -rf "${VOLUME_MODELS}/sams"
  echo "[NSW] ✓ Cleared sams/ (SAM segmentation removed)"
fi

# IPAdapter models (no longer used)
if [ -d "${VOLUME_MODELS}/ipadapter" ]; then
  rm -rf "${VOLUME_MODELS}/ipadapter"
  echo "[NSW] ✓ Cleared ipadapter/ (IPAdapter models removed)"
fi

# LoRAs: Juggernaut Ragnarok uses NO style LoRAs.
# Only character LoRAs (in characters/ subdirectory) are kept.
# Remove all old Pony style LoRAs from the root loras/ directory.
PONY_STYLE_LORAS=(
  "pony-ebony-skin.safetensors"
  "pony-skin-tone-slider.safetensors"
  "pony-hourglass-body.safetensors"
  "perfect-breasts-v2.safetensors"
  "pony-realism-stable-yogi.safetensors"
  "pony-detail-slider.safetensors"
)

if [ -d "${VOLUME_LORAS_DIR}" ]; then
  for lora_name in "${PONY_STYLE_LORAS[@]}"; do
    if [ -f "${VOLUME_LORAS_DIR}/${lora_name}" ]; then
      echo "[NSW] Removing Pony style LoRA: ${lora_name}"
      rm -f "${VOLUME_LORAS_DIR}/${lora_name}"
    fi
  done
  echo "[NSW] ✓ Pony style LoRAs removed (Ragnarok uses no style LoRAs)"
fi

echo "[NSW] Cleanup complete."
echo "[NSW] ========================================="

# ---- Juggernaut XL Ragnarok checkpoint (inference) ----
# HuggingFace: RunDiffusion/Juggernaut-XL-v9
RAGNAROK_CKPT_DEST="${VOLUME_MODELS}/checkpoints/Juggernaut-Ragnarok.safetensors"
RAGNAROK_URL="https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"
if [ -f "$RAGNAROK_CKPT_DEST" ]; then
    echo "[NSW] ✓ Juggernaut-Ragnarok.safetensors (exists)"
elif [ -d "${VOLUME_MODELS}/checkpoints" ]; then
    echo "[NSW] Downloading Juggernaut-Ragnarok.safetensors (~6.5GB)..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${RAGNAROK_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=900)
    with open('${RAGNAROK_CKPT_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${RAGNAROK_CKPT_DEST}.tmp" "${RAGNAROK_CKPT_DEST}" || \
    { rm -f "${RAGNAROK_CKPT_DEST}.tmp"; echo "[NSW] ERROR: Juggernaut Ragnarok download failed"; }
    # Sanity check: SDXL checkpoints are typically 6-7GB
    if [ -f "$RAGNAROK_CKPT_DEST" ]; then
        CKPT_SIZE=$(stat -c%s "${RAGNAROK_CKPT_DEST}" 2>/dev/null || stat -f%z "${RAGNAROK_CKPT_DEST}" 2>/dev/null || echo 0)
        if [ "$CKPT_SIZE" -lt 2000000000 ]; then
            echo "[NSW] ERROR: Juggernaut Ragnarok file too small (${CKPT_SIZE} bytes) — likely a redirect/error page"
            rm -f "${RAGNAROK_CKPT_DEST}"
        else
            echo "[NSW] ✓ Juggernaut-Ragnarok.safetensors downloaded ($(( CKPT_SIZE / 1024 / 1024 ))MB)"
        fi
    fi
fi

# ---- 4x NMKD Siax upscaler ----
UPSCALE_DIR="${VOLUME_MODELS}/upscale_models"
mkdir -p "${UPSCALE_DIR}" 2>/dev/null
download_to_volume \
    "https://huggingface.co/gemasai/4x_NMKD-Siax_200k/resolve/main/4x_NMKD-Siax_200k.pth" \
    "4x_NMKD-Siax_200k.pth" \
    "${UPSCALE_DIR}"

# ---- Hourglass Body Shape v2 SDXL LoRA (female body proportions) ----
# CivitAI model 129130, version 911708
# Used during portrait and dataset generation for female characters only.
# NOT used at scene inference time — the trained character LoRA carries the proportions.
HOURGLASS_URL="https://civitai.com/api/download/models/911708"
[ -n "${CIVITAI_API_KEY:-}" ] && HOURGLASS_URL="${HOURGLASS_URL}?token=${CIVITAI_API_KEY}"
download_to_volume \
    "${HOURGLASS_URL}" \
    "hourglassv2_SDXL.safetensors" \
    "${VOLUME_LORAS_DIR}"

# Character LoRAs are downloaded on-demand per-job by the handler (handler_wrapper.py).

echo "[NSW] ========================================="
if [ $FAILED -gt 0 ]; then
    echo "[NSW] WARNING: ${FAILED} model(s) failed to download."
    echo "[NSW] ComfyUI will start but some features may not work."
else
    echo "[NSW] All models ready."
fi
echo "[NSW] ========================================="
