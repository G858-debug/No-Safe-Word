// Story Publisher Types
// These types define the JSON format Claude outputs at Stage 7
// and the database models for the story publisher pipeline.

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
}

export interface CharacterImport {
  name: string;
  role: "protagonist" | "love_interest" | "supporting" | "antagonist";
  prose_description: string;
  structured: CharacterStructured;
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
  secondary_character_name?: string;
  prompt: string;
}

export interface WebsiteNsfwPairedImage {
  pairs_with_facebook: number; // position number of the facebook_sfw image
  character_name: string | null;
  secondary_character_name?: string;
  prompt: string;
}

export interface WebsiteOnlyImage {
  position_after_word: number;
  character_name: string | null;
  secondary_character_name?: string;
  prompt: string;
}

export interface MarketingImport {
  taglines?: string[];
  posting_schedule?: string;
  teaser_prompt?: string;
}

// ============================================================
// DATABASE ROW TYPES (what Supabase stores)
// ============================================================

export interface StorySeriesRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  total_parts: number;
  hashtag: string | null;
  status: SeriesStatus;
  marketing: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  approved: boolean;
  approved_image_id: string | null;
  approved_seed: number | null;
  approved_prompt: string | null;
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
  status: ImagePromptStatus;
  created_at: string;
  updated_at: string;
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

export interface ImportResult {
  series_id: string;
  slug: string;
  posts_created: number;
  characters_linked: number;
  image_prompts_queued: number;
  auto_detected_secondary: number;
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
  }

  // Characters validation
  if (!Array.isArray(obj.characters)) {
    errors.push("'characters' must be an array");
  } else {
    for (let i = 0; i < obj.characters.length; i++) {
      const c = obj.characters[i] as Record<string, unknown>;
      if (!c.name) errors.push(`characters[${i}].name is required`);
      if (!c.structured || typeof c.structured !== "object")
        errors.push(`characters[${i}].structured is required`);
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
