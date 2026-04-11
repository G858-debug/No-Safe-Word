/**
 * Renders all OpenPose skeleton PNGs from the pose catalog.
 *
 * Outputs to packages/image-gen/assets/poses/<pose-id>.png
 * at the SDXL resolution matching each pose's orientation.
 *
 * Usage: npx tsx scripts/render-pose-skeletons.ts
 */

import path from 'path';
import fs from 'fs';
import { POSE_CATALOG } from '../packages/image-gen/src/controlnet/pose-catalog';
import { renderPoseToFile } from '../packages/image-gen/src/controlnet/pose-renderer';

const ASSETS_DIR = path.resolve(__dirname, '../packages/image-gen/assets/poses');

async function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  console.log(`Rendering ${POSE_CATALOG.length} poses to ${ASSETS_DIR}/\n`);

  for (const pose of POSE_CATALOG) {
    const outPath = path.join(ASSETS_DIR, `${pose.id}.png`);
    process.stdout.write(`  ${pose.id} (${pose.orientation}) ... `);
    await renderPoseToFile(pose, outPath);

    const stat = fs.statSync(outPath);
    console.log(`${(stat.size / 1024).toFixed(0)} KB`);
  }

  console.log('\nDone. All pose skeletons written.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
