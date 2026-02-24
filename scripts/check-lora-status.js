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

const charNames = {
  'b4344cb6-1615-4169-9e1c-3e6bbc4bcd2c': 'Zanele',
  'd757c016-20cf-43de-b671-a80842798e23': 'Langa Mkhize',
  'efc71e1c-06aa-4cc1-993d-c852636ce10e': 'Lindiwe Dlamini',
  'cfc4548b-6e95-4186-8d4a-a566e6c6d454': 'Sibusiso Ndlovu',
};

async function main() {
  const { data: allLoras } = await sb
    .from('character_loras')
    .select('*')
    .order('created_at', { ascending: false });

  for (const lora of allLoras || []) {
    const name = charNames[lora.character_id] || lora.character_id;

    const { data: imgs } = await sb
      .from('lora_dataset_images')
      .select('id, prompt_template, category, source, eval_status, eval_score, caption')
      .eq('lora_id', lora.id)
      .order('created_at');

    const total = (imgs || []).length;
    const passed = (imgs || []).filter(i => i.eval_status === 'passed').length;
    const failed = (imgs || []).filter(i => i.eval_status === 'failed').length;
    const pending = (imgs || []).filter(i => i.eval_status === null || i.eval_status === 'pending').length;
    const captioned = (imgs || []).filter(i => i.caption).length;
    const nbCount = (imgs || []).filter(i => i.source === 'nano-banana').length;
    const cuCount = (imgs || []).filter(i => i.source === 'comfyui').length;

    console.log('\n' + '='.repeat(55));
    console.log(`${name} | Status: ${lora.status.toUpperCase()}`);
    console.log(`LoRA ID: ${lora.id}`);
    console.log(`Updated: ${lora.updated_at}`);
    if (lora.error) console.log(`ERROR: ${lora.error}`);
    console.log(`Training attempts: ${lora.training_attempts}`);
    console.log(`Dataset: ${total} images (${nbCount} nano-banana, ${cuCount} comfyui)`);
    console.log(`Eval: ${passed} passed, ${failed} failed, ${pending} pending`);
    console.log(`Captioned: ${captioned}`);

    // Show eval score breakdown for passed images
    if (passed > 0) {
      const passedImgs = (imgs || []).filter(i => i.eval_status === 'passed');
      const avgScore = passedImgs.reduce((s, i) => s + (i.eval_score || 0), 0) / passedImgs.length;
      console.log(`Avg passed score: ${avgScore.toFixed(1)}`);
    }
  }
}

main().catch(console.error);
