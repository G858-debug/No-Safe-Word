# Pony V6 / CyberRealistic Pony Semi-Realistic — Scene Generation Guide

> **When to read this skill:** Before writing or enhancing ANY scene image prompt for the
> `pony_cyberreal` (V4) pipeline, before modifying the prompt builder or enhance endpoint,
> and when debugging image quality issues.

---

## 1. Prompt Architecture

### 1.1 Tag Order (Critical)

Pony V6 weighs earlier tags more heavily. Tag order directly affects output quality.
The optimal order for No Safe Word prompts:

```
[quality tags], [rating tag], [source tag],
[character LoRA trigger], [character count],
[pose/action], [expression/gaze],
[clothing/state of dress],
[body interaction tags (for intimate scenes)],
[setting/location], [specific objects/props],
[lighting source], [atmosphere],
[composition: shot type, angle, depth of field]
```

### 1.2 Quality Tags

Always start with quality tags. These are NOT optional:

```
score_9, score_8_up, score_7_up
```

Do NOT include `score_6_up` — it dilutes quality.
Do NOT include `score_9_up` — it has no real training data and can cause artifacts.

In the NEGATIVE prompt, include:
```
score_6, score_5, score_4
```

### 1.3 Rating Tags

Controls SFW/NSFW content generation:

| Tag | Use for | What it generates |
|-----|---------|-------------------|
| `rating_safe` | Facebook SFW images | No nudity, no sexual content |
| `rating_questionable` | Suggestive/teaser images | Revealing but not explicit |
| `rating_explicit` | Website NSFW images | Full nudity, sexual content |

For No Safe Word's dual-platform strategy:
- Facebook posts: `rating_safe` or `rating_questionable`
- Website paired images: `rating_explicit`
- Website-only atmospheric shots: `rating_safe` (no nudity needed)

### 1.4 Source Tags

Controls the visual style:

| Tag | Effect |
|-----|--------|
| `source_anime` | Anime/illustration style |
| `source_cartoon` | Western cartoon style |
| `source_pony` | MLP-adjacent style (avoid for our use case) |
| *(no source tag)* | Model defaults — often semi-realistic with CyberRealistic Pony Semi-Realistic |

**For No Safe Word:** With CyberRealistic Pony Semi-Realistic checkpoint, **omit source tags entirely** or
use `source_anime` lightly. The checkpoint already pushes toward semi-realism. Adding
`source_pony` will pull output toward the MLP aesthetic, which is wrong for our brand.

---

## 2. Body Proportion Control

### 2.1 Core Body Tags (for No Safe Word characters)

Our characters are curvaceous Black South African women. The following tags control proportions:

**Hips/Ass (PRIMARY emphasis — list these FIRST in body tags):**
- `huge ass` — strongest effect, very large
- `large ass` — substantial but slightly more natural
- `wide hips` — emphasises hip width specifically
- `thick thighs` — complements wide hips
- `bubble butt` — rounder, perkier shape
- `round ass` — shape descriptor
- Combine: `huge ass, wide hips, thick thighs` for maximum effect

**Breasts (SECONDARY emphasis — list AFTER hips/ass):**
- `huge breasts` — very large
- `large breasts` — large but less extreme
- `medium breasts` — moderate size
- Combine with: `cleavage` (visible), `sideboob` (side view), `underboob` (from below)

**Waist/Overall Shape:**
- `narrow waist` or `defined waist` — creates hourglass contrast
- `curvy` — general curvy body type
- `hourglass figure` — explicit shape descriptor
- `voluptuous` — fuller overall figure

**Tag order for body:** `wide hips, huge ass, thick thighs, large breasts, narrow waist`
(ass/hips first, then breasts, then waist — priority order)

### 2.2 Skin Tone Tags

- `dark skin` — general dark skin
- `dark-skinned female` — explicit dark-skinned woman
- `brown skin` — medium-dark
- `ebony skin` — very dark
- `skin detail` or `detailed skin` — adds texture and realism

**Important:** When using a character LoRA, these tags are baked into the trigger word.
Do NOT add skin tags to scene prompts if the character LoRA is loaded — it can cause
conflicting signals.

### 2.3 Body Positioning Tags for Natural Poses

The biggest complaint with LoRA-based generation is unnatural poses. Use specific
pose tags to counteract this:

**Standing poses:**
- `standing, hand on hip` — confident, natural
- `standing, leaning against wall` — casual
- `standing, arms crossed` — defensive/confident
- `standing, weight on one leg, contrapposto` — dynamic, natural hip shift

**Seated poses:**
- `sitting, legs crossed` — elegant
- `sitting on edge of bed` — intimate, suggestive
- `sitting, leaning forward` — engaged, interested
- `sitting on couch, legs tucked` — casual, relaxed

**Reclining poses:**
- `lying on side, propped on elbow` — classic pin-up
- `lying on back, looking up` — vulnerable, intimate
- `lying on stomach, looking over shoulder` — playful, suggestive

**Action poses:**
- `walking, looking over shoulder` — caught-in-motion
- `leaning on table, looking at viewer` — inviting
- `reaching for something` — narrative moment

---

## 3. SFW Suggestive Imagery (Facebook)

### 3.1 The "Moment Before" Technique

The most powerful SFW images show the moment BEFORE something explicit happens.
The viewer fills in the gap themselves. This is more engaging than nudity.

**Effective suggestive tags (all SFW-safe):**

Gaze and expression:
- `bedroom eyes, half-lidded eyes, looking at viewer` — seductive gaze
- `biting lip, looking at viewer` — anticipation
- `looking over shoulder, smirk` — caught-you-looking
- `half-closed eyes, parted lips` — arousal without nudity
- `eye contact, intense gaze` — direct challenge

Clothing state (revealing but covered):
- `off-shoulder top, bare shoulder` — skin showing, nothing explicit
- `unbuttoned shirt, cleavage` — suggestion of undressing
- `short skirt, thigh gap` — legs visible
- `low-cut dress, sideboob` — revealing angle
- `wet clothing, see-through (fabric)` — implied without nudity
- `towel, wrapped in towel` — post-shower, body hidden
- `oversized shirt, bare legs` — boyfriend's-shirt aesthetic

Narrative implication:
- `hand reaching for zipper` — about to undress
- `sitting on edge of unmade bed, one heel on, other on floor` — just arrived or leaving
- `leaning against doorframe, watching someone off-screen` — voyeuristic tension
- `fingers tracing along collarbone` — self-touch
- `hand on someone's chest` — physical connection

### 3.2 What to AVOID in SFW Images

Add to NEGATIVE prompt for Facebook images:
```
nsfw, nude, nudity, nipples, pussy, penis, sex, exposed breasts,
completely nude, topless, bottomless, genital, pubic hair
```

### 3.3 SFW Prompt Template

```
score_9, score_8_up, score_7_up, rating_safe,
[trigger_word], 1girl, solo,
[suggestive pose], [seductive expression], [gaze direction],
[revealing-but-covered clothing],
[narrative action tag],
[South African setting details],
[specific light source],
[atmosphere tags],
[composition: shot type, angle, depth of field]
```

---

## 4. NSFW / Explicit Imagery (Website)

### 4.1 Rating and Content Control

For explicit content, use `rating_explicit` in positive prompt.
Remove `nsfw, nude, nudity` from negative prompt.

### 4.2 Nudity Tags

**Partial nudity:**
- `topless` — bare breasts
- `bottomless` — bare below waist
- `partially clothed, partially undressed` — in the process of undressing
- `open shirt, no bra` — shirt open, breasts visible
- `pulled-down panties` — halfway undressed

**Full nudity:**
- `completely nude, nude` — fully unclothed
- `naked` — alternative to nude
- `bare skin` — emphasis on exposed skin

**Specific body parts (explicit):**
- `nipples, areolae` — breast detail
- `navel` — stomach/belly button
- `ass focus` — rear emphasis
- `thigh focus` — leg emphasis
- `back, bare back` — back view

### 4.3 Intimate/Sexual Scene Tags

**Solo intimate (one character):**
- `masturbation, touching self` — self-pleasure
- `spread legs` — open posture
- `on bed, lying on bed, bedsheet` — bedroom setting
- `afterglow, post-coital` — after intimacy

**Couple intimate (two characters):**
- `1boy, 1girl` — essential character count
- `hetero, couple` — relationship marker
- `embrace, hugging` — romantic contact
- `kiss, kissing` — oral contact
- `hand on another's face, cupping face` — tender touch
- `body contact, skin contact` — physical closeness
- `pressed against wall` — urgent/passionate
- `straddling, girl on top` — positioning
- `missionary, from above, from below` — viewing angles for sex scenes
- `doggy style, from behind` — positioning
- `cowgirl position` — positioning

**Important anatomy tags for explicit scenes:**
- `sex, vaginal, penetration` — explicit intercourse
- `cum, cumming` — orgasm (use "cum" not "come" per brand guidelines)
- `sweat, sweating, glistening skin` — physical exertion
- `heavy breathing, open mouth, panting` — arousal
- `grabbing, groping` — physical interaction
- `biting neck, neck kiss` — intimate contact

### 4.4 Anatomical Accuracy for Explicit Scenes

Pony/SDXL can struggle with body part positioning in explicit scenes.
Use these tags to improve anatomical accuracy:

- Be SPECIFIC about who is doing what: `1boy behind 1girl` not just `sex`
- Specify hand placement: `hands on hips`, `hand on breast`, `gripping sheets`
- Specify leg positioning: `legs wrapped around`, `one leg raised`, `legs spread`
- Specify face direction: `face down, ass up`, `looking back at partner`, `eyes closed in pleasure`
- Use `from behind`, `from above`, `from below`, `from side` to lock the camera angle

### 4.5 NSFW Prompt Template

```
score_9, score_8_up, score_7_up, rating_explicit,
[trigger_word_1], [trigger_word_2 if dual],
1girl, 1boy,
[specific position/action], [body contact details],
[expression: pleasure, vulnerability, intensity],
[state of undress or nudity],
[hand/limb placement],
[South African setting details],
[specific light source — intimate: candlelight, bedside lamp, moonlight],
[atmosphere: steam, sweat, warmth],
[composition: tight framing, low angle, close-up]
```

---

## 5. SFW → NSFW Paired Prompts

### 5.1 The Pairing Principle

For every Facebook SFW image, there must be a Website NSFW image showing the SAME scene
one beat later. The viewer who subscribes should think "THIS is what I was missing."

**Rules:**
- Both prompts describe the same setting independently (no "same scene" references)
- SFW shows the moment before; NSFW shows what happens next
- Lighting, setting, and atmosphere tags should be nearly identical
- Character positioning advances: closer, more contact, less clothing
- Expression evolves: confident → vulnerable, daring → surrendering

### 5.2 Pairing Example

**SFW (Facebook):**
```
score_9, score_8_up, score_7_up, rating_safe,
lindiwe_nsw, sibusiso_nsw, 1girl, 1boy,
leaning against car door, arms crossed, half-smile,
looking up at partner, challenging expression,
off-shoulder top, gold earrings, jeans,
mechanic workshop background, car with open hood,
single amber streetlight, long shadows,
night scene, small town atmosphere, Middelburg,
close-medium two-shot, slight low angle, depth of field
```

**NSFW (Website paired):**
```
score_9, score_8_up, score_7_up, rating_explicit,
lindiwe_nsw, sibusiso_nsw, 1girl, 1boy,
pressed against car door, bodies close,
hand cupping her face, other hand on hip,
top slipped off shoulder, bare shoulder, collarbone,
foreheads touching, eyes closed, heavy breathing,
mouths almost touching, intimate distance,
mechanic workshop background, warm glow from bay door,
single amber streetlight, catches skin,
night scene, Middelburg,
tight two-shot, shallow depth of field
```

### 5.3 What Changes Between SFW and NSFW Pair

| Element | SFW | NSFW |
|---------|-----|------|
| Distance | Apart or arms-length | Pressed together, touching |
| Clothing | Fully dressed, maybe revealing | Slipped, unbuttoned, partially removed |
| Expression | Confident, challenging, daring | Vulnerable, breathless, surrendering |
| Gaze | At each other or at viewer | Eyes closed, lost in moment |
| Physical contact | None or minimal | Hands on body, faces close |
| Composition | Medium shot, some space | Tight shot, fills frame |

---

## 6. Lighting for Intimate Scenes

### 6.1 Effective Light Sources (Name Specific Sources)

Never use generic "warm lighting." Always name the source:

**Warm/Intimate:**
- `single bedside lamp, warm glow` — bedroom intimacy
- `candlelight, flickering shadows` — romantic, traditional
- `fireplace light, orange glow` — cozy, passionate
- `string lights, soft bokeh` — modern romantic

**Dramatic/Urgent:**
- `single amber streetlight` — outdoor rendezvous
- `neon sign through window, colored light on skin` — urban passion
- `car headlights, harsh shadows` — illicit encounter
- `lightning flash through window` — storm scene

**Vulnerable/Tender:**
- `moonlight through curtains, blue tones` — post-intimacy
- `dawn light, golden hour through blinds` — morning after
- `bathroom light through cracked door, backlighting` — private moment

### 6.2 Atmosphere Tags

- `steam, mist` — post-shower or rain scenes
- `sweat, glistening skin` — physical exertion
- `rain on window, water droplets` — weather atmosphere
- `dust motes in light` — golden hour warmth
- `breath visible` — cold setting, body heat

---

## 7. South African Setting Tags

### 7.1 Specific Locations (Not Generic "African")

**Urban:**
- `Johannesburg skyline, city apartment` — cosmopolitan
- `Soweto township, colorful houses` — township setting
- `Sandton hotel room, luxury interior` — upscale
- `Maboneng loft, industrial chic` — creative class

**Small Town:**
- `Middelburg night, quiet street` — No Safe Word's recurring setting
- `small town, amber streetlights` — rural Mpumalanga
- `farm house, rural landscape` — countryside

**Interior Details:**
- `shweshwe fabric, African print` — textile authenticity
- `beaded curtain, carved wood` — decor detail
- `Amarula bottle on nightstand` — South African drink
- `doek headwrap, being unwrapped` — intimate cultural detail
- `lace curtains, tiled floor` — township home interior

---

## 8. Composition and Camera Tags

### 8.1 Shot Types

- `close-up` — face/detail, maximum intimacy
- `upper body, bust shot` — head to waist
- `medium shot, cowboy shot` — head to mid-thigh
- `full body` — entire figure
- `extreme close-up` — detail: lips, eyes, hands

### 8.2 Camera Angles

- `from below, low angle` — power, dominance, imposing
- `from above, high angle` — vulnerability, submission
- `eye level` — neutral, direct engagement
- `dutch angle` — tension, unease
- `over shoulder shot` — voyeuristic, perspective

### 8.3 Depth and Focus

- `depth of field, bokeh` — subject sharp, background blurred
- `shallow depth of field` — extreme blur, focus on eyes or detail
- `everything in focus` — environmental storytelling
- `silhouette` — body shape without detail

### 8.4 Framing for Intimate Scenes

- `two-shot, couple shot` — both characters
- `tight framing, faces filling frame` — claustrophobic intimacy
- `negative space` — isolation, loneliness
- `partially obscured, seen through doorway` — voyeuristic
- `reflected in mirror` — doubles the scene
- `cropped composition` — suggestive, what's hidden matters

---

## 9. CyberRealistic Pony Semi-Realistic Specific Settings

### 9.1 Recommended Generation Settings

| Setting | Value | Notes |
|---------|-------|-------|
| Sampler | DPM++ SDE Karras | Or DPM++ 2M Karras |
| Steps | 30+ | Minimum 25 for quality |
| CFG Scale | 5 | Pony standard; 4-7 range |
| Clip Skip | 2 | Pony V6 requirement |
| Resolution | 832×1216 (portrait) or 1216×832 (landscape) | SDXL native ratios |
| VAE | Integrated (baked into checkpoint) | Do NOT load external VAE |

### 9.2 CyberRealistic Semi-Realistic Negative Prompt

```
score_6, score_5, score_4, source_pony,
(worst quality:1.2), (low quality:1.2), (normal quality:1.2),
lowres, bad anatomy, bad hands, signature, watermarks,
ugly, imperfect eyes, skewed eyes, unnatural face, unnatural body,
error, extra limb, missing limbs
```

Note: `source_pony` in NEGATIVE prevents MLP-style output.

### 9.3 Style Notes

- CyberRealistic Pony Semi-Realistic naturally produces stylized semi-realistic output
- For MORE realism: add `photo (medium), realistic` to positive; add `anime, cartoon, 3d, cgi` to negative
- For MORE stylised: add `source_anime` to positive; reduce realism tags
- The checkpoint has an integrated VAE — do NOT use an external VAE, it will cause color issues

---

## 10. Dual-Character Scene Tips

### 10.1 Tag Structure

Always specify both characters:
```
[trigger_1], [trigger_2], 1girl, 1boy, two-shot, couple
```

### 10.2 Spatial Relationship

Be explicit about who is where:
- `1boy behind 1girl` — specific relative position
- `face to face, facing each other` — mutual engagement
- `1girl sitting on 1boy's lap` — specific positioning
- `side by side, shoulder to shoulder` — companionship

### 10.3 AttentionCouplePPM Regions

For dual-character scenes using AttentionCouplePPM (region-based conditioning):
- Each character gets their own prompt region
- Keep overlap zone tight (~4%) to prevent character merging
- Front-load character count in the base conditioning (within CLIP's 77-token window)
- Landscape orientation (1216×832) for side-by-side scenes
- Each character's LoRA loads at 0.65-0.75 (lower than solo to prevent conflicts)

### 10.4 Common Dual-Character Failures

**Problem:** Characters merge into one person
**Fix:** Increase separation between regions, reduce overlap, add `2people` tag

**Problem:** One character dominates (the other looks generic)
**Fix:** Ensure both character LoRAs are loaded at similar strength

**Problem:** Characters facing wrong directions
**Fix:** Specify `facing each other` or `looking at partner` explicitly

---

## 11. Common Failures and Fixes

### Bad hands / extra fingers
**Negative:** `bad hands, extra fingers, fewer digits, fused fingers, mutated hands`
**Also:** Use FaceDetailer with hand detection model for post-processing

### Flat, lifeless lighting
**Fix:** Replace generic lighting tags with specific sources. Add `rim light`, `volumetric lighting`, `light rays` for drama.

### Uncanny valley faces (too smooth, waxy)
**Fix:** Add `skin detail, pores, skin texture` to positive. This pushes CyberRealistic Semi-Realistic toward more textured rendering.

### Wrong body proportions (too thin/too thick)
**Fix:** Check tag order — body tags must be near the front of the prompt for stronger effect. Use specific tags like `wide hips` rather than vague `curvy`.

### Character LoRA overriding the scene (always same pose)
**Fix:** Reduce LoRA strength from 0.85 to 0.65-0.70. Add stronger pose tags.

### Dark images / can't see the character
**Fix:** Add explicit visibility guarantee: `well-lit, clearly visible subject, light illuminating face`. Name a bright light source.

### NSFW content not generating despite rating_explicit
**Fix:** Ensure `nsfw, nude` is NOT in negative prompt. Add explicit action tags. Check that the checkpoint supports NSFW (CyberRealistic Pony Semi-Realistic does natively).

---

## 12. Danbooru Tag Reference

For comprehensive tag lists, reference these databases:
- [Danbooru Wiki Tag Groups](https://danbooru.donmai.us/wiki_pages/tag_groups)
- [Pony Diffusion Recognized Tags (Google Sheet)](https://docs.google.com/spreadsheets/d/1m2W-pZEvHuEpfHcNHrxCSr-Aw1mgtUUYho6sz9LChEA/)
- [Civitai: Pony V6 XL Prompting Resources](https://civitai.com/articles/4871)
- [Civitai: Pony Realism Compendium](https://civitai.com/articles/6621)
- [Civitai: Another Prompting Guide for Pony](https://civitai.com/articles/9378)
- [Civitai: Pony XL Image Generation Guide](https://civitai.com/articles/6044)
