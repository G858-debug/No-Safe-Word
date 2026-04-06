# SDXL Character LoRA Training — Pipeline Reference

## Overview

Character LoRAs are trained using Kohya sd-scripts (`sdxl_train_network.py`) on RunPod GPU pods. Training runs as a fire-and-forget batch job — the orchestrator creates the pod, the pod trains, uploads the result, and POSTs a webhook on completion.

**Base model for training:** SDXL 1.0 base (NOT Juggernaut Ragnarok). Training against the base model produces portable LoRAs that work across all SDXL fine-tunes (Juggernaut, RealVisXL, epiCRealism, etc.).

**Inference checkpoint:** Juggernaut XL Ragnarok (or any SDXL fine-tune). The trained LoRA is injected into the workflow at inference time.

## Two-Pass Training Architecture

We use a two-pass training approach for maximum character flexibility:

### Pass 1: Initial LoRA
1. Generate 40–60 candidate dataset images using Juggernaut Ragnarok (via RunPod serverless)
2. Evaluate with Claude Vision — auto-score each image
3. Curate to best 30–50 images meeting diversity requirements
4. Human approval — user reviews dataset in dashboard, can veto any AI pass/fail
5. Caption with natural language (trigger word + scene description, identity tags stripped)
6. Package images + captions → tar.gz → Supabase Storage
7. Train on RunPod pod (Kohya, ~30–60 min)
8. Validate — generate 6 test images, score against reference portrait

### Pass 2: Refined LoRA (after Pass 1 validation succeeds)
1. Use Pass 1 LoRA at low strength (0.3–0.5) to generate 40–60 NEW images
2. Use diverse prompts: varied poses, expressions, lighting, clothing, backgrounds
3. Optionally mix checkpoints (generate some images with Juggernaut, some with RealVisXL) for style diversity
4. Evaluate, curate to best 30–50
5. Human approval
6. Retrain on the expanded dataset
7. Validate — the Pass 2 LoRA should be significantly more flexible than Pass 1

**Why two passes:** The first LoRA learns from a narrow distribution (one checkpoint's interpretation of the character). The second pass uses that LoRA to generate more diverse training data, producing a LoRA that generalises across scenes, poses, and styles. This is the approach used by the Everly Heights Story Studio project for serialised visual storytelling.

**Cost:** ~$0.60–1.40 per character (doubled from single-pass, negligible for the quality gain).

## Dataset Requirements

### Image Count
- **Generate:** 40–60 candidates per pass
- **Curate to:** 30–50 final training images
- Quality and consistency always beat quantity
- Pass 2 can have a larger dataset (up to 50) because the source images are more diverse

### Image Distribution

Target a roughly 60/40 face-to-body ratio with more repeats on face images:

| Category | Count | Repeats | Purpose |
|----------|-------|---------|---------|
| Face close-ups | 10–12 | 40 | Facial identity — bone structure, eyes, nose, lips |
| Head-and-shoulders | 6–8 | 25 | Face + upper body transition |
| Waist-up | 6–8 | 20 | Upper body proportions, clothing variety |
| Full-body | 8–10 | 20 | Body proportions, full figure, posture |

**Total steps target:** ~1500–2000 (repeats × images × epochs)

### Variety Requirements

**Must include across the dataset:**
- 3+ face angles (front, 3/4 left, 3/4 right, slight up, slight down)
- 3+ expressions (smiling, serious, laughing, contemplative)
- 3+ lighting conditions (warm indoor, cool outdoor, dramatic shadow, golden hour)
- 4+ clothing variations (casual, formal, sleepwear, activewear)
- 4+ background types (indoor, outdoor, neutral, environmental)

**Must AVOID:**
- Other people in the frame (even partial — cropped hands, background faces)
- Text, watermarks, UI elements
- Extreme poses that distort proportions
- Very dark or very bright images where features are indistinguishable
- Pure white or pure black backgrounds (cause artifacts)
- Repeated clothing/hairstyle across many images (causes overfitting)

### Body Shape Requirements (Female Characters)

All female characters have specific body types defined in their character data. The LoRA must capture body proportions alongside facial identity. The dataset must include enough full-body and waist-up shots to teach the model the character's figure.

## Training Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Base model | SDXL 1.0 base | NOT the inference checkpoint — for portability |
| Network dim | 32 | Higher than Pony's 8 — photorealistic needs more capacity for facial detail |
| Network alpha | 16 | Half of dim |
| Optimizer | Prodigy | Self-adjusting learning rate |
| Learning rate | 1.0 | Prodigy handles the actual LR internally |
| Scheduler | cosine_with_restarts | |
| Noise offset | 0.03 | |
| Resolution | 1024 | SDXL native |
| Batch size | 2 | |
| Clip skip | 1 | SDXL standard (Pony used 2 — don't carry that over) |
| Epochs | 10–15 | Save checkpoints every 2 epochs to find the sweet spot |
| Save every N epochs | 2 | Test intermediate checkpoints — the best LoRA is rarely the last epoch |
| Mixed precision | fp16 | |
| Cache latents | Yes | Reduces VRAM, maintains quality |
| Cache text encoder | Yes | |

**Key changes from Pony pipeline:**
- Network dim increased from 8 → 32 (photorealistic faces need more capacity)
- Network alpha changed from 8 → 16 (half of dim)
- Clip skip changed from 2 → 1 (SDXL standard)
- Epochs reduced from 12 → 10–15 with more frequent checkpointing
- Save every 2 epochs instead of 4 (more checkpoints to test)

## Captioning

Use **natural language captions** (not Booru tags). Ragnarok was trained with both styles, but natural language produces better results for photorealistic character LoRAs.

### Caption Format

```
{trigger_word}, a [age] [ethnicity] [gender] [action/pose], [clothing], [expression], [setting], [lighting]
```

### Identity Tag Stripping

The trigger word carries the character's identity. Strip these from captions so the model associates them with the trigger word, not with explicit text:
- Hair color and style
- Eye color
- Skin tone
- Body type descriptors
- Ethnicity
- Distinguishing facial features

**Example caption:**
```
lindiwe_nsw, a young woman smiling, fitted blazer and tailored trousers, warm expression looking at camera, modern office interior, soft window light
```

NOT:
```
lindiwe_nsw, a young Black South African woman with medium-brown skin, oval face, high cheekbones, dark brown eyes, neat braids in low bun, slim curvaceous figure, smiling...
```

The second version bakes identity into the text — the model should learn identity from the images, not from repeated text descriptions.

## Quality Evaluation (Claude Vision)

Each generated dataset image is evaluated by Claude Vision on these criteria (1–10 each):

1. **Face consistency** (weight: 3x) — Does the face match the character description? Consistent bone structure, eye shape, nose, lips?
2. **Skin tone accuracy** (weight: 2x) — Is the skin tone correct and consistent with the character's specified tone?
3. **Body proportion accuracy** (weight: 2x) — Does the body match the description? Correct build, proportions?
4. **Image quality** (weight: 1x) — Sharp, well-composed, no artifacts, no extra limbs?

**Pass threshold:** Weighted score ≥ 6.0
**Minimum passed images:** 25 (per pass)

### Evaluation Output

Each evaluation must produce:
- **Verdict:** pass or fail
- **Score:** weighted numeric score
- **Reason:** 1–2 sentence description explaining the verdict (e.g., "Face structure matches reference well but skin tone is slightly lighter than specified medium-brown" or "Full body proportions are accurate but right hand has six fingers")

### Human Veto

The user can override any AI evaluation:
- **Veto a pass** — reject an image the AI approved (e.g., "the expression doesn't match my character's personality")
- **Veto a fail** — approve an image the AI rejected (e.g., "the slight skin tone variation is acceptable for training diversity")

The user's judgment is final. The AI evaluation is a first pass to save time, not an authority.

## Validation (Post-Training)

After training completes:
1. Generate 6 test images using the trained LoRA at strength 0.8
2. Test prompts should cover: portrait, waist-up, full-body, different clothing, different lighting, different expression
3. Each test image scored by Claude Vision for face consistency against the approved reference portrait
4. Minimum 5/6 must pass with face score ≥ 7

If validation fails → retry training with adjusted parameters (lower learning rate, different epoch checkpoint).

## Pipeline Files

| File | Purpose |
|------|---------|
| `packages/image-gen/src/lora-trainer.ts` | Pipeline orchestrator (replaces pony-lora-trainer.ts) |
| `packages/image-gen/src/dataset-generator.ts` | Training image generation (replaces pony-dataset-generator.ts) |
| `packages/image-gen/src/character-lora-validator.ts` | Post-training validation (replaces pony-character-lora-validator.ts) |
| `packages/image-gen/src/character-lora/training-image-evaluator.ts` | Dataset curation |
| `packages/image-gen/src/character-lora/training-caption-builder.ts` | Caption generation |
| `infra/kohya-trainer/train_entrypoint.py` | Kohya training script on RunPod pod |
| `apps/web/app/api/lora-training-webhook/route.ts` | Webhook handler for training completion |

## RunPod Infrastructure

- **Training:** RunPod PODS (batch GPU jobs, NOT serverless)
- **Inference:** RunPod serverless endpoints
- **GPU:** Dynamic selection via `getAvailableGpusSortedByPrice()` — 24GB+ VRAM, Secure cloud, $1.00/hr cap
- **Docker image:** `ghcr.io/g858-debug/nsw-kohya-trainer` (update tag when rebuilding)
- **Network volume:** `nsw-comfyui-models` — checkpoints and trained LoRAs stored here
- **Base checkpoint on volume:** SDXL 1.0 base (`sd_xl_base_1.0.safetensors`) — download from HuggingFace as fallback if not present

## Troubleshooting

### Training pod fails to start
- Check RunPod GPU availability with `getAvailableGpusSortedByPrice()`
- Verify Docker image tag exists on GHCR (tokens expire — check `write:packages` scope)
- Verify base checkpoint exists on network volume or HuggingFace fallback works

### LoRA works for faces but not full-body
- Dataset needs more full-body images (minimum 8–10)
- Increase network dim to 48 or 64 for more capacity
- Check that body shots aren't all the same pose/clothing

### LoRA overfit (generates same image regardless of prompt)
- Too many epochs or too many repeats — use an earlier checkpoint
- Dataset lacks variety — add more clothing/background/pose diversity
- Learning rate too high — try reducing (though Prodigy should handle this)

### Skin tone inconsistent across generations
- Dataset images may have inconsistent skin tones — curate more aggressively
- Lighting variation in dataset is important — include warm, cool, and neutral lighting
- If checkpoint struggles with specific skin tones, consider a skin rendering LoRA as supplement (test first without)
