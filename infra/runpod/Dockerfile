FROM runpod/worker-comfyui:5.7.1-base

# ---- Custom Nodes ----
# Impact Pack: FaceDetailer, SAMLoader
# Impact Subpack: UltralyticsDetectorProvider (separated since Impact Pack v8.0)
RUN comfy-node-install comfyui-impact-pack comfyui-impact-subpack

# ---- Checkpoint Models ----
# Juggernaut X v10 (high-quality SDXL photorealistic model, freely downloadable)
# To use Juggernaut XI v11 instead, replace URL with HF gated model URL and add --set-token
RUN comfy model download \
    --url "https://huggingface.co/RunDiffusion/Juggernaut-X-v10/resolve/main/Juggernaut-X-RunDiffusion-NSFW.safetensors" \
    --relative-path models/checkpoints \
    --filename juggernaut-x-v10.safetensors

# ---- LoRA Models ----
# detail-tweaker-xl (enhances fine detail, weight range [-3, 3])
RUN comfy model download \
    --url "https://huggingface.co/LyliaEngine/add-detail-xl/resolve/main/add-detail-xl.safetensors" \
    --relative-path models/loras \
    --filename detail-tweaker-xl.safetensors

# ---- Detection Models (for FaceDetailer) ----
# YOLO face detection (used by UltralyticsDetectorProvider)
RUN comfy model download \
    --url "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt" \
    --relative-path models/ultralytics/bbox \
    --filename face_yolov8m.pt

# SAM ViT-B (Segment Anything Model, used by SAMLoader for face masking)
RUN comfy model download \
    --url "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth" \
    --relative-path models/sams \
    --filename sam_vit_b_01ec64.pth
