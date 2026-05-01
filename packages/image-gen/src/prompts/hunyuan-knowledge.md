# HunyuanImage 3.0 — Generation Reference & Test Findings

This file is the team's reference for what we have learned about generating
images with HunyuanImage 3.0. It is no longer read at runtime by any
service — the previous Mistral-based prompt rewriter that consumed it has
been removed (May 2026). It now exists for human reference: prompt-builder
authors, scene-prompt editors, and anyone debugging generation quality
should consult it.

Update it whenever new patterns are validated or existing patterns fail.
Write findings as observations, not rules. Describe what happened in
testing and why we think it happened.

---

## Pipeline context (current)

- **Hosting**: Siray.ai (`api.siray.ai/v1`). The `tencent/hunyuan-image-3-instruct-t2i`
  and `tencent/hunyuan-image-3-instruct-i2i` model IDs are the only paths
  exposed; we use the **Instruct** checkpoint, not the base/pretrain model.
- **Identity injection runs through TWO channels:**
  1. **Text** — `characters.portrait_prompt_locked` (the exact prompt that
     produced the approved portrait) is prepended to every scene prompt
     via `assembleHunyuanPrompt`. For scenes the portrait composition
     language is stripped first; for covers it is kept verbatim.
  2. **Image** — the approved portrait's permanent Supabase Storage URL
     (resolved via `getPortraitUrlsForScene`) is passed to
     `instruct-i2i` as a reference image. Up to 3 references per call.
  When at least one reference is supplied the route uses `instruct-i2i`;
  with zero references it falls back to `instruct-t2i`.
- **No safety checker / no content filter.** Siray does not impose one,
  and we do not send any `safety` / `safe_mode` / `disable_safety_checker`
  parameter.
- **Aspect ratios in use:** `3:4` (portrait scenes, default), `4:3`
  (two-character/landscape scenes), `2:3` (covers).

### ⚠️ Open question — Instruct's built-in DeepSeek rewriter

The Instruct checkpoint ships with its own prompt-rewriting capability,
selectable in the upstream Tencent code via a `bot_task` parameter:

| `bot_task` | Behaviour |
|---|---|
| `image` | Direct generation, no rewrite |
| `recaption` | Rewrite → image |
| `think_recaption` | Think → rewrite → image (Tencent recommends this) |

Siray's public submit endpoint only documents `{model, prompt, seed,
size, images}` — `bot_task` is not exposed in the schema we use. We do
not currently know which mode Siray defaults to. If the default is any
of `recaption` / `think_recaption`, the prompts we send are being
rewritten by DeepSeek before generation, which could either reinforce
or undo the patterns documented below. **Action:** verify against
Siray's full API docs (the Siray blog 404s from some regions; see
[Hunyuan Image 3 Instruct T2I Guide](https://blog.siray.ai/hunyuan-image-3-instruct-t2i/)
and the [Face Swap & Outfit Edit guide](https://blog.siray.ai/hunyuan-image-for-face-swap-and-clothing-change/))
or test empirically with a deliberately-vague prompt vs. a fully
rewritten one.

### ⚠️ The composition patterns below were established under a different pipeline

Patterns A–D, the chimera rule, and the "drop opposite-gender block"
guidance were all observed during testing in April 2026 when:

- The model was hosted on Replicate, not Siray.
- Identity flowed via text only — no reference images.
- We pre-rewrote prompts with our own Mistral Small (now removed).
- The model variant was the base/pretrain checkpoint, not Instruct.

All four of those conditions have changed. The findings are still the
best baseline we have, but they should be re-tested against the current
i2i pipeline. In particular, the "omit the male description block to
avoid a chimera" rule was a workaround for text-only conditioning —
once the model has the female reference image as a separate channel,
including the male's text block may no longer create the same conflict.

---

## Official prompt structure (Tencent)

From the Tencent prompt handbook (`Hunyuan-Image3.md`) and the
[HunyuanImage-3.0-Instruct HuggingFace model card](https://huggingface.co/tencent/HunyuanImage-3.0-Instruct):

> **Main subject and scene + Image quality and style + Composition and
> perspective + Lighting and atmosphere + Technical parameters.**

The model weights earlier tokens more heavily, so subject and action
go first. The model is built for long prompts — over 1,000 characters
of complex instructions are handled fine — but specificity beats
volume.

### Lighting

Use precise technical lighting terms rather than vague descriptors.
"Golden hour," "rim lighting," "chiaroscuro," "practical lamps,"
"overcast diffuse," "neon rim light," "soft box + hair light" all
activate specific expert networks in the model. "Warm lighting" or
"soft light" alone does not. We have observed this matches the official
guidance.

### Composition

Lens and aperture language works. "85mm portrait," "f/1.8 shallow DoF,"
"f/2.8," "50mm natural" are understood and applied. Rule of thirds,
negative space, and explicit frame placement language (left/right,
upper two-thirds) all work as composition anchors.

### Relationship mapping (multi-subject)

When two subjects are in the frame, define their spatial relationship
explicitly rather than listing them separately. "She is in front of him,
his hands visible at her sides" is more reliable than describing two
characters independently. The model needs to understand who is where
relative to whom.

### Anchor and constrain

Keep the core positioning objective in one clear sentence near the top
of the prompt. Then add two or three hard constraints (lens, lighting,
composition). This stabilises results. A long prompt that buries the
key compositional directive deep in the text will not weight it
correctly.

### What to avoid

- Excessive adjectives stacked together ("beautiful amazing stunning
  glowing") — these dilute each other and create noise
- Contradictory instructions (bright sunny day + dark moody atmosphere)
- Vague spatial language — replace with measurable cues: "f/2.0,"
  "85mm," "left edge of frame," "upper two-thirds of frame"
- Generic style descriptors — be specific about the visual register:
  "editorial photography," "photorealistic," "cinematic still" are
  distinct and understood

---

## Image-to-image (i2i) framing in upstream docs

Tencent and the various API providers position i2i as **edit /
transform / fuse**, not as **identity-anchor for arbitrary new
scenes**. The HuggingFace card describes the i2i capability as:

> "Supports creative image editing, including adding elements,
> removing objects, modifying styles, and seamless background
> replacement while preserving key visual elements."

And "Multi-Image Fusion":

> "Intelligently combines multiple reference images (up to 3 inputs)
> to create coherent composite images that integrate visual elements
> from different sources."

Our usage is somewhat off-label: we pass a portrait of the character
and a scene prompt that does NOT instruct an edit ("change the outfit,"
"swap the background") but instead asks for a new scene that should
share the person's identity. This appears to work — the portrait
constrains face/body — but we should expect edge cases where the model
treats the reference as something to edit rather than as an identity
anchor.

For face swap and outfit changes specifically, Siray's blog post
[Hunyuan Image 3 Face Swap and Outfit Edit](https://blog.siray.ai/hunyuan-image-for-face-swap-and-clothing-change/)
covers the more conventional usage and is worth consulting if we ever
add explicit edit features (e.g. "regenerate this scene but in a red
dress").

---

## What we are trying to produce

Serialised adult romance fiction imagery for a Black South African
audience. Two main registers:

- **SFW (Facebook):** Suggestive but not explicit. The "moment before."
  Tension, anticipation, skin but no nudity, fully clothed characters.
- **Explicit (website):** Intimate scenes with nudity and sexual
  content. Emotionally focused — connection over display. Realistic
  South African settings (Middelburg, Soweto, Sandton, bushveld,
  townships).

For the uncensored side specifically, Siray's
[Hunyuan Image 3 Uncensored T2I guide](https://blog.siray.ai/hunyuan-image-3-instruct-uncensored/)
documents the model's permissiveness on the Siray endpoint.

---

## General observations about HunyuanImage 3.0

These are model-level observations that have held across pipeline
changes:

- The model is photorealistic and responds well to specific South
  African settings and props. Generic "African" or "tropical" settings
  produce generic images; "Sandton apartment," "mechanic workshop in
  Middelburg," "unfinished house in the bushveld" produce specific
  and grounded images.

- Token weight matters. Descriptions that appear earlier in the prompt
  are weighted more heavily. For a scene with one featured visible
  character, their description should come first.

- The model is sensitive to contradictions. If the character block
  says "male" and the scene says "breasts exposed," the text-only
  pipeline produced a chimera — a figure with male structure and
  female chest features. Whether i2i still produces this when a
  same-gender reference image is supplied is unverified.

- Named light sources work; generic light descriptors do not.
  "Overhead fluorescent," "single bedside lamp," "afternoon sun
  through louvred blinds" produce consistent results. "Warm lighting"
  or "soft light" alone produces flat, undefined lighting.

---

## Prompt simplicity

Shorter and simpler prompts produce better results. The model
struggles when a prompt is long, dense, or hard to parse spatially.
If a reader cannot immediately picture where each character is and
what each body part is doing, the model will not be able to render
it correctly either.

The most common failure mode is intertwined limbs — scenes where one
character's arms, legs, or hands overlap significantly with the
other's. The model cannot reliably untangle complex limb arrangements
and will produce distorted or fused anatomy. When a scene prompt
describes this kind of physical complexity, simplify it: choose one
clear point of contact, one clear camera angle, and describe only
what is essential to establish the composition. Everything else —
atmosphere, expression, setting detail — can be described briefly
without adding spatial complexity.

A good prompt describes each character's position in plain,
unambiguous language, as if giving directions. "She is bent forward.
His hands are behind her." is more reliable than a paragraph
describing the exact angle of every limb. The model fills in the
rest.

When editing scene prompts, prefer fewer sentences over more. If a
sentence does not anchor a character's position or establish the
composition, it can usually be cut or compressed.

---

## Composition templates (April 2026 — text-only baseline; needs i2i re-validation)

When a scene prompt describes an intimate act, the most reliable
approach observed under the text-only pipeline was to simplify the
composition down to the closest matching template below rather than
trying to preserve every detail of how the author described it. The
author's intent — emotional beat, setting, characters, narrative
moment — should be preserved. Specific body positioning, camera
angle, and spatial language should be replaced with template
language we know works.

**Re-validation status:** None of these patterns has been re-tested
under the current Siray/i2i pipeline. They are presumed to still
work as a baseline because they target model behaviour, not
pipeline-specific quirks — but the "drop opposite-gender block"
rule below was specifically a workaround for text-only conditioning
and may relax under i2i. Treat the templates as starting points,
not laws.

---

### Pattern A — Female-from-behind, male anonymous

**Setup:** Female character fully visible from behind. Male character
represented only by hands and anatomy entering from the camera
direction.

**What worked (text-only baseline):**
- Describing the male hands as "coming from the same direction as the
  camera" produced correct hand placement — hands appear naturally at
  the hips from the viewer's perspective.
- Describing the entry as "from the camera direction" placed the
  anatomy correctly without the male figure appearing in frame.
- Including only the female character's description block produced a
  consistent female figure.

**What did not work:**
- Describing the hands as "at her hips" or "on her waist" produced
  hands appearing from the sides rather than from the viewer's
  direction. The model interpreted "at her hips" as beside her, not
  behind her.
- Including the male character's full description block alongside
  Pattern A caused the model to try to render the male figure. Since
  the male is never supposed to appear in frame, his description block
  created a contradiction — the model resolved it by merging features
  into a chimera. **(May relax under i2i if no male reference image
  is supplied; needs testing.)**
- "Reversed" gender (male visible, female anonymous) did not work
  well. Output was consistently poor. We stopped testing it.

**Setting observations:** Works across interior settings. The
unfinished-house kitchen in our first successful test produced
strong atmosphere (bare concrete, natural light, dust).

---

### Pattern B — Side profile, male cropped

**Setup:** Camera at 90 degrees to the scene. Female face in profile
on the right side of the frame. Male cropped entirely out of frame;
only his anatomy entering from the left edge.

**What worked:**
- Specifying "camera at 90 degrees" established the profile
  perspective reliably. The female face in profile with visible
  expression was consistent.
- Explicitly describing the male as "cropped entirely out of frame"
  prevented the model from generating any male body features.
  Simply not mentioning him was not enough — the model added a
  second figure anyway. The explicit "cropped out" instruction
  suppressed this.
- Specifying "left edge of frame" for the male element anchored
  placement. Without an edge reference, placement was inconsistent.
- Like Pattern A: omitting the male description block produced
  cleaner results. **(Same i2i caveat as Pattern A.)**

---

### Pattern C — Kissing close-up, both faces visible

**Setup:** Both characters' faces visible in close-up, in the act
of kissing.

**What worked:**
- "Lips pressed firmly together in contact, mouths closed and
  sealed" produced actual contact between the faces. This specific
  language was critical.
- Both character description blocks should be included here — both
  faces are visible and the model needs both identities.

**What did not work:**
- Without the explicit contact language, the model consistently
  produced faces approaching each other but not touching — "almost
  kissing" rather than kissing. Every variation we tested without
  that specific phrase failed.
- "Kissing deeply," "in a passionate kiss," "mouths meeting" — none
  of these produced reliable lip contact. The model seemed to
  interpret them as "about to kiss."

---

### Pattern D — Oral (female receiving), low upward angle

**Setup:** Female face and shoulders filling most of the frame.
Male anatomy entering from below at low upward angle.

**What worked:**
- Describing the female face filling the upper two-thirds produced
  good framing. The low upward angle of entry rendered correctly
  without additional spatial description.
- Like Patterns A and B: the male description block should be
  omitted under text-only. He is never in frame. **(Same i2i
  caveat.)**

**What did not work:**
- Adding hand placement broke this pattern every time we tested it.
  When we described hands — whether the male's hands, the female's
  hands, or both — the model placed them incorrectly (sides of the
  frame, emerging from the wrong direction). The no-hands version
  of this pattern is the only reliable form we have found.
- A top-down first-person perspective (steep overhead angle)
  produced anatomical distortion regardless of how we described
  it. The model defaults to a low upward angle anyway; fighting
  it made things worse.

---

## What we have not found a reliable pattern for

### Fully visible two-character explicit

Both bodies fully in frame, both genders rendered, anatomical
connection visible — this is the most "natural" composition but
HunyuanImage 3.0 (text-only) could not render it reliably. The
anatomy at the point of connection failed consistently. We
considered routing this through a specialist model (Pony Diffusion)
but deferred it. For now, scenes that would naturally use this
composition should be rewritten to use one of the patterns above.

**Re-test under i2i:** unknown whether providing two reference
images (one per character) lets the model render the connection
cleanly. Worth a focused test pass.

---

## Visual signature

Every image ends with this cinematic quality signature, appended by
`assembleHunyuanPrompt` (the `VISUAL_SIGNATURE` constant in
`prompt-constants.ts`). Do not include it in scene-prompt edits —
it is added for you:

> "Cinematic shallow depth of field. Rich shadows with luminous
> highlights. Soft skin glow. Intimate framing. Editorial photography
> quality. Photorealistic."

---

## Reference docs

- **Tencent HunyuanImage-3.0** — main repository and prompt handbook:
  - [GitHub: Tencent-Hunyuan/HunyuanImage-3.0](https://github.com/Tencent-Hunyuan/HunyuanImage-3.0)
  - [Hunyuan-Image3.md (prompt handbook)](https://github.com/Tencent-Hunyuan/HunyuanImage-3.0/blob/main/Hunyuan-Image3.md)
- **Instruct variant** (the one we actually use, via Siray):
  - [HuggingFace: tencent/HunyuanImage-3.0-Instruct](https://huggingface.co/tencent/HunyuanImage-3.0-Instruct)
  - [Distilled variant: tencent/HunyuanImage-3.0-Instruct-Distil](https://huggingface.co/tencent/HunyuanImage-3.0-Instruct-Distil)
    (faster; not currently used)
- **Siray-specific guidance:**
  - [Hunyuan Image 3 Instruct T2I Guide](https://blog.siray.ai/hunyuan-image-3-instruct-t2i/)
  - [Hunyuan Image 3 Face Swap and Outfit Edit](https://blog.siray.ai/hunyuan-image-for-face-swap-and-clothing-change/)
  - [Hunyuan Image 3 Uncensored T2I Model](https://blog.siray.ai/hunyuan-image-3-instruct-uncensored/)

---

## How to update this file

When new test results come in:
- Add findings under the relevant pattern section.
- If a previously reliable pattern starts failing, note it with a
  date and what changed in the pipeline.
- If a new pattern is discovered, add a new section.
- Write observations, not rules — describe what happened and why
  you think it happened.
- When a pattern is re-validated under i2i, replace the
  "i2i caveat" notes with the new findings.
