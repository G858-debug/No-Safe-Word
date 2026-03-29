# Pony V6 / CyberRealistic Pony — Character LoRA Training Guide

> **When to read this skill:** Before generating training datasets, curating training images,
> preparing captions, configuring training parameters, evaluating LoRA output, or debugging
> character consistency issues in the `pony_cyberreal` (V4) image pipeline.

---

## 1. Overview

Character LoRAs are small model files (~50-150MB) that teach the base model to recognise a specific
character's identity — face shape, skin tone, hair, body proportions, distinguishing features —
via a trigger word. When the trigger word appears in a prompt, the LoRA activates and produces
that character consistently.

For No Safe Word, each story character gets their own LoRA trained on CyberRealistic Pony v17
(Pony V6 SDXL variant). The LoRA is then loaded at inference time alongside the checkpoint.

**Pipeline position:** Character design → Dataset generation → Curation → Captioning → Training → Approval → Scene generation.

---

## 2. Training Dataset Generation

### 2.1 Quantity and Quality Rules

- Generate **40-60 candidate images** per character using CyberRealistic Pony with detailed booru tags
- Curate down to **15-20 final training images**
- **Quality over quantity** — 15 excellent images outperform 50 mediocre ones
- Using more than ~25 images can decrease reproducibility and introduce unwanted variation
- All training images should be **stylistically consistent** — same checkpoint, same general quality level
- Do NOT mix photorealistic and anime-style images in one training set

### 2.2 Required Diversity

The training set MUST include variety across these dimensions:

**Angles (minimum 4 of these):**
- Front-facing (looking at viewer)
- Three-quarter view (turned ~45°)
- Side profile
- Looking over shoulder
- Slight high angle (looking up at viewer)
- Slight low angle (looking down)

**Framing (minimum 3 of these):**
- Close-up / portrait (head and shoulders)
- Upper body / bust shot
- Medium shot (waist up)
- Full body

**Expressions (minimum 3 of these):**
- Neutral / resting face
- Smiling / warm
- Serious / intense
- Suggestive / seductive (for NSFW capability)

**Lighting (minimum 2 of these):**
- Well-lit / daylight
- Warm indoor lighting
- Dramatic side-lighting
- Low light / evening

**Clothing states (minimum 2 of these):**
- Dressed / casual
- Dressed / formal or work attire
- Revealing but clothed (for SFW boundary)
- Intimate / minimal clothing (for NSFW capability)

### 2.3 What NOT to Include

- Images with anatomical errors (extra fingers, distorted limbs)
- Images where the face is obscured, heavily shadowed, or at extreme angles (back of head)
- Images where skin tone is inconsistent with the character design
- Images with busy, distracting backgrounds that compete with the character
- Images where body proportions deviate significantly from the character spec
- Images that are blurry, artifacted, or low quality
- Multiple characters in one image (training images should be solo)

### 2.4 Generation Prompt Template

When generating candidate training images, use this tag structure:

```
score_9, score_8_up, score_7_up, rating_[safe|questionable],
1girl, solo, [ethnicity tags], [skin tone] skin,
[hair color] hair, [hair style], [eye color] eyes,
[body type tags: curvy, wide hips, thick thighs, large breasts, defined waist],
[face shape], [distinguishing features],
[clothing for this image],
[expression for this image],
[pose for this image],
[background: simple, not distracting],
[lighting for this image],
[framing: close-up | upper body | full body],
depth of field
```

**Key principle:** Include ALL character-identifying features in every generation prompt.
These same features will later be REMOVED from training captions so the LoRA learns to
associate them with the trigger word.

---

## 3. Training Image Curation

### 3.1 Selection Criteria

When curating from 40-60 candidates down to 15-20 finals, evaluate each image against:

**MUST HAVE (reject if any fail):**
- [ ] Face is clearly visible and well-defined
- [ ] Skin tone matches character spec
- [ ] No anatomical errors (hands, fingers, limbs)
- [ ] Body proportions match character spec
- [ ] Image is sharp, not blurry or artifacted

**SHOULD HAVE (prefer images that meet these):**
- [ ] Expression is natural, not frozen or uncanny
- [ ] Pose feels natural and relaxed
- [ ] Lighting is flattering and consistent
- [ ] Background is clean, not distracting
- [ ] Hair style and color are correct

**DIVERSITY CHECK (the final 15-20 must collectively cover):**
- [ ] At least 4 different angles
- [ ] At least 3 different framings
- [ ] At least 3 different expressions
- [ ] At least 2 different lighting conditions
- [ ] At least 2 different clothing states

### 3.2 The "Same Person" Test

Look at all 15-20 selected images together. Ask: do these all look like the same person?
If any image looks like it could be a different character, remove it — even if it's otherwise
high quality. Consistency across the training set is more important than any individual image.

### 3.3 Resolution and Cropping

- Crop all images to **1024x1024** for Pony/SDXL training
- SDXL supports bucketing (mixed aspect ratios), but consistent 1024x1024 is simplest
- If using varied aspect ratios, keep within SDXL supported ratios: 1024x1024, 832x1216, 1216x832
- The character should fill most of the frame — avoid large empty backgrounds
- For close-up shots, ensure the face is at least 30% of the image area

---

## 4. Captioning / Tagging

### 4.1 Tagging Method

For Pony V6, use **booru-style tags** (comma-separated), NOT natural language captions.
Use WD Tagger 1.4 for automatic tagging, then manually edit.

### 4.2 The Trigger Word

Every training image caption MUST start with the character's trigger word.

**Trigger word format:** `charactername_nsw` (lowercase, underscored, suffixed with _nsw for No Safe Word)

Examples: `lindiwe_nsw`, `sibusiso_nsw`, `zanele_nsw`

### 4.3 Tags to REMOVE from Captions

After auto-tagging, REMOVE all character-identifying features. The LoRA must learn these
from the images themselves, associated with the trigger word — not from the text.

**Remove these categories:**

- **Hair:** `black hair`, `braids`, `low bun`, `long hair`, `short hair`, etc.
- **Eyes:** `brown eyes`, `dark eyes`, etc.
- **Skin:** `dark skin`, `dark-skinned female`, `medium-brown skin`, etc.
- **Body:** `curvy`, `wide hips`, `thick thighs`, `large breasts`, `voluptuous`, `slim`, etc.
- **Face:** `oval face`, `high cheekbones`, `round face`, etc.
- **Ethnicity:** `african`, `black`, `ndebele`, etc.

**Keep these categories:**

- **Pose:** `standing`, `sitting`, `leaning`, `arms crossed`, etc.
- **Expression:** `smile`, `serious`, `looking at viewer`, `half-lidded eyes`, etc.
- **Clothing:** `fitted blazer`, `jeans`, `off-shoulder top`, `gold earrings`, etc.
- **Scene elements:** `indoor`, `outdoor`, `simple background`, etc.
- **Composition:** `close-up`, `upper body`, `full body`, etc.
- **Lighting:** `warm lighting`, `dramatic shadows`, etc.

### 4.4 Pony Score Tags in Training

- Include `score_9` ONLY on your genuinely best training images (top ~30%)
- Include `score_8_up` on good images
- Include `score_7_up` on acceptable images
- Do NOT use `score_9` on low-quality images — this confuses the aesthetic classifier
- Alternatively, omit score tags entirely from training captions to avoid biasing the LoRA

### 4.5 Example Caption (BEFORE and AFTER editing)

**Auto-tagged (before):**
```
1girl, solo, dark skin, dark-skinned female, black hair, braids, brown eyes,
curvy, wide hips, large breasts, fitted blazer, gold earrings,
smile, looking at viewer, upper body, indoor, warm lighting
```

**Edited for training (after):**
```
lindiwe_nsw, 1girl, solo, fitted blazer, gold earrings,
smile, looking at viewer, upper body, indoor, warm lighting
```

Notice: all identity tags removed. Only pose, clothing, expression, and scene tags remain.

---

## 5. Training Parameters

### 5.1 Recommended Settings for Pony V6 Character LoRAs

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Base model** | CyberRealisticPony_v17.safetensors or ponyDiffusionV6XL | Train on the model you'll use for inference |
| **Network type** | LoRA | Not LyCORIS, not full fine-tune |
| **Network dim (rank)** | 8 | Characters are simpler than styles; 8 is sufficient |
| **Network alpha** | 8 | Equal to dim for characters |
| **Optimizer** | Prodigy or AdaFactor | With cosine with restarts scheduler |
| **Learning rate** | 1e-4 (if AdaFactor) | Prodigy is adaptive, auto-adjusts |
| **Text encoder LR** | 5e-5 | 1/2 of the network LR |
| **Batch size** | 1-2 (12GB VRAM), 3-5 (16GB+) | Higher batch = more stable training |
| **Epochs** | 10-15 | Save every epoch to pick the best one |
| **Resolution** | 1024x1024 | SDXL native; bucketing handles mixed sizes |
| **Clip skip** | 2 | Pony V6 standard |
| **Noise offset** | 0.03 | Better for small details like eyes; 0.1 can blur fine features |
| **Shuffle tags** | Yes | Teaches the LoRA that tag order is variable |
| **Keep tokens** | 1 | Keeps trigger word first, shuffles the rest |
| **Flip augmentation** | No | Only for symmetrical subjects; can confuse asymmetric features |
| **Sampler for samples** | DPM++ SDE Karras | Pony standard |
| **CFG for samples** | 5 | Pony standard |

### 5.2 Calculating Repeats

Total training images = dataset_size × repeats × epochs.

For a 20-image dataset with 15 epochs, you want total steps around 1500-3000:
- 20 images × 5 repeats = 100 images per epoch
- 100 × 15 epochs = 1500 total steps (lower bound, good starting point)

Adjust repeats so that: `dataset_size × repeats × epochs ≈ 1500-3000`

### 5.3 Sample Prompts During Training

Set `Sample every n epochs: 1` and `Save model every n epochs: 1`.

Use this sample prompt to monitor training progress:
```
score_9, score_8_up, score_7_up, rating_safe,
[trigger_word], 1girl, solo, looking at viewer, smile,
standing, upper body, simple background,
warm lighting, depth of field
```

This generates a standard portrait at each epoch so you can visually compare progression
and identify the optimal epoch (before overtraining sets in).

---

## 6. Evaluating Trained LoRAs

### 6.1 Signs of a Good LoRA

- Character is recognisable across different poses and angles
- Face shape, skin tone, and body proportions are consistent
- The LoRA activates reliably with the trigger word
- Expressions look natural, not frozen
- Works well at strength 0.7-0.9 without artifacts
- Doesn't force a specific pose (character should be posable)

### 6.2 Signs of Overtraining

- Character always appears in the same pose regardless of prompt
- Background elements from training images bleed into new generations
- Face looks "waxy" or overly smooth
- Expressions are limited to what was in the training set
- Reducing LoRA strength below 0.7 causes the character to disappear
- Colors become oversaturated or washed out

### 6.3 Signs of Undertraining

- Character is vaguely similar but not consistently recognisable
- Face shape drifts between generations
- Skin tone varies significantly
- Trigger word has weak effect — character only appears sometimes
- Need strength > 1.0 to get any resemblance

### 6.4 The Epoch Selection Process

- Generate the same test prompt across all saved epochs (e.g., epochs 1-15)
- Compare side by side
- Earlier epochs are often more flexible (easier to pose)
- Later epochs are more consistent but may be rigid
- The sweet spot is usually epochs 8-12 for a 15-epoch run
- Pick the epoch where the character is recognisable AND still flexible

### 6.5 Inference Strength Guidelines

| Use case | Recommended strength | Notes |
|----------|---------------------|-------|
| Standard scene | 0.75-0.85 | Good balance of identity and flexibility |
| Close-up portrait | 0.85-0.95 | Higher strength for face accuracy |
| Full body action | 0.65-0.75 | Lower strength for better pose freedom |
| NSFW/explicit | 0.70-0.80 | Slightly lower to prevent pose rigidity |
| Dual character scene | 0.65-0.75 each | Lower per-character to prevent conflicts |

---

## 7. Troubleshooting

### Problem: "All generations look the same / character won't change pose"
**Cause:** Overtrained LoRA or training set lacked pose diversity.
**Fix:** Use an earlier epoch. If all epochs are rigid, retrain with more pose variety in the dataset.

### Problem: "Face looks different in every generation"
**Cause:** Undertrained, or training images had inconsistent faces.
**Fix:** Use a later epoch. If still inconsistent, curate the training set more strictly — ensure all images look like the same person.

### Problem: "Skin tone keeps changing"
**Cause:** Identity tags (skin tone descriptors) were left in the training captions, so the LoRA didn't learn to associate skin tone with the trigger word.
**Fix:** Remove all skin/ethnicity tags from captions and retrain.

### Problem: "Character has artifacts at high LoRA strength"
**Cause:** Overtraining or network dim too high for the character's complexity.
**Fix:** Reduce strength to 0.7-0.8. If still bad, retrain with dim 4 instead of 8.

### Problem: "Eyes look blurry or inconsistent"
**Cause:** Noise offset too high (0.1 blurs fine details).
**Fix:** Retrain with noise offset 0.03.

### Problem: "LoRA works on base Pony but not on CyberRealistic Pony"
**Cause:** Training on a different base model than inference.
**Fix:** Train on the same checkpoint you'll use for generation. If you train on base Pony V6, test on base Pony V6. If you generate with CyberRealistic Pony v17, train on CyberRealistic Pony v17.

---

## 8. No Safe Word Specific Guidelines

### 8.1 Character Body Requirements

All female characters must be curvaceous with emphasis on:
- **Hips/ass first** — this is the primary body emphasis
- **Breasts second** — large but secondary to hips
- **Defined waist** — creates the hourglass silhouette

In training dataset prompts, include these body tags to get the right proportions.
Then REMOVE them from training captions so the LoRA learns the body shape from images.

### 8.2 SFW/NSFW Dual Capability

The training set should include BOTH clothed and revealing images so the LoRA works
for both Facebook SFW content and website NSFW content. Include:
- 10-12 SFW images (dressed, various outfits)
- 5-8 NSFW-adjacent images (revealing clothing, intimate poses, partial undress)

This ensures the LoRA doesn't collapse to either "always dressed" or "always undressed."

### 8.3 Ethnicity and Skin Tone

Our characters are predominantly Black South African women. Training images must:
- Use consistent, accurate skin tone descriptors during generation
- Remove ALL ethnicity/skin tags from training captions
- Ensure the final LoRA reliably produces the correct skin tone without prompting
- Test the trained LoRA WITHOUT any skin/ethnicity tags to verify the identity is baked in

---

## 9. Training Platform Options

### Option A: Civitai On-Site Trainer (Simplest)
- Upload dataset, select Pony V6 XL as base model
- ~500 Buzz cost
- Limited parameter control but good defaults
- Tag-based captioning supported

### Option B: Kohya SS on RunPod GPU Pod (Most Control)
- Spin up a RunPod GPU pod (NOT serverless), run Kohya SS
- Full parameter control
- 12GB+ VRAM recommended
- Install: https://github.com/bmaltais/kohya_ss

### Option C: Replicate (if SDXL trainer available)
- Check for `ostris/sdxl-lora-trainer` or equivalent
- Familiar workflow from existing Flux LoRA training
- May have limited parameter control

---

## 10. Reference Links

- [LoRA Training Guide: SDXL | Pony | Illustrious (Civitai)](https://civitai.com/articles/24648)
- [SDXL Pony Fast Training Guide (Civitai)](https://civitai.com/models/351583)
- [On-Site LoRA Training Settings Guide by Diamond (Civitai)](https://civitai.com/articles/8737)
- [Opinionated Guide to All LoRA Training, 2025 Update (Civitai)](https://civitai.com/articles/1716)
- [PonyV6 Character Training (DigitalCreativeAI)](https://www.digitalcreativeai.net/en/post/original-character-lora-pony-character-training)
- [Detailed LoRA Training Guide (ViewComfy)](https://www.viewcomfy.com/blog/detailed-LoRA-training-guide-for-Stable-Diffusion)
- [AI Consistent Character Generator Guide 2026 (Apatero)](https://www.apatero.com/blog/ai-consistent-character-generator-multiple-images-2026)
- [Holostrawberry's LoRA Training Guide](https://arcenciel.io/articles/1)
- [Kohya SS GitHub](https://github.com/bmaltais/kohya_ss)
