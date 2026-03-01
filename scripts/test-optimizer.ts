/**
 * Test what the optimizer outputs for the car scene prompt.
 * Simulates the full pipeline: assemble → decompose → optimize
 */
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

import { createClient } from '@supabase/supabase-js';
import {
  extractCharacterTags,
  condensedCharacterTags,
  buildStoryImagePrompt,
  decomposePrompt,
  optimizePrompts,
} from '../packages/image-gen/src/index';
import type { CharacterContext } from '../packages/image-gen/src/index';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const rawScenePrompt = `leaning over a car engine under streetlight, forearm flexed on the engine block, (looking up directly at camera with calm knowing eyes:1.3), overalls unzipped to waist over white t-shirt, man in foreground centre. A woman standing beside the car — braids loose, off-shoulder top revealing collarbone, (biting her lower lip, body angled toward him:1.1). Single amber streetlight overhead, mechanic workshop glow spilling onto the street behind, Middelburg night, close-medium shot, slight low angle, electric tension`;

async function main() {
  // Get both characters' approved prompts
  const { data: sibChar } = await supabase
    .from('story_characters')
    .select('approved_prompt')
    .eq('character_id', 'cfc4548b-6e95-4186-8d4a-a566e6c6d454')
    .single();

  const { data: linChar } = await supabase
    .from('story_characters')
    .select('approved_prompt')
    .eq('character_id', 'efc71e1c-06aa-4cc1-993d-c852636ce10e')
    .single();

  const sibTags = extractCharacterTags(sibChar!.approved_prompt!);
  const linTags = extractCharacterTags(linChar!.approved_prompt!);

  // Build full prompt
  const fullPrompt = buildStoryImagePrompt(sibTags, linTags, rawScenePrompt, 'sfw', ['tok']);

  // Decompose
  const decomposed = decomposePrompt(fullPrompt, sibTags, linTags);

  // Build character context
  const characters: CharacterContext[] = [
    { name: 'Sibusiso Ndlovu', gender: 'male', role: 'primary', identityTags: condensedCharacterTags(sibTags) },
    { name: 'Lindiwe Dlamini', gender: 'female', role: 'secondary', identityTags: condensedCharacterTags(linTags) },
  ];

  console.log('=== Calling AI Optimizer ===\n');

  const optimized = await optimizePrompts(
    {
      fullPrompt,
      rawScenePrompt,
      characters,
      mode: 'sfw',
      imageType: 'facebook_sfw',
      negativePromptAdditions: '(extra person:1.3), (third person:1.2), (crowd:1.2), deformed, bad anatomy',
    },
    decomposed,
  );

  console.log('\n========================================');
  console.log('=== OPTIMIZER OUTPUT ===');
  console.log('========================================');
  console.log('\nWas optimized:', optimized.wasOptimized);
  console.log('Notes:', optimized.notes.join('; '));
  console.log('Duration:', optimized.durationMs, 'ms');

  const d = optimized.optimizedDecomposed;
  console.log('\n--- scenePrompt (Pass 1 standard path) ---');
  console.log(d.scenePrompt);

  console.log('\n--- primaryIdentityPrompt (Pass 2) ---');
  console.log(d.primaryIdentityPrompt);

  console.log('\n--- secondaryIdentityPrompt (Pass 2) ---');
  console.log(d.secondaryIdentityPrompt || 'NULL');

  console.log('\n--- fullPrompt (Pass 3) ---');
  console.log(d.fullPrompt);

  console.log('\n--- sharedScenePrompt (base_cond, node 110) ---');
  console.log(d.sharedScenePrompt || 'NULL');

  console.log('\n--- primaryRegionPrompt (node 120) ---');
  console.log(d.primaryRegionPrompt || 'NULL');

  console.log('\n--- secondaryRegionPrompt (node 121) ---');
  console.log(d.secondaryRegionPrompt || 'NULL');

  console.log('\n--- Optimized Negative Additions ---');
  console.log(optimized.optimizedNegativeAdditions || 'NULL (unchanged)');

  // Now show what Pass 2 prompt would look like with the new dual-character restructure
  const pg = 'male';
  const sg = 'female';
  const genderCount = pg === sg
    ? `(2${pg === 'female' ? 'women' : 'men'}:1.3)`
    : '(1man, 1woman:1.3)';
  const secondaryBlock = d.secondaryIdentityPrompt
    ? `, ${d.secondaryIdentityPrompt}`
    : '';
  const pass2Raw = `${genderCount}, ${d.scenePrompt}, ${d.primaryIdentityPrompt}${secondaryBlock}`;
  const { deduplicateWeightedTokens } = await import('../packages/image-gen/src/prompt-decomposer');
  const pass2Prompt = deduplicateWeightedTokens(pass2Raw);

  console.log('\n--- Pass 2 assembled prompt (BEFORE dedup) ---');
  console.log(pass2Raw);
  console.log('\n--- Pass 2 assembled prompt (AFTER dedup) ---');
  console.log(pass2Prompt);
}

main().catch(console.error);
