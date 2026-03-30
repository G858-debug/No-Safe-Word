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
    req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
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

    echo "[NSW] ✗✗ ${filename} FAILED after 3 attempts — will be missing from pipeline"
    FAILED=$((FAILED + 1))
    return 1
}

echo "[NSW] ========================================="
echo "[NSW] Checking models..."
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

echo "[NSW] Cleaning up SDXL model files..."

# Checkpoints dir: remove old SDXL checkpoints but keep active ones
if [ -d "${VOLUME_MODELS}/checkpoints" ]; then
  for ckpt_file in "${VOLUME_MODELS}/checkpoints/"*.safetensors "${VOLUME_MODELS}/checkpoints/"*.ckpt; do
    [ -f "$ckpt_file" ] || continue
    ckpt_name=$(basename "$ckpt_file")
    case "$ckpt_name" in
      CyberRealistic_PonySemi_V4.5.safetensors)
        ;; # keep
      *)
        echo "[NSW] Removing old checkpoint: $ckpt_name"
        rm -f "$ckpt_file"
        ;;
    esac
  done
  echo "[NSW] ✓ Old checkpoints removed (kept CyberRealistic_PonySemi_V4.5)"
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

# LoRAs to keep — all other .safetensors in the loras/ directory will be deleted.
# Pony scene generation LoRAs only.
KEEP_LORAS=(
  "pony-ebony-skin.safetensors"
  "pony-skin-tone-slider.safetensors"
  "pony-hourglass-body.safetensors"
  "perfect-breasts-v2.safetensors"
  "pony-realism-stable-yogi.safetensors"
  "pony-detail-slider.safetensors"
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
      echo "[NSW] Removing stale LoRA: $basename_file"
      rm -f "$lora_file"
    fi
  done
  echo "[NSW] ✓ Stale LoRAs removed from loras/"
fi

echo "[NSW] Cleanup complete."
echo "[NSW] ========================================="

# ---- Pony / CyberRealistic Semi-Realistic checkpoint (for V4 pony_cyberreal pipeline) ----
# CivitAI model 709404, version 2601141 (v4.5)
# https://civitai.com/models/709404/cyberrealistic-pony-semi-realistic
PONY_CKPT_DEST="${VOLUME_MODELS}/checkpoints/CyberRealistic_PonySemi_V4.5.safetensors"
if [ -f "$PONY_CKPT_DEST" ]; then
    echo "[NSW] ✓ CyberRealistic_PonySemi_V4.5.safetensors (exists)"
elif [ -d "${VOLUME_MODELS}/checkpoints" ]; then
    PONY_URL="https://civitai.com/api/download/models/2601141"
    [ -n "${CIVITAI_API_KEY:-}" ] && PONY_URL="${PONY_URL}?token=${CIVITAI_API_KEY}"
    echo "[NSW] Downloading CyberRealistic_PonySemi_V4.5.safetensors (~6GB)..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${PONY_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=900)
    with open('${PONY_CKPT_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${PONY_CKPT_DEST}.tmp" "${PONY_CKPT_DEST}" || \
    { rm -f "${PONY_CKPT_DEST}.tmp"; echo "[NSW] ERROR: CyberRealistic Pony Semi-Realistic download failed"; }
    # Sanity check: SDXL checkpoints are typically 6-7GB
    if [ -f "$PONY_CKPT_DEST" ]; then
        PONY_SIZE=$(stat -c%s "${PONY_CKPT_DEST}" 2>/dev/null || stat -f%z "${PONY_CKPT_DEST}" 2>/dev/null || echo 0)
        if [ "$PONY_SIZE" -lt 2000000000 ]; then
            echo "[NSW] ERROR: CyberRealistic Pony Semi-Realistic file too small (${PONY_SIZE} bytes) — likely a redirect/error page"
            rm -f "${PONY_CKPT_DEST}"
        else
            echo "[NSW] ✓ CyberRealistic_PonySemi_V4.5.safetensors downloaded ($(( PONY_SIZE / 1024 / 1024 ))MB)"
        fi
    fi
fi


# ---- Pony Scene Generation LoRAs ----

# Ebony Pony (dark skin) — CivitAI model 513296, version 595483
# Trigger: aiebonyskin | Strength: 0.6 | Pony-native
download_to_volume "595483" "pony-ebony-skin.safetensors"

# Skin Tone Slider PonyXL v1.2 BETA — CivitAI model 421744, version 1106176
# Trigger: none (slider LoRA) | Strength: 3.0 | Pony-native
download_to_volume "1106176" "pony-skin-tone-slider.safetensors"

# Hourglass Body Shape v2 Pony — CivitAI model 129130, version 928762
# Trigger: hourglass body shape | Strength: 0.85 | Pony-native
download_to_volume "928762" "pony-hourglass-body.safetensors"

# Perfect Breasts v2 — CivitAI model 1621732, version 1987668
# Already on volume; re-download only if missing.
download_to_volume "1987668" "perfect-breasts-v2.safetensors"

# Realism LoRA Stable Yogi v3.0_lite — CivitAI model 1098033, version 2074888
# Trigger: none | Strength: 0.7 | Pony-native
download_to_volume "2074888" "pony-realism-stable-yogi.safetensors"

# Detail Slider PonyXL v1.4 — CivitAI model 402462, version 712947
# Trigger: none (slider LoRA) | Strength: 3.0 | Pony-native
download_to_volume "712947" "pony-detail-slider.safetensors"


echo "[NSW] ========================================="
if [ $FAILED -gt 0 ]; then
    echo "[NSW] WARNING: ${FAILED} model(s) failed to download."
    echo "[NSW] ComfyUI will start but some features may not work."
else
    echo "[NSW] All models ready."
fi
echo "[NSW] ========================================="
