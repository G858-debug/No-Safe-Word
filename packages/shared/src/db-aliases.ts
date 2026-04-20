/**
 * Flat type aliases derived from the generated Database type.
 *
 * The Supabase CLI's `gen types typescript` output only emits the
 * nested `Database['public']['Tables'][<name>]['Row' | 'Insert' | 'Update']`
 * shape. This file keeps caller-facing names (`Character`, `ImageRow`,
 * `NswUser`, …) that the rest of the monorepo imports, and derives them
 * from the generated type so the mapping regenerates automatically.
 *
 * Adding an alias here is the expected pattern when a new table enters
 * the schema and callers want a short name for its Row/Insert types.
 */
import type { Database } from "./database.types";

type PublicTables = Database["public"]["Tables"];

// ─── characters ─────────────────────────────────────────────────────
export type Character = PublicTables["characters"]["Row"];
export type CharacterInsert = PublicTables["characters"]["Insert"];

// ─── images ─────────────────────────────────────────────────────────
export type ImageRow = PublicTables["images"]["Row"];
export type ImageInsert = PublicTables["images"]["Insert"];

// ─── generation_jobs ────────────────────────────────────────────────
export type GenerationJobRow = PublicTables["generation_jobs"]["Row"];
export type GenerationJobInsert = PublicTables["generation_jobs"]["Insert"];

// ─── story_* ────────────────────────────────────────────────────────
export type StorySeriesInsert = PublicTables["story_series"]["Insert"];
export type StoryPostInsert = PublicTables["story_posts"]["Insert"];
export type StoryCharacterInsert = PublicTables["story_characters"]["Insert"];
export type StoryImagePromptInsert = PublicTables["story_image_prompts"]["Insert"];

// ─── nsw_users ──────────────────────────────────────────────────────
export type NswUser = PublicTables["nsw_users"]["Row"];
export type NswUserInsert = PublicTables["nsw_users"]["Insert"];
export type NswUserUpdate = PublicTables["nsw_users"]["Update"];

// ─── nsw_subscriptions ──────────────────────────────────────────────
export type NswSubscription = PublicTables["nsw_subscriptions"]["Row"];
export type NswSubscriptionInsert = PublicTables["nsw_subscriptions"]["Insert"];

// ─── nsw_payments ───────────────────────────────────────────────────
export type NswPayment = PublicTables["nsw_payments"]["Row"];
export type NswPaymentInsert = PublicTables["nsw_payments"]["Insert"];

// ─── nsw_purchases ──────────────────────────────────────────────────
export type NswPurchase = PublicTables["nsw_purchases"]["Row"];
export type NswPurchaseInsert = PublicTables["nsw_purchases"]["Insert"];
