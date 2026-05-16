import { supabase } from "@no-safe-word/story-engine";
import type { PortraitCharacterDescription } from "@no-safe-word/image-gen";
import {
  draftScenePrompt,
  type DraftSceneCharacter,
  type DraftSceneImageType,
} from "./draft-scene-prompt";

// ============================================================
// DB-side wrapper around draftScenePrompt():
//
// 1. Loads the story_image_prompts row.
// 2. Loads the linked characters.
// 3. Validates that the series is on hunyuan3 and that linked characters
//    have approved descriptions + portraits.
// 4. Calls Mistral via draftScenePrompt().
// 5. Persists the result to story_image_prompts.final_prompt and
//    final_prompt_drafted_at.
//
// Used by both /api/stories/images/[promptId]/draft-prompt (manual
// re-draft) and /api/stories/[seriesId]/generate-image (auto-draft when
// final_prompt is null).
// ============================================================

export interface DraftAndPersistResult {
  finalPrompt: string;
  draftedAt: string;
}

export async function draftAndPersistScenePrompt(
  promptId: string
): Promise<DraftAndPersistResult> {
  const { data: prompt, error: promptErr } = await supabase
    .from("story_image_prompts")
    .select(
      "id, prompt, character_id, secondary_character_id, character_name, secondary_character_name, image_type, clothing_override, sfw_constraint_override, visual_signature_override, post_id, image_id, pose_template_id, ref_mode"
    )
    .eq("id", promptId)
    .single();

  if (promptErr || !prompt) {
    throw new Error(`Prompt ${promptId} not found`);
  }

  // Optional pose template — when set, Mistral writes the prompt around
  // the template's pose_description. The image side of the template
  // (reference URL) is sent to Siray separately by the generation route.
  let poseTemplate: { name: string; description: string } | null = null;
  if (prompt.pose_template_id) {
    const { data: pose } = await supabase
      .from("pose_templates")
      .select("name, pose_description")
      .eq("id", prompt.pose_template_id)
      .single();
    if (pose) {
      poseTemplate = { name: pose.name, description: pose.pose_description };
    }
  }

  // If a previous image exists for this prompt, fetch its critique +
  // the prompt text that was actually sent. Mistral uses both as
  // iterative-improvement context: "here's what you wrote last, here's
  // what Pixtral 12B said went wrong, fix it."
  let previousFinalPrompt: string | null = null;
  let previousCritique: string | null = null;
  if (prompt.image_id) {
    const { data: priorImage } = await supabase
      .from("images")
      .select("prompt, critique")
      .eq("id", prompt.image_id)
      .single();
    if (priorImage) {
      previousFinalPrompt = priorImage.prompt ?? null;
      previousCritique = priorImage.critique ?? null;
    }
  }

  const { data: post, error: postErr } = await supabase
    .from("story_posts")
    .select("series_id")
    .eq("id", prompt.post_id)
    .single();

  if (postErr || !post) {
    throw new Error(`Post for prompt ${promptId} not found`);
  }

  const { data: series, error: seriesErr } = await supabase
    .from("story_series")
    .select("id, image_model")
    .eq("id", post.series_id)
    .single();

  if (seriesErr || !series) {
    throw new Error(`Series for prompt ${promptId} not found`);
  }

  const pipeline = series.image_model === "flux2_dev" ? "flux2_dev" : "hunyuan3";

  const charIds = [prompt.character_id, prompt.secondary_character_id].filter(
    (id): id is string => Boolean(id)
  );

  const charById = new Map<
    string,
    {
      name: string;
      lockedPromptText: string | null;
      fallbackBodyType?: string;
      defaultClothing?: string;
      hasApprovedPortrait: boolean;
    }
  >();

  if (charIds.length > 0) {
    const { data: chars, error: charsErr } = await supabase
      .from("characters")
      .select("id, name, description, portrait_prompt_locked, approved_image_id")
      .in("id", charIds);

    if (charsErr) {
      throw new Error(`Failed to load characters: ${charsErr.message}`);
    }

    for (const c of chars ?? []) {
      if (!c.approved_image_id) {
        throw new Error(
          `Character ${c.name ?? c.id} has no approved portrait yet — approve the portrait before drafting scene prompts.`
        );
      }
      if (pipeline === "hunyuan3" && !c.portrait_prompt_locked && !c.description) {
        throw new Error(
          `Character ${c.name ?? c.id} has neither portrait_prompt_locked nor description. Approve the character's portrait before drafting.`
        );
      }
      const desc = (c.description ?? {}) as PortraitCharacterDescription & {
        clothing?: string;
      };
      charById.set(c.id, {
        name: c.name,
        lockedPromptText: c.portrait_prompt_locked,
        fallbackBodyType: desc.bodyType,
        defaultClothing: desc.clothing,
        hasApprovedPortrait: Boolean(c.approved_image_id),
      });
    }
  }

  const primaryCharacter: DraftSceneCharacter | undefined = prompt.character_id
    ? toDraftCharacter(charById.get(prompt.character_id))
    : undefined;
  const secondaryCharacter: DraftSceneCharacter | undefined = prompt
    .secondary_character_id
    ? toDraftCharacter(charById.get(prompt.secondary_character_id))
    : undefined;

  const aspectRatio =
    prompt.character_id && prompt.secondary_character_id ? "5:4" : "4:5";

  const finalPrompt = await draftScenePrompt({
    imageType: prompt.image_type as DraftSceneImageType,
    aspectRatio,
    primaryCharacter,
    secondaryCharacter,
    scenePrompt: prompt.prompt,
    clothingOverride: prompt.clothing_override,
    sfwConstraintOverride: prompt.sfw_constraint_override,
    visualSignatureOverride: prompt.visual_signature_override,
    previousFinalPrompt,
    previousCritique,
    poseTemplate,
    pipeline,
    refMode: (prompt.ref_mode ?? "face_and_body") as "face" | "body" | "face_and_body",
  });

  const draftedAt = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("story_image_prompts")
    .update({
      final_prompt: finalPrompt,
      final_prompt_drafted_at: draftedAt,
    })
    .eq("id", promptId);

  if (updateErr) {
    throw new Error(`Failed to persist final_prompt: ${updateErr.message}`);
  }

  return { finalPrompt, draftedAt };
}

function toDraftCharacter(
  c:
    | {
        name: string;
        lockedPromptText: string | null;
        fallbackBodyType?: string;
        defaultClothing?: string;
        hasApprovedPortrait: boolean;
      }
    | undefined
): DraftSceneCharacter | undefined {
  if (!c) return undefined;
  return {
    name: c.name,
    lockedPromptText: c.lockedPromptText,
    fallbackBodyType: c.fallbackBodyType,
    defaultClothing: c.defaultClothing,
    hasApprovedPortrait: c.hasApprovedPortrait,
  };
}
