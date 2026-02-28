import { supabase } from "./supabase";
import type { Json } from "@no-safe-word/shared";
import {
  slugify,
  type StoryImportPayload,
  type ImportResult,
  type CharacterImport,
} from "@no-safe-word/shared";
import { cleanScenePrompt } from "@no-safe-word/image-gen";
import { detectSecondaryCharacters } from "./detect-secondary-character";

/**
 * Import a complete story payload into the database.
 * Used by both /api/stories/import and /api/webhook/story-import.
 */
export async function importStory(
  payload: StoryImportPayload
): Promise<ImportResult> {
  const slug = slugify(payload.series.title);

  // Check for duplicate slug
  const { data: existingSeries } = await supabase
    .from("story_series")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existingSeries) {
    throw new Error(
      `A series with slug "${slug}" already exists (id: ${existingSeries.id}). ` +
        `Delete or archive it first, or use a different title.`
    );
  }

  // 1. Create or find characters — build a name→id map
  const characterMap = new Map<string, string>();
  for (const char of payload.characters) {
    const characterId = await upsertCharacter(char);
    characterMap.set(char.name, characterId);
  }

  // 2. Create the story series
  const { data: series, error: seriesError } = await supabase
    .from("story_series")
    .insert({
      title: payload.series.title,
      slug,
      description: payload.series.description || null,
      total_parts: payload.series.total_parts,
      hashtag: payload.series.hashtag || null,
      status: "characters_pending",
      marketing: (payload.marketing ?? {}) as Json,
    })
    .select("id")
    .single();

  if (seriesError || !series) {
    throw new Error(`Failed to create series: ${seriesError?.message}`);
  }

  const seriesId = series.id;

  // 3. Link characters to series
  const storyCharacterRows = payload.characters.map((char) => ({
    series_id: seriesId,
    character_id: characterMap.get(char.name)!,
    role: char.role,
    prose_description: char.prose_description || null,
    approved: false,
  }));

  const { error: linkError } = await supabase
    .from("story_characters")
    .insert(storyCharacterRows);

  if (linkError) {
    throw new Error(`Failed to link characters: ${linkError.message}`);
  }

  // 4. Create posts and their image prompts
  let totalImagePrompts = 0;
  const postIds: string[] = [];

  for (const post of payload.posts) {
    // Create the post
    const { data: postRow, error: postError } = await supabase
      .from("story_posts")
      .insert({
        series_id: seriesId,
        part_number: post.part_number,
        title: post.title,
        facebook_content: post.facebook_content,
        website_content: post.website_content,
        facebook_teaser: post.facebook_teaser || null,
        facebook_comment: post.facebook_comment || null,
        hashtags: post.hashtags || [],
        status: "draft",
      })
      .select("id")
      .single();

    if (postError || !postRow) {
      throw new Error(
        `Failed to create post ${post.part_number}: ${postError?.message}`
      );
    }

    const postId = postRow.id;
    postIds.push(postId);

    // Create image prompts — Facebook SFW
    const sfwPromptIds = new Map<number, string>(); // position → prompt id

    for (const img of post.images.facebook_sfw) {
      const charId = img.character_name
        ? characterMap.get(img.character_name) || null
        : null;
      const secondaryCharId = img.secondary_character_name
        ? characterMap.get(img.secondary_character_name) || null
        : null;

      const { data: promptRow, error: promptError } = await supabase
        .from("story_image_prompts")
        .insert({
          post_id: postId,
          image_type: "facebook_sfw",
          position: img.position,
          character_name: img.character_name || null,
          character_id: charId,
          secondary_character_name: img.secondary_character_name || null,
          secondary_character_id: secondaryCharId,
          prompt: cleanScenePrompt(img.prompt),
          status: "pending",
        })
        .select("id")
        .single();

      if (promptError || !promptRow) {
        throw new Error(
          `Failed to create SFW prompt for post ${post.part_number}: ${promptError?.message}`
        );
      }

      sfwPromptIds.set(img.position, promptRow.id);
      totalImagePrompts++;
    }

    // Create image prompts — Website NSFW Paired
    for (const img of post.images.website_nsfw_paired) {
      const charId = img.character_name
        ? characterMap.get(img.character_name) || null
        : null;
      const secondaryCharId = img.secondary_character_name
        ? characterMap.get(img.secondary_character_name) || null
        : null;

      const pairedWithId = sfwPromptIds.get(img.pairs_with_facebook) || null;

      const { error: promptError } = await supabase
        .from("story_image_prompts")
        .insert({
          post_id: postId,
          image_type: "website_nsfw_paired",
          pairs_with: pairedWithId,
          position: img.pairs_with_facebook,
          character_name: img.character_name || null,
          character_id: charId,
          secondary_character_name: img.secondary_character_name || null,
          secondary_character_id: secondaryCharId,
          prompt: cleanScenePrompt(img.prompt),
          status: "pending",
        });

      if (promptError) {
        throw new Error(
          `Failed to create NSFW paired prompt for post ${post.part_number}: ${promptError.message}`
        );
      }

      totalImagePrompts++;
    }

    // Create image prompts — Website Only
    for (let i = 0; i < post.images.website_only.length; i++) {
      const img = post.images.website_only[i];
      const charId = img.character_name
        ? characterMap.get(img.character_name) || null
        : null;
      const secondaryCharId = img.secondary_character_name
        ? characterMap.get(img.secondary_character_name) || null
        : null;

      const { error: promptError } = await supabase
        .from("story_image_prompts")
        .insert({
          post_id: postId,
          image_type: "website_only",
          position: i + 1,
          position_after_word: img.position_after_word,
          character_name: img.character_name || null,
          character_id: charId,
          secondary_character_name: img.secondary_character_name || null,
          secondary_character_id: secondaryCharId,
          prompt: cleanScenePrompt(img.prompt),
          status: "pending",
        });

      if (promptError) {
        throw new Error(
          `Failed to create website-only prompt for post ${post.part_number}: ${promptError.message}`
        );
      }

      totalImagePrompts++;
    }
  }

  // 5. Auto-detect secondary characters in prompts that don't have one linked
  let autoDetectedSecondary = 0;

  if (postIds.length > 0) {
    const { data: allPrompts } = await supabase
      .from("story_image_prompts")
      .select("id, prompt, character_id, secondary_character_id")
      .in("post_id", postIds)
      .is("secondary_character_id", null);

    if (allPrompts && allPrompts.length > 0) {
      const detections = detectSecondaryCharacters(
        allPrompts,
        payload.characters,
        characterMap
      );

      for (const detection of detections) {
        await supabase
          .from("story_image_prompts")
          .update({
            secondary_character_name: detection.detectedCharacterName,
            secondary_character_id: detection.detectedCharacterId,
          })
          .eq("id", detection.promptId);
      }

      autoDetectedSecondary = detections.length;
      console.log(
        `[Import] Auto-detected ${detections.length} secondary characters in ${allPrompts.length} prompts`
      );
      for (const d of detections) {
        console.log(
          `[Import]   ${d.promptId.substring(0, 8)}: ${d.detectedCharacterName} (${d.confidence}) — ${d.reason}`
        );
      }
    }
  }

  return {
    series_id: seriesId,
    slug,
    posts_created: payload.posts.length,
    characters_linked: payload.characters.length,
    image_prompts_queued: totalImagePrompts,
    auto_detected_secondary: autoDetectedSecondary,
  };
}

/**
 * Find an existing character by name or create a new one.
 * If the character exists, update the description to the latest.
 * Returns the character UUID.
 */
async function upsertCharacter(char: CharacterImport): Promise<string> {
  // Try to find by exact name match
  const { data: existing } = await supabase
    .from("characters")
    .select("id")
    .eq("name", char.name)
    .maybeSingle();

  if (existing) {
    // Update description to latest
    await supabase
      .from("characters")
      .update({ description: char.structured as unknown as Json })
      .eq("id", existing.id);

    return existing.id;
  }

  // Create new character
  const { data: created, error } = await supabase
    .from("characters")
    .insert({
      name: char.name,
      description: char.structured as unknown as Json,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(
      `Failed to create character "${char.name}": ${error?.message}`
    );
  }

  return created.id;
}
