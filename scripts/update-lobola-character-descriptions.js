/**
 * Updates character description fields for Lobola List characters to be
 * Flux-compatible. Key fix: strip "young adult" suffix from age fields so
 * buildKontextIdentityPrefix produces "A 24-year-old..." not "A 24, young adult-year-old..."
 *
 * Usage: node scripts/update-lobola-character-descriptions.js
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

// Updated Flux-compatible descriptions for each character (by character ID)
const UPDATES = {
  // Lindiwe Dlamini
  'efc71e1c-06aa-4cc1-993d-c852636ce10e': {
    age: '24',
    gender: 'female',
    ethnicity: 'Black South African, Ndebele',
    bodyType: 'slim waist, very large prominent breasts, wide round hips, strong hourglass curves',
    hairColor: 'black',
    hairStyle: 'neat braids, usually low bun or worn loose',
    eyeColor: 'dark brown',
    skinTone: 'medium-brown',
    distinguishingFeatures: 'oval face, high cheekbones, expressive eyes, composed expression',
    // Unused by Flux pipeline but kept for reference
    clothing: 'fitted blazers and tailored trousers for work; jeans and fitted tops casually; simple gold jewellery',
    pose: '',
    expression: 'composed and controlled',
  },

  // Sibusiso Ndlovu
  'cfc4548b-6e95-4186-8d4a-a566e6c6d454': {
    age: '26',
    gender: 'male',
    ethnicity: 'Black South African, Zulu',
    bodyType: 'broad muscular shoulders, naturally muscular from physical work, strong hands',
    hairColor: 'black',
    hairStyle: 'short natural hair',
    eyeColor: 'dark brown',
    skinTone: 'medium-dark brown',
    distinguishingFeatures: 'broad shoulders, easy smile that crinkles his eyes, quiet physical confidence',
    // Unused by Flux pipeline but kept for reference
    clothing: 'overalls unzipped to waist over white t-shirt, work boots; casually jeans and plain t-shirt with fresh sneakers',
    pose: '',
    expression: 'calm, warm, direct gaze',
  },

  // Langa Mkhize
  'd757c016-20cf-43de-b671-a80842798e23': {
    age: '28',
    gender: 'male',
    ethnicity: 'Black South African',
    bodyType: 'tall, lean, well-built, gym-fit',
    hairColor: 'black',
    hairStyle: 'low fade haircut',
    eyeColor: 'dark brown',
    skinTone: 'dark brown',
    distinguishingFeatures: 'strong jaw, clean-shaven, very handsome, polished appearance',
    // Unused by Flux pipeline but kept for reference
    clothing: 'fitted shirts with rolled sleeves, tailored chinos, quality watch',
    pose: '',
    expression: 'confident smile',
  },

  // Zanele (supporting character - Lindiwe's friend)
  'b4344cb6-1615-4169-9e1c-3e6bbc4bcd2c': {
    age: '24',
    gender: 'female',
    ethnicity: 'Black South African',
    bodyType: 'voluptuous, curvy build',
    hairColor: 'black',
    hairStyle: 'natural twists or colourful headwrap',
    eyeColor: 'dark brown',
    skinTone: 'medium-brown',
    distinguishingFeatures: 'round face, warm smile, expressive and animated',
    // Unused by Flux pipeline but kept for reference
    clothing: 'colourful prints, bold earrings, lipstick, form-fitting printed dresses',
    pose: '',
    expression: 'warm, animated, expressive',
  },
};

async function main() {
  const { data: series } = await sb
    .from('story_series')
    .select('id, title')
    .ilike('title', '%lobola%');

  if (!series || series.length === 0) {
    console.error('No Lobola List series found');
    return;
  }

  console.log(`Updating character descriptions for: ${series[0].title}`);
  console.log();

  for (const [characterId, newDesc] of Object.entries(UPDATES)) {
    const { data: character, error: fetchErr } = await sb
      .from('characters')
      .select('id, name, description')
      .eq('id', characterId)
      .single();

    if (fetchErr || !character) {
      console.error(`Character ${characterId} not found:`, fetchErr?.message);
      continue;
    }

    const { error: updateErr } = await sb
      .from('characters')
      .update({ description: newDesc })
      .eq('id', characterId);

    if (updateErr) {
      console.error(`Failed to update ${character.name}:`, updateErr.message);
    } else {
      console.log(`✓ Updated ${character.name} (${characterId})`);
    }
  }

  console.log('\nDone. Run fetch-character-descriptions.js to verify.');
}

main().catch(console.error);
