# Qwen 2.5 VL 72B — RunPod Setup Guide

## Overview

The Art Director system uses Qwen 2.5 VL 72B Instruct as a self-hosted vision-language model. It runs on a RunPod GPU pod with vLLM serving an OpenAI-compatible API.

Self-hosting avoids NSFW content filtering from hosted API providers (OpenAI, Anthropic, Google).

## Prerequisites

- RunPod account with `RUNPOD_API_KEY` configured in `.env.local`
- Hugging Face token with access to `Qwen/Qwen2.5-VL-72B-Instruct` (set `HUGGINGFACE_TOKEN` in `.env.local`)
- A100 80GB GPU availability on RunPod (the 72B VL model needs ~75GB VRAM in FP16)

## Automatic Setup

The Art Director can auto-create the pod via the API:

```bash
# Create a new pod
curl -X POST http://localhost:3000/api/art-director/pod \
  -H 'Content-Type: application/json' \
  -d '{"action": "create"}'

# Response: { "podId": "abc123", "endpoint": "https://abc123-8000.proxy.runpod.net" }
```

After creation, add the pod ID to `.env.local`:
```
QWEN_VL_POD_ID=abc123
QWEN_VL_API_KEY=EMPTY
```

## Manual Setup (RunPod Dashboard)

1. Go to RunPod → Pods → Deploy
2. Select **A100 80GB** GPU (PCIe or SXM4)
3. Docker image: `vllm/vllm-openai:latest`
4. Docker command override:
   ```
   --model Qwen/Qwen2.5-VL-72B-Instruct --max-model-len 32768 --tensor-parallel-size 1 --trust-remote-code --dtype auto --gpu-memory-utilization 0.95
   ```
5. Container disk: 150 GB (model weights are ~140 GB)
6. Volume: 150 GB (for Hugging Face cache)
7. Expose port: 8000/http
8. Environment variables:
   - `HUGGING_FACE_HUB_TOKEN`: Your HF token
9. Deploy and note the pod ID

## Environment Variables

Add to `.env.local`:
```bash
# RunPod pod ID (from creation or dashboard)
QWEN_VL_POD_ID=your_pod_id_here

# API key for vLLM (default: EMPTY — vLLM doesn't require auth by default)
QWEN_VL_API_KEY=EMPTY
```

## Health Check

```bash
# Check if the model is loaded and ready
curl https://{podId}-8000.proxy.runpod.net/health

# Test inference
curl https://{podId}-8000.proxy.runpod.net/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen/Qwen2.5-VL-72B-Instruct",
    "messages": [{"role": "user", "content": "Hello, what model are you?"}],
    "max_tokens": 100
  }'
```

Or via the API:
```bash
curl http://localhost:3000/api/art-director/pod
# Response: { "podId": "abc123", "status": "running", "endpoint": "...", ... }
```

## Cost Management

The A100 80GB costs ~$1.50-2.50/hr on RunPod. To save costs:

```bash
# Stop the pod when not in use (preserves disk, stops GPU billing)
curl -X POST http://localhost:3000/api/art-director/pod \
  -H 'Content-Type: application/json' \
  -d '{"action": "stop"}'

# Resume when needed (faster than creating — model weights are cached on disk)
curl -X POST http://localhost:3000/api/art-director/pod \
  -H 'Content-Type: application/json' \
  -d '{"action": "start"}'
```

The dashboard's Art Director modal auto-starts the pod if it's stopped.

## Troubleshooting

### Model takes long to load
First boot downloads ~140 GB of model weights. This takes 5-15 minutes depending on network. Subsequent starts with cached weights take 3-5 minutes.

### OOM errors
The 72B model requires A100 80GB. It will NOT fit on A100 40GB, A40 (48GB), or RTX 4090 (24GB). Do not change the model — change the GPU.

### 503 during startup
vLLM returns 503 while loading the model. The health check endpoint distinguishes this from a genuine failure. Wait and retry.

### Token limit errors
`max-model-len 32768` supports images up to ~4K resolution. If you need higher resolution analysis, reduce `max-model-len` to free VRAM, but this is rarely needed.
