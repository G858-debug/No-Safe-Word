# Juggernaut XL Ragnarok — Pipeline Reference

## Overview

Juggernaut XL Ragnarok is a photorealistic SDXL checkpoint. It is the most downloaded SDXL model (520K+ downloads) and the final SDXL release from KandooAI / RunDiffusion.

**Key characteristics:**
- Photorealistic output with cinematic quality
- NSFW capability baked into training (trained with Booru tags on an NSFW dataset, merged with a Lustify-based NSFW pass for anatomical stability)
- Supports BOTH natural language prompts AND Booru-style tags
- No safety filter — ComfyUI has no built-in NSFW filter; content is controlled entirely through prompts
- Uses natural language for SFW scenes and Booru tags for NSFW anatomical detail

**Checkpoint file:** `Juggernaut-Ragnarok.safetensors`
**Architecture:** SDXL 1.0
**VAE:** Baked in (no separate VAE needed)
**License:** Check Civitai/HuggingFace for current license terms

## Generation Settings

| Parameter | Value | Notes |
|-----------|-------|-------|
| Resolution | 832×1216 (portrait), 1024×1024 (square) | Use standard SDXL resolutions |
| Sampler | DPM++ 2M SDE | Primary recommendation |
| Scheduler | Karras | |
| Steps | 30–40 | 30 for speed, 40 for quality |
| CFG | 3–5 | Lower = more realistic. 3 for maximum realism, 5 for more prompt adherence |
| Denoise | 1.0 | For txt2img. Use 0.2–0.4 for img2img refinement |

## HiRes / Upscale Settings

| Parameter | Value |
|-----------|-------|
| Upscaler | 4xNMKD-Siax_200k |
| Upscale Steps | 15 |
| Upscale Denoise | 0.3 |
| Upscale Factor | 1.5x |

## Prompt Structure

### Component Order (earlier = more weight)

Ragnarok respects prompt token order — place the most important elements first.

1. **Subject** — The primary focus (woman, man, two people, etc.)
2. **Action** — What the subject is doing
3. **Clothing** — CRITICAL for SFW. Ragnarok defaults toward nudity due to NSFW training. Always describe clothing explicitly for SFW images.
4. **Expression/Emotion** — Facial expression, eye contact direction
5. **Environment/Setting** — Where the scene takes place
6. **Lighting** — Specific light source (never generic)
7. **Style/Medium** — "photograph", "cinematic", "photorealistic"
8. **Perspective/Composition** — Camera angle, shot type, depth of field
9. **Color/Atmosphere** — Mood, color palette, atmospheric elements
10. **Texture/Material** — Surface details, fabric descriptions

### Prompt Size

Try not to exceed 75 tokens. SDXL has a 77-token CLIP limit — content beyond this is truncated. Be concise and specific rather than verbose.

### Quality Boosters (optional)

For maximum photorealism, prepend:
```
masterpiece, 4k, ray tracing, intricate details, highly-detailed, hyper-realistic, 8k RAW Editorial Photo
```

For film/analog aesthetic:
```
film grain ISO 200 faded film, 35mm photo, grainy, vignette, vintage, Kodachrome, Lomography, stained, highly detailed, found footage
```

For clean photographic look:
```
photograph, high resolution, cinematic, skin textures, detailed skin
```

### SFW Prompting Rules

**CRITICAL:** Because Ragnarok was trained on NSFW data, SFW images require explicit clothing descriptions. Without clothing in the prompt, the model may default to nudity or revealing states.

**Always include in SFW prompts:**
- Specific clothing descriptions (e.g., "elegant dress", "fitted blazer and tailored trousers", "casual streetwear")
- Add NSFW-prevention tokens to negative prompt: `nudity, naked, nsfw, topless, nude`

**SFW negative prompt template:**
```
nudity, naked, nsfw, topless, nude, bad eyes, blurry, missing limbs, bad anatomy, cartoon, low quality, worst quality, deformed
```

### NSFW Prompting Rules

For explicit/intimate content, use Booru-style tags for anatomical precision:
- Booru tags give more reliable anatomical results than natural language for NSFW
- Keep the scene description in natural language, use Booru for body/positioning
- The model was specifically trained with Booru-tagged NSFW data

**NSFW prompt pattern:**
```
[Natural language scene description], [Booru body/position tags], [lighting], [composition]. Photorealistic.
```

**Standard negative prompt (NSFW):**
```
bad anatomy, bad hands, extra limbs, watermark, blurry, text, cartoon, illustration, painting, low quality, worst quality, deformed
```

### What NOT to Do

- **Don't use Pony quality tags** — `score_9`, `score_8_up`, `source_pony` etc. are Pony-specific and meaningless to Ragnarok
- **Don't use `rating_safe` / `rating_explicit`** — these are Pony rating tags
- **Don't leave clothing out of SFW prompts** — the model will default toward nudity
- **Don't use CFG above 7** — causes waxy skin, oversaturation, and unrealistic output
- **Don't exceed 75 tokens** — content is truncated beyond the CLIP limit
- **Don't use generic lighting** — "warm lighting" is vague. Name the source: "single amber streetlight", "candlelight", "golden hour through window"

## LoRA Compatibility

- Ragnarok is SDXL 1.0 architecture — compatible with all SDXL LoRAs
- Character LoRAs should be trained against **SDXL 1.0 base** (not Ragnarok itself) for maximum portability across SDXL fine-tunes
- LoRA injection via ComfyUI LoraLoader nodes — same pattern as Pony pipeline
- Keep total LoRA count minimal (1-2 per generation) to preserve prompt adherence. The Pony pipeline used 6+ style LoRAs — this is NOT recommended for Ragnarok. The checkpoint handles photorealism natively.

## Skin Tone and Ethnicity

Ragnarok uses natural language for ethnicity and skin tone — not Booru tags.

**For Black South African characters across the full skin tone spectrum:**
- Describe skin tone explicitly: "light brown skin", "medium-brown skin", "dark brown skin", "deep brown skin", "warm caramel skin"
- Include ethnicity naturally: "Black South African woman", "young Zulu man"
- Hair texture and style should be described independently of skin tone
- African identity is expressed through the combination of facial features + hair texture + skin tone — not skin darkness alone

**Testing guidance:** Before committing to production, generate test batches at various skin tones and lighting conditions to verify the checkpoint renders them well without supplementary LoRAs.

## Comparison with Previous Pipeline (CyberRealistic Pony)

| Aspect | CyberRealistic Pony | Juggernaut Ragnarok |
|--------|---------------------|---------------------|
| Aesthetic | Semi-realistic | Photorealistic |
| Prompt style | Booru tags only | Natural language + Booru for NSFW |
| Quality tags | `score_9, score_8_up` | `masterpiece, 4k, hyper-realistic` or none |
| CFG | 5.0 | 3–5 |
| Style LoRAs needed | 6 (Ebony Pony, Skin Tone, etc.) | 0 — checkpoint handles photorealism natively |
| NSFW capability | Via rating tags | Baked in — clothing required for SFW |
| Negative prompt style | Pony-specific negatives | Standard SDXL negatives |
| Sampler | dpmpp_2m_sde / karras | dpmpp_2m_sde / karras (same) |
