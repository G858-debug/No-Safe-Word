# Qwen 2.5 VL 72B AWQ — RunPod Setup Guide

## Overview

The Art Director uses **Qwen 2.5 VL 72B Instruct AWQ** as a self-hosted vision-language model for image analysis, reference ranking, recipe adaptation, and evaluation. It runs on a RunPod GPU pod with vLLM serving an OpenAI-compatible API.

Self-hosting avoids NSFW content filtering from hosted API providers.

## Model & Infrastructure

| Setting | Value |
|---|---|
| Model | `Qwen/Qwen2.5-VL-72B-Instruct-AWQ` |
| Quantization | AWQ (4-bit, auto-detected by vLLM) |
| Docker image | `vllm/vllm-openai:v0.8.5` (pinned — later versions have compatibility issues) |
| GPU | NVIDIA A100 SXM 80GB (single GPU) |
| VRAM usage | ~40GB for AWQ weights + KV cache |
| Max model length | 32768 tokens |
| GPU memory utilization | 0.90 |
| Network volume | Mounted at `/runpod-volume`, `HF_HOME=/runpod-volume/huggingface` |
| Boot time | ~160s from cached weights on network volume |
| Pod name | `qwen-vl-72b-art-director` |
| Cost | A100 80GB SXM hourly rate on RunPod (~$1.50-2.50/hr) |

## vLLM Launch Args

```
--model Qwen/Qwen2.5-VL-72B-Instruct-AWQ
--max-model-len 32768
--tensor-parallel-size 1
--trust-remote-code
--gpu-memory-utilization 0.90
--enforce-eager
--limit-mm-per-prompt image=5
```

Key flags:
- `--enforce-eager` — Prevents CUDA graph OOM during model loading
- `--limit-mm-per-prompt image=5` — Allows up to 5 images per request (needed for reference ranking step)
- `--max-model-len 32768` — Supports 5 images (~10K tokens) + system prompt + SD knowledge in a single call

## Environment Variables

Add to `apps/web/.env.local`:
```bash
QWEN_VL_POD_ID=your_pod_id_here
QWEN_VL_API_KEY=EMPTY
HUGGINGFACE_TOKEN=your_hf_token_here
```

## Automatic Setup

Create a pod via the dashboard API:
```bash
curl -X POST http://localhost:3000/api/art-director/pod \
  -H 'Content-Type: application/json' \
  -d '{"action": "create"}'
```

This calls `createQwenVLPod()` in `pod-manager.ts`, which tries A100 SXM 80GB on SECURE then COMMUNITY clouds.

After creation, update `QWEN_VL_POD_ID` in `.env.local` with the returned pod ID.

## Start / Stop via API

```bash
# Check pod status
curl http://localhost:3000/api/art-director/pod

# Stop (preserves disk, stops GPU billing)
curl -X POST http://localhost:3000/api/art-director/pod \
  -H 'Content-Type: application/json' \
  -d '{"action": "stop"}'

# Resume (fast restart — model weights cached on network volume)
curl -X POST http://localhost:3000/api/art-director/pod \
  -H 'Content-Type: application/json' \
  -d '{"action": "start"}'
```

The dashboard's Art Director modal auto-starts the pod if it's stopped.

## Health Check

```bash
# Check if vLLM is ready
curl https://{podId}-8000.proxy.runpod.net/health

# List loaded models (confirms max_model_len)
curl https://{podId}-8000.proxy.runpod.net/v1/models

# Test inference
curl https://{podId}-8000.proxy.runpod.net/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen/Qwen2.5-VL-72B-Instruct-AWQ",
    "messages": [{"role": "user", "content": "Hello, what model are you?"}],
    "max_tokens": 100
  }'
```

## Troubleshooting

### First boot is slow
First deployment downloads ~40GB of AWQ weights. Subsequent starts from the network volume cache take ~160s.

### OOM errors
The AWQ model fits comfortably on A100 80GB (~40GB). If OOM occurs with `--max-model-len 32768`, fall back to `16384` — still enough for 3-4 images per call.

### 503 during startup
vLLM returns 503 while loading the model. The `healthCheck()` function in `qwen-vl-client.ts` distinguishes this from genuine failures. Wait and retry.

### Token limit errors
With `--max-model-len 32768`, the model supports ~5 images + full system prompt per call. If you need more images, batch them across multiple calls.

### Why AWQ instead of FP16?
The FP16 variant (`Qwen2.5-VL-72B-Instruct`) requires ~144GB VRAM — doesn't fit on a single A100 80GB. AWQ provides 4x memory savings with minimal quality loss for this use case (image analysis + structured JSON output).

### Why pinned to v0.8.5?
Later vLLM versions have compatibility issues with Qwen2.5-VL vision models. The v0.8.5 image is confirmed working.
