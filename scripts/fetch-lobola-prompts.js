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

async function main() {
  const { data: series } = await sb
    .from('story_series')
    .select('id, title')
    .ilike('title', '%lobola%');

  if (!series || series.length === 0) {
    console.error('No series found');
    return;
  }

  const seriesId = series[0].id;
  console.log('Series:', series[0].title, seriesId);

  const { data: posts, error: pErr } = await sb
    .from('story_posts')
    .select('id, title, part_number')
    .eq('series_id', seriesId)
    .order('part_number');

  if (pErr) {
    console.error('Posts error:', pErr);
    return;
  }

  console.log('\nPosts:', posts.length);

  for (const post of posts) {
    console.log('\n========================================');
    console.log('Part ' + post.part_number + ': ' + post.title);
    console.log('Post ID: ' + post.id);
    console.log('========================================');

    const { data: prompts, error: prErr } = await sb
      .from('story_image_prompts')
      .select('id, image_type, position, position_after_word, prompt, character_id, character_name, secondary_character_id, secondary_character_name, pairs_with, status')
      .eq('post_id', post.id)
      .order('position');

    if (prErr) {
      console.error('Prompts error:', prErr);
      continue;
    }

    for (const p of prompts) {
      console.log('\n--- ID: ' + p.id + ' ---');
      console.log('Type: ' + p.image_type + ' | Pos: ' + p.position + ' | Word pos: ' + p.position_after_word);
      console.log('Character: ' + (p.character_name || 'none') + ' (' + (p.character_id || '') + ')');
      console.log('Secondary: ' + (p.secondary_character_name || 'none') + ' (' + (p.secondary_character_id || '') + ')');
      console.log('Pairs with: ' + (p.pairs_with || 'none'));
      console.log('Status: ' + p.status);
      console.log('PROMPT:');
      console.log(p.prompt);
    }
  }
}

main().catch(console.error);
