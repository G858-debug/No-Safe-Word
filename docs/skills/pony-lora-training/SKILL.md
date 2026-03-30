# Pony CyberRealistic Character LoRA Training — Best Practices

## Purpose

This document is the authoritative reference for training character identity LoRAs on the Pony V6 / CyberRealistic Pony SDXL pipeline. Every training parameter, dataset decision, and captioning rule documented here reflects tested community best practices adapted for our specific use case: **original fictional Black South African characters in a semi-realistic aesthetic**.

Claude Code MUST read this file before modifying any training-related code. If a parameter in the code contradicts this document, this document wins unless the user explicitly overrides.

---

## Our Use Case — What Makes It Different

Most LoRA training guides assume you're training on an existing character with readily available reference images (anime screenshots, celebrity photos). Our situation is different:

1. **Original characters** — no reference images exist. We generate the training dataset with the same model we'll later use the LoRA on. This creates a chicken-and-egg dynamic: the dataset must be internally consistent enough to teach a clear identity, generated solely from text descriptions.

2. **Characters with specific skin tones** — Our characters span a range of skin tones (light-brown, medium-brown, dark-brown, deep ebony). Pony V6 will drift toward its training data average if the LoRA doesn't firmly anchor the character's specific skin tone. This matters for any skin tone — a light-skinned character can drift lighter just as a dark-skinned character can drift lighter. The LoRA must lock in exactly what's in the training images.

3. **Semi-realistic aesthetic** — CyberRealistic Pony sits between photorealism and anime. Training images must match this aesthetic. Photorealistic training images will push the LoRA toward realism; anime training images will pull it toward stylisation. Consistency matters.

4. **Body identity matters** — unlike typical face-only LoRAs, our characters have specific body types (curvaceous, full breasts, defined waist, round hips). The LoRA must capture body proportions alongside facial identity.

5. **Both SFW and NSFW usage** — the trained LoRA will be used for SFW Facebook images and NSFW website images. It must be flexible enough for both, without baking in clothing or nudity.

---

## Dataset Preparation

### Image Count

- **Target: 15–20 curated images** for the final training set
- Generate 40–60 candidates, then curate down
- More images is NOT better — 20 high-quality, consistent images outperform 50 inconsistent ones
- Quality and consistency always beat quantity

### Image Requirements

**Resolution:**
- Minimum 1024×1024 (SDXL native)
- Kohya's bucketing handles mixed aspect ratios, but keeping images at consistent resolutions reduces training noise
- Recommended: generate all training images at 1024×1024 square for simplicity

**Content variety — what to include:**
- 4–5 face close-ups (different angles: front, 3/4 left, 3/4 right, slight up, slight down)
- 3–4 upper body shots (different poses, different clothing)
- 3–4 full body shots (standing, sitting, different outfits)
- 2–3 expression variations (smiling, serious, laughing, contemplative)
- 2–3 lighting variations (warm indoor, cool outdoor, dramatic shadow)

**Content variety — what to AVOID:**
- No other people in the frame (even partially visible — cropped hands, background faces)
- No text, watermarks, or UI elements
- No extreme poses that distort proportions
- No images where the character looks significantly different from others (consistency is king)
- No very dark or very bright images where features are hard to distinguish
- No images with heavy stylistic filters that differ from the base CyberRealistic look

**Background handling:**
- Mixed backgrounds are fine (Kohya learns to separate subject from background)
- Avoid pure white or pure black backgrounds — they can create artifacts
- Natural, varied backgrounds (indoor, outdoor, neutral) work best
- Do NOT remove backgrounds to transparency — this is SDXL, not SD 1.5

### Quality Evaluation (Claude Vision Auto-Review)

When the pipeline's Claude Vision evaluator reviews generated training images, it should score on these criteria (1–10 each):

1. **Face consistency** (weight: 3x) — Does the face match the character description? Consistent bone structure, eye shape, nose, lips across images?
2. **Skin tone accuracy** (weight: 2x) — Is the skin tone correct and consistent? Not lighter or darker than specified?
3. **Body proportion accuracy** (weight: 2x) — Does the body match the description? Correct build, proportions?
4. **Image quality** (weight: 1x) — Sharp, well-composed, no artifacts, no extra limbs?
5. **Aesthetic consistency** (weight: 1x) — Does it match the semi-realistic CyberRealistic style? Not too photorealistic, not too anime?
6. **Pose uniqueness** (weight: 1x) — Is this pose sufficiently different from already-approved images?

**Thresholds:**
- Score 8+ → auto-approve
- Score 5–7 → flag for review (include in dataset if needed for variety)
- Score below 5 → auto-reject

**Target after evaluation:** 15–20 approved images with good variety in pose, angle, expression, and lighting, but strong consistency in face, skin, and body.

---

## Captioning / Tagging

### Format

Pony V6 uses **booru-style comma-separated tags**, not natural language captions. Every training image must have a matching `.txt` file with the same filename.

### Trigger Word

Every caption MUST start with the character's trigger word. Use a unique, non-dictionary string:

```
Format: {firstname}_{identifier}
Example: lindiwe_nsw, sibusiso_nsw, zanele_nsw
```

The `_nsw` suffix (No Safe Word) ensures the trigger word doesn't collide with any existing concept in the model's training data.

### What to INCLUDE in captions

- Trigger word (always first)
- Character count: `1girl`, `1boy`, `solo`
- Pose: `standing`, `sitting`, `leaning`, `looking at viewer`, `looking away`
- Expression: `smile`, `serious`, `parted lips`, `closed eyes`
- Framing: `portrait`, `upper body`, `full body`, `close-up`
- Clothing (describe what's visible): `fitted blazer`, `white t-shirt`, `gold earrings`
- Setting/lighting: `indoor`, `outdoor`, `warm lighting`, `dramatic shadow`

### What to EXCLUDE from captions (CRITICAL)

These are the features the LoRA should LEARN to associate with the trigger word. If you tag them, the model learns them as separate concepts rather than as part of the character's identity:

- **Skin tone** — never tag `dark skin`, `light skin`, `brown skin`, `pale`, `tan` or any skin shade descriptor
- **Hair color** — never tag `black hair`
- **Hair style** — never tag `braids`, `dreadlocks`, `afro` (unless the character changes hairstyles and you want style flexibility)
- **Eye color** — never tag `brown eyes`, `dark eyes`
- **Body type** — never tag `curvy`, `thick thighs`, `wide hips`, `large breasts`
- **Ethnicity** — never tag `african`, `black woman`
- **Age indicators** — never tag `young`, `mature`

**Why this matters:** If you tag skin tone in captions (e.g., `dark skin` or `light skin`), the model learns that skin tone is a separate attribute from the trigger word. When you later use the LoRA without that tag, the model may drift toward its default rather than the character's actual skin tone. By excluding skin/body/face tags, all these features get baked into the trigger word itself.

### Example caption

```
lindiwe_nsw, 1girl, solo, smile, looking at viewer, upper body,
fitted blazer, gold earrings, indoor, warm lighting, office background
```

Notice: no skin color, no hair description, no body type, no ethnicity. Just the trigger word + what's happening in the image.

### Pony Score Tags in Training Captions

**Do NOT add `score_9` or quality tags to training captions.** These are inference-time tags that tell the model what quality level to target. Adding them to training data creates a dependency — the LoRA may only activate properly when quality tags are present.

Let the training images speak for themselves through their actual quality.

---

## Training Parameters

### Recommended Defaults (Pony V6 Character LoRA)

```
Checkpoint:        ponyDiffusionV6XL (base) or CyberRealisticPony v17
Network module:    networks.lora
Network dim:       8
Network alpha:     8
Optimizer:         prodigy
LR scheduler:      cosine_with_restarts
LR scheduler cycles: 3
Learning rate:     1.0 (Prodigy auto-adjusts; this is the starting point)
Noise offset:      0.03
Epochs:            12
Batch size:        2 (increase to 3–4 if GPU has 24GB+ VRAM)
Resolution:        1024,1024
Clip skip:         2 (mandatory for Pony V6)
Mixed precision:   bf16 (use fp16 only if GPU doesn't support bf16)
Caption extension: .txt
Max token length:  225
Seed:              42
Save every N epochs: 3
Cache latents:     true
Cache latents to disk: true
Gradient checkpointing: true
xFormers:          true
```

### Parameter Explanations

**Network dim: 8** — This is the LoRA rank. For character identity (face + body), 8 is sufficient. Styles and complex concepts need 16–32. Higher dim = larger file size and more risk of overfitting. Character LoRAs at dim 8 typically produce 50–100MB files.

**Network alpha: 8** — Equal to dim for character LoRAs. The community consensus for Pony character training is dim:alpha ratio of 1:1. Style LoRAs sometimes use 2:1 (e.g., dim 16, alpha 8). Don't set alpha higher than dim.

**Optimizer: Prodigy** — Self-adapting learning rate optimizer. Best choice for character LoRAs because it automatically finds the right learning rate. Set initial LR to 1.0 and let Prodigy handle the rest. Arguments: `decouple=True, weight_decay=0.01, d_coef=2, use_bias_correction=True, safeguard_warmup=True`.

**Alternative optimizer: AdaFactor** — Good alternative if Prodigy isn't available. Use with LR 1e-4 and cosine scheduler.

**Noise offset: 0.03** — Improves detail consistency, especially for facial features. Higher values (0.05+) can cause color shifts. 0.03 is the sweet spot for character LoRAs on Pony.

**Clip skip: 2** — MANDATORY for Pony V6. The model was trained with clip skip 2. Using clip skip 1 will produce noticeably worse results. This is not optional.

**Epochs: 12** — With 15–20 images and appropriate repeats, 12 epochs is a good balance. Save checkpoints every 3 epochs (epochs 3, 6, 9, 12) and test each. Often epoch 9 or 10 produces the best results — the final epoch is not always the best.

**Batch size: 2** — Safe for RTX 4090 (24GB VRAM) with gradient checkpointing. Increase to 3–4 on higher-VRAM GPUs. Batch size 1 works but trains slower with potentially noisier gradients.

### Repeats Calculation

Kohya uses repeats to control how many times each image is seen per epoch. The formula:

```
total_steps_per_epoch = (num_images × repeats) / batch_size
total_training_steps = total_steps_per_epoch × num_epochs
```

**Target: 1500–3000 total training steps** for character LoRAs.

Calculation guide:
- 15 images × 14 repeats / 2 batch = 105 steps/epoch × 12 epochs = 1260 steps
- 20 images × 10 repeats / 2 batch = 100 steps/epoch × 12 epochs = 1200 steps
- 15 images × 20 repeats / 2 batch = 150 steps/epoch × 12 epochs = 1800 steps

**Rule of thumb:** `repeats = max(1, 500 / num_images)`, capped at 50.

### What NOT to Do

- **Don't train the text encoder** for character LoRAs on Pony. UNet-only training is more stable and produces more flexible LoRAs. Text encoder training is for style LoRAs only, and even then it's risky on SDXL.
- **Don't use regularization images** for character LoRAs. Regularization helps prevent style bleed for style LoRAs, but for character identity LoRAs it can dilute the identity signal.
- **Don't use flip augmentation** unless the character is perfectly symmetrical. For characters with asymmetric features (parted hair, moles, scars), flipping creates conflicting signals.
- **Don't set noise offset above 0.05** — causes color/brightness shifts.
- **Don't use learning rate warmup with Prodigy** — Prodigy has its own warmup via `safeguard_warmup`.
- **Don't overtrain** — more epochs is not better. Check the saved checkpoints. Signs of overtraining: rigid poses, color saturation increase, loss of detail, "deep-fried" look.

---

## Training Base Model Selection

**For training: use Pony Diffusion V6 XL** (the base model), NOT CyberRealistic Pony.

CyberRealistic Pony is a fine-tune of Pony V6. Training a LoRA on a fine-tune of a fine-tune compounds any quirks. Training on the base Pony V6 XL produces LoRAs that work well across ALL Pony V6 fine-tunes, including CyberRealistic.

**For inference: use CyberRealistic Pony** (your production checkpoint).

The LoRA trained on base Pony V6 will load into CyberRealistic Pony without issues — SDXL LoRAs are architecturally compatible across fine-tunes of the same base.

Download: `https://huggingface.co/AstraliteHeart/pony-diffusion-v6/resolve/main/v6.safetensors`

---

## LoRA Inference Parameters

When USING the trained LoRA during image generation:

**LoRA strength: 0.75–0.85** — Start at 0.8. If the character looks stiff or over-stylised, reduce to 0.7. If identity isn't coming through strongly enough, increase to 0.9. Never go above 1.0.

**Strength adjustment by scene type:**
- Character portrait: 0.85 (identity is the focus)
- Scene with character: 0.75–0.80 (let the scene breathe)
- Explicit/NSFW scene: 0.70–0.75 (higher strength can cause pose rigidity)
- Dual-character scene: 0.70 each (two LoRAs at full strength compete)

**Trigger word is mandatory** — always include the trigger word in the prompt when the LoRA is loaded. Without it, the LoRA's effect is unpredictable.

---

## Troubleshooting

### Identity isn't consistent

- **Check dataset consistency** — if training images have high face variance, the LoRA learns a blurry average. Curate more aggressively.
- **Increase network dim** to 12 or 16 — the identity may be too complex for dim 8 (rare for single characters, more common for characters with elaborate tattoos, scars, or unusual features).
- **Check caption quality** — if identity features leaked into captions, the LoRA isn't learning them as part of the trigger word.

### Skin tone doesn't match the character

- **Caption audit** — ensure NO skin-related tags in captions. Not `dark skin`, not `light skin`, not `brown skin` — none. The trigger word must carry all skin tone information.
- **Dataset check** — ensure ALL training images have the correct, consistent skin tone. Even one or two outliers with a different shade will pull the average. This is the most common cause of skin tone drift.
- **Increase LoRA strength** at inference to 0.85–0.90 to reinforce the trained identity.
- **Add skin tone tags at inference time** — as a fallback, include the character's specific skin tone tag (e.g., `dark skin` or `light brown skin`) in the inference prompt alongside the trigger word. This shouldn't be necessary if the LoRA is well-trained, but it's a valid reinforcement.

### Character looks "deep-fried" or over-saturated

- **Overtrained** — use an earlier epoch checkpoint. Check epochs 6–9 instead of 12.
- **Reduce noise offset** to 0.02.
- **Reduce LoRA strength** at inference to 0.65–0.70.

### Poses are rigid or repetitive

- **Dataset variety issue** — add more pose variety to training images.
- **Overtrained** — use an earlier epoch.
- **Reduce LoRA strength** at inference — high strength locks in trained poses.

### LoRA works for portraits but not full-body

- **Dataset needs more full-body images** — ensure at least 4–5 full-body shots in the training set.
- **Body proportions may not have been captured** — if all training images are face close-ups, the LoRA only learns the face. Include variety.

### LoRA conflicts with scene composition

- **Reduce LoRA strength** — identity LoRAs at high strength can override scene-level composition tags.
- **Use later clip layers** — if using attention-couple for dual-character scenes, the LoRA may need to be scoped to specific regions.

---

## File Naming Conventions

```
Training dataset:   datasets/{character_id}/{trigger_word}/
Individual images:  {trigger_word}_{001..020}.png
Caption files:      {trigger_word}_{001..020}.txt  (same name, .txt extension)
Packaged dataset:   datasets/{character_id}/{trigger_word}_dataset.tar.gz
Trained LoRA:       loras/lora_{trigger_word}_{timestamp}.safetensors
Validation images:  validation/{character_id}/{trigger_word}_val_{001..005}.png
```

---

## Pipeline Integration Notes

- The dataset generator (`pony-dataset-generator.ts`) generates candidates via RunPod serverless (inference endpoint)
- The evaluator (`training-image-evaluator.ts`) uses Claude Vision to auto-approve/reject
- The caption builder (`training-caption-builder.ts`) generates booru tags, strips identity tags
- The trainer (`pony-lora-trainer.ts`) orchestrates the full pipeline via RunPod pods (batch GPU)
- The validator (`pony-character-lora-validator.ts`) generates test images with the new LoRA
- All stages persist state to `story_characters.lora_training_progress` (JSONB)
- The pipeline is resumable from any failed stage

**Training runs on RunPod PODS (not serverless)** — training is a 30–60 minute batch job, not a quick inference call. The pod runs the Kohya Docker image, trains, uploads the result, and self-terminates.

**Estimated cost per character LoRA:** $0.30–0.70 (RTX 4090 at ~$0.50/hr × 30–60 min training time, plus ~$0.10 for dataset generation inference).
