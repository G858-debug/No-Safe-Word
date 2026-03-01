/**
 * Test what the decomposer outputs for the car scene prompt.
 */
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

import { decomposePrompt, buildStoryImagePrompt, extractCharacterTags, condensedCharacterTags } from '../packages/image-gen/src/index';

const rawScenePrompt = `leaning over a car engine under streetlight, forearm flexed on the engine block, (looking up directly at camera with calm knowing eyes:1.3), overalls unzipped to waist over white t-shirt, man in foreground centre. A woman standing beside the car — braids loose, off-shoulder top revealing collarbone, (biting her lower lip, body angled toward him:1.1). Single amber streetlight overhead, mechanic workshop glow spilling onto the street behind, Middelburg night, close-medium shot, slight low angle, electric tension`;

// Sibusiso's approved prompt tags (from the database)
const sibusisoApprovedPrompt = `masterpiece, best quality, highly detailed, (close-up head and shoulders portrait:1.4), (face in focus:1.3), (detailed facial features:1.2), (smooth clear skin:1.2), (natural skin:1.1), (matte skin:1.1), 26, young adult, young adult, male, (African male:1.3), South African, Zulu, muscular, naturally muscular, broad body, black short natural hair, dark brown eyes, medium-dark brown skin, full lips, strong jawline, calm, warm, direct gaze expression, wearing overalls unzipped to waist over white t-shirt, work boots; casually jeans and plain t-shirt with fresh sneakers, broad shoulders, strong hands, easy smile that crinkles his eyes, quiet physical confidence, (professional portrait photography:1.2), soft diffused studio lighting, (seamless medium gray backdrop:1.3), plain uniform background, looking at camera, neutral expression, photorealistic`;

// Extract tags the same way the pipeline does
const sibusisoTags = extractCharacterTags(sibusisoApprovedPrompt);
console.log('=== Sibusiso extracted tags ===');
console.log(sibusisoTags);

const sibusisoCondensed = condensedCharacterTags(sibusisoTags);
console.log('\n=== Sibusiso condensed ===');
console.log(sibusisoCondensed);

// We need Lindiwe's tags too - fetch from db
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  // Get Lindiwe's approved prompt
  const { data: lindiweChar } = await supabase
    .from('story_characters')
    .select('approved_prompt')
    .eq('character_id', 'efc71e1c-06aa-4cc1-993d-c852636ce10e')
    .single();

  const lindiweTags = lindiweChar?.approved_prompt
    ? extractCharacterTags(lindiweChar.approved_prompt)
    : null;

  console.log('\n=== Lindiwe extracted tags ===');
  console.log(lindiweTags);

  const lindiweCondensed = lindiweTags ? condensedCharacterTags(lindiweTags) : null;
  console.log('\n=== Lindiwe condensed ===');
  console.log(lindiweCondensed);

  // Now simulate what buildStoryImagePrompt does (roughly)
  // In reality, the pipeline calls buildStoryImagePrompt which wraps the scene
  // with quality prefix, trigger words, condensed tags, enhancements, quality suffix.
  // But let's see what decomposePrompt outputs given the full prompt.

  // Get the actual full prompt that was used (from the image record)
  const { data: image } = await supabase
    .from('images')
    .select('prompt')
    .eq('id', '40083943-b0f3-43ef-bf7d-8f02cf686cc0')
    .single();

  // The stored prompt IS the raw scene prompt in this case
  // Let's build a full prompt to simulate what the pipeline does
  const fullPrompt = buildStoryImagePrompt(
    sibusisoTags,
    lindiweTags,
    rawScenePrompt,
    'sfw',
    ['tok'],
  );

  console.log('\n=== Full assembled prompt ===');
  console.log(fullPrompt);

  // Now decompose it
  const decomposed = decomposePrompt(fullPrompt, sibusisoTags, lindiweTags);

  console.log('\n\n========================================');
  console.log('=== DECOMPOSED OUTPUT ===');
  console.log('========================================');
  console.log('\n--- scenePrompt (used for Pass 1 standard path, also input to optimizer) ---');
  console.log(decomposed.scenePrompt);
  console.log('\n--- primaryIdentityPrompt (Pass 2) ---');
  console.log(decomposed.primaryIdentityPrompt);
  console.log('\n--- secondaryIdentityPrompt (Pass 2, dual-character) ---');
  console.log(decomposed.secondaryIdentityPrompt || 'NULL');
  console.log('\n--- fullPrompt (Pass 3) ---');
  console.log(decomposed.fullPrompt);
  console.log('\n--- Regional prompts (populated by optimizer, not decomposer) ---');
  console.log('sharedScenePrompt:', decomposed.sharedScenePrompt || 'NULL (set by optimizer)');
  console.log('primaryRegionPrompt:', decomposed.primaryRegionPrompt || 'NULL (set by optimizer)');
  console.log('secondaryRegionPrompt:', decomposed.secondaryRegionPrompt || 'NULL (set by optimizer)');
}

main().catch(console.error);
