/**
 * Update Lobola List scene prompts to Phase 6 format.
 *
 * New format follows the Five Layers structure:
 *   [action/pose], [expression/gaze with weight], [scene-specific clothing],
 *   [setting with SA details], [specific light source], [atmosphere],
 *   [composition — shot type, camera angle, depth of field]
 *
 * Rules applied:
 * - Approved characters (Lindiwe, Sibusiso, Langa): NO physical descriptions — pipeline injects those
 * - Non-character people (Zanele/friend, unnamed extras): brief inline physical details
 * - Every prompt specifies gaze explicitly with emphasis weight
 * - Named light sources instead of generic "warm lighting"
 * - Specific SA cultural/location details
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
    // Pos 1 website_only — wine glass detail (Lindiwe)
    id: '9ce67fca-691c-40e5-b46c-122819d98bd0',
    prompt: 'close-up of a hand resting on a wine glass stem, gold bracelet catching light, wine glowing amber in the glass, (contemplative stillness:1.1), Piatto restaurant background soft-blurred, single overhead pendant light reflecting in the wine surface, Friday evening warmth, macro close-up, shallow depth of field, slight overhead angle',
  },
  {
    // Pos 1 facebook_sfw — two women at restaurant (Lindiwe + non-char friend)
    id: '8f614d3c-eb81-419d-9e97-6c3397233b3d',
    prompt: 'leaning forward over restaurant table, (sharp seductive half-smile, looking directly at camera:1.3), fitted low-cut top showing tasteful cleavage, gold earrings, wine glass dangling from fingers, woman in foreground left. Her friend in background right — older woman with round face, colourful headwrap, voluptuous in form-fitting printed dress, bold earrings, (mid-laugh head thrown back:1.1). Piatto restaurant interior, warm amber light from single overhead pendant, Friday evening atmosphere, shallow depth of field blurring other diners, medium shot, eye-level',
  },
  {
    // Pos 1 website_nsfw_paired — two women leaning in (Lindiwe + non-char friend)
    id: 'ede9ddff-edb0-4760-bdeb-b67e4d67c545',
    prompt: 'leaning forward conspiratorially, (eyes bright with mischief, looking directly at camera:1.3), low-cut top revealing deeper cleavage, wine glass held loosely in one hand, woman in foreground left. Her friend beside her — round-faced woman in colourful headwrap and bold earrings, leaning in close whispering, one hand on her arm. Piatto restaurant interior, single overhead pendant casting golden glow on white tablecloth, wine glasses and plates on table, Friday evening atmosphere, shallow depth of field blurring other diners, intimate two-shot, eye-level',
  },
  {
    // Pos 2 website_nsfw_paired — pressed against car (Sibusiso + Lindiwe as secondary)
    id: '2f855423-561a-4096-8097-554d5c4b5a6f',
    prompt: 'standing very close, one hand cupping her face, the other on her hip, forehead touching hers, (watching her face intently:1.2), overalls unzipped to waist over white vest. She is pressed back against the car door, off-shoulder top slipped further down her shoulder, (eyes closed:1.3), both breathing hard, mouths almost touching. Single amber streetlight casting long shadows, mechanic workshop warm fluorescent glow spilling from open bay door behind them, Middelburg night, quiet street, warm amber tones against dark sky, close-up two-shot, shallow depth of field',
  },
  {
    // Pos 2 website_only — establishing shot (no character)
    id: '8565d5ec-91a0-4ce4-88a5-194fcd97c3a2',
    prompt: 'quiet Middelburg parking lot, half-lit by amber streetlights, mechanic workshop with single warm fluorescent light visible through open bay door across the street, a car sits under a streetlight with hood up, suggestion of two figures just out of frame, warm light pools against dark Highveld sky, empty concrete, wide establishing shot, cinematic colour grading, deep depth of field',
  },
  {
    // Pos 2 facebook_sfw — man at car engine (Sibusiso + non-char woman)
    id: '43597c6b-42f6-4f3a-b3f9-18c1052e8cf6',
    prompt: 'leaning over a car engine under streetlight, forearm flexed on the engine block, (looking up directly at camera with calm knowing eyes:1.3), overalls unzipped to waist over white t-shirt, man in foreground centre. A woman standing beside the car — braids loose, off-shoulder top revealing collarbone, (biting her lower lip, body angled toward him:1.1). Single amber streetlight overhead, mechanic workshop glow spilling onto the street behind, Middelburg night, close-medium shot, slight low angle, electric tension',
  },
  {
    // Pos 3 website_only — bedroom scene (Lindiwe)
    id: 'dfdbcda6-dea9-47a3-be31-718f914c0ea5',
    prompt: 'lying in bed in the dark, one arm above her head, phone face-down on her chest, thin-strapped camisole, (eyes open staring at ceiling:1.2), expression caught between desire and frustration, blue phone-screen light casting glow on collarbone and the curve of her lips, dark bedroom, intimate close-up from slightly above, shallow depth of field',
  },
];

// ─── PART 2: THE FRONTRUNNER ──────────────────────────────────

const PART2_UPDATES = [
  {
    // Pos 1 website_nsfw_paired — intimate restaurant (Langa + non-char woman)
    id: '00c29b63-d958-4bd5-99ca-74aaa052a206',
    prompt: 'leaned in close across intimate table, hand resting on hers, thumb tracing her knuckle, (confident magnetic gaze, looking directly at camera:1.3), fitted shirt open one extra button revealing chest, man in foreground right. A woman across the table — off-shoulder top shifted showing smooth skin along shoulder and swell of breast, (biting her lower lip, eyes locked on his mouth:1.2). Hobos Cafe interior, single candle on white tablecloth casting flickering shadows across both faces, wine glasses catching candlelight, evening atmosphere, intimate two-shot, slightly low angle, shallow depth of field',
  },
  {
    // Pos 1 website_only — hand detail (Langa)
    id: '1f55be3b-e7cd-4709-9fe1-f8d6754a16e9',
    prompt: 'close-up of a hand reaching across a restaurant table to touch a woman\'s fingers, quality silver watch on wrist, deliberate gentle first contact, her hand resting near a wine glass with gold bracelet and painted nails, warm candlelight reflecting off the watch face, Hobos Cafe table, extreme close-up, shallow depth of field',
  },
  {
    // Pos 1 facebook_sfw — couple at Hobos (Langa + non-char woman)
    id: '8e03e4b7-67b4-4450-9f25-313144cab188',
    prompt: 'leaning forward across table with (confident magnetic smile, looking directly at camera:1.3), fitted shirt open one button, quality watch glinting, man in foreground left. A woman across the table — off-shoulder top, gold chain resting on her decolletage, curvaceous figure turned slightly toward him, (chin resting on hand, slow smile, lidded eyes:1.1). Hobos Cafe interior, warm candlelight on table for two, wine glasses on white tablecloth, intimate evening atmosphere, medium shot, eye-level, shallow depth of field',
  },
  {
    // Pos 2 facebook_sfw — outside workshop (Sibusiso + non-char woman)
    id: 'f7a98bb2-9346-4c7f-8c88-63b617dbb7a1',
    prompt: 'leaning against workshop doorframe with arms folded, (slow knowing smile, looking directly at camera:1.3), overalls pulled down to waist, vest showing muscular arms, man in background right. A woman sitting on a plastic crate — fitted jeans, simple top, braids loose around shoulders, gold earrings, Coke bottle in hand, one leg crossed, (looking sideways at him with half-smile:1.1), woman in foreground left. Late afternoon golden Highveld light casting long warm shadows, string lights above workshop entrance, Middelburg, medium shot, eye-level, thick unspoken attraction in the air',
  },
  {
    // Pos 2 website_nsfw_paired — close on crates (Sibusiso + non-char woman)
    id: 'd49a5b7e-c4f7-4acf-baae-ee9803a977ee',
    prompt: 'sitting close on wooden crates, hand resting on her knee, white vest pulled tight across chest, (looking at her with intent:1.2), man on the right. A woman beside him — her leg touching his, simple top ridden up showing a strip of smooth midriff, head tilted toward him, (lips parted:1.1). Forgotten Coke bottles on the ground, mechanic workshop exterior with wooden crates and string lights above the entrance, late afternoon golden Highveld light casting warm long shadows, Middelburg evening, bodies gravitating together, the moment just before someone closes the gap, tight two-shot, eye-level, shallow depth of field',
  },
  {
    // Pos 2 website_only — sunset establishing (no character)
    id: '3ed929d9-f382-4dda-887d-3f57d3cae0be',
    prompt: 'Mpumalanga Highveld sky at sunset, specific orange-to-purple gradient, silhouette of a mechanic workshop with corrugated walls catching the last light in foreground, two small figures visible on crates outside backlit by the dying sun, quiet street, parked car, small town settling into evening, wide establishing shot, cinematic colour grading, deep depth of field',
  },
  {
    // Pos 3 facebook_sfw — bedroom (Lindiwe)
    id: 'a74669d1-fb31-4269-a671-92875511c900',
    prompt: 'lying in bed in the dark, sheets pooled at waist, one arm above her head, phone face-down on her chest, thin-strapped camisole showing smooth shoulders and collarbone, (eyes open, lips slightly parted, looking directly at camera:1.3), expression caught between desire and frustration — replaying someone in her mind, soft blue phone-screen light casting shadows across skin, dark bedroom, intimate close-up from slightly above, shallow depth of field',
  },
  {
    // Pos 3 website_nsfw_paired — bedroom giving in (Lindiwe)
    id: '95d12c18-1446-48e1-a828-2d717529c76d',
    prompt: 'lying in bed, sheets slipped lower revealing the curve of waist and swell of hip, hand drifting from chest to stomach, fingertips grazing the waistband of underwear, thin-strapped camisole, braids loose against the pillow, (eyes closed, head tilted back, lips parted:1.3), the expression of someone giving in to a fantasy, soft blue phone-screen light illuminating collarbone and the curve of her lips, dark bedroom, intimate atmosphere, closer crop on face and upper body, shallow depth of field',
  },
  {
    // Pos 3 website_only — hands detail (Sibusiso)
    id: '1f8edd7d-7320-40b8-b529-6fbdf1c157bc',
    prompt: 'close-up of rough working hands holding a green Coca-Cola glass bottle, callused strong fingers, clean nails, hands that fix things, workshop tools blurred in background, warm golden light from workshop interior, the hands she keeps thinking about, macro close-up, shallow depth of field',
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
