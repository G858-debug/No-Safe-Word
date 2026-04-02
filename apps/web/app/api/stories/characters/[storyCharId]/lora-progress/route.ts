import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";
import type { CharacterInput, CharacterStructured } from "@no-safe-word/image-gen";

// Stale thresholds — if updated_at is older than this, the pipeline process is dead.
// Stages with heartbeats (generating_dataset, evaluating) use a short threshold
// since heartbeats fire every ~2-3 min. No heartbeat for 5 min = dead process.
const STALE_THRESHOLDS: Record<string, number> = {
  generating_dataset: 5 * 60_000,   // 5 min — heartbeats every ~2-3 min
  evaluating: 5 * 60_000,           // 5 min — heartbeats every batch
  captioning: 5 * 60_000,            // 5 min — heartbeats every 3 images
  packaging_dataset: 10 * 60_000,   // 10 min
  training: 90 * 60_000,            // 90 min — pod-based, webhook expected
  validating: 30 * 60_000,          // 30 min
};

// Stages where we can auto-resume (pipeline functions are resumable)
// generating_dataset + evaluating → runPonyPipeline (skips done images)
// captioning + training (no pod) → resumePonyPipeline (re-packages + creates pod)
const AUTO_RESUMABLE_STAGES = new Set(["generating_dataset", "evaluating", "captioning"]);

// Statuses that are active pipeline stages (not terminal states)
const ACTIVE_STATUSES = new Set(Object.keys(STALE_THRESHOLDS));

// In-memory guard: prevent concurrent auto-resumes for the same LoRA
const resumingLoras = new Set<string>();

/**
 * Build CharacterInput from a storyCharId for pipeline re-invocation.
 */
async function buildCharacterInput(storyCharId: string): Promise<CharacterInput | null> {
  const { data: sc } = await (supabase as any)
    .from("story_characters")
    .select(`
      id, character_id, approved_seed, approved_prompt,
      approved_fullbody_seed, approved_image_id, approved_fullbody_image_id,
      characters ( id, name, description )
    `)
    .eq("id", storyCharId)
    .single();
  if (!sc) return null;

  const char = sc.characters as { id: string; name: string; description: Record<string, string> };
  const desc = char.description;

  const [portrait, fullBody] = await Promise.all([
    (supabase as any).from("images").select("stored_url, sfw_url").eq("id", sc.approved_image_id).single(),
    (supabase as any).from("images").select("stored_url, sfw_url").eq("id", sc.approved_fullbody_image_id).single(),
  ]);

  const portraitUrl = portrait.data?.sfw_url || portrait.data?.stored_url;
  const fullBodyUrl = fullBody.data?.sfw_url || fullBody.data?.stored_url;
  if (!portraitUrl || !fullBodyUrl) return null;

  const structuredData: CharacterStructured = {
    gender: desc.gender || "female",
    ethnicity: desc.ethnicity || "",
    bodyType: desc.bodyType || "",
    skinTone: desc.skinTone || "",
    hairColor: desc.hairColor || "",
    hairStyle: desc.hairStyle || "",
    eyeColor: desc.eyeColor || "",
    age: desc.age || "",
    distinguishingFeatures: desc.distinguishingFeatures,
  };

  return {
    characterId: char.id,
    characterName: char.name,
    gender: desc.gender || "female",
    approvedImageUrl: portraitUrl,
    approvedPrompt: sc.approved_prompt || "",
    fullBodyImageUrl: fullBodyUrl,
    fullBodySeed: sc.approved_fullbody_seed || 42,
    portraitSeed: sc.approved_seed || 42,
    structuredData,
    pipelineType: "story_character",
    imageEngine: "pony_cyberreal",
  };
}

/**
 * Check if a LoRA pipeline stage is stale and auto-recover.
 *
 * For resumable stages (generating_dataset, evaluating): re-fires the pipeline
 * in the background. The pipeline is resumable — it skips already-done work.
 *
 * For non-resumable stages: marks as failed so the user can retry.
 *
 * Returns true if the status changed (caller should re-fetch).
 * This function MUST NOT throw.
 */
async function detectAndRecoverStale(lora: any, storyCharId: string): Promise<boolean> {
  try {
    const threshold = STALE_THRESHOLDS[lora.status];
    if (!threshold) return false;

    const updatedAt = new Date(lora.updated_at).getTime();
    const age = Date.now() - updatedAt;

    if (age < threshold) return false;

    const ageMin = Math.round(age / 60_000);
    console.warn(`[LoRA Stale] ${lora.id} stuck in "${lora.status}" for ${ageMin}min`);

    // ── Auto-resume for resumable stages ──
    if (AUTO_RESUMABLE_STAGES.has(lora.status)) {
      if (resumingLoras.has(lora.id)) {
        console.log(`[LoRA Stale] ${lora.id} already being resumed, skipping`);
        return false;
      }

      const charInput = await buildCharacterInput(storyCharId);
      if (!charInput) {
        console.error(`[LoRA Stale] Could not build CharacterInput for ${storyCharId}`);
        return false; // Can't resume without character data
      }

      // Bump updated_at so the next poll doesn't re-trigger immediately
      await (supabase as any)
        .from("character_loras")
        .update({ updated_at: new Date().toISOString(), error: null })
        .eq("id", lora.id);

      // Fire-and-forget: re-invoke the appropriate resumable pipeline function
      resumingLoras.add(lora.id);
      const useResumePipeline = lora.status === "captioning";
      console.log(`[LoRA Stale] Auto-resuming ${lora.id} via ${useResumePipeline ? "resumePonyPipeline" : "runPonyPipeline"} (was "${lora.status}" for ${ageMin}min)`);

      import("@no-safe-word/image-gen/server/pony-lora-trainer").then(({ runPonyPipeline, resumePonyPipeline }) => {
        const fn = useResumePipeline ? resumePonyPipeline : runPonyPipeline;
        fn(charInput, lora.id, { supabase })
          .catch(err => console.error(`[LoRA Stale] Auto-resume failed:`, err))
          .finally(() => resumingLoras.delete(lora.id));
      }).catch(err => {
        console.error(`[LoRA Stale] Failed to import pipeline:`, err);
        resumingLoras.delete(lora.id);
      });

      return false; // Status hasn't changed yet, pipeline is resuming in background
    }

    // ── Training with no pod: process was killed before pod creation ──
    // Use a short threshold (5 min) since no work is happening without a pod
    if (lora.status === "training" && !lora.training_id && age > 5 * 60_000) {
      if (resumingLoras.has(lora.id)) return false;

      const charInput = await buildCharacterInput(storyCharId);
      if (!charInput) return false;

      await (supabase as any)
        .from("character_loras")
        .update({ updated_at: new Date().toISOString(), error: null })
        .eq("id", lora.id);

      resumingLoras.add(lora.id);
      console.log(`[LoRA Stale] Auto-resuming ${lora.id} — training status but no pod (killed before pod creation)`);

      import("@no-safe-word/image-gen/server/pony-lora-trainer").then(({ resumePonyPipeline }) => {
        resumePonyPipeline(charInput, lora.id, { supabase })
          .catch(err => console.error(`[LoRA Stale] Auto-resume (no pod) failed:`, err))
          .finally(() => resumingLoras.delete(lora.id));
      }).catch(err => {
        console.error(`[LoRA Stale] Failed to import pipeline:`, err);
        resumingLoras.delete(lora.id);
      });

      return false;
    }

    // ── Non-resumable stages: mark as failed ──

    // For training status with a pod, check if pod is still alive
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
        if (podStatus.desiredStatus !== "TERMINATED") {
          const { terminateTrainingPod } = await import("@no-safe-word/image-gen/runpod-pods");
          terminateTrainingPod(lora.training_id).catch(() => {});
        }
      } catch {
        // Pod might be gone already
      }
    }

    const errorMsg = `Pipeline stalled in "${lora.status}" for ${ageMin} minutes. Click "Regenerate Dataset" to try again.`;
    const { error: updateErr } = await (supabase as any)
      .from("character_loras")
      .update({ status: "failed", error: errorMsg, updated_at: new Date().toISOString() })
      .eq("id", lora.id);

    if (updateErr) {
      console.error(`[LoRA Stale] DB update failed:`, updateErr);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[LoRA Stale] detectAndRecoverStale crashed:`, err);
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
      const wasStale = await detectAndRecoverStale(lora, storyCharId);
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
