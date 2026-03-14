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
        if curl -sL \
            -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
            -o "${tmp_path}" \
            "${url}" && [ -s "${tmp_path}" ]; then
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

# ---- One-time SDXL model cleanup ----
# Deletes SDXL-only model files from the network volume to free ~20GB.
# Safe to re-run: rm -f is a no-op if the file is already gone.
# Kontext/Flux uses diffusion_models/, clip/, vae/ — not checkpoints/.

VOLUME_MODELS="${VOLUME_LORAS_DIR%/loras}"  # /runpod-volume/models

echo "[NSW] Cleaning up SDXL model files..."

# Checkpoints dir: remove old SDXL checkpoints but keep RealVisXL V5.0 (used by LoRA Studio)
if [ -d "${VOLUME_MODELS}/checkpoints" ]; then
  for ckpt_file in "${VOLUME_MODELS}/checkpoints/"*.safetensors "${VOLUME_MODELS}/checkpoints/"*.ckpt; do
    [ -f "$ckpt_file" ] || continue
    ckpt_name=$(basename "$ckpt_file")
    if [ "$ckpt_name" != "realvisxlV50_v50Bakedvae.safetensors" ]; then
      echo "[NSW] Removing old checkpoint: $ckpt_name"
      rm -f "$ckpt_file"
    fi
  done
  echo "[NSW] ✓ Old SDXL checkpoints removed (kept realvisxlV50_v50Bakedvae)"
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

# clip_vision/ — kept for Redux conditioning (SigCLIP Vision encoder)

# IPAdapter models (no longer used)
if [ -d "${VOLUME_MODELS}/ipadapter" ]; then
  rm -rf "${VOLUME_MODELS}/ipadapter"
  echo "[NSW] ✓ Cleared ipadapter/ (IPAdapter models removed)"
fi

# LoRAs to keep — all other .safetensors in the loras/ directory will be deleted.
# Includes both Flux scene LoRAs and SDXL character approval LoRAs.
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
  "bodylicious-flux.safetensors"
  "nsw-curves-body.safetensors"
  "refcontrol_pose.safetensors"
  "flux-cinematic-finisher.safetensors"
  "melanin-XL.safetensors"
  "curvy-body-sdxl.safetensors"
  "sdxl-skin-tone-xl.safetensors"
  "sdxl-skin-realism.safetensors"
  "skin-realism-sdxl.safetensors"
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

# Flux Realism Cinematic Finisher — editorial skin textures, dramatic lighting, fabric sharpness
# CivitAI model 1902557, version 2153525. Trigger word: realism_cinema (~292MB)
CINEMATIC_DEST="${VOLUME_LORAS_DIR}/flux-cinematic-finisher.safetensors"
if [ -f "$CINEMATIC_DEST" ]; then
    echo "[LoRA] ✓ flux-cinematic-finisher.safetensors (exists)"
elif [ -d "${VOLUME_LORAS_DIR}" ]; then
    echo "[LoRA] Downloading flux-cinematic-finisher.safetensors..."
    CINEMATIC_URL="https://civitai.com/api/download/models/2153525"
    [ -n "${CIVITAI_API_KEY:-}" ] && CINEMATIC_URL="${CINEMATIC_URL}?token=${CIVITAI_API_KEY}"
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${CINEMATIC_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=600)
    with open('${CINEMATIC_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${CINEMATIC_DEST}.tmp" "${CINEMATIC_DEST}" || \
    { rm -f "${CINEMATIC_DEST}.tmp"; echo "[LoRA] ERROR: flux-cinematic-finisher download failed"; exit 1; }
    # Sanity check: file must be > 100MB
    CINEMATIC_SIZE=$(stat -c%s "${CINEMATIC_DEST}" 2>/dev/null || stat -f%z "${CINEMATIC_DEST}" 2>/dev/null || echo 0)
    if [ "$CINEMATIC_SIZE" -lt 104857600 ]; then
        echo "[LoRA] ERROR: flux-cinematic-finisher download failed or file is too small (${CINEMATIC_SIZE} bytes)"
        rm -f "${CINEMATIC_DEST}"
        exit 1
    fi
    echo "[LoRA] flux-cinematic-finisher.safetensors downloaded successfully"
fi

# Kontext LoRAs — downloaded at runtime (small files, < 200MB each).
# Larger models (Flux Kontext UNET ~8GB, CLIP encoders, VAE) live on the
# network volume and are managed via scripts/download-kontext-models.mjs

# ---- LoRA Studio: RealVisXL V5.0 checkpoint + Curvy body LoRA ----
# Used for photorealistic body image generation in the LoRA training pipeline.
# Both downloaded to network volume so they persist across container restarts.
# RealVisXL V5.0 BakedVAE fp16 (~6.6GB) — CivitAI version 789646.
CKPT_DIR="/runpod-volume/models/checkpoints"
CKPT_FILE="realvisxlV50_v50Bakedvae.safetensors"
if [ -f "${CKPT_DIR}/${CKPT_FILE}" ]; then
    echo "[NSW] ✓ ${CKPT_FILE} (volume checkpoint, exists)"
elif [ -d "/runpod-volume/models" ]; then
    mkdir -p "${CKPT_DIR}"
    CKPT_URL="https://civitai.com/api/download/models/789646"
    [ -n "${CIVITAI_API_KEY:-}" ] && CKPT_URL="${CKPT_URL}?token=${CIVITAI_API_KEY}"
    echo "[NSW] Downloading ${CKPT_FILE} to volume checkpoints..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${CKPT_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=900)
    with open('${CKPT_DIR}/${CKPT_FILE}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${CKPT_DIR}/${CKPT_FILE}.tmp" "${CKPT_DIR}/${CKPT_FILE}" && \
    echo "[NSW] ✓ ${CKPT_FILE} (volume checkpoint, downloaded)" || \
    { rm -f "${CKPT_DIR}/${CKPT_FILE}.tmp"; echo "[NSW] ✗✗ ${CKPT_FILE} FAILED"; FAILED=$((FAILED + 1)); }
else
    echo "[NSW] Volume not mounted — skipping ${CKPT_FILE}"
fi

# BodyLicious FLUX — exaggerated feminine curves (CivitAI model 238105, version 979680)
download_to_volume "979680" "bodylicious-flux.safetensors"

# Melanin Girlfriend mix — SDXL dark skin enhancement for character face generation
# CivitAI model 390634, version 435833. Trigger word: melanin
download_to_volume "435833" "melanin-XL.safetensors"

# Curvy Body SDXL — curvaceous body shape for character body generation
# Already present on volume as curvy-body-sdxl.safetensors (pre-installed).
# Replaces venus-body-xl which was removed from CivitAI.

# Skin Tone Style XL — CivitAI model 562884 v627184
# Trigger: dark chocolate skin tone style | Strength: 0.6 | Size: ~435MB
# Use for Black/African characters in SDXL face + body generation
download_to_volume "627184" "sdxl-skin-tone-xl.safetensors"

# Skin Realism SDXL — CivitAI model 248951 v340833
# Trigger: Detailed natural skin and blemishes without-makeup and acne
# Strength: 0.4 (keep below 0.5 — higher weights skew younger) | Size: ~218MB
# Use for all characters in SDXL face + body generation
# Clean up old filename variant if it exists on the volume
if [ -f "${VOLUME_LORAS_DIR}/skin-realism-sdxl.safetensors" ] && [ ! -f "${VOLUME_LORAS_DIR}/sdxl-skin-realism.safetensors" ]; then
    mv "${VOLUME_LORAS_DIR}/skin-realism-sdxl.safetensors" "${VOLUME_LORAS_DIR}/sdxl-skin-realism.safetensors"
    echo "[NSW] Renamed skin-realism-sdxl.safetensors → sdxl-skin-realism.safetensors"
fi
download_to_volume "340833" "sdxl-skin-realism.safetensors"

# NSW Curves — custom-trained body LoRA (Replicate tar → safetensors extraction)
NSW_CURVES_DEST="${VOLUME_LORAS_DIR}/nsw-curves-body.safetensors"
NSW_CURVES_URL="https://replicate.delivery/xezq/2eBOTROp2kT2MKdv2IQwyQ7VYWQF9Z2MOPX01U3gC9pKekOWA/trained_model.tar"
if [ -f "$NSW_CURVES_DEST" ]; then
    echo "[NSW] ✓ nsw-curves-body.safetensors (volume, exists)"
elif [ -d "${VOLUME_LORAS_DIR}" ]; then
    echo "[NSW] Downloading nsw-curves-body LoRA from Replicate..."
    python3 -c "
import urllib.request, tarfile, io, sys, os, shutil
try:
    req = urllib.request.Request('${NSW_CURVES_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=600)
    data = resp.read()
    resp.close()
    tar = tarfile.open(fileobj=io.BytesIO(data))
    for m in tar.getmembers():
        if m.name.endswith('.safetensors') and m.isfile():
            f = tar.extractfile(m)
            with open('${NSW_CURVES_DEST}.tmp', 'wb') as out:
                shutil.copyfileobj(f, out)
            break
    tar.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${NSW_CURVES_DEST}.tmp" "${NSW_CURVES_DEST}" && \
    echo "[NSW] ✓ nsw-curves-body.safetensors (volume, downloaded)" || \
    { rm -f "${NSW_CURVES_DEST}.tmp"; echo "[NSW] ✗✗ nsw-curves-body.safetensors FAILED"; }
fi

# RefControl Kontext Pose LoRA — identity+pose transfer for Flux Kontext
# HuggingFace: thedeoxen/refcontrol-flux-kontext-reference-pose-lora (344 MB)
REFCONTROL_DEST="${VOLUME_LORAS_DIR}/refcontrol_pose.safetensors"
REFCONTROL_URL="https://huggingface.co/thedeoxen/refcontrol-flux-kontext-reference-pose-lora/resolve/main/refcontrol_pose.safetensors"
if [ -f "$REFCONTROL_DEST" ]; then
    echo "[NSW] ✓ refcontrol_pose.safetensors (volume, exists)"
elif [ -d "${VOLUME_LORAS_DIR}" ]; then
    echo "[NSW] Downloading RefControl Kontext Pose LoRA from HuggingFace..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${REFCONTROL_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=600)
    with open('${REFCONTROL_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${REFCONTROL_DEST}.tmp" "${REFCONTROL_DEST}" && \
    echo "[NSW] ✓ refcontrol_pose.safetensors (volume, downloaded)" || \
    { rm -f "${REFCONTROL_DEST}.tmp"; echo "[NSW] ✗✗ refcontrol_pose.safetensors FAILED"; }
fi

# ---- Flux Redux style model + CLIP Vision (for Redux conditioning pass) ----
# Redux transfers visual identity from a reference image into new generations.
# Requires: style model + CLIP Vision encoder on the network volume.

STYLE_MODELS_DIR="/runpod-volume/models/style_models"
CLIP_VISION_DIR="/runpod-volume/models/clip_vision"

# Flux Redux Dev style model (~1.2GB) — from Black Forest Labs
REDUX_DEST="${STYLE_MODELS_DIR}/flux1-redux-dev.safetensors"
REDUX_URL="https://huggingface.co/black-forest-labs/FLUX.1-Redux-dev/resolve/main/flux1-redux-dev.safetensors"
if [ -f "$REDUX_DEST" ]; then
    echo "[NSW] ✓ flux1-redux-dev.safetensors (volume, exists)"
elif [ -d "/runpod-volume/models" ]; then
    mkdir -p "${STYLE_MODELS_DIR}"
    echo "[NSW] Downloading Flux Redux Dev style model from HuggingFace..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${REDUX_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    token = '${HUGGINGFACE_TOKEN:-${HF_TOKEN:-}}'
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    resp = urllib.request.urlopen(req, timeout=900)
    with open('${REDUX_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${REDUX_DEST}.tmp" "${REDUX_DEST}" && \
    echo "[NSW] ✓ flux1-redux-dev.safetensors (volume, downloaded)" || \
    { rm -f "${REDUX_DEST}.tmp"; echo "[NSW] ✗✗ flux1-redux-dev.safetensors FAILED"; FAILED=$((FAILED + 1)); }
fi

# SigCLIP Vision encoder for Redux conditioning (~1.5GB)
CLIPV_DEST="${CLIP_VISION_DIR}/sigclip_vision_patch14_384.safetensors"
CLIPV_URL="https://huggingface.co/Comfy-Org/sigclip_vision_384/resolve/main/sigclip_vision_patch14_384.safetensors"
if [ -f "$CLIPV_DEST" ]; then
    echo "[NSW] ✓ sigclip_vision_patch14_384.safetensors (volume, exists)"
elif [ -d "/runpod-volume/models" ]; then
    mkdir -p "${CLIP_VISION_DIR}"
    echo "[NSW] Downloading SigCLIP Vision encoder from HuggingFace..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${CLIPV_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=600)
    with open('${CLIPV_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${CLIPV_DEST}.tmp" "${CLIPV_DEST}" && \
    echo "[NSW] ✓ sigclip_vision_patch14_384.safetensors (volume, downloaded)" || \
    { rm -f "${CLIPV_DEST}.tmp"; echo "[NSW] ✗✗ sigclip_vision_patch14_384.safetensors FAILED"; FAILED=$((FAILED + 1)); }
fi

echo "[NSW] ========================================="
if [ $FAILED -gt 0 ]; then
    echo "[NSW] WARNING: ${FAILED} model(s) failed to download."
    echo "[NSW] ComfyUI will start but some features may not work."
else
    echo "[NSW] All models ready."
fi
echo "[NSW] ========================================="
