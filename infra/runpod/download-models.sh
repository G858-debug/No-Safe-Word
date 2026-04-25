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
STALE_LORAS=(
  "pony-ebony-skin.safetensors"
  "pony-skin-tone-slider.safetensors"
  "pony-hourglass-body.safetensors"
  "perfect-breasts-v2.safetensors"
  "pony-realism-stable-yogi.safetensors"
  "pony-detail-slider.safetensors"
  "hourglassv2_SDXL.safetensors"
  "Hourglass_of_Venus_v2.safetensors"
  "Thick__Fit_Female_Wellness_Body_LoRA-000057.safetensors"
)

if [ -d "${VOLUME_LORAS_DIR}" ]; then
  for lora_name in "${STALE_LORAS[@]}"; do
    if [ -f "${VOLUME_LORAS_DIR}/${lora_name}" ]; then
      echo "[NSW] Removing Pony style LoRA: ${lora_name}"
      rm -f "${VOLUME_LORAS_DIR}/${lora_name}"
    fi
  done
  echo "[NSW] ✓ Stale LoRAs removed"
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

# ---- ControlNet: OpenPose SDXL (two-character pose guidance) ----
# HuggingFace: thibaud/controlnet-openpose-sdxl-1.0
CONTROLNET_DIR="${VOLUME_MODELS}/controlnet"
mkdir -p "${CONTROLNET_DIR}" 2>/dev/null
download_to_volume \
    "https://huggingface.co/thibaud/controlnet-openpose-sdxl-1.0/resolve/main/OpenPoseXL2.safetensors" \
    "OpenPoseXL2.safetensors" \
    "${CONTROLNET_DIR}"

# ---- ControlNet: Flux2 Fun ControlNet Union (Flux 2 Dev pose guidance) ----
# HuggingFace: alibaba-pai/FLUX.2-dev-Fun-ControlNet-Union
# v2602 variant — improved per-layer control, more natural results (~8.2GB)
download_to_volume \
    "https://huggingface.co/alibaba-pai/FLUX.2-dev-Fun-ControlNet-Union/resolve/main/FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors" \
    "FLUX.2-dev-Fun-Controlnet-Union-2602.safetensors" \
    "${CONTROLNET_DIR}"

# ---- PuLID Flux: Face identity injection for Flux 2 Dev ----
# HuggingFace: guozinan/PuLID — face identity embedding model (~1.1GB)
PULID_DIR="${VOLUME_MODELS}/pulid"
mkdir -p "${PULID_DIR}" 2>/dev/null
download_to_volume \
    "https://huggingface.co/guozinan/PuLID/resolve/main/pulid_flux_v0.9.1.safetensors" \
    "pulid_flux_v0.9.1.safetensors" \
    "${PULID_DIR}"

# ---- EVA-02 CLIP Vision (PuLID face embedding encoder) ----
# HuggingFace: QuanSun/EVA-CLIP — vision encoder for face features (~856MB)
CLIP_VISION_DIR="${VOLUME_MODELS}/clip_vision"
mkdir -p "${CLIP_VISION_DIR}" 2>/dev/null
download_to_volume \
    "https://huggingface.co/QuanSun/EVA-CLIP/resolve/main/EVA02_CLIP_L_336_psz14_s6B.pt" \
    "EVA02_CLIP_L_336_psz14_s6B.pt" \
    "${CLIP_VISION_DIR}"

# ---- DWPose models (reference image pose extraction) ----
# Used by DWPreprocessor node from comfyui_controlnet_aux.
# Extracts OpenPose skeletons from reference photos on the GPU.
DWPOSE_DIR="/comfyui/custom_nodes/comfyui_controlnet_aux/ckpts/yzd-v/DWPose"
mkdir -p "${DWPOSE_DIR}" 2>/dev/null
download_to_volume \
    "https://huggingface.co/yzd-v/DWPose/resolve/main/yolox_l.onnx" \
    "yolox_l.onnx" \
    "${DWPOSE_DIR}"
download_to_volume \
    "https://huggingface.co/yzd-v/DWPose/resolve/main/dw-ll_ucoco_384.onnx" \
    "dw-ll_ucoco_384.onnx" \
    "${DWPOSE_DIR}"

# ---- Body shape slider LoRAs (female characters, portrait + dataset only) ----

# Body Weight Slider (ILXL) — CivitAI 1348692, version 1523317
BODYWEIGHT_URL="https://civitai.com/api/download/models/1523317"
[ -n "${CIVITAI_API_KEY:-}" ] && BODYWEIGHT_URL="${BODYWEIGHT_URL}?token=${CIVITAI_API_KEY}"
download_to_volume "${BODYWEIGHT_URL}" "Body_weight_slider_ILXL.safetensors" "${VOLUME_LORAS_DIR}"

# Bubble Butt Slider — CivitAI 479344, version 533085
BUBBLEBUTT_URL="https://civitai.com/api/download/models/533085"
[ -n "${CIVITAI_API_KEY:-}" ] && BUBBLEBUTT_URL="${BUBBLEBUTT_URL}?token=${CIVITAI_API_KEY}"
download_to_volume "${BUBBLEBUTT_URL}" "Bubble Butt_alpha1.0_rank4_noxattn_last.safetensors" "${VOLUME_LORAS_DIR}"

# Breast Size Slider SDXL — CivitAI 481119, version 535064
BREASTSIZE_URL="https://civitai.com/api/download/models/535064"
[ -n "${CIVITAI_API_KEY:-}" ] && BREASTSIZE_URL="${BREASTSIZE_URL}?token=${CIVITAI_API_KEY}"
download_to_volume "${BREASTSIZE_URL}" "Breast Slider - SDXL_alpha1.0_rank4_noxattn_last.safetensors" "${VOLUME_LORAS_DIR}"

# Character LoRAs are downloaded on-demand per-job by the handler (handler_wrapper.py).

# ---- PuLID ComfyUI 5.x compatibility patch ----
# Patches are applied every startup (idempotent — re.sub with no-match is a no-op).
# Fixes two regressions introduced in ComfyUI 5.8.x that cause
#   'NoneType' object is not callable  (ApplyPulidFlux returns None)
#   KeyError: 'timesteps'              (hook accesses key that moved)
# in the KSampler when PuLID is active.
PULID_DIR="${COMFY_DIR}/custom_nodes/ComfyUI_PuLID_Flux_ll"
if [ -d "${PULID_DIR}" ]; then
    python3 - <<'PYEOF'
import re, pathlib, sys

PULID_DIR = pathlib.Path("/comfyui/custom_nodes/ComfyUI_PuLID_Flux_ll")
patched_files = []

for pyfile in sorted(PULID_DIR.rglob("*.py")):
    txt = pyfile.read_text(errors="replace")
    orig = txt

    # Patch 1: forward_orig — accept **kwargs for timestep_zero_index et al.
    txt = re.sub(
        r"(    attn_mask: Tensor = None,\n)(\) -> Tensor:)",
        r"\1    **kwargs,\n\2",
        txt,
    )

    # Patch 2: transformer_options — use .get() so missing key returns {} not KeyError.
    txt = re.sub(
        r'transformer_options = extra_options\["transformer_options"\]',
        'transformer_options = extra_options.get("transformer_options") or (input_args or {}).get("transformer_options", {})',
        txt,
    )

    if txt != orig:
        pyfile.write_text(txt)
        patched_files.append(str(pyfile.relative_to(PULID_DIR)))

if patched_files:
    print(f"[NSW] PuLID patched: {', '.join(patched_files)}")
else:
    print("[NSW] PuLID: no patterns matched (already patched or source changed)")
PYEOF
else
    echo "[NSW] PuLID custom node not found at ${PULID_DIR} — skipping patch"
fi

echo "[NSW] ========================================="
if [ $FAILED -gt 0 ]; then
    echo "[NSW] WARNING: ${FAILED} model(s) failed to download."
    echo "[NSW] ComfyUI will start but some features may not work."
else
    echo "[NSW] All models ready."
fi
echo "[NSW] ========================================="
