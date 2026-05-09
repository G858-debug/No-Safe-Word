import { supabase } from "./supabase";
import type { Database, Json } from "@no-safe-word/shared";
import {
  slugify,
  AUTHOR_NOTES_KEYS,
  type StoryImportPayload,
  type ImportResult,
  type CharacterImport,
  type CharacterImportAction,
  type CharacterImportOutcome,
  type ImageModel,
  type AuthorNotes,
} from "@no-safe-word/shared";
import { cleanScenePrompt } from "@no-safe-word/image-gen";
import { detectSecondaryCharacters } from "./detect-secondary-character";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The subset of supabase methods upsertCharacter exercises. Lets tests
 * pass an in-memory fake without faking the entire SupabaseClient surface.
 */
type SupabaseLike = SupabaseClient<Database>;

export interface ImportStoryOptions {
  /** Image generation model for the new series. Defaults to 'flux2_dev'. */
  imageModel?: ImageModel;
}

/**
 * Import a complete story payload into the database.
 * Used by both /api/stories/import and /api/webhook/story-import.
 */
export async function importStory(
  payload: StoryImportPayload,
  options: ImportStoryOptions = {}
): Promise<ImportResult> {
  const slug = slugify(payload.series.title);
  const imageModel: ImageModel = options.imageModel ?? 'flux2_dev';

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

  // Resolve the author. An explicit `series.author_slug` must match an
  // existing row in `authors`. Absence falls back to Nontsikelelo. Either
  // way, an unresolvable slug throws — anonymous covers are not allowed.
  const requestedSlug = payload.series.author_slug?.trim() || "nontsikelelo-mabaso";
  const { data: authorRow } = await supabase
    .from("authors")
    .select("id")
    .eq("slug", requestedSlug)
    .maybeSingle();

  if (!authorRow) {
    const { data: existingAuthors } = await supabase
      .from("authors")
      .select("slug");
    const slugList = (existingAuthors ?? []).map((r) => r.slug).join(", ");
    throw new Error(
      `Author with slug '${requestedSlug}' not found. Existing authors: [${slugList}]. Cannot import.`
    );
  }
  const authorId = authorRow.id;

  // 1. Create or find characters — build a name→id map and record the
  //    per-character action (reused / name_matched / created) so the
  //    operator can spot mistyped slugs in the response.
  const characterMap = new Map<string, string>();
  const characterOutcomes: CharacterImportOutcome[] = [];
  for (const char of payload.characters) {
    const { id: characterId, action } = await upsertCharacter(char, authorId);
    characterMap.set(char.name, characterId);
    characterOutcomes.push({ name: char.name, action });
  }

  // 2. Extract blurb variants + cover_prompt from the marketing block
  //    and write them to the dedicated top-level columns (added in
  //    migration 041). The full marketing JSONB is ALSO preserved for
  //    fields that don't have dedicated columns (taglines,
  //    posting_schedule, teaser_prompt).
  //
  //    Defense-in-depth validation: validateImportPayload() already
  //    enforces the exactly-3 rule at the webhook layer, but non-
  //    webhook callers of importStory() could bypass it. Re-check
  //    here so malformed payloads fail loudly instead of landing
  //    null top-level columns while the marketing JSONB has
  //    whatever-length arrays.
  const marketing = payload.marketing;

  const blurbShortVariants =
    marketing?.blurb_short_variants !== undefined ? marketing.blurb_short_variants : null;
  if (blurbShortVariants !== null) {
    if (!Array.isArray(blurbShortVariants) || blurbShortVariants.length !== 3) {
      throw new Error(
        `marketing.blurb_short_variants must be an array of exactly 3 strings (got ${
          Array.isArray(blurbShortVariants) ? blurbShortVariants.length : typeof blurbShortVariants
        })`
      );
    }
    if (!blurbShortVariants.every((v) => typeof v === "string" && v.length > 0)) {
      throw new Error(
        "marketing.blurb_short_variants entries must all be non-empty strings"
      );
    }
  }

  const blurbLongVariants =
    marketing?.blurb_long_variants !== undefined ? marketing.blurb_long_variants : null;
  if (blurbLongVariants !== null) {
    if (!Array.isArray(blurbLongVariants) || blurbLongVariants.length !== 3) {
      throw new Error(
        `marketing.blurb_long_variants must be an array of exactly 3 strings (got ${
          Array.isArray(blurbLongVariants) ? blurbLongVariants.length : typeof blurbLongVariants
        })`
      );
    }
    if (!blurbLongVariants.every((v) => typeof v === "string" && v.length > 0)) {
      throw new Error(
        "marketing.blurb_long_variants entries must all be non-empty strings"
      );
    }
  }

  const coverPrompt =
    marketing?.cover_prompt !== undefined && marketing.cover_prompt !== null
      ? String(marketing.cover_prompt).trim() || null
      : null;

  // Defense-in-depth re-validation of author_notes (mirrors validator).
  // Non-webhook callers of importStory() bypass validateImportPayload; this
  // ensures malformed blocks fail loudly here rather than landing partially
  // populated in the JSONB column.
  let authorNotes: AuthorNotes | null = null;
  if (marketing?.author_notes !== undefined && marketing.author_notes !== null) {
    const raw = marketing.author_notes as unknown;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("marketing.author_notes must be an object when provided");
    }
    const notes = raw as Record<string, unknown>;

    for (const key of AUTHOR_NOTES_KEYS) {
      const value = notes[key];
      if (value === undefined) {
        throw new Error(
          `marketing.author_notes.${key} is required and must be a non-empty string`
        );
      }
      if (typeof value !== "string") {
        throw new Error(`marketing.author_notes.${key} must be a string`);
      }
      if (value.trim().length === 0) {
        throw new Error(
          `marketing.author_notes.${key} must not be empty or whitespace-only`
        );
      }
    }

    const allowed = new Set<string>(AUTHOR_NOTES_KEYS);
    for (const key of Object.keys(notes)) {
      if (!allowed.has(key)) {
        throw new Error(
          `marketing.author_notes contains unknown key: '${key}'`
        );
      }
    }

    authorNotes = {
      website_long: notes.website_long as string,
      email_version: notes.email_version as string,
      linkedin_post: notes.linkedin_post as string,
      social_caption: notes.social_caption as string,
    };
  }

  // Author-note accompanying image prompt — required when author_notes is
  // present. Mirrors the validator rule for non-webhook callers.
  let authorNoteImagePrompt: string | null = null;
  if (authorNotes !== null) {
    const raw = marketing?.author_notes_image_prompt;
    if (raw === undefined || raw === null) {
      throw new Error(
        "marketing.author_notes_image_prompt is required when marketing.author_notes is provided"
      );
    }
    if (typeof raw !== "string") {
      throw new Error("marketing.author_notes_image_prompt must be a string");
    }
    if (raw.trim().length === 0) {
      throw new Error(
        "marketing.author_notes_image_prompt must not be empty or whitespace-only"
      );
    }
    authorNoteImagePrompt = raw.trim();
  }

  // 3. Create the story series
  const { data: series, error: seriesError } = await supabase
    .from("story_series")
    .insert({
      title: payload.series.title,
      slug,
      description: payload.series.description || null,
      total_parts: payload.series.total_parts,
      hashtag: payload.series.hashtag || null,
      status: "characters_pending",
      image_model: imageModel,
      marketing: (payload.marketing ?? {}) as Json,
      blurb_short_variants: (blurbShortVariants ?? null) as Json | null,
      blurb_long_variants: (blurbLongVariants ?? null) as Json | null,
      cover_prompt: coverPrompt,
      author_notes: (authorNotes ?? null) as Json | null,
      author_id: authorId,
      author_note_image_prompt: authorNoteImagePrompt,
    })
    .select("id")
    .single();

  if (seriesError || !series) {
    throw new Error(`Failed to create series: ${seriesError?.message}`);
  }

  const seriesId = series.id;

  // From here on out, anything that throws leaves a zombie series row
  // (blocking future imports with the same slug because the orphan still
  // owns it). Wrap the rest of the import in try/catch — on failure, drop
  // the series (CASCADE clears posts/characters/prompts) and rethrow.
  try {
    return await finishImport(
      seriesId,
      slug,
      payload,
      characterMap,
      characterOutcomes
    );
  } catch (err) {
    await supabase.from("story_series").delete().eq("id", seriesId);
    throw err;
  }
}

async function finishImport(
  seriesId: string,
  slug: string,
  payload: StoryImportPayload,
  characterMap: Map<string, string>,
  characterOutcomes: CharacterImportOutcome[]
): Promise<ImportResult> {
  // 4. Link characters to series. Portrait state (approved_image_id, etc.)
  //    lives on the base `characters` row and is populated via the approval
  //    route — not set here at import time.
  const storyCharacterRows = payload.characters.map((char) => {
    return {
      series_id: seriesId,
      character_id: characterMap.get(char.name)!,
      role: char.role,
      prose_description: char.prose_description || null,
    };
  });

  const { error: linkError } = await supabase
    .from("story_characters")
    .insert(storyCharacterRows);

  if (linkError) {
    throw new Error(`Failed to link characters: ${linkError.message}`);
  }

  // 5. Create posts and their image prompts
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

  // 6. Auto-detect secondary characters in prompts that don't have one linked
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
    characters: characterOutcomes,
  };
}

/**
 * Find or create the canonical character row for an imported character.
 *
 * Resolution order:
 *   1. Slug match: SELECT WHERE author_id = ? AND character_slug = ?
 *      → reuse the existing row, refresh description + profile-card
 *      fields from the new JSON. Approved face/body/card FKs and
 *      approval timestamps are NOT touched (they belong to the row).
 *   2. Name match (author-scoped): SELECT WHERE author_id = ? AND name = ?
 *      → reuse + opportunistically attach the slug if the new JSON
 *      supplied one and the existing row doesn't already have one.
 *      NOTE: this is a deliberate behaviour change from the prior
 *      global name-keyed dedupe, which silently merged same-named
 *      characters across authors (latent multi-author bug).
 *   3. Insert fresh row with author_id + character_slug + name +
 *      description + profile fields.
 *
 * Returns the character UUID and the action that fired so the import
 * response can surface it.
 *
 * `client` parameter is for dependency injection in tests; defaults to
 * the module-level service-role supabase client.
 */
export async function upsertCharacter(
  char: CharacterImport,
  authorId: string,
  client: SupabaseLike = supabase
): Promise<{ id: string; action: CharacterImportAction }> {
  const profileCardFields = buildProfileCardFields(char);

  // 1. Slug-keyed reuse (preferred when slug present)
  if (char.character_slug) {
    const { data: bySlug } = await client
      .from("characters")
      .select("id")
      .eq("author_id", authorId)
      .eq("character_slug", char.character_slug)
      .maybeSingle();

    if (bySlug) {
      const { error } = await client
        .from("characters")
        .update({
          name: char.name,
          description: char.structured as unknown as Json,
          ...profileCardFields,
        })
        .eq("id", bySlug.id);

      if (error) {
        throw new Error(
          `Failed to update reused character "${char.name}" (${char.character_slug}): ${error.message}`
        );
      }
      return { id: bySlug.id, action: "reused" };
    }
  }

  // 2. Name-keyed fallback, scoped to author. Tightens the prior
  //    global-name dedupe.
  const { data: byName } = await client
    .from("characters")
    .select("id, character_slug")
    .eq("author_id", authorId)
    .eq("name", char.name)
    .maybeSingle();

  if (byName) {
    // Opportunistically attach the slug if the JSON supplied one and
    // the existing row hasn't been slugged yet. Never overwrite an
    // existing slug — that would silently rebind the slug namespace.
    const slugAttachment =
      char.character_slug && !byName.character_slug
        ? { character_slug: char.character_slug }
        : {};

    const { error } = await client
      .from("characters")
      .update({
        description: char.structured as unknown as Json,
        ...profileCardFields,
        ...slugAttachment,
      })
      .eq("id", byName.id);

    if (error) {
      throw new Error(
        `Failed to update name-matched character "${char.name}": ${error.message}`
      );
    }
    return { id: byName.id, action: "name_matched" };
  }

  // 3. Fresh insert
  const { data: created, error } = await client
    .from("characters")
    .insert({
      name: char.name,
      author_id: authorId,
      character_slug: char.character_slug ?? null,
      description: char.structured as unknown as Json,
      ...profileCardFields,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(
      `Failed to create character "${char.name}": ${error?.message}`
    );
  }
  return { id: created.id, action: "created" };
}

/**
 * Pick profile-card fields from a CharacterImport, dropping any keys whose
 * values are undefined so the update path doesn't overwrite stored data
 * with nulls.
 */
function buildProfileCardFields(char: CharacterImport): Record<string, string> {
  const fields: Record<string, string> = {};
  if (char.archetype_tag !== undefined) fields.archetype_tag = char.archetype_tag;
  if (char.vibe_line !== undefined) fields.vibe_line = char.vibe_line;
  if (char.wants !== undefined) fields.wants = char.wants;
  if (char.needs !== undefined) fields.needs = char.needs;
  if (char.defining_quote !== undefined) fields.defining_quote = char.defining_quote;
  if (char.watch_out_for !== undefined) fields.watch_out_for = char.watch_out_for;
  if (char.bio_short !== undefined) fields.bio_short = char.bio_short;
  if (char.card_image_prompt !== undefined) fields.card_image_prompt = char.card_image_prompt;
  return fields;
}
