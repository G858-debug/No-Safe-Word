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

const chars = [
  { name: 'Sibusiso', id: 'cfc4548b-6e95-4186-8d4a-a566e6c6d454' },
  { name: 'Lindiwe', id: 'efc71e1c-06aa-4cc1-993d-c852636ce10e' },
  { name: 'Langa', id: 'd757c016-20cf-43de-b671-a80842798e23' },
  { name: 'Zanele', id: 'b4344cb6-1615-4169-9e1c-3e6bbc4bcd2c' },
];

const seriesId = '6d6b5580-6b4b-446d-b169-6ac3690b83d2';

async function main() {
  for (const c of chars) {
    const { data: sc } = await sb.from('story_characters')
      .select('approved_image_id, approved_fullbody_image_id')
      .eq('series_id', seriesId)
      .eq('character_id', c.id)
      .single();

    for (const [label, imgId] of [['face', sc.approved_image_id], ['body', sc.approved_fullbody_image_id]]) {
      if (!imgId) { console.log(c.name, label, '- NO ID'); continue; }
      const { data: img } = await sb.from('images').select('stored_url, sfw_url').eq('id', imgId).single();

      for (const [urlLabel, url] of [['stored_url', img && img.stored_url], ['sfw_url', img && img.sfw_url]]) {
        if (!url) continue;
        try {
          const resp = await fetch(url, { method: 'HEAD' });
          const size = resp.headers.get('content-length');
          const type = resp.headers.get('content-type');
          console.log(`${c.name} ${label} ${urlLabel}: ${resp.status} ${type} ${size ? Math.round(size/1024)+'KB' : 'unknown'}`);
        } catch (e) {
          console.log(`${c.name} ${label} ${urlLabel}: FETCH ERROR: ${e.message}`);
        }
      }
    }
  }
}
main().catch(console.error);
