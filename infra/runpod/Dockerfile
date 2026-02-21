FROM runpod/worker-comfyui:5.7.1-base

# ---- Custom Nodes ----
# Impact Pack: FaceDetailer, SAMLoader
# Impact Subpack: UltralyticsDetectorProvider (separated since Impact Pack v8.0)
RUN comfy-node-install comfyui-impact-pack comfyui-impact-subpack

# IPAdapter Plus: IPAdapterUnifiedLoaderFaceID, IPAdapterFaceID (face consistency for story images)
# Must use comfy-node-install (not git clone) so the node is registered with ComfyUI's snapshot
RUN comfy-node-install comfyui_ipadapter_plus

# Diagnostic: verify IPAdapter Plus installation and ComfyUI compatibility
RUN echo "=== Custom Nodes Directory ===" && \
    ls -la /comfyui/custom_nodes/ && \
    echo "=== IPAdapter Files ===" && \
    (ls /comfyui/custom_nodes/ComfyUI_IPAdapter_plus/__init__.py 2>/dev/null && echo "Found cubiq style" || echo "No cubiq dir") && \
    (ls /comfyui/custom_nodes/comfyui-ipadapter/__init__.py 2>/dev/null && echo "Found comfyorg style" || echo "No comfyorg dir") && \
    echo "=== Pip ipadapter ===" && \
    (pip list 2>/dev/null | grep -i ipadapter || echo "Not in pip") && \
    echo "=== ComfyUI Import Check ===" && \
    cd /comfyui && python3 -c "\
import sys; sys.path.insert(0, '.'); \
try: \
    import node_helpers; print('node_helpers: OK'); \
except Exception as e: print('node_helpers: FAILED -', e); \
try: \
    from comfy.clip_vision import clip_preprocess; print('clip_preprocess: OK'); \
except Exception as e: print('clip_preprocess: FAILED -', e); \
try: \
    from comfy.clip_vision import Output; print('clip_vision.Output: OK'); \
except Exception as e: print('clip_vision.Output: FAILED -', e); \
" && \
    echo "=== Full Node Import Test ===" && \
    cd /comfyui && python3 -c "\
import sys, os; sys.path.insert(0, '.'); os.chdir('/comfyui'); \
for d in os.listdir('custom_nodes'): \
    init = os.path.join('custom_nodes', d, '__init__.py'); \
    if os.path.isfile(init) and 'ipadapter' in d.lower(): \
        print(f'Testing import of {d}...'); \
        sys.path.insert(0, os.path.join('custom_nodes', d)); \
        try: \
            mod = __import__(d); \
            if hasattr(mod, 'NODE_CLASS_MAPPINGS'): \
                keys = list(mod.NODE_CLASS_MAPPINGS.keys()); \
                print(f'  Loaded {len(keys)} nodes'); \
                faceid = [k for k in keys if 'FaceID' in k]; \
                print(f'  FaceID nodes: {faceid}'); \
            else: print('  No NODE_CLASS_MAPPINGS'); \
        except Exception as e: \
            print(f'  IMPORT FAILED: {type(e).__name__}: {e}'); \
            import traceback; traceback.print_exc(); \
" || true

# InsightFace + ONNX Runtime for FaceID face embedding extraction
# comfy-node-install handles most deps, but we ensure insightface and onnxruntime-gpu are present
RUN pip install --no-cache-dir insightface onnxruntime-gpu

# Pre-download InsightFace buffalo_l models (used by IPAdapter FaceID at inference time)
# Uses a separate Python script to avoid Dockerfile inline syntax issues with `with` statements
ENV COMFY_DIR=/comfyui
COPY download-insightface.py /tmp/download-insightface.py
RUN python3 /tmp/download-insightface.py && rm /tmp/download-insightface.py

# ---- Build-time LoRA Downloads ----
# LoRAs are small (~1GB total) and critical for portrait generation.
# Baking them into the image guarantees they're available on every worker
# regardless of runtime network conditions.
# Uses Python urllib (not wget) because wget decodes percent-encoded chars
# in redirect URLs, breaking AWS S3 signatures for files with spaces.
# All downloads are in a single RUN layer to minimize disk usage on CI runners.
ENV COMFY_DIR=/comfyui
RUN mkdir -p ${COMFY_DIR}/models/loras && python3 -c "\
import urllib.request, os;\
loras = [\
  ('https://huggingface.co/LyliaEngine/add-detail-xl/resolve/main/add-detail-xl.safetensors', 'detail-tweaker-xl.safetensors'),\
  ('https://huggingface.co/ford442/sdxl-vae-bf16/resolve/main/LoRA/skin_texture_style_v4.safetensors', 'realistic-skin-xl.safetensors'),\
  ('https://huggingface.co/ffxvs/lora-effects-xl/resolve/main/detailedEyes_v3.safetensors', 'eyes-detail-xl.safetensors'),\
  ('https://huggingface.co/ffxvs/lora-effects-xl/resolve/main/hands_xl_v21.safetensors', 'negative-hands-v2.safetensors'),\
  ('https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cinematic-lighting/resolve/main/cinematic%20lighting.safetensors', 'cinematic-lighting-xl.safetensors'),\
];\
d = os.environ['COMFY_DIR'] + '/models/loras/';\
[print(f'Downloading {name}...') or urllib.request.urlretrieve(url, d + name) or print(f'  done') for url, name in loras];\
print('All LoRAs downloaded.')\
"

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
