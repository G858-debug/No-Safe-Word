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

# ---- One-time SDXL model cleanup ----
# Deletes SDXL-only model files from the network volume to free ~20GB.
# Safe to re-run: rm -f is a no-op if the file is already gone.
# Kontext/Flux uses diffusion_models/, clip/, vae/ — not checkpoints/.

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

# FaceDetailer YOLO models no longer cleaned up — ultralytics/ may be needed by ReActor

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

# Kontext LoRAs — downloaded at runtime (small files, < 200MB each).
# Larger models (Flux Kontext UNET ~8GB, CLIP encoders, VAE) live on the
# network volume and are managed via scripts/download-kontext-models.mjs

# ---- RealVisXL and BigASP removed — no longer needed for Pony pipeline ----
# CyberRealistic Pony Semi-Realistic v4.5 is downloaded via scripts/download-pony-via-endpoint.mjs
CKPT_DIR="/runpod-volume/models/checkpoints"
fi

# BodyLicious FLUX — exaggerated feminine curves (CivitAI model 238105, version 979680)
download_to_volume "979680" "bodylicious-flux.safetensors"

# ---- Retired SDXL LoRAs (replaced by Pony-native alternatives below) ----
# melanin-XL.safetensors, curvy-body-sdxl.safetensors, feminine-body-proportions-sdxl.safetensors,
# sdxl-skin-tone-xl.safetensors, sdxl-skin-realism.safetensors — all removed.

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

# ---- PuLID Models ----

# PuLID Flux v0.9.1 — face identity injection model (~577MB).
# HuggingFace: guozinan/PuLID. ComfyUI folder_paths["pulid"] → /runpod-volume/models/pulid/
PULID_DIR="/runpod-volume/models/pulid"
PULID_DEST="${PULID_DIR}/pulid_flux_v0.9.1.safetensors"
PULID_URL="https://huggingface.co/guozinan/PuLID/resolve/main/pulid_flux_v0.9.1.safetensors"
if [ -f "$PULID_DEST" ]; then
    echo "[NSW] ✓ pulid_flux_v0.9.1.safetensors (exists)"
elif [ -d "/runpod-volume/models" ]; then
    mkdir -p "${PULID_DIR}"
    echo "[NSW] Downloading pulid_flux_v0.9.1.safetensors from HuggingFace..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${PULID_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    token = '${HUGGINGFACE_TOKEN:-${HF_TOKEN:-}}'
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    resp = urllib.request.urlopen(req, timeout=600)
    with open('${PULID_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${PULID_DEST}.tmp" "${PULID_DEST}" && \
    echo "[NSW] ✓ pulid_flux_v0.9.1.safetensors (downloaded)" || \
    { rm -f "${PULID_DEST}.tmp"; echo "[NSW] ✗✗ pulid_flux_v0.9.1.safetensors FAILED"; FAILED=$((FAILED + 1)); }
fi

# EVA02 CLIP L 336 — required by PuLID for face encoding (~1.3GB).
# HuggingFace: QuanSun/EVA-CLIP. ComfyUI folder_paths["clip"] → /runpod-volume/models/clip/
EVACLIP_DIR="/runpod-volume/models/clip"
EVACLIP_DEST="${EVACLIP_DIR}/EVA02_CLIP_L_336_psz14_s6B.pt"
EVACLIP_URL="https://huggingface.co/QuanSun/EVA-CLIP/resolve/main/EVA02_CLIP_L_336_psz14_s6B.pt"
if [ -f "$EVACLIP_DEST" ]; then
    echo "[NSW] ✓ EVA02_CLIP_L_336_psz14_s6B.pt (exists)"
elif [ -d "/runpod-volume/models" ]; then
    mkdir -p "${EVACLIP_DIR}"
    echo "[NSW] Downloading EVA02_CLIP_L_336_psz14_s6B.pt from HuggingFace..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${EVACLIP_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    token = '${HUGGINGFACE_TOKEN:-${HF_TOKEN:-}}'
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    resp = urllib.request.urlopen(req, timeout=900)
    with open('${EVACLIP_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${EVACLIP_DEST}.tmp" "${EVACLIP_DEST}" && \
    echo "[NSW] ✓ EVA02_CLIP_L_336_psz14_s6B.pt (downloaded)" || \
    { rm -f "${EVACLIP_DEST}.tmp"; echo "[NSW] ✗✗ EVA02_CLIP_L_336_psz14_s6B.pt FAILED"; FAILED=$((FAILED + 1)); }
fi

# ---- ReActor Face-Swap Models ----
# InsightFace inswapper model (~370MB) — core face-swap engine used by ReActor node.
# Downloaded from HuggingFace (ezioruan/inswapper_128.onnx mirror).
INSIGHTFACE_DIR="/runpod-volume/models/insightface"
INSWAPPER_DEST="${INSIGHTFACE_DIR}/inswapper_128.onnx"
INSWAPPER_URL="https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx"
if [ -f "$INSWAPPER_DEST" ]; then
    echo "[NSW] ✓ inswapper_128.onnx (exists)"
elif [ -d "/runpod-volume/models" ]; then
    mkdir -p "${INSIGHTFACE_DIR}"
    echo "[NSW] Downloading inswapper_128.onnx for ReActor face-swap..."
    python3 -c "
import urllib.request, sys, shutil
try:
    req = urllib.request.Request('${INSWAPPER_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)')
    resp = urllib.request.urlopen(req, timeout=600)
    with open('${INSWAPPER_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1 && mv "${INSWAPPER_DEST}.tmp" "${INSWAPPER_DEST}" && \
    echo "[NSW] ✓ inswapper_128.onnx (downloaded)" || \
    { rm -f "${INSWAPPER_DEST}.tmp"; echo "[NSW] ✗✗ inswapper_128.onnx FAILED"; FAILED=$((FAILED + 1)); }
fi

# ========================================================
# V2 PIPELINE MODELS (NB2 → Florence-2/SAM2 → UnCanny)
# Only downloaded when DOWNLOAD_V2_MODELS=true
# ========================================================
if [ "${DOWNLOAD_V2_MODELS}" = "true" ]; then

  # UnCanny v1.3 fp8 (photorealism fine-tune of Chroma, ~8.3GB)
  # Downloaded in BACKGROUND so ComfyUI can start while it downloads.
  # The RunPod health check times out if we block here for ~5 min.
  # Once downloaded, the file persists on the network volume.
  UNCANNY_DEST="/runpod-volume/models/diffusion_models/uncanny_v1.3_fp8.safetensors"
  UNCANNY_MIN_SIZE=5000000000  # 5GB minimum — full file is ~8.3GB
  if [ -f "$UNCANNY_DEST" ]; then
      UNCANNY_SIZE=$(stat -c%s "$UNCANNY_DEST" 2>/dev/null || stat -f%z "$UNCANNY_DEST" 2>/dev/null || echo 0)
      if [ "$UNCANNY_SIZE" -lt "$UNCANNY_MIN_SIZE" ]; then
          echo "[NSW] uncanny_v1.3_fp8.safetensors is truncated (${UNCANNY_SIZE} bytes < ${UNCANNY_MIN_SIZE}). Deleting and re-downloading."
          rm -f "$UNCANNY_DEST"
      else
          echo "[NSW] ✓ uncanny_v1.3_fp8.safetensors (exists, ${UNCANNY_SIZE} bytes)"
      fi
  fi
  if [ ! -f "$UNCANNY_DEST" ] && [ -d "/runpod-volume/models" ]; then
      if [ -n "${UNCANNY_MODEL_URL:-}" ]; then
          mkdir -p "/runpod-volume/models/diffusion_models"
          UNCANNY_DL_URL="${UNCANNY_MODEL_URL}"
          if [ -n "${CIVITAI_API_KEY:-}" ]; then
              case "$UNCANNY_DL_URL" in
                  *\?*) UNCANNY_DL_URL="${UNCANNY_DL_URL}&token=${CIVITAI_API_KEY}" ;;
                  *)    UNCANNY_DL_URL="${UNCANNY_DL_URL}?token=${CIVITAI_API_KEY}" ;;
              esac
          fi
          echo "[NSW] Launching UnCanny download daemon (~8.3GB)..."
          # setsid creates a new session so the process survives exec in start-wrapper.sh
          setsid python3 -c "
import urllib.request, sys, shutil, os
try:
    req = urllib.request.Request('${UNCANNY_DL_URL}')
    req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    resp = urllib.request.urlopen(req, timeout=900)
    with open('${UNCANNY_DEST}.tmp', 'wb') as f:
        shutil.copyfileobj(resp, f)
    resp.close()
    os.rename('${UNCANNY_DEST}.tmp', '${UNCANNY_DEST}')
    sz = os.path.getsize('${UNCANNY_DEST}') / (1024*1024)
    print(f'[NSW] uncanny download complete: {sz:.0f} MB')
except Exception as e:
    print(f'[NSW] UnCanny download error: {e}', file=sys.stderr)
    try: os.remove('${UNCANNY_DEST}.tmp')
    except: pass
" > /tmp/uncanny_download.log 2>&1 &
          echo "[NSW] Download daemon PID: $! (setsid, survives exec)"
      else
          echo "[NSW] UNCANNY_MODEL_URL not set — skipping UnCanny download"
      fi
  fi
fi

echo "[NSW] ========================================="
if [ $FAILED -gt 0 ]; then
    echo "[NSW] WARNING: ${FAILED} model(s) failed to download."
    echo "[NSW] ComfyUI will start but some features may not work."
else
    echo "[NSW] All models ready."
fi
echo "[NSW] ========================================="
