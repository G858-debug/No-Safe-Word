# CLAUDE.md

## Image Generation Best Practices

### Character Consistency Rules
1. **Approved characters** (anyone in the story_characters table with an approved portrait): appearance is ALWAYS defined by the approved portrait prompt tags, never by scene prompts. The pipeline injects these automatically.
2. **Non-character people** (background figures, unnamed extras, one-off mentions like "a waiter", "his mother", "the woman at the next table"): MUST be described inline in the scene prompt with physical details, since the pipeline has no data for them. Keep these descriptions brief — just enough for the model to render them correctly (e.g., "older woman in floral dress and doek in background" rather than full Five Layers treatment).
3. Scene prompts describe ONLY: action, pose, clothing for this scene, setting, lighting, camera angle, composition, gaze/expression override — plus any non-character people as described above.
4. Never include physical descriptions (skin tone, hair, build, face shape) for approved characters in scene prompts — the pipeline injects these from character data.
5. Always specify gaze direction explicitly with emphasis: (looking directly at camera:1.3), (eyes closed:1.2), etc.
6. For multi-character scenes with TWO approved characters, use primary + secondary character linking. Both get their tags injected. Only describe non-character people inline.

### Scene Prompt Format (New Standard)
Scene prompts should follow this structure:

[action/pose], [expression/gaze with weight], [scene-specific clothing], [setting with South African details], [specific light source], [atmosphere], [composition — shot type, camera angle, depth of field]

Example (old style — DO NOT USE):
"A stunning young Black South African woman (24, oval face, high cheekbones, neat braids in low bun, slim curvaceous figure, fitted low-cut top showing tasteful cleavage, gold earrings), leaning forward with a sharp seductive half-smile..."

Example (new style — USE THIS):
"leaning forward over restaurant table, (sharp seductive half-smile, looking directly at camera:1.3), fitted low-cut top showing tasteful cleavage, gold earrings, wine glass dangling from fingers, Piatto restaurant interior, warm amber light from single overhead pendant, Friday evening atmosphere, shallow depth of field blurring other diners, medium shot, eye-level"

### The Five Layers (Every Prompt Must Have All Five)
1. Expression & Gaze — face tells the story, always specify with emphasis weight
2. Narrative Implication — something just happened or is about to, viewer fills the gap
3. Lighting & Atmosphere — name the specific light source, never "warm lighting"
4. Composition & Framing — camera angle, shot type, depth of field, strategic cropping
5. Setting & Cultural Grounding — specific South African environmental details

### What Makes a Great Sensual Image
- Tension over exposure — the "moment before" is more powerful than nudity
- Expression is the single biggest differentiator between forgettable and scroll-stopping
- Direct eye contact with intent creates immediate connection with the viewer
- Strategic obscuring (steam, fabric, shadow, another person's body) implies more than showing
- Warm, directional lighting from a named source (candle, streetlight, window) creates intimacy
- Cultural grounding (African print fabric, specific SA locations, local objects) creates authenticity and differentiates from generic AI content

### Model Selection
- Default: Juggernaut XL Ragnarok (best balance of quality, diversity, and cost)
- For premium character portraits: RealVisXL V5.0
- For NSFW / intimate scenes: Lustify V5 Endgame (superior anatomy, CFG 3.0-4.5)

### Self-Contained Prompts (Critical)
Every image prompt must be fully self-contained. The Civitai API generates each image independently — there is NO context, NO memory, and NO reference to any other image or prompt.

NEVER use in any prompt:
- "Same scene...", "Same bedroom...", "Same café..."
- "Same lighting...", "Same composition..."
- "But now...", "This time...", "Tighter framing than before..."
- "More intimate version of...", "The next beat of..."
- Any phrase that assumes the model knows what a previous image looked like

ALWAYS re-describe:
- The full setting (location, environment, props)
- The lighting (specific light source and direction)
- The atmosphere and mood
- Character positioning and spatial relationship
- Camera angle and composition

For NSFW paired prompts, achieve visual continuity by independently describing the same setting details (not by saying "same") while advancing the intimacy level.

### Multi-Character Scenes
- Tag the scene with the PRIMARY character only
- Describe the secondary character by role and clothing, not by physical features
- Give spatial composition instructions: "woman in foreground left, man behind right shoulder"
- For critical couple shots, consider generating each character separately
