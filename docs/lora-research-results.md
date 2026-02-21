# LoRA Research Results — Premium Cinematic & Skin Enhancement

Research date: 2026-02-21
Search method: CivitAI API v1, filtered to SDXL 1.0 base model, sorted by Most Downloaded

---

## Category 1: Film Grain / Cinematic Color Grading

### Candidate A: CineColor_Harmonizer (RECOMMENDED)
- **CivitAI:** https://civitai.com/models/2389677
- **Downloads:** 58 | **Likes:** 4
- **Version ID:** 2686970
- **File:** CineColor_Harmonizer-000011.safetensors (56 MB)
- **Base model:** SDXL 1.0
- **Trigger word:** `sunset_gold_film`
- **Recommended strength:** 0.3–0.5 (subtle warmth), up to 0.8 for dramatic scenes
- **What it does:** Pure color-grading LoRA — warm golden highlights, deep shadows, high-contrast film aesthetics. Does NOT alter anatomy, composition, or subject matter.
- **Why it fits:** Small file size (56MB), non-destructive, compatible with realistic models. Adds the "warm directional lighting" quality our style guide calls for without fighting other LoRAs. Works well at low strength as an always-on cinematic enhancer.

### Candidate B: XL25 Analog
- **CivitAI:** https://civitai.com/models/2121933
- **Downloads:** 233 | **Likes:** 16
- **Version ID:** 2400355
- **File:** 25-11_Analog_V1.safetensors (870 MB)
- **Base model:** SDXL 1.0
- **Trigger word:** `25analogv1` (plus many era-specific triggers)
- **Recommended strength:** 0.5–0.8
- **What it does:** Full vintage film emulation (1950s–1990s). Warm tones, grain, faded colors, high saturation. Very stylized.
- **Why it was rejected:** 870MB file size is large for a subtle enhancement. Strong vintage bias may conflict with our modern South African setting. Film grain needs to be added post-generation. Too heavy-handed for always-on use.

### Candidate C: Dark_Mood_Atmosphere
- **CivitAI:** https://civitai.com/models/2380516
- **Downloads:** 84 | **Likes:** 11
- **Version ID:** 2676950
- **File:** Dark_Mood_Atmosphere-000007.safetensors (223 MB)
- **Base model:** SDXL 1.0
- **Trigger word:** `jarod_darkomood`
- **Recommended strength:** 0.6–1.0
- **What it does:** Deep dramatic shadows, directional cinematic lighting, moody atmosphere.
- **Why it was rejected:** Designed for anime/2.5D. Described as transforming "anime or 2.5D" images. May not suit photorealistic pipeline. Also overlaps with our existing cinematic-lighting-xl slider.

---

## Category 2: Dark Skin Enhancement

### Candidate A: [XL] Melanin Girlfriend mix (RECOMMENDED)
- **CivitAI:** https://civitai.com/models/390634
- **Downloads:** 1,289 | **Likes:** 186
- **Version ID:** 435833
- **File:** melanin-XL.safetensors (223 MB)
- **Base model:** SDXL 1.0
- **Trigger word:** `melanin`
- **Recommended strength:** 0.8–1.0 (per creator), we'll use 0.4–0.6 to enhance without dominating
- **What it does:** Trained on 1,000+ curated influencer images of Black women. Improves skin tone accuracy, texture rendering, and feature representation for dark-skinned subjects.
- **Why it fits:** By far the most downloaded and highest-rated SDXL LoRA for dark skin rendering. Trained on real photographs (not AI art). The trigger word "melanin" integrates naturally. At lower strengths (0.4–0.6) it subtly improves skin rendering without overriding character-specific features injected by IPAdapter.
- **Concern:** Trained primarily on women — may need testing with male characters. At high strength could bias face features.

### No other viable SDXL candidates found
Other results were anime character LoRAs (Illustrious base), not skin texture enhancers.

---

## Category 3: Natural / Dynamic Posing

### No recommendation — no viable SDXL option exists

**Best candidate found:** Better Hands & Natural Poses (model 2352839, 143 downloads)
- Tagged as anime, no confirmed photorealistic support
- Overlaps significantly with our existing `negative-hands-v2` LoRA
- 250MB for marginal improvement

**Why we're skipping this category:**
The SDXL LoRA ecosystem for posing is dominated by anime/Illustrious models. No photorealistic posing LoRA with meaningful adoption exists. Natural posing is better achieved through prompt engineering (our Five Layers system already handles this via "Composition & Framing" layer) and our use of 40-step sampling with karras scheduler.

---

## Final Recommendations

| Category | LoRA | Version ID | File Size | Strength | Always-on? |
|----------|------|-----------|-----------|----------|------------|
| Cinematic color | CineColor_Harmonizer | 2686970 | 56 MB | 0.3 | Yes (all images) |
| Dark skin | Melanin Girlfriend mix | 435833 | 223 MB | 0.5 | Conditional (dark-skinned subjects) |
| Natural posing | — | — | — | — | Skipped |

**Total additional disk:** ~279 MB
**LoRA cap change:** Increase from 4 to 5 (adding up to 2 new LoRAs, but only 1 at a time alongside existing 4)
