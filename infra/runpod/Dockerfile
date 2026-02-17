FROM runpod/worker-comfyui:5.7.1-base

# ---- Custom Nodes ----
# Impact Pack: FaceDetailer, SAMLoader
# Impact Subpack: UltralyticsDetectorProvider (separated since Impact Pack v8.0)
RUN comfy-node-install comfyui-impact-pack comfyui-impact-subpack

# ---- Build-time LoRA Downloads ----
# LoRAs are small (~1GB total) and critical for portrait generation.
# Baking them into the image guarantees they're available on every worker
# regardless of runtime network conditions.
ENV COMFY_DIR=/comfyui

RUN mkdir -p ${COMFY_DIR}/models/loras && \
    wget -q -O ${COMFY_DIR}/models/loras/detail-tweaker-xl.safetensors \
      "https://huggingface.co/LyliaEngine/add-detail-xl/resolve/main/add-detail-xl.safetensors" && \
    echo "✓ detail-tweaker-xl" && \
    wget -q -O ${COMFY_DIR}/models/loras/realistic-skin-xl.safetensors \
      "https://huggingface.co/MarkBW/detailed-skin-xl/resolve/main/skin%20texture%20style%20v4.safetensors" && \
    echo "✓ realistic-skin-xl" && \
    wget -q -O ${COMFY_DIR}/models/loras/eyes-detail-xl.safetensors \
      "https://huggingface.co/ffxvs/lora-effects-xl/resolve/main/detailedEyes_v3.safetensors" && \
    echo "✓ eyes-detail-xl" && \
    wget -q -O ${COMFY_DIR}/models/loras/negative-hands-v2.safetensors \
      "https://huggingface.co/ffxvs/lora-effects-xl/resolve/main/hands_xl_v21.safetensors" && \
    echo "✓ negative-hands-v2" && \
    wget -q -O ${COMFY_DIR}/models/loras/cinematic-lighting-xl.safetensors \
      "https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cinematic-lighting/resolve/main/cinematic%20lighting.safetensors" && \
    echo "✓ cinematic-lighting-xl"

# ---- Runtime Model Download ----
# Large models (checkpoint ~6.5GB, SAM ~400MB, YOLO ~50MB) are downloaded
# on first startup to keep the image buildable on GitHub Actions runners.
# With a RunPod network volume, these persist across restarts.
COPY download-models.sh /usr/local/bin/download-models.sh
RUN chmod +x /usr/local/bin/download-models.sh

# Wrap the base image's /start.sh to download models first.
# We rename the original and replace it with our wrapper, rather than
# using ENTRYPOINT, which breaks RunPod serverless deployment.
RUN mv /start.sh /start-original.sh
COPY start-wrapper.sh /start.sh
RUN chmod +x /start.sh
