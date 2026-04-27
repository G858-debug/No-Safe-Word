# HunyuanImage 3.0 — Generation Test Findings

This file is the single source of truth for what we have learned about
generating images with HunyuanImage 3.0. Update it whenever new patterns
are validated or existing patterns fail. The rewriter reads this at runtime.

Write findings as observations, not rules. Describe what happened in testing
and why we think it happened. The rewriter applies its own intelligence to
decide how to use this knowledge for a given scene.

---

## What we are trying to produce

Serialised adult romance fiction imagery for a Black South African audience.
Two main registers:

- **SFW (Facebook):** Suggestive but not explicit. The "moment before."
  Tension, anticipation, skin but no nudity, fully clothed characters.
- **Explicit (website):** Intimate scenes with nudity and sexual content.
  Emotionally focused — connection over display. Realistic South African
  settings (Middelburg, Soweto, Sandton, bushveld, townships).

---

## General observations about HunyuanImage 3.0

- The model is photorealistic and responds well to specific South African
  settings and props. Generic "African" or "tropical" settings produce
  generic images; "Sandton apartment," "mechanic workshop in Middelburg,"
  "unfinished house in the bushveld" produce specific and grounded images.

- Character identity is entirely text-driven — the model has no
  reference-image conditioning. Every prompt must be fully self-contained.
  The model has no memory between generations.

- Token weight matters. Descriptions that appear earlier in the prompt
  are weighted more heavily. For a scene with one featured visible character,
  their description should come first.

- The model is sensitive to contradictions. If the character block says
  "male" and the scene says "breasts exposed," the model produces a chimera
  — a figure with male structure and female chest features. This happened
  in our first test run and produced an unusable image.

- Named light sources work; generic light descriptors do not. "Overhead
  fluorescent," "single bedside lamp," "afternoon sun through louvred blinds"
  produce consistent results. "Warm lighting" or "soft light" alone produces
  flat, undefined lighting.

---

## Prompt simplicity

Shorter and simpler prompts produce better results. The model struggles when
a prompt is long, dense, or hard to parse spatially. If a reader cannot
immediately picture where each character is and what each body part is doing,
the model will not be able to render it correctly either.

The most common failure mode is intertwined limbs — scenes where one
character's arms, legs, or hands overlap significantly with the other's. The
model cannot reliably untangle complex limb arrangements and will produce
distorted or fused anatomy. When a scene prompt describes this kind of
physical complexity, simplify it: choose one clear point of contact, one
clear camera angle, and describe only what is essential to establish the
composition. Everything else — atmosphere, expression, setting detail — can
be described briefly without adding spatial complexity.

A good prompt describes each character's position in plain, unambiguous
language, as if giving directions. "She is bent forward. His hands are behind
her." is more reliable than a paragraph describing the exact angle of every
limb. The model fills in the rest.

When rewriting, prefer fewer sentences over more. If a sentence does not
anchor a character's position or establish the composition, it can usually be
cut or compressed.

---

## Our approach to rewriting scene prompts

When a scene prompt describes an intimate act, the most reliable approach is
to simplify the composition down to the closest matching template below rather
than trying to preserve every detail of how the author described it. The
author's intent — the emotional beat, the setting, the characters, the
narrative moment — should be preserved. But the specific body positioning,
camera angle, and spatial language should be replaced with the template
language that we know works for this model.

The templates are not creative constraints; they are the shapes this model
can actually render. An elaborate description of a complex two-character
position will fail or produce a chimera. The same narrative moment described
through one of these templates will render cleanly.

If a scene doesn't map neatly to any of the four templates — for example,
it calls for a composition in the "What we have not found a reliable pattern
for" section — rewrite it to the closest template that preserves the
narrative intent. It is better to have a cleanly rendered image that
slightly simplifies the original scene than a detailed prompt that produces
an unusable result.

---

## Explicit composition: what we have tested

### Female-from-behind, male anonymous (what we call Pattern A)

**What we tested:** Female character fully visible from behind. Male character
represented only by hands and anatomy entering from the camera direction.

**What worked:**
- Describing the male hands as "coming from the same direction as the camera"
  produced correct hand placement — hands appear naturally at the hips from
  the viewer's perspective.
- Describing the entry as "from the camera direction" placed the anatomy
  correctly without the male figure appearing in frame.
- Including only the female character's description block produced a
  consistent female figure. The female body type, skin tone, and hair from
  the description block appeared accurately.

**What did not work:**
- Describing the hands as "at her hips" or "on her waist" produced hands
  appearing from the sides rather than from the viewer's direction. This
  seems to be a spatial anchoring issue — the model interprets "at her hips"
  as beside her, not behind her.
- Including the male character's full description block alongside Pattern A
  caused the model to try to render the male figure. Since the male is never
  supposed to appear in frame, his description block created a contradiction
  — the model resolved it by merging the male and female features into a
  chimera. Removing the male block entirely resolved this.
- "Reversed" gender (male visible, female anonymous) did not work well.
  Output was consistently poor. We have not investigated why; we stopped
  testing it.

**Setting observations:** This pattern works across interior settings.
The unfinished-house kitchen in our first successful test produced strong
atmosphere (bare concrete, natural light, dust).

---

### Side profile, male cropped (what we call Pattern B)

**What we tested:** Camera at 90 degrees to the scene. Female face in profile
on the right side of the frame. Male cropped entirely out of frame; only his
anatomy entering from the left edge.

**What worked:**
- Specifying "camera at 90 degrees" established the profile perspective
  reliably. The female face in profile with visible expression was consistent.
- Explicitly describing the male as "cropped entirely out of frame" prevented
  the model from generating any male body features. Simply not mentioning him
  was not enough — the model added a second figure anyway. The explicit
  "cropped out" instruction suppressed this.
- Specifying "left edge of frame" for the male element anchored placement.
  Without an edge reference, placement was inconsistent.
- Like Pattern A: including the male description block caused issues.
  Omitting it produced cleaner results.

---

### Kissing close-up, both faces visible (what we call Pattern C)

**What we tested:** Both characters' faces visible in close-up, in the act
of kissing.

**What worked:**
- "Lips pressed firmly together in contact, mouths closed and sealed"
  produced actual contact between the faces. This specific language was
  critical.
- Both character description blocks should be included here — both faces
  are visible and the model needs both identities.

**What did not work:**
- Without the explicit contact language, the model consistently produced
  faces approaching each other but not touching — "almost kissing" rather
  than kissing. Every variation we tested without that specific phrase failed.
- "Kissing deeply," "in a passionate kiss," "mouths meeting" — none of
  these produced reliable lip contact. The model seemed to interpret them
  as "about to kiss."

---

### Oral (female receiving), low upward angle (what we call Pattern D)

**What we tested:** Female face and shoulders filling most of the frame.
Male anatomy entering from below at low upward angle.

**What worked:**
- Describing the female face filling the upper two-thirds produced good
  framing. The low upward angle of entry rendered correctly without additional
  spatial description.
- Like Patterns A and B: the male description block should be omitted.
  He is never in frame.

**What did not work:**
- Adding hand placement broke this pattern every time we tested it. When
  we described hands — whether the male's hands, the female's hands, or
  both — the model placed them incorrectly (sides of the frame, emerging
  from the wrong direction). The no-hands version of this pattern is the
  only reliable form we have found.
- A top-down first-person perspective (steep overhead angle) produced
  anatomical distortion regardless of how we described it. The model seems
  to default to a low upward angle anyway; fighting it made things worse.

---

## What we have not found a reliable pattern for

### Fully visible two-character explicit

Both bodies fully in frame, both genders rendered, anatomical connection
visible — this is the most "natural" composition but HunyuanImage 3.0
cannot render it reliably. The anatomy at the point of connection fails
consistently. We considered routing this through a specialist model (Pony
Diffusion) but deferred it. For now, scenes that would naturally use this
composition should be rewritten to use one of the patterns above.

---

## Visual signature

Every image ends with this cinematic quality signature. It is appended
by the pipeline — do not include it in the prompt output:

"Cinematic shallow depth of field. Rich shadows with luminous highlights.
Soft skin glow. Intimate framing. Editorial photography quality. Photorealistic."

---

## How to update this file

When new test results come in:
- Add findings under the relevant pattern section
- If a previously reliable pattern starts failing, note it with a date
- If a new pattern is discovered, add a new section
- Write observations, not rules — describe what happened and why you think
  it happened
