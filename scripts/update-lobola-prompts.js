/**
 * Fix Lobola List prompts — one-off DB update.
 *
 * Issues fixed:
 * 1. Overwritten prompts restored to scene-only text (identity prefix + atmosphere removed)
 * 2. SDXL emphasis weights removed — Flux T5 encoder ignores (text:1.3) syntax
 * 3. Inline physical descriptions removed — pipeline injects from character data
 * 4. Ambiguous pronouns replaced with character names
 * 5. Zanele/Lindiwe differentiated via clothing: Zanele = ankara headwrap, colourful prints, bold earrings;
 *    Lindiwe = braids/low bun, fitted structured outfits, gold jewellery
 * 6. All prompts written as natural-language prose (Flux format)
 */

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// ─── PART 1: THE SYSTEM ──────────────────────────────────────

const PART1_UPDATES = [
  {
    // Pos 1 website_nsfw_paired — two women at Piatto (Lindiwe + Zanele dual)
    id: 'ede9ddff-edb0-4760-bdeb-b67e4d67c545',
    prompt: `Lindiwe leans forward conspiratorially across the restaurant table, eyes bright with mischief as she looks at Zanele beside her. She wears a fitted low-cut top revealing deep cleavage with gold earrings, a wine glass held loosely in one hand, positioned in the foreground left. Zanele leans in close whispering, one hand on Lindiwe's arm, wearing a colourful ankara-print dress with a low neckline and bold statement earrings, her ankara headwrap framing her face. Piatto restaurant interior, a single overhead pendant casting golden glow on white tablecloth, wine glasses and plates on the table, Friday evening atmosphere, shallow depth of field blurring other diners. Intimate two-shot at eye level, both women looking at each other, not at the camera.`,
  },
  {
    // Pos 1 facebook_sfw — two women at Piatto (Lindiwe + Zanele dual) [WAS OVERWRITTEN]
    id: '8f614d3c-eb81-419d-9e97-6c3397233b3d',
    prompt: `Lindiwe and Zanele share a lively Friday evening at Piatto restaurant. Warm amber light spills down from a single overhead pendant, casting a flattering glow across their table and softening the background into a gentle blur of other diners. In the foreground on the left, Lindiwe leans forward over the table wearing a classy fitted low-cut top with gold earrings catching the light, holding a wine glass loosely between her fingers. Her expression is a slow seductive half-smile with slightly parted lips as she turns to hold Zanele's gaze, composed and deliberate. In the background on the right, Zanele wears a vibrant colourful ankara headwrap with bold statement earrings and a form-fitting ankara-print dress with a low-cut neckline. She is mid-laugh, head thrown back with uninhibited joy, eyes bright as she looks back at Lindiwe. Medium shot at eye level with shallow depth of field softly blurring the restaurant interior. Both women are looking at each other, not at the camera.`,
  },
  {
    // Pos 1 website_only — wine glass detail (Lindiwe solo) [WAS OVERWRITTEN]
    id: '9ce67fca-691c-40e5-b46c-122819d98bd0',
    prompt: `A close-up shot of a hand resting elegantly on the stem of a wine glass, a gold bracelet catching the warm overhead light at the wrist. The wine glows amber in the glass, a single pendant light reflected softly on its surface. The scene holds a contemplative stillness — a quiet Friday evening moment. The background resolves into a soft blur of Piatto restaurant warmth, candlelight and ambient tones blending together in shallow depth of field. The macro framing emphasises texture and light: the curve of the glass stem, the gleam of gold, the rich translucence of the wine. The camera angle sits slightly overhead, lending an intimate editorial quality to the composition.`,
  },
  {
    // Pos 2 website_nsfw_paired — pressed against car (Sibusiso + Lindiwe dual)
    id: '2f855423-561a-4096-8097-554d5c4b5a6f',
    prompt: `Sibusiso stands very close to Lindiwe, one hand cupping her face, the other on her hip, forehead touching hers, watching her face intently. His overalls are unzipped to the waist over a white vest. Lindiwe is pressed back against the car door, her fitted off-shoulder top slipped further down her shoulder, her eyes closed, both breathing hard, mouths almost touching. A single amber streetlight casts long shadows while the mechanic workshop's warm fluorescent glow spills from the open bay door behind them. Middelburg night, quiet street, warm amber tones against dark sky. Close-up two-shot with shallow depth of field, both looking at each other, not at the camera.`,
  },
  {
    // Pos 2 website_only — establishing shot (no character)
    id: '8565d5ec-91a0-4ce4-88a5-194fcd97c3a2',
    prompt: `A quiet Middelburg parking lot, half-lit by amber streetlights. A mechanic workshop with a single warm fluorescent light visible through the open bay door across the street. A car sits under a streetlight with its hood up, a suggestion of two figures just out of frame. Warm light pools against the dark Highveld sky, empty concrete. Wide establishing shot with cinematic colour grading and deep depth of field.`,
  },
  {
    // Pos 2 facebook_sfw — man at car engine (Sibusiso + Lindiwe dual)
    id: '43597c6b-42f6-4f3a-b3f9-18c1052e8cf6',
    prompt: `Sibusiso leans over a car engine under a streetlight, forearm flexed on the engine block, looking up directly at the camera with calm knowing eyes. His overalls are unzipped to the waist over a white t-shirt, positioned in the foreground centre. Lindiwe stands beside the car wearing a fitted mini skirt and an off-shoulder top, her braids worn loose, biting her lower lip with her body angled toward him. A single amber streetlight overhead, mechanic workshop glow spilling onto the street behind. Middelburg night, close-medium shot at a slight low angle, electric tension between them.`,
  },
  {
    // Pos 3 website_only — bedroom scene (Lindiwe solo)
    id: 'dfdbcda6-dea9-47a3-be31-718f914c0ea5',
    prompt: `Lindiwe lies in bed in the semi-darkness, one arm above her head, wearing black lace lingerie with a thin-strapped camisole, her phone face-down on her chest. Her eyes are open, staring at the ceiling, her expression caught between desire and frustration. Blue phone-screen light casts a glow on her collarbone and the curve of her lips. Dark bedroom, intimate close-up from slightly above with shallow depth of field.`,
  },
];

// ─── PART 2: THE FRONTRUNNER ──────────────────────────────────

const PART2_UPDATES = [
  {
    // Pos 1 website_nsfw_paired — intimate restaurant (Langa + Lindiwe dual) [WAS OVERWRITTEN + DOUBLED]
    id: '00c29b63-d958-4bd5-99ca-74aaa052a206',
    prompt: `Langa leans in close across the intimate table, his hand resting on Lindiwe's, thumb tracing her knuckle, a confident magnetic gaze with his eyes locked on her. He wears a fitted shirt open one extra button revealing his chest, positioned in the foreground right. Lindiwe sits across the table wearing a fitted off-shoulder top that has shifted to show smooth skin along her shoulder, biting her lower lip with her eyes locked on his mouth. Hobos Cafe interior, a single candle on the white tablecloth casting flickering shadows across both faces, wine glasses catching the candlelight, evening atmosphere. Intimate two-shot at a slightly low angle with shallow depth of field, both looking at each other, not at the camera.`,
  },
  {
    // Pos 1 website_only — hand detail (Langa + Lindiwe dual) [WAS OVERWRITTEN]
    id: '1f55be3b-e7cd-4709-9fe1-f8d6754a16e9',
    prompt: `A close-up shot of a hand reaching across a restaurant table to touch a woman's fingers — a deliberate, gentle first contact. A quality silver watch catches the warm candlelight at his wrist, the glow reflecting softly off the watch face. Her hand rests near a wine glass, fingers delicate with painted nails and a gold bracelet catching the amber light. The setting is Hobos Cafe, the table surface warm and intimate under candlelight. Extreme close-up with shallow depth of field, the background dissolving into soft bokeh while the hands remain in sharp, tender focus. The lighting is warm and flattering, the atmosphere quiet and charged with the significance of a first touch.`,
  },
  {
    // Pos 1 facebook_sfw — couple at Hobos (Langa + Lindiwe dual)
    id: '8e03e4b7-67b4-4450-9f25-313144cab188',
    prompt: `Langa leans forward across the table with a confident magnetic smile, gazing at Lindiwe across the table. He wears a fitted shirt open one button with a quality watch glinting, positioned in the foreground left. Lindiwe sits across the table wearing a fitted off-shoulder top showing generous cleavage, a gold chain resting on her decolletage, her figure turned slightly toward him, chin resting on her hand with a slow smile and lidded eyes. Hobos Cafe interior, warm candlelight on a table for two, wine glasses on white tablecloth, intimate evening atmosphere. Medium shot at eye level with shallow depth of field, both looking at each other, not at the camera.`,
  },
  {
    // Pos 2 website_nsfw_paired — on crates (Sibusiso + Lindiwe dual) [WAS OVERWRITTEN + DOUBLED]
    id: 'd49a5b7e-c4f7-4acf-baae-ee9803a977ee',
    prompt: `Sibusiso sits close to Lindiwe on wooden crates, his hand resting on her knee, wearing a white vest pulled tight across his chest, looking at her with intent, positioned on the right. Lindiwe sits beside him, her leg touching his, wearing a simple fitted top that has ridden up showing a strip of smooth midriff, her head tilted toward him with lips parted. Forgotten Coke bottles on the ground beside them. Mechanic workshop exterior with wooden crates and string lights above the entrance, late afternoon golden Highveld light casting warm long shadows, Middelburg evening. Their bodies gravitate together in the moment just before someone closes the gap. Tight two-shot at eye level with shallow depth of field, both looking at each other, not at the camera.`,
  },
  {
    // Pos 2 facebook_sfw — outside workshop (Sibusiso + Lindiwe dual)
    id: 'f7a98bb2-9346-4c7f-8c88-63b617dbb7a1',
    prompt: `Sibusiso leans against the workshop doorframe with his arms folded, a slow knowing smile as he looks at Lindiwe. His overalls are pulled down to the waist, his vest showing muscular arms, positioned in the background right. Lindiwe sits on a plastic crate wearing a fitted black mini skirt and a simple fitted top, her braids loose around her shoulders with gold earrings, a Coke bottle in hand, one leg crossed, looking sideways at him with a half-smile, positioned in the foreground left. Late afternoon golden Highveld light casts long warm shadows, string lights above the workshop entrance, Middelburg. Medium shot at eye level, thick unspoken attraction in the air.`,
  },
  {
    // Pos 2 website_only — sunset establishing (no character)
    id: '3ed929d9-f382-4dda-887d-3f57d3cae0be',
    prompt: `A wide establishing shot of a Mpumalanga Highveld sky at sunset, the horizon burning through a gradient of deep orange melting into soft purple overhead. In the foreground, the silhouette of a mechanic workshop with corrugated iron walls catches the last amber light of the dying sun, the ridged metal glowing faintly along its edges. Two small figures sit on crates just outside the workshop, backlit by the fading light, their outlines soft against the warm sky. A quiet street stretches out nearby with a parked car resting at the kerb, the whole small town settling gently into evening stillness. Cinematic colour grading with deep depth of field pulling the eye from the textured foreground silhouettes into the vast luminous sky beyond.`,
  },
  {
    // Pos 3 website_only — hands detail (Sibusiso solo) [WAS OVERWRITTEN]
    id: '1f8edd7d-7320-40b8-b529-6fbdf1c157bc',
    prompt: `Close-up shot of a pair of strong, broad hands cradling a green Coca-Cola glass bottle with relaxed confidence — hands that fix things, that know how to work. Shot in macro with shallow depth of field, the workshop interior behind softly blurs into warm golden tones, hinting at tools and metal surfaces. The light from inside the workshop falls warmly across the knuckles and the curve of each finger, highlighting the texture of the skin and the quiet strength held in the grip. The composition is intimate and editorial, warm and flattering, with soft bokeh drawing full attention to the detail and character written into those hands.`,
  },
  {
    // Pos 3 website_nsfw_paired — bedroom giving in (Lindiwe solo) [WAS OVERWRITTEN]
    id: '95d12c18-1446-48e1-a828-2d717529c76d',
    prompt: `Lindiwe lies in bed in a dark bedroom, sheets slipped lower to reveal the curve of her waist and the swell of her hip. She wears a thin-strapped camisole, one hand drifting from her chest down toward her stomach, fingertips lightly grazing the waistband of her underwear. Her eyes are gently closed, lips slightly parted, head tilted back against the pillow — the composed, surrendered expression of someone lost in a private fantasy. Soft blue phone-screen light spills across her collarbone and traces the curve of her lips, the only source of illumination in the otherwise dark room. Closer crop focused on her face and upper body with shallow depth of field. Warm golden tones layer over the cool blue glow, casting rich shadows that follow the contours of her figure.`,
  },
  {
    // Pos 3 facebook_sfw — bedroom (Lindiwe solo) [WAS OVERWRITTEN]
    id: 'a74669d1-fb31-4269-a671-92875511c900',
    prompt: `Lindiwe lies in a dark bedroom, sheets pooled at her waist. Her face is illuminated by soft blue light from a phone resting face-down on her chest. One arm stretches above her head as she gazes directly into the camera, lips slightly parted, her expression caught somewhere between desire and frustration — the look of someone replaying a person in their mind. She wears a thin-strapped camisole that reveals her smooth shoulders and collarbone. The intimate shot is framed from slightly above in a close-up with shallow depth of field, the blue phone-screen glow casting delicate shadows across her skin against the surrounding darkness of the room.`,
  },
];

async function main() {
  const allUpdates = [...PART1_UPDATES, ...PART2_UPDATES];
  console.log('Updating ' + allUpdates.length + ' prompts...\n');

  let success = 0;
  let failed = 0;

  for (const update of allUpdates) {
    const { error } = await sb
      .from('story_image_prompts')
      .update({ prompt: update.prompt })
      .eq('id', update.id);

    if (error) {
      console.error('FAILED ' + update.id + ': ' + error.message);
      failed++;
    } else {
      console.log('OK ' + update.id);
      success++;
    }
  }

  console.log('\nDone: ' + success + ' updated, ' + failed + ' failed');
}

main().catch(console.error);
