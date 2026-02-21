FROM runpod/worker-comfyui:5.7.1-base

# ---- Custom Nodes ----
# Impact Pack: FaceDetailer, SAMLoader
# Impact Subpack: UltralyticsDetectorProvider (separated since Impact Pack v8.0)
RUN comfy-node-install comfyui-impact-pack comfyui-impact-subpack

# IPAdapter Plus: IPAdapterUnifiedLoaderFaceID, IPAdapterFaceID (face consistency for story images)
# Must use comfy-node-install (not git clone) so the node is registered with ComfyUI's snapshot
RUN comfy-node-install comfyui_ipadapter_plus

# Diagnostic: verify IPAdapter Plus installation and ComfyUI compatibility
COPY diagnose-ipadapter.py /tmp/diagnose-ipadapter.py
RUN python3 /tmp/diagnose-ipadapter.py && rm /tmp/diagnose-ipadapter.py

# InsightFace + ONNX Runtime for FaceID face embedding extraction
# Must pin insightface>=0.7 — default `pip install insightface` installs 0.2.1 (from 2019)
# which lacks FaceAnalysis.providers support needed by IPAdapter FaceID.
# insightface>=0.7 has no pre-built wheel for Python 3.12, so we build from source.
# Requires: g++ (build-essential) and Cython. Cleaned up after to keep image small.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3-dev && \
    pip install --no-cache-dir Cython && \
    pip install --no-cache-dir 'insightface>=0.7' onnxruntime-gpu && \
    apt-get purge -y build-essential python3-dev && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

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
print('All HuggingFace LoRAs downloaded.')\
"

# ---- Build-time CivitAI LoRA Downloads ----
# These LoRAs require a CivitAI API key. Passed as a build arg from GitHub Actions.
# If the key is not provided, these are skipped and fall back to runtime download.
ARG CIVITAI_API_KEY=""
RUN if [ -n "${CIVITAI_API_KEY}" ]; then \
  python3 -c "\
import urllib.request, os, sys;\
key = '${CIVITAI_API_KEY}';\
loras = [\
  (f'https://civitai.com/api/download/models/359579?type=Model&format=SafeTensor&token={key}', 'better-bodies-xl.safetensors'),\
  (f'https://civitai.com/api/download/models/2686970?token={key}', 'cinecolor-harmonizer.safetensors'),\
  (f'https://civitai.com/api/download/models/435833?token={key}', 'melanin-mix-xl.safetensors'),\
  (f'https://civitai.com/api/download/models/1543944?token={key}', 'couples-poses-xl.safetensors'),\
];\
d = os.environ['COMFY_DIR'] + '/models/loras/';\
failed = 0;\
for url, name in loras:\
    print(f'Downloading {name}...');\
    try:\
        req = urllib.request.Request(url);\
        req.add_header('User-Agent', 'Mozilla/5.0 (ComfyUI-Worker)');\
        resp = urllib.request.urlopen(req, timeout=300);\
        with open(d + name, 'wb') as f:\
            import shutil; shutil.copyfileobj(resp, f);\
        resp.close();\
        print(f'  done ({os.path.getsize(d + name) // 1024 // 1024}MB)');\
    except Exception as e:\
        print(f'  FAILED: {e}', file=sys.stderr); failed += 1;\
print(f'CivitAI LoRAs: {len(loras) - failed}/{len(loras)} downloaded.');\
"; \
else \
  echo '[NSW] CIVITAI_API_KEY not provided as build arg — CivitAI LoRAs will be downloaded at runtime'; \
fi

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
