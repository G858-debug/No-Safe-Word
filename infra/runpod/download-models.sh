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

# better-bodies-xl — Body anatomy LoRA for NSFW content accuracy (EauDeNoire)
# Requires CIVITAI_API_KEY (same as premium models section)
if [ -n "${CIVITAI_API_KEY}" ]; then
    download_model \
        "https://civitai.com/api/download/models/359579?type=Model&format=SafeTensor&token=${CIVITAI_API_KEY}" \
        "loras" \
        "better-bodies-xl.safetensors"
    # cinecolor-harmonizer — Cinematic golden color grading (jarod2212)
    # Civitai model 2389677, version 2686970
    download_model \
        "https://civitai.com/api/download/models/2686970?token=${CIVITAI_API_KEY}" \
        "loras" \
        "cinecolor-harmonizer.safetensors"

    # melanin-mix-xl — Dark skin enhancement trained on 1000+ Black influencer photos (Ggrue)
    # Civitai model 390634, version 435833
    download_model \
        "https://civitai.com/api/download/models/435833?token=${CIVITAI_API_KEY}" \
        "loras" \
        "melanin-mix-xl.safetensors"

    # couples-poses-xl — Dual-character pose composition for SDXL
    # CivitAI model 1543944
    download_model \
        "https://civitai.com/api/download/models/1543944?token=${CIVITAI_API_KEY}" \
        "loras" \
        "couples-poses-xl.safetensors"
else
    echo "[NSW] ⚠ Skipping better-bodies-xl, cinecolor-harmonizer, melanin-mix-xl, couples-poses-xl (CIVITAI_API_KEY not set)"
fi

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

# =============================================
# IPAdapter FaceID models — face consistency for story images
# These enable the single-character and dual-character workflows
# that inject the approved portrait's face into story scene images.
# =============================================

# CLIP Vision ViT-H/14 — required by IPAdapter for image encoding (~2.5GB)
download_model \
    "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" \
    "clip_vision" \
    "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"

# IP-Adapter FaceID Plus V2 SDXL — face embedding adapter model (~100MB)
download_model \
    "https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sdxl.bin" \
    "ipadapter" \
    "ip-adapter-faceid-plusv2_sdxl.bin"

# IP-Adapter FaceID Plus V2 SDXL LoRA — auto-loaded by unified loader (~400MB)
download_model \
    "https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sdxl_lora.safetensors" \
    "loras" \
    "ip-adapter-faceid-plusv2_sdxl_lora.safetensors"

# =============================================
# Premium models — opt-in via INSTALL_PREMIUM_MODELS=true
# These are additional checkpoints for model selection intelligence.
# They require extra disk space (~20GB) so are only downloaded on demand.
# =============================================
if [ "${INSTALL_PREMIUM_MODELS}" = "true" ]; then
    echo "[NSW] ========================================="
    echo "[NSW] Installing premium models..."
    echo "[NSW] ========================================="

    if [ -z "${CIVITAI_API_KEY}" ]; then
        echo "[NSW] WARNING: CIVITAI_API_KEY not set — skipping premium model downloads"
        echo "[NSW] Set CIVITAI_API_KEY env var to enable premium model downloads from Civitai"
    else
        # RealVisXL V5.0 (BakedVAE) — premium portrait model (superior face and skin rendering)
        # Civitai model 139562, version 789646
        download_model \
            "https://civitai.com/api/download/models/789646?token=${CIVITAI_API_KEY}" \
            "checkpoints" \
            "realvisxl-v5.safetensors"

        # Lustify V5 Endgame — NSFW-optimized photorealistic checkpoint
        # CivitAI model 573152, version 1094291
        # Purpose-built for photorealistic NSFW with superior anatomy and lighting
        download_model \
            "https://civitai.com/api/download/models/1094291?token=${CIVITAI_API_KEY}" \
            "checkpoints" \
            "lustify-v5-endgame.safetensors"
    fi
else
    echo "[NSW] Skipping premium models (set INSTALL_PREMIUM_MODELS=true to install)"
fi

echo "[NSW] ========================================="
if [ $FAILED -gt 0 ]; then
    echo "[NSW] WARNING: ${FAILED} model(s) failed to download."
    echo "[NSW] ComfyUI will start but some features may not work."
else
    echo "[NSW] All models ready."
fi
echo "[NSW] ========================================="
