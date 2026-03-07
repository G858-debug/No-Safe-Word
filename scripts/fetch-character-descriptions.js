/**
 * Fetches and displays the current description JSON for all characters
 * in the Lobola List story series.
 *
 * Usage: node scripts/fetch-character-descriptions.js
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

async function main() {
  const { data: series } = await sb
    .from('story_series')
    .select('id, title')
    .ilike('title', '%lobola%');

  if (!series || series.length === 0) {
    console.error('No Lobola List series found');
    return;
  }

  const seriesId = series[0].id;
  console.log(`Series: ${series[0].title} (${seriesId})\n`);

  const { data: storyChars, error } = await sb
    .from('story_characters')
    .select(`
      id,
      role,
      approved,
      approved_fullbody,
      approved_prompt,
      characters (
        id,
        name,
        description
      )
    `)
    .eq('series_id', seriesId);

  if (error) {
    console.error('Error fetching characters:', error);
    return;
  }

  if (!storyChars || storyChars.length === 0) {
    console.log('No characters found for this series');
    return;
  }

  for (const sc of storyChars) {
    const ch = sc.characters;
    console.log('='.repeat(60));
    console.log(`Character: ${ch.name}`);
    console.log(`Story Character ID: ${sc.id}`);
    console.log(`Character ID: ${ch.id}`);
    console.log(`Role: ${sc.role}`);
    console.log(`Portrait approved: ${sc.approved}`);
    console.log(`Full body approved: ${sc.approved_fullbody}`);
    console.log(`\nCurrent description JSON:`);
    console.log(JSON.stringify(ch.description, null, 2));
    if (sc.approved_prompt) {
      console.log(`\nStored approved_prompt:`);
      console.log(sc.approved_prompt);
    }
    console.log();
  }
}

main().catch(console.error);
