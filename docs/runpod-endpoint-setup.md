# RunPod Endpoint Setup for Juggernaut Ragnarok

## Serverless Endpoint (Image Generation)

The image generation pipeline uses a RunPod serverless endpoint running ComfyUI with the Juggernaut Ragnarok checkpoint.

### Setup Steps

1. Go to RunPod Console -> Serverless -> New Endpoint
2. Select your ComfyUI Docker image (or use a community ComfyUI serverless template)
3. Attach network volume: `nsw-comfyui-models`
4. Configure:
   - Min Workers: 0 (scale to zero when idle)
   - Max Workers: 2 (adjust based on demand)
   - GPU: RTX 4090 or A5000 (24GB VRAM minimum for SDXL)
   - Idle Timeout: 5 seconds
   - Execution Timeout: 300 seconds (5 min per image)
5. Copy the Endpoint ID and set it as `RUNPOD_ENDPOINT_ID` in `.env.local`

### Verify Checkpoint on Volume

Before the endpoint will work, ensure these files exist on the network volume:

```
/workspace/models/checkpoints/Juggernaut-Ragnarok.safetensors   (~6.5GB)
/workspace/models/checkpoints/sd_xl_base_1.0.safetensors        (~6.9GB, for training)
/workspace/models/upscale_models/4xNMKD-Siax_200k.pth          (~67MB)
```

Run `node scripts/download-models-to-runpod.mjs` to download them.

### Testing the Endpoint

```bash
# Submit a test job
curl -X POST "https://api.runpod.ai/v2/${ENDPOINT_ID}/run" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input": {"workflow": {"prompt": "test"}}}'

# Check status
curl "https://api.runpod.ai/v2/${ENDPOINT_ID}/status/${JOB_ID}" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}"
```

## Pod Endpoint (LoRA Training)

LoRA training uses on-demand pods (NOT serverless). These are created programmatically by the training pipeline.

### Requirements

- Network volume must have `sd_xl_base_1.0.safetensors` in `checkpoints/`
- Kohya Docker image pushed to GHCR: `ghcr.io/g858-debug/nsw-kohya-trainer:v5-ragnarok`
- `TRAINING_WEBHOOK_SECRET` must match between `.env.local` and the pod environment

### GPU Selection

The training pipeline uses `getAvailableGpusSortedByPrice()` to dynamically find the cheapest available GPU with:
- 24GB+ VRAM
- Secure cloud
- Under $1.00/hr

No manual GPU selection needed.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `RUNPOD_API_KEY` | RunPod API key for all RunPod operations |
| `RUNPOD_ENDPOINT_ID` | Serverless endpoint ID for image generation |
| `RUNPOD_NETWORK_VOLUME_ID` | Network volume ID for model storage |
| `KOHYA_TRAINER_IMAGE` | Docker image tag for training pods (default: `ghcr.io/g858-debug/nsw-kohya-trainer:v5-ragnarok`) |
| `TRAINING_WEBHOOK_SECRET` | Shared secret for training webhook auth |
| `CIVITAI_API_KEY` | Optional, for gated model downloads |
