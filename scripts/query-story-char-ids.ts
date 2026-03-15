import * as fs from 'fs';
import * as path from 'path';

const envLines = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n');
for (const l of envLines) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const charIds = [
  'b4344cb6-1615-4169-9e1c-3e6bbc4bcd2c', // Zanele
  'd757c016-20cf-43de-b671-a80842798e23', // Langa Mkhize
  'efc71e1c-06aa-4cc1-993d-c852636ce10e', // Lindiwe Dlamini
  'cfc4548b-6e95-4186-8d4a-a566e6c6d454', // Sibusiso Ndlovu
];

async function main() {
  const { data, error } = await (sb as any)
    .from('story_characters')
    .select('id, character_id, characters(name)')
    .in('character_id', charIds);

  if (error) { console.error(error); process.exit(1); }
  console.log(JSON.stringify(data, null, 2));
}

main();
