# Flux Image Prompting Skill

## Purpose

Guide for writing high-quality image generation prompts for Flux models (Flux 1, Flux Krea Dev, Flux Krea Dev Uncensored, Flux Kontext). Applies to both the **Image Generator** standalone tool and the **Story Publisher** scene generation pipeline in the No Safe Word platform.

Read this skill before writing or reviewing any image prompt — whether for characters, scenes, SFW Facebook content, or NSFW website content.

---

## 1. Flux T5 Encoder — How Flux Reads Prompts

Flux uses a **T5 text encoder**, not CLIP. This changes everything about how prompts should be written:

- **Write flowing prose sentences**, not comma-separated tag lists
- **No emphasis weights** — `(word:1.3)` syntax is ignored. Use descriptive language instead: "with emphasis on" or "with a focus on"
- **No negative prompts** — Flux has no negative prompt input. Describe what you WANT, not what to avoid
- **No quality tags** — "masterpiece, best quality, ultra detailed, 8k, RAW photo" provide zero benefit. Community blind tests confirm no quality difference with or without them
- **Natural language wins** — "A chef preparing fresh pasta in a modern restaurant kitchen with stainless steel appliances and warm overhead lighting" outperforms "chef, pasta, modern kitchen, stainless steel, warm lighting, restaurant, professional"
- **Word order matters** — Flux weighs earlier information more heavily. Front-load the most important elements
- **Optimal length** — 30–80 words is the sweet spot for most images. Under 30 for simple concepts, 80+ only for complex multi-element scenes

### Priority Order (Front to Back)

```
Main subject → Key action/pose → Critical style → Setting/context → Lighting → Composition/technical
```

### What NOT to Include

| Don't Use | Why | Use Instead |
|-----------|-----|-------------|
| `(word:1.3)` emphasis weights | T5 ignores them | Descriptive prose |
| `masterpiece, best quality, 8k` | No measurable effect | Nothing — just omit |
| Negative prompts | Flux can't process them | Positive alternatives |
| Comma-separated tag lists | T5 processes sentences | Flowing prose |
| `RAW photo, DSLR` quality tags | Minimal effect on Flux | Specific camera/lens references |

---

## 2. The Five Layers Framework (No Safe Word)

Every image prompt — SFW, NSFW, or atmospheric — must activate all five layers. This is what separates scroll-stopping images from generic AI output.

### Layer 1: Expression & Gaze

The face tells the story. Always specify:
- **Eye direction** — "looking directly into the camera," "eyes closed," "glancing over her shoulder," "watching his face"
- **Expression specifics** — "knowing half-smile," "lips slightly parted," "biting her lower lip," "expression of unguarded pleasure"
- **Emotional register** — confidence vs vulnerability, power vs surrender, anticipation vs release

For SFW, expression alone carries the sensuality. For NSFW, expression elevates content from mechanical to erotic.

### Layer 2: Narrative Implication

Capture a moment where something just happened or is about to happen. The viewer fills the gap:
- "hand reaching for the zipper at the back of her dress"
- "sitting on the edge of an unmade bed, one heel still on, the other on the floor"
- "his fingers tracing along her jawline"

The **before/after gap** creates arousal and engagement, not nudity.

### Layer 3: Lighting & Atmosphere

Name a **specific light source** — never use generic "warm lighting" or "good lighting":
- "single amber streetlight casting long shadows"
- "bedside lamp casting warm glow across tangled sheets"
- "candlelight flickering across both faces"
- "workshop fluorescent spilling through the open bay door"
- "golden hour side-lighting through sheer curtains"

**BFL-recommended lighting approaches:**
- **Rembrandt lighting** (45° key light) — dramatic triangle of light on face
- **Split lighting** (90° side) — high contrast, half-face illuminated
- **Practical lighting** — visible light sources in the scene (neon signs, desk lamps, candles)
- **Chiaroscuro** — extreme light/shadow contrast for drama
- **Golden hour** — warm, soft, intimate
- **Blue hour** — moody, cool, contemplative

### Layer 4: Composition & Framing

Specify shot type, camera angle, and depth of field:
- **Shot types:** close-up, medium shot, wide establishing shot, detail/macro, two-shot
- **Camera angles:** eye-level, slight low angle (power), high angle (vulnerability), Dutch angle (tension)
- **Depth of field:** "shallow depth of field, background blurred" focuses attention
- **Strategic cropping:** "framed from the waist up," "over-the-shoulder," "shot from behind"
- **Obscuring elements (SFW):** "sheer curtain partially obscuring," "steam," "bedsheet draped," "his body blocking the view"

**BFL official guidance on camera specs:**
- f-number controls background blur: f/1.4–f/2.8 = blurry background (intimate), f/8+ = everything sharp
- mm controls zoom/width: 24mm = wide scene, 50mm = natural, 85mm = close portrait
- Specifying "shot on Fujifilm X-T5, 35mm f/1.4" produces more authentic photorealism than "professional photo"

### Layer 5: Setting & Cultural Grounding

South African authenticity differentiates our content. Include specific local details:
- **Specific interiors** — a Middelburg kitchen with lace curtains, a Soweto bedroom, a workshop with tools on pegboard walls
- **Local texture** — African print fabrics, shweshwe, doek, specific furniture styles
- **Context clues** — Amarula on the nightstand, Coke bottles on a crate, township architecture through a window
- **Setting-as-character** — the environment tells its own story

---

## 3. Prompt Structure Template

### Scene Prompts (Story Publisher Pipeline)

When writing scene prompts for the automated pipeline, **do NOT include physical descriptions for approved characters** — the pipeline injects identity from character data. Write only what the pipeline cannot infer:

```
[Setting with specific South African details]. [Specific light source and atmosphere].
[Character action/pose], [expression/gaze], [clothing for this scene].
[Narrative moment — what just happened or is about to].
[Composition — shot type, camera angle, depth of field].
```

**Example:**
> Hobos Café interior, warm pendant light casting amber glow across a table for two, Friday evening atmosphere in Middelburg. She leans forward with a sharp seductive half-smile, wine glass dangling from her fingers, locked in amused eye contact with the man across the table. Her fitted off-shoulder top reveals her collarbone, gold earrings catching the light. The air between them is electric, a dare hanging unspoken. Medium two-shot, eye-level, shallow depth of field.

### Standalone Prompts (Image Generator)

When using the Image Generator directly (no pipeline injection), include full character descriptions inline:

```
[Full character physical description], [expression/gaze], [action/narrative moment],
[clothing state], [setting with specific South African details],
[specific light source], [atmosphere/mood],
[composition — shot type, camera angle, depth of field].
```

### Non-Character / Atmospheric Prompts

For establishing shots, detail shots, and environmental storytelling — no character identity needed:

```
[Setting description with specific details]. [Lighting and atmosphere].
[Narrative implication — suggesting a story happening out of frame].
[Composition and technical specs].
```

---

## 4. Working Without Negative Prompts

Flux cannot process negative prompts. Use the **Replacement Strategy**:

1. Identify the unwanted element
2. Ask "what would I see instead?"
3. Describe the positive replacement

| Instead of... | Write... |
|---------------|----------|
| "no people" | "empty," "deserted," "solitary" |
| "no blur" | "sharp focus throughout" |
| "not dark" | "brightly lit" or "sun-drenched" |
| "no background distractions" | "smooth gradient background transitioning from deep blue to black" |
| "not too realistic" | "stylized illustration with simplified forms and bold colour blocks" |
| "no crowds" | "peaceful solitude" or "empty cobblestone walkway" |
| "not scary" | "peaceful, welcoming, warm atmosphere with soft golden lighting" |

**If positive framing still fails:**
1. Be more specific about what fills the space
2. Front-load the positive description
3. Add environmental context to make the positive element feel natural

---

## 5. Advanced Techniques

### Layered Compositions

Describe foreground, middle ground, and background separately:
1. **Foreground** — what's closest to the viewer (sharp focus)
2. **Middle ground** — the main subject area
3. **Background** — setting the scene (can specify blur)

Add "shot with shallow depth of field to separate the layers" to reinforce depth.

### Camera/Lens for Photorealism

Instead of generic "photorealistic," specify real camera gear. Flux responds strongly to this:
- "shot on Hasselblad X2D, 80mm f/2.8" — exceptional detail and colour accuracy
- "shot on Canon EOS R5, 85mm f/1.4" — classic portrait look
- "Fujifilm X-T5, 35mm f/1.4" — warm tones, street/lifestyle feel
- "iPhone 16 Pro" — casual, authentic snapshot quality

### Hex Colour Control

Flux supports precise colour matching via hex codes for brand consistency:
- "Her dress is colour #8B0000 deep burgundy"
- "Warm amber lighting in tones of #D4A574"
- Signal with "color" or "hex" followed by the code

### Gaze Enhancement for Flux

Flux's T5 encoder responds to descriptive richness for gaze/expression. Enrich bare gaze instructions:
- "looking at the camera" → "looking directly into the camera with intense, inviting eyes"
- "eye contact" → "deep eye contact with magnetic intensity"
- "seductive smile" → "slow seductive half-smile with slightly parted lips"
- "eyes closed" → "eyes gently closed, lips slightly parted, lost in the moment"

### Dark Scene Visibility

Flux tends to generate very dark images when the prompt describes a dark environment. Counter this:
- If a light source exists in the prompt, add: "The light is strong enough to clearly illuminate the subject"
- If no light source: "Despite the dark setting, a soft directional light source illuminates the subject, keeping skin tones warm and details clearly visible"

### Prompt Sentence Reordering

For optimal T5 processing, structure sentences in this order:
1. **Setting** sentences first (ground the scene)
2. **Lighting** sentences next (establish atmosphere)
3. **Action/character** sentences (the subject doing things)
4. **Composition** sentences last (camera/framing instructions)

---

## 6. Kontext Image-to-Image Editing

When using Flux Kontext for i2i editing:

- **Be explicit** — "Change to daytime while maintaining the same style" works better than "Change to daytime"
- **Name subjects directly** — "the woman with short black hair" not "her" or "she"
- **Preserve intentionally** — state what should stay: "while maintaining the same facial features, hairstyle, and expression"
- **Choose verbs carefully** — "transform" implies complete change; "change the clothes to" gives more control
- **Break complex edits into steps** — dramatic transformations work better as sequential edits
- **Text editing** — use quotation marks: `Replace 'joy' with 'BFL'`
- **Composition control** — when changing backgrounds, specify "keep the exact camera angle, position, and framing"
- **Max prompt token limit** — 512 tokens

---

## 7. Platform-Specific Rules (No Safe Word)

### SFW (Facebook)
- Suggestive, not explicit — all intimate areas covered, obscured, or cropped
- Focus on tension, anticipation, the "moment before"
- Expression and gaze carry the sensuality
- Can show skin, cleavage, bare shoulders, thighs — no nudity

### NSFW Paired (Website)
- Same scene as Facebook counterpart, one narrative beat later
- Can include partial or full nudity
- Still compositionally thoughtful — expression and emotion remain focus
- Must independently re-describe the entire setting (no "same scene" references)

### Website-Only (Additional)
- Range from atmospheric establishing shots to intimate close-ups
- Not every image needs a character — detail shots and environmental storytelling
- Enhance reading rhythm and break up text
- Match emotional tone of surrounding text

### SFW ↔ NSFW Visual Continuity

| Element | Facebook (SFW) | Website (NSFW) |
|---------|---------------|----------------|
| Gaze | Confident, suggestive, daring | Vulnerable, lost in pleasure, raw |
| Clothing | Partially dressed, revealing but covered | Minimal or nude |
| Narrative moment | The lead-up, tension, anticipation | The release, the act, the surrender |
| What's hidden | Key areas obscured or clothed | Less hidden, but compositionally thoughtful |
| Tone | "I dare you to look away" | "You shouldn't be seeing this" |

---

## 8. Pipeline-Specific Notes (Flux Krea Dev Uncensored)

These apply specifically to the No Safe Word ComfyUI pipeline on RunPod:

- **Uncensored checkpoint required** — safety training is baked into official Flux checkpoints at the base model level. NSFW LoRAs alone cannot override it. Use `fuxCapacityNSFWPorn_51FP16` for explicit content.
- **SFW/NSFW checkpoint switching** — pipeline automatically selects SFW or NSFW checkpoint based on scene classification.
- **LoRA stack** — up to 8 slots with defined priority order. Character identity LoRAs injected by pipeline, not in prompts.
- **PuLID strength** — 0.55/0.20 for dark scenes, 0.75/0.30 for bright scenes.
- **Character LoRA strength** — 0.65 (reduced from 0.85 for better scene adherence).
- **Female enhancement suffix** — pipeline auto-appends body description for female characters to ensure voluptuous rendering.
- **Atmosphere suffix** — pipeline auto-appends photography-style quality instructions (replaces stripped SDXL quality tags).
- **Prompt rewriter** — Claude Sonnet rewrites SDXL-style prompts into Flux-native prose if tag-like syntax is detected.
- **Scene prompt reordering** — pipeline automatically reorders sentences: setting → lighting → action → composition.
- **Dark scene injection** — pipeline auto-adds visibility guarantee for dark environments.
- **Dual-character scenes** — require both `character_name` and `secondary_character_name` tags. Pipeline handles AttentionCouplePPM region separation.

### What the Pipeline Handles Automatically (Don't Include in Prompts)

- Character physical descriptions (skin tone, hair, build, face shape) for approved characters
- Quality tags and atmosphere suffixes
- LoRA trigger words
- Female body enhancement language
- Dark scene visibility fixes
- Sentence reordering
- SDXL-to-Flux syntax conversion

### What YOU Must Include in Scene Prompts

- Setting with specific South African details
- Specific light source (named, not generic)
- Action, pose, and clothing for this scene
- Expression and gaze direction
- Narrative moment (what's happening or about to happen)
- Composition (shot type, angle, depth of field)
- Non-character people described inline with physical details

---

## 9. Quality Checklist

Before finalising any prompt, verify:

- [ ] Written in flowing prose sentences (no tag lists)
- [ ] No emphasis weights, no negative prompt language, no quality tags
- [ ] All five layers present (expression, narrative, lighting, composition, setting)
- [ ] Most important elements front-loaded
- [ ] Specific light source named (not generic "warm lighting")
- [ ] Camera angle and depth of field specified
- [ ] Expression and gaze direction explicit
- [ ] South African cultural/environmental details included where relevant
- [ ] For pipeline: no character physical descriptions (pipeline injects them)
- [ ] For pipeline: non-character people described inline
- [ ] 30–80 words for standard prompts, 80+ only for complex scenes
- [ ] Each prompt is 100% self-contained (no "same scene" references)
- [ ] Dark scenes have visibility guarantee
- [ ] Dual-character prompts have both character names tagged

---

## 10. Reference Links

- [BFL Official Quick Reference](https://docs.bfl.ml/guides/prompting_summary)
- [BFL Advanced Techniques](https://docs.bfl.ml/guides/prompting_guide_t2i_advanced)
- [BFL Working Without Negatives](https://docs.bfl.ml/guides/prompting_guide_t2i_negative)
- [BFL Kontext I2I Guide](https://docs.bfl.ml/guides/prompting_guide_kontext_i2i)
- [BFL FLUX.2 Prompting](https://docs.bfl.ml/guides/prompting_guide_flux2)
- [BFL GitHub Skills Repo](https://github.com/black-forest-labs/skills)
