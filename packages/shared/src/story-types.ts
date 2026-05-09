// Story Publisher Types
// These types define the JSON format Claude outputs at Stage 7
// and the database models for the story publisher pipeline.
//
// Pipeline stages (for context; see the claude.ai Project system
// prompt for the authoritative 10-stage definition):
//
//   Stage 7  — JSON import (this file's `StoryImportPayload`).
//   Stage 8  — Character portrait generation + approval.
//   Stage 8½ — COVER generation + approval. Runs AFTER character
//              approval and BEFORE scene image generation. Covers
//              always use Flux 2 Dev regardless of
//              story_series.image_model; the dedicated endpoint
//              /api/stories/[seriesId]/generate-cover bypasses the
//              model-aware dispatcher (implemented in Prompt 2).
//   Stage 9  — Scene image generation (model-aware:
//              flux2_dev | hunyuan3).
//   Stage 10 — Review & publish (cover + blurbs + posts together).

// ============================================================
// JSON IMPORT FORMAT (what Claude produces)
// ============================================================

/** The complete JSON payload Claude outputs after Stage 6 approval */
export interface StoryImportPayload {
  series: SeriesImport;
  characters: CharacterImport[];
  posts: PostImport[];
  marketing?: MarketingImport;
}

export interface SeriesImport {
  title: string;
  description: string;
  hashtag: string;
  total_parts: number;
  /**
   * Optional author identifier. Resolves at import time against `authors.slug`.
   * Absent → defaults to the platform's original author (Nontsikelelo Mabaso).
   * An unknown slug fails the import loudly.
   */
  author_slug?: string;
}

export interface CharacterImport {
  name: string;
  /**
   * Optional stable identifier for cross-story reuse. When supplied
   * and an existing character row matches (author_id, character_slug),
   * the import reuses that row's approved face/body portraits, card
   * image, and approval timestamps. Profile fields and prose_description
   * are still rewritten from this JSON.
   *
   * Format: lowercase ASCII letters + digits + hyphens, 1–64 chars,
   * no leading or trailing hyphen. Enforced by the validator AND a
   * DB CHECK constraint (migration 20260510000000).
   */
  character_slug?: string;
  role: "protagonist" | "love_interest" | "supporting" | "antagonist";
  prose_description: string;
  structured: CharacterStructured;

  // ── Profile-card fields (Phase 1). All optional. Drive the future
  //    "MEET THE CAST" section + Story Publisher approval stage. ──
  archetype_tag?: string;
  vibe_line?: string;
  wants?: string;
  needs?: string;
  defining_quote?: string;
  watch_out_for?: string;
  bio_short?: string;
  card_image_prompt?: string;
}

/** Structured character data for image generation — matches existing CharacterData type */
export interface CharacterStructured {
  gender: string;
  age: string;
  ethnicity: string;
  bodyType: string;
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  distinguishingFeatures: string;
  clothing: string;
  expression: string;
  pose: string;
}

export interface PostImport {
  part_number: number;
  title: string;
  facebook_content: string;
  website_content: string;
  facebook_teaser: string | null;
  facebook_comment: string | null;
  hashtags: string[];
  images: PostImagesImport;
}

export interface PostImagesImport {
  facebook_sfw: FacebookSfwImage[];
  website_nsfw_paired: WebsiteNsfwPairedImage[];
  website_only: WebsiteOnlyImage[];
}

export interface FacebookSfwImage {
  position: number;
  character_name: string | null;
  // For scenes with 3+ characters: link only the 2 most prominent here.
  // Describe remaining characters inline in the prompt text.
  secondary_character_name?: string;
  prompt: string;
}

export interface WebsiteNsfwPairedImage {
  pairs_with_facebook: number; // position number of the facebook_sfw image
  character_name: string | null;
  // For scenes with 3+ characters: link only the 2 most prominent here.
  // Describe remaining characters inline in the prompt text.
  secondary_character_name?: string;
  prompt: string;
}

export interface WebsiteOnlyImage {
  position_after_word: number;
  character_name: string | null;
  // For scenes with 3+ characters: link only the 2 most prominent here.
  // Describe remaining characters inline in the prompt text.
  secondary_character_name?: string;
  prompt: string;
}

export interface MarketingImport {
  taglines?: string[];
  posting_schedule?: string;
  teaser_prompt?: string;
  /** 3 short blurb variants (1–2 sentences each). User selects one in the Story Publisher. */
  blurb_short_variants?: string[];
  /** 3 long blurb variants (150–250 words each). User selects one in the Story Publisher. */
  blurb_long_variants?: string[];
  /** Cover image prompt (Five Layers Framework, two-character intimate composition, suggestive-not-explicit). Generated via Flux 2 Dev regardless of story image_model. */
  cover_prompt?: string;
  /**
   * Optional editorial reflection block from the author persona.
   * Absent when the story is entertainment-only and did not earn notes.
   * When present, all four sub-fields are required and non-empty.
   */
  author_notes?: AuthorNotes;
  /**
   * Prompt for the image that accompanies the Author's Notes block on the
   * story page. REQUIRED when `author_notes` is present (validator enforces
   * the pairing). Image generation is Phase 2.
   */
  author_notes_image_prompt?: string;
}

/**
 * Editorial reflection block produced at Stage 7 alongside the story JSON.
 * Persisted on `story_series.author_notes` as JSONB. Rendered on the Publish
 * review screen and (future) on the public website story page.
 */
export interface AuthorNotes {
  /** 400–700 word reflection, paywalled on the website story page. */
  website_long: string;
  /** 200–350 word email body. */
  email_version: string;
  /** 150–250 word LinkedIn post under the Nontsikelelo persona. */
  linkedin_post: string;
  /** 60–120 word Facebook/Instagram caption. */
  social_caption: string;
}

/** Allowed keys inside `author_notes`. Used by validators to reject unknown keys. */
export const AUTHOR_NOTES_KEYS: ReadonlyArray<keyof AuthorNotes> = [
  "website_long",
  "email_version",
  "linkedin_post",
  "social_caption",
];

// ============================================================
// DATABASE ROW TYPES (what Supabase stores)
// ============================================================

/**
 * Active image generation model for a story. Set at import time.
 *
 * - `flux2_dev`: Flux 2 Dev via ComfyUI/RunPod (PuLID reference images).
 * - `hunyuan3`: HunyuanImage 3.0 via Siray.ai (text + i2i reference images).
 *
 * The string values are persisted to the database — do not rename them
 * even if the underlying provider changes.
 */
export type ImageModel = 'flux2_dev' | 'hunyuan3';

/**
 * Cover generation state machine. Cover generation is model-locked to
 * Flux 2 Dev regardless of story_series.image_model — see CLAUDE.md.
 *
 * Flow: pending → generating → variants_ready → approved → compositing → complete
 * Any stage may transition to `failed`; retry resumes from the last checkpoint.
 */
export type CoverStatus =
  | "pending"
  | "generating"
  | "variants_ready"
  | "approved"
  | "compositing"
  | "complete"
  | "failed";

/** Composited cover output URLs, written after typography passes. */
export interface CoverSizes {
  /** Website story detail page. 1600×2400 JPEG. */
  hero: string;
  /** Library grid + story cards. 600×900 JPEG. */
  card: string;
  /** OG link previews (landscape layout). 1200×630 JPEG. */
  og: string;
  /** Email headers (landscape layout). 1200×600 JPEG. */
  email: string;
}

export interface StorySeriesRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  total_parts: number;
  hashtag: string | null;
  status: SeriesStatus;
  /** Active generation model. Authoritative. */
  image_model: ImageModel;
  marketing: Record<string, unknown>;

  // --- Cover fields (added in migration 041) ---
  /** Generation prompt for the cover. Editable in the UI. Fed into Flux 2 Dev. */
  cover_prompt: string | null;
  /** Public URL of the approved base image (no typography, 1024×1536). */
  cover_base_url: string | null;
  /** Up to 4 variant URLs produced during generation. */
  cover_variants: string[] | null;
  /** Index 0–3 of the user-selected variant. Null until approved. */
  cover_selected_variant: number | null;
  /** Composited output URLs keyed by size label. */
  cover_sizes: CoverSizes | null;
  cover_status: CoverStatus;

  // --- Blurb fields (added in migration 041) ---
  /** 3 short blurb variants (1–2 sentences). */
  blurb_short_variants: string[] | null;
  /** Index 0–2 of selected short blurb. */
  blurb_short_selected: number | null;
  /** 3 long blurb variants (150–250 words). */
  blurb_long_variants: string[] | null;
  /** Index 0–2 of selected long blurb. */
  blurb_long_selected: number | null;

  // --- Author's notes (migration 20260428100000) ---
  /**
   * Optional editorial reflection block. NULL when the story did not earn notes.
   * When present, contains exactly four non-empty strings (validated at import).
   */
  author_notes: AuthorNotes | null;

  // --- Cover-reveal Buffer post (migration 20260506000000) ---
  /** Buffer Post.id for the cover-reveal post. Null until scheduled. */
  cover_post_buffer_id: string | null;
  /**
   * Last observed Buffer status for the cover post. Mirrors Buffer's
   * PostStatus enum (pending|scheduled|sending|sent|error). Synced by
   * /api/cron/buffer-sync.
   */
  cover_post_status: string | null;
  /** Buffer-side error message when cover_post_status='error'. */
  cover_post_error: string | null;
  /** The scheduledAt we asked Buffer for. ISO string. */
  cover_post_scheduled_for: string | null;
  /** Buffer-reported sentAt for the cover post. ISO string. */
  cover_post_published_at: string | null;
  /** FB post id parsed from Buffer.externalLink. */
  cover_post_facebook_id: string | null;
  /** Operator-edited CTA line appended to the cover post body. */
  cover_post_cta_line: string | null;

  created_at: string;
  updated_at: string;
}

// --- Derived getters (computed in TS; NOT DB columns) ---------

/** Selected short blurb text, or null if not yet selected. */
export function getSelectedShortBlurb(row: Pick<StorySeriesRow, "blurb_short_variants" | "blurb_short_selected">): string | null {
  const { blurb_short_variants: vs, blurb_short_selected: i } = row;
  if (!vs || i === null || i === undefined) return null;
  return vs[i] ?? null;
}

/** Selected long blurb text, or null if not yet selected. */
export function getSelectedLongBlurb(row: Pick<StorySeriesRow, "blurb_long_variants" | "blurb_long_selected">): string | null {
  const { blurb_long_variants: vs, blurb_long_selected: i } = row;
  if (!vs || i === null || i === undefined) return null;
  return vs[i] ?? null;
}

/** Composited hero cover URL (website detail page), or null if not composited. */
export function getCoverHeroUrl(row: Pick<StorySeriesRow, "cover_sizes">): string | null {
  return row.cover_sizes?.hero ?? null;
}

/** Composited card cover URL (library grid), or null if not composited. */
export function getCoverCardUrl(row: Pick<StorySeriesRow, "cover_sizes">): string | null {
  return row.cover_sizes?.card ?? null;
}

/** Composited OG cover URL (link previews), or null if not composited. */
export function getCoverOgUrl(row: Pick<StorySeriesRow, "cover_sizes">): string | null {
  return row.cover_sizes?.og ?? null;
}

/** Composited email cover URL (email headers), or null if not composited. */
export function getCoverEmailUrl(row: Pick<StorySeriesRow, "cover_sizes">): string | null {
  return row.cover_sizes?.email ?? null;
}

export type SeriesStatus =
  | "draft"
  | "characters_pending"
  | "images_pending"
  | "review"
  | "scheduled"
  | "published"
  | "archived";

export interface StoryPostRow {
  id: string;
  series_id: string;
  part_number: number;
  title: string;
  facebook_content: string;
  facebook_teaser: string | null;
  facebook_comment: string | null;
  website_content: string;
  hashtags: string[];
  status: PostStatus;
  facebook_post_id: string | null;
  published_at: string | null;
  scheduled_for: string | null;
  buffer_post_id: string | null;
  buffer_status: string | null;
  buffer_error: string | null;
  created_at: string;
  updated_at: string;
}

export type PostStatus =
  | "draft"
  | "images_pending"
  | "images_approved"
  | "ready"
  | "scheduled"
  | "published";

export interface StoryCharacterRow {
  id: string;
  series_id: string;
  character_id: string;
  role: string;
  prose_description: string | null;
}

/**
 * Base-roster character row. One row per unique identity; reused across every
 * story that features them. Portrait approval writes here — not to
 * story_characters — so approved faces persist across stories.
 */
export interface CharacterRow {
  id: string;
  name: string;
  description: Record<string, unknown>;
  approved_image_id: string | null;
  approved_seed: number | null;
  approved_prompt: string | null;
  /** Exact prompt text that produced the approved portrait. Injected verbatim into scene prompts for hunyuan3. Null until portrait approved. */
  portrait_prompt_locked: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoryImagePromptRow {
  id: string;
  post_id: string;
  image_type: ImageType;
  pairs_with: string | null;
  position: number;
  position_after_word: number | null;
  character_name: string | null;
  character_id: string | null;
  secondary_character_name: string | null;
  secondary_character_id: string | null;
  prompt: string;
  image_id: string | null;
  sfw_image_id: string | null;
  status: ImagePromptStatus;
  created_at: string;
  updated_at: string;
  character_block_override: string | null;
  secondary_character_block_override: string | null;
}

export type ImageType = "facebook_sfw" | "website_nsfw_paired" | "website_only";
export type ImagePromptStatus =
  | "pending"
  | "generating"
  | "generated"
  | "approved"
  | "failed";

// ============================================================
// API RESPONSE TYPES
// ============================================================

/**
 * What the import did with each character entry. Surfaced in
 * ImportResult.characters so the operator can spot a mistyped slug
 * (action="created" when "reused" was expected).
 *
 * - "reused"        — slug match → existing row reused (portraits inherited).
 * - "name_matched"  — no slug or slug miss, but name match in this author's
 *                     namespace → existing row reused (portraits inherited).
 * - "created"       — fresh insert (typo in slug? new character? new author?).
 */
export type CharacterImportAction = "reused" | "name_matched" | "created";

export interface CharacterImportOutcome {
  /** Character display name from the import JSON. */
  name: string;
  action: CharacterImportAction;
}

export interface ImportResult {
  series_id: string;
  slug: string;
  posts_created: number;
  characters_linked: number;
  image_prompts_queued: number;
  auto_detected_secondary: number;
  /**
   * Per-character outcome aligned with payload.characters order. Lets the
   * operator verify the slug-keyed reuse path fired as expected.
   */
  characters: CharacterImportOutcome[];
}

export interface SeriesWithDetails extends StorySeriesRow {
  posts: StoryPostRow[];
  characters: (StoryCharacterRow & {
    character: { id: string; name: string; description: Record<string, unknown> };
  })[];
  image_prompt_counts: {
    total: number;
    pending: number;
    generated: number;
    approved: number;
    failed: number;
  };
}

// ============================================================
// VALIDATION
// ============================================================

export function validateImportPayload(
  data: unknown
): { valid: true; payload: StoryImportPayload } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Payload must be a JSON object"] };
  }

  const obj = data as Record<string, unknown>;

  // Series validation
  if (!obj.series || typeof obj.series !== "object") {
    errors.push("Missing or invalid 'series' object");
  } else {
    const s = obj.series as Record<string, unknown>;
    if (!s.title || typeof s.title !== "string") errors.push("series.title is required");
    if (!s.total_parts || typeof s.total_parts !== "number")
      errors.push("series.total_parts is required and must be a number");
    if (s.author_slug !== undefined) {
      if (typeof s.author_slug !== "string" || s.author_slug.trim().length === 0) {
        errors.push("series.author_slug must be a non-empty string when provided");
      }
    }
  }

  // Characters validation
  if (!Array.isArray(obj.characters)) {
    errors.push("'characters' must be an array");
  } else {
    const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
    for (let i = 0; i < obj.characters.length; i++) {
      const c = obj.characters[i] as Record<string, unknown>;
      if (!c.name) errors.push(`characters[${i}].name is required`);
      if (!c.structured || typeof c.structured !== "object")
        errors.push(`characters[${i}].structured is required`);

      // Optional cross-story reuse identifier. Format mirrored in the
      // DB CHECK constraint (migration 20260510000000) so both layers
      // reject the same inputs.
      if (c.character_slug !== undefined) {
        if (typeof c.character_slug !== "string") {
          errors.push(`characters[${i}].character_slug must be a string`);
        } else if (!SLUG_REGEX.test(c.character_slug)) {
          errors.push(
            `characters[${i}].character_slug must be 1–64 chars, lowercase ASCII letters / digits / hyphens, no leading or trailing hyphen`
          );
        }
      }

      // Optional profile-card fields — must be strings when present.
      const optionalCharStringFields = [
        "archetype_tag",
        "vibe_line",
        "wants",
        "needs",
        "defining_quote",
        "watch_out_for",
        "bio_short",
        "card_image_prompt",
      ] as const;
      for (const field of optionalCharStringFields) {
        if (c[field] !== undefined && c[field] !== null && typeof c[field] !== "string") {
          errors.push(`characters[${i}].${field} must be a string when provided`);
        }
      }
    }
  }

  // Posts validation
  if (!Array.isArray(obj.posts)) {
    errors.push("'posts' must be an array");
  } else {
    for (let i = 0; i < obj.posts.length; i++) {
      const p = obj.posts[i] as Record<string, unknown>;
      if (!p.part_number) errors.push(`posts[${i}].part_number is required`);
      if (!p.title) errors.push(`posts[${i}].title is required`);
      if (!p.facebook_content) errors.push(`posts[${i}].facebook_content is required`);
      if (!p.website_content) errors.push(`posts[${i}].website_content is required`);

      if (p.images && typeof p.images === "object") {
        const imgs = p.images as Record<string, unknown>;
        if (!Array.isArray(imgs.facebook_sfw))
          errors.push(`posts[${i}].images.facebook_sfw must be an array`);
        if (!Array.isArray(imgs.website_nsfw_paired))
          errors.push(`posts[${i}].images.website_nsfw_paired must be an array`);
        if (!Array.isArray(imgs.website_only))
          errors.push(`posts[${i}].images.website_only must be an array`);
      } else {
        errors.push(`posts[${i}].images is required`);
      }
    }
  }

  // Marketing validation (optional block — cover/blurbs are added post-import,
  // but if present at import they must have the correct shape).
  if (obj.marketing !== undefined && obj.marketing !== null) {
    if (typeof obj.marketing !== "object") {
      errors.push("'marketing' must be an object when provided");
    } else {
      const m = obj.marketing as Record<string, unknown>;

      if (m.blurb_short_variants !== undefined) {
        if (!Array.isArray(m.blurb_short_variants) || m.blurb_short_variants.length !== 3) {
          errors.push("marketing.blurb_short_variants must be an array of exactly 3 strings");
        } else if (!m.blurb_short_variants.every((v) => typeof v === "string" && v.length > 0)) {
          errors.push("marketing.blurb_short_variants entries must all be non-empty strings");
        }
      }

      if (m.blurb_long_variants !== undefined) {
        if (!Array.isArray(m.blurb_long_variants) || m.blurb_long_variants.length !== 3) {
          errors.push("marketing.blurb_long_variants must be an array of exactly 3 strings");
        } else if (!m.blurb_long_variants.every((v) => typeof v === "string" && v.length > 0)) {
          errors.push("marketing.blurb_long_variants entries must all be non-empty strings");
        }
      }

      if (m.cover_prompt !== undefined && (typeof m.cover_prompt !== "string" || m.cover_prompt.length === 0)) {
        errors.push("marketing.cover_prompt must be a non-empty string when provided");
      }

      // author_notes — optional, but strict when present.
      if (m.author_notes !== undefined && m.author_notes !== null) {
        if (typeof m.author_notes !== "object" || Array.isArray(m.author_notes)) {
          errors.push("marketing.author_notes must be an object when provided");
        } else {
          const notes = m.author_notes as Record<string, unknown>;

          for (const key of AUTHOR_NOTES_KEYS) {
            const value = notes[key];
            if (value === undefined) {
              errors.push(`marketing.author_notes.${key} is required and must be a non-empty string`);
            } else if (typeof value !== "string") {
              errors.push(`marketing.author_notes.${key} must be a string`);
            } else if (value.trim().length === 0) {
              errors.push(`marketing.author_notes.${key} must not be empty or whitespace-only`);
            }
          }

          const allowed = new Set<string>(AUTHOR_NOTES_KEYS);
          for (const key of Object.keys(notes)) {
            if (!allowed.has(key)) {
              errors.push(`marketing.author_notes contains unknown key: '${key}'`);
            }
          }
        }

        // When author_notes is present, the accompanying image prompt must
        // also be present. Image generation is Phase 2; this guarantees the
        // input is captured at import.
        if (
          m.author_notes_image_prompt === undefined ||
          m.author_notes_image_prompt === null
        ) {
          errors.push(
            "marketing.author_notes_image_prompt is required when marketing.author_notes is provided"
          );
        } else if (typeof m.author_notes_image_prompt !== "string") {
          errors.push("marketing.author_notes_image_prompt must be a string");
        } else if (m.author_notes_image_prompt.trim().length === 0) {
          errors.push(
            "marketing.author_notes_image_prompt must not be empty or whitespace-only"
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, payload: data as StoryImportPayload };
}

/** Generate a URL-friendly slug from a title */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
