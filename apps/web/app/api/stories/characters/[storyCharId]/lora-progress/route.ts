import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// Stale thresholds — if updated_at is older than this, the pipeline is stuck
const STALE_THRESHOLDS: Record<string, number> = {
  generating_dataset: 30 * 60_000,  // 30 min — dataset gen takes ~10 min
  evaluating: 30 * 60_000,          // 30 min — evaluation takes ~5-10 min
  captioning: 20 * 60_000,          // 20 min — captioning is fast
  packaging_dataset: 10 * 60_000,   // 10 min — packaging is fast
  training: 90 * 60_000,            // 90 min — training takes 30-60 min
  validating: 30 * 60_000,          // 30 min — validation takes ~10 min
};

// Statuses that are active pipeline stages (not terminal states)
const ACTIVE_STATUSES = new Set(Object.keys(STALE_THRESHOLDS));

/**
 * Check if a LoRA pipeline stage is stale and auto-recover if so.
 * For `training` status, also tries to check if the RunPod pod is still alive.
 * Returns true if the record was marked as failed (caller should re-fetch).
 *
 * This function MUST NOT throw — errors are caught and logged so the
 * main GET handler can still return the current status to the UI.
 */
async function detectAndRecoverStale(lora: any): Promise<boolean> {
  try {
    const threshold = STALE_THRESHOLDS[lora.status];
    if (!threshold) return false;

    const updatedAt = new Date(lora.updated_at).getTime();
    const age = Date.now() - updatedAt;

    if (age < threshold) return false;

    const ageMin = Math.round(age / 60_000);
    console.warn(`[LoRA Stale] ${lora.id} stuck in "${lora.status}" for ${ageMin}min (threshold: ${threshold / 60_000}min)`);

    // For training status, try to check if pod is still alive
    if (lora.status === "training" && lora.training_id) {
      try {
        const { getTrainingPodStatus } = await import("@no-safe-word/image-gen/runpod-pods");
        const podStatus = await getTrainingPodStatus(lora.training_id);
        if (podStatus.desiredStatus === "RUNNING") {
          if (age < 180 * 60_000) {
            console.log(`[LoRA Stale] Pod ${lora.training_id} still RUNNING — extending grace period`);
            return false;
          }
        }
        console.warn(`[LoRA Stale] Pod ${lora.training_id} status: ${podStatus.desiredStatus}`);

        if (podStatus.desiredStatus !== "TERMINATED") {
          const { terminateTrainingPod } = await import("@no-safe-word/image-gen/runpod-pods");
          terminateTrainingPod(lora.training_id).catch(err => {
            console.warn(`[LoRA Stale] Failed to terminate pod: ${err}`);
          });
        }
      } catch (err) {
        console.warn(`[LoRA Stale] Could not check pod status (proceeding with reset): ${err}`);
      }
    }

    // Archive any existing "failed" records for this character to avoid
    // unique constraint violation on (character_id, status)
    if (lora.character_id) {
      await (supabase as any)
        .from("character_loras")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("character_id", lora.character_id)
        .eq("status", "failed");
    }

    // Mark as failed with a clear error message
    const errorMsg = `Pipeline stalled in "${lora.status}" for ${ageMin} minutes without progress. ` +
      `This usually means the background process crashed or timed out. Click "Retry Training" to try again.`;

    const { error: updateErr } = await (supabase as any)
      .from("character_loras")
      .update({
        status: "failed",
        error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora.id);

    if (updateErr) {
      console.error(`[LoRA Stale] DB update failed for ${lora.id}:`, updateErr);
      return false;
    }

    console.log(`[LoRA Stale] Marked ${lora.id} as failed (was "${lora.status}" for ${ageMin}min)`);
    return true;
  } catch (err) {
    console.error(`[LoRA Stale] detectAndRecoverStale crashed for ${lora.id}:`, err);
    return false;
  }
}


// GET /api/stories/characters/[storyCharId]/lora-progress
// Poll the LoRA training pipeline progress for a character.
export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  const params = await props.params;
  const { storyCharId } = params;

  try {
    // Fetch the story character to get the character_id and active_lora_id
    const { data: storyChar, error: scError } = await (supabase as any)
      .from("story_characters")
      .select("character_id, active_lora_id")
      .eq("id", storyCharId)
      .single() as { data: { character_id: string; active_lora_id: string | null } | null; error: any };

    if (scError || !storyChar) {
      return NextResponse.json(
        { error: "Story character not found" },
        { status: 404 }
      );
    }

    // Find the most relevant LoRA record
    let { data: lora } = await (supabase as any)
      .from("character_loras")
      .select("id, character_id, status, error, validation_score, training_attempts, training_id, trigger_word, storage_url, filename, dataset_size, created_at, updated_at, deployed_at")
      .eq("character_id", storyChar.character_id)
      .not("status", "eq", "archived")
      .order("created_at", { ascending: false })
      .limit(1)
      .single() as { data: any };

    if (!lora) {
      return NextResponse.json({ status: "no_lora", progress: null });
    }

    // Check for stale pipelines and auto-recover (only for active stages)
    if (ACTIVE_STATUSES.has(lora.status)) {
      const wasStale = await detectAndRecoverStale(lora);
      if (wasStale) {
        // Re-fetch the now-failed record
        const { data: refreshed } = await (supabase as any)
          .from("character_loras")
          .select("id, character_id, status, error, validation_score, training_attempts, training_id, trigger_word, storage_url, filename, dataset_size, created_at, updated_at, deployed_at")
          .eq("id", lora.id)
          .single() as { data: any };
        if (refreshed) lora = refreshed;
      }
    }

    return NextResponse.json({
      loraId: lora.id,
      status: lora.status,
      progress: {
        stage: lora.status,
        error: lora.error,
        validationScore: lora.validation_score,
        trainingAttempts: lora.training_attempts,
        podId: lora.training_id,
        triggerWord: lora.trigger_word,
        loraUrl: lora.storage_url,
        filename: lora.filename,
        deployed: lora.status === "deployed",
        deployedAt: lora.deployed_at,
        updatedAt: lora.updated_at,
        datasetSize: lora.dataset_size,
      },
    });
  } catch (err) {
    console.error("[LoRA API] Progress check failed:", err);
    return NextResponse.json(
      { error: "Failed to check progress", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/stories/characters/[storyCharId]/lora-progress
// Force-reset a stuck LoRA pipeline to "failed" so the user can retry.
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ storyCharId: string }> }
) {
  try {
    const params = await props.params;
    const { storyCharId } = params;
    const body = await request.json();
    const { action } = body as { action?: string };

    if (action !== "force-reset") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    // Find the character's active LoRA
    const { data: storyChar, error: scErr } = await (supabase as any)
      .from("story_characters")
      .select("character_id")
      .eq("id", storyCharId)
      .single();

    if (scErr || !storyChar) {
      return NextResponse.json({ error: `Story character not found: ${scErr?.message || "no data"}` }, { status: 404 });
    }

    const { data: lora, error: loraErr } = await (supabase as any)
      .from("character_loras")
      .select("id, status")
      .eq("character_id", storyChar.character_id)
      .not("status", "eq", "archived")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (loraErr || !lora) {
      return NextResponse.json({ error: `No LoRA found: ${loraErr?.message || "no data"}` }, { status: 404 });
    }

    if (!ACTIVE_STATUSES.has(lora.status)) {
      return NextResponse.json({ error: `LoRA is not stuck (status: ${lora.status})` }, { status: 400 });
    }

    // Archive any existing "failed" records for this character to avoid
    // unique constraint violation on (character_id, status)
    await (supabase as any)
      .from("character_loras")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("character_id", storyChar.character_id)
      .eq("status", "failed");

    // Now safe to set the stuck record to "failed"
    const { error: updateErr } = await (supabase as any)
      .from("character_loras")
      .update({
        status: "failed",
        error: `Manually reset from stuck "${lora.status}" status. Click "Retry Training" to try again.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lora.id);

    if (updateErr) {
      console.error(`[LoRA Reset] DB update failed:`, updateErr);
      return NextResponse.json({ error: `DB update failed: ${updateErr.message}` }, { status: 500 });
    }

    console.log(`[LoRA Reset] Force-reset ${lora.id} from "${lora.status}" to "failed"`);
    return NextResponse.json({ ok: true, previousStatus: lora.status });
  } catch (err) {
    console.error("[LoRA Reset] Unexpected error:", err);
    return NextResponse.json(
      { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
