#!/usr/bin/env npx tsx
/**
 * Backfill cache-control headers on `story-images` bucket objects.
 *
 * Scope: `story-images` only (scene images generated before Prompt 3's
 * cache-control convention was established). Does NOT touch the
 * `story-covers` bucket — composite uploads there already carry the
 * correct immutable long-TTL header, and variant uploads there use a
 * short TTL by design.
 *
 * Behaviour per object:
 *   1. Download current bytes via the Supabase public URL
 *   2. Re-upload with `cacheControl: 'public, max-age=31536000, immutable'`
 *      and `upsert: true`, preserving Content-Type
 *
 * Bandwidth cost is proportional to the total bucket size (download +
 * re-upload per object). One-shot; rerun is safe (idempotent) but
 * wasteful if nothing changed.
 *
 * Usage:
 *   cd apps/web && npm run backfill-cache-headers
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local BEFORE any other imports ──
// Mirrors the pattern in batch-art-director.ts so this script works the
// same way when run from the apps/web directory.
const envPath = resolve(__dirname, "../.env.local");
try {
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.error(`Could not read ${envPath}`);
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { supabase } = require("@no-safe-word/story-engine") as {
  supabase: import("@supabase/supabase-js").SupabaseClient;
};

const BUCKET = "story-images";
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const PAGE_SIZE = 100;

interface StorageFile {
  name: string;
  id: string | null;
  metadata: { mimetype?: string; size?: number } | null;
}

async function listAllObjects(prefix = ""): Promise<Array<{ path: string; file: StorageFile }>> {
  const all: Array<{ path: string; file: StorageFile }> = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      throw new Error(
        `storage.list(${JSON.stringify(prefix)}) failed at offset ${offset}: ${error.message}`
      );
    }
    if (!data || data.length === 0) break;

    for (const entry of data) {
      // Directories show up with id=null and no metadata — recurse.
      if (entry.id === null && entry.metadata === null) {
        const nested = await listAllObjects(
          prefix ? `${prefix}/${entry.name}` : entry.name
        );
        all.push(...nested);
      } else {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        all.push({
          path,
          file: entry as StorageFile,
        });
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

async function reuploadObject(path: string, mimetype: string): Promise<number> {
  // Fetch the current object bytes via the bucket's download API so we
  // don't assume public-URL availability (and to get byte-exact data).
  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (dlErr || !blob) {
    throw new Error(`download failed: ${dlErr?.message ?? "no blob"}`);
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimetype || "application/octet-stream",
    upsert: true,
    cacheControl: CACHE_CONTROL,
  });

  if (upErr) {
    throw new Error(`upload failed: ${upErr.message}`);
  }

  return buffer.length;
}

async function main() {
  console.log(
    `[backfill-cache-headers] listing objects in bucket "${BUCKET}"...`
  );

  const objects = await listAllObjects();
  console.log(`[backfill-cache-headers] found ${objects.length} objects`);

  let processed = 0;
  let errors = 0;
  let totalBytes = 0;

  for (let i = 0; i < objects.length; i++) {
    const { path, file } = objects[i];
    const mimetype = file.metadata?.mimetype ?? "image/png";
    const prefix = `[${i + 1}/${objects.length}]`;

    try {
      const bytes = await reuploadObject(path, mimetype);
      totalBytes += bytes;
      processed++;
      console.log(`${prefix} ${path} — ${(bytes / 1024).toFixed(0)}KB OK`);
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${prefix} ${path} — FAILED: ${message}`);
    }
  }

  console.log("");
  console.log(`[backfill-cache-headers] complete`);
  console.log(`  processed: ${processed}`);
  console.log(`  errors:    ${errors}`);
  console.log(`  bytes:     ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[backfill-cache-headers] fatal:", err);
  process.exit(1);
});
