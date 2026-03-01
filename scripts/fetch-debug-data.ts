/**
 * Fetch debug data for a recently generated story image prompt.
 * Usage: npx tsx scripts/fetch-debug-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  // Find all recent prompts with debug_data, ordered by most recent update
  const { data: prompts, error } = await supabase
    .from('story_image_prompts')
    .select('id, post_id, image_type, prompt, status, image_id, debug_data, character_name, secondary_character_name, created_at, updated_at')
    .not('debug_data', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  if (!prompts || prompts.length === 0) {
    console.log('No prompts with debug_data found. Checking all recent prompts...');

    const { data: allPrompts } = await supabase
      .from('story_image_prompts')
      .select('id, image_type, prompt, status, image_id, character_name, secondary_character_name, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20);

    for (const p of allPrompts || []) {
      const short = (p.prompt || '').substring(0, 80);
      console.log(`[${p.status}] ${p.image_type} | ${p.character_name || 'no char'} | ${short}...`);
      console.log(`  id: ${p.id} | image_id: ${p.image_id} | updated: ${p.updated_at}`);
    }
    return;
  }

  // Find the car scene
  console.log(`Found ${prompts.length} prompts with debug_data:\n`);
  for (const p of prompts) {
    const short = (p.prompt || '').substring(0, 80);
    const isCar = (p.prompt || '').toLowerCase().includes('car') ||
                  (JSON.stringify(p.debug_data) || '').toLowerCase().includes('car');
    const marker = isCar ? ' <<<< CAR SCENE' : '';
    console.log(`[${p.status}] ${p.image_type} | ${p.character_name || 'no char'}${p.secondary_character_name ? ' + ' + p.secondary_character_name : ''} | ${short}...${marker}`);
    console.log(`  id: ${p.id} | updated: ${p.updated_at}`);
  }

  // Output the first car scene's full debug data
  const carPrompt = prompts.find(p => {
    const text = (p.prompt || '') + JSON.stringify(p.debug_data || {});
    return text.toLowerCase().includes('car');
  });

  if (carPrompt) {
    console.log('\n\n========== FULL DEBUG DATA FOR CAR SCENE ==========\n');
    console.log('Prompt ID:', carPrompt.id);
    console.log('Status:', carPrompt.status);
    console.log('Image Type:', carPrompt.image_type);
    console.log('Character:', carPrompt.character_name);
    console.log('Secondary:', carPrompt.secondary_character_name);
    console.log('Image ID:', carPrompt.image_id);
    console.log('\n--- Prompt ---');
    console.log(carPrompt.prompt);
    console.log('\n--- Debug Data ---');
    // Output debug data but truncate base64 image data
    const debugStr = JSON.stringify(carPrompt.debug_data, null, 2);
    // Replace long base64 strings with placeholder
    const cleaned = debugStr.replace(/"data:image\/[^"]*"/g, '"[BASE64_IMAGE_TRUNCATED]"')
      .replace(/"(\/9j\/|iVBOR)[A-Za-z0-9+/=]{100,}"/g, '"[BASE64_IMAGE_TRUNCATED]"');
    console.log(cleaned);
  } else {
    // Just output the most recent one
    const p = prompts[0];
    console.log('\n\n========== FULL DEBUG DATA (MOST RECENT) ==========\n');
    console.log('Prompt ID:', p.id);
    console.log('Status:', p.status);
    console.log('Image Type:', p.image_type);
    console.log('Character:', p.character_name);
    console.log('Secondary:', p.secondary_character_name);
    console.log('Image ID:', p.image_id);
    console.log('\n--- Prompt ---');
    console.log(p.prompt);
    console.log('\n--- Debug Data ---');
    const debugStr = JSON.stringify(p.debug_data, null, 2);
    const cleaned = debugStr.replace(/"data:image\/[^"]*"/g, '"[BASE64_IMAGE_TRUNCATED]"')
      .replace(/"(\/9j\/|iVBOR)[A-Za-z0-9+/=]{100,}"/g, '"[BASE64_IMAGE_TRUNCATED]"');
    console.log(cleaned);
  }
}

main().catch(console.error);
