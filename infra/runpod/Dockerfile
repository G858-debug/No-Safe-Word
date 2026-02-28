# Thin app layer — builds in ~1-2 minutes.
# All heavy dependencies (custom nodes, InsightFace, LoRAs, download-models.sh)
# live in the base image, built separately via Dockerfile.base.
#
# Rebuild base:  gh workflow run build-runpod-base.yml
# Rebuild app:   automatic on push to infra/runpod/ (or gh workflow run build-runpod-image.yml)
ARG BASE_IMAGE=ghcr.io/g858-debug/nsw-comfyui-base:latest
FROM ${BASE_IMAGE}

ENV COMFY_DIR=/comfyui

# ---- Character LoRA Runtime Download Handler ----
# Injects character LoRA download support into the base handler.py.
# At build time, patch_handler.py prepends a monkey-patch to the original
# handler that intercepts `character_lora_downloads` from job input,
# downloads LoRAs to /comfyui/models/loras/characters/, refreshes
# ComfyUI's model cache, then delegates to the original handler.
#
# nsw_refresh_models: tiny ComfyUI extension that adds POST /api/nsw/refresh-models
# to clear the folder_paths filename cache. Without this, ComfyUI rejects
# newly downloaded LoRAs because its cached file list is stale from startup.
COPY nsw_refresh_models/ ${COMFY_DIR}/custom_nodes/nsw_refresh_models/
# NSW Region Masks: custom node for creating horizontal region masks
# Used by Attention Couple integration in multi-pass workflow
COPY nsw_region_masks/ ${COMFY_DIR}/custom_nodes/nsw_region_masks/
RUN mv /handler.py /handler_original.py
COPY patch_handler.py /tmp/patch_handler.py
RUN python3 /tmp/patch_handler.py && rm /tmp/patch_handler.py /handler_original.py

# ---- Override runtime model download script ----
# The base image ships download-models.sh, but we may update it more
# frequently (e.g. adding new LoRAs). Re-copy here so the app image
# always has the latest version without rebuilding the heavy base.
COPY download-models.sh /usr/local/bin/download-models.sh
RUN chmod +x /usr/local/bin/download-models.sh

# Wrap the base image's /start.sh to download models first.
# We rename the original and replace it with our wrapper, rather than
# using ENTRYPOINT, which breaks RunPod serverless deployment.
RUN mv /start.sh /start-original.sh
COPY start-wrapper.sh /start.sh
RUN chmod +x /start.sh
