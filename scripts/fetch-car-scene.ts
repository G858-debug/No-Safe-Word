/**
 * Fetch all data for the car scene image.
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
  const promptId = '43597c6b-42f6-4f3a-b3f9-18c1052e8cf6';
  const imageId = '40083943-b0f3-43ef-bf7d-8f02cf686cc0';

  // Get the prompt record
  const { data: prompt } = await supabase
    .from('story_image_prompts')
    .select('*')
    .eq('id', promptId)
    .single();

  console.log('=== STORY IMAGE PROMPT ===');
  console.log(JSON.stringify(prompt, null, 2));

  // Get the image record
  const { data: image } = await supabase
    .from('images')
    .select('*')
    .eq('id', imageId)
    .single();

  console.log('\n=== IMAGE RECORD ===');
  console.log(JSON.stringify(image, null, 2));

  // Get any generation jobs for this image
  const { data: jobs } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('image_id', imageId);

  console.log('\n=== GENERATION JOBS ===');
  console.log(JSON.stringify(jobs, null, 2));

  // Get the story character info
  if (prompt?.character_id) {
    const { data: storyChar } = await supabase
      .from('story_characters')
      .select('*, characters(*)')
      .eq('character_id', prompt.character_id)
      .limit(1)
      .single();

    console.log('\n=== STORY CHARACTER ===');
    // Truncate approved_prompt for readability
    const sc = { ...storyChar };
    console.log(JSON.stringify(sc, null, 2));
  }
}

main().catch(console.error);
