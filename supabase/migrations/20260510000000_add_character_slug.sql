-- Cross-story character reuse via per-author character slug.
--
-- Why: recurring characters (e.g. Lindiwe across multiple stories) need
-- a stable identifier so re-importing a story with the same character
-- reuses the previously approved face/body portrait + card image rather
-- than orphaning a fresh row. Today's `characters` table dedupes on
-- `name`, which (a) collides across authors now that the platform is
-- multi-author, and (b) is fragile to typos / capitalization drift.
--
-- This migration adds:
--   - characters.author_id (NOT NULL FK) — backfilled per-character via
--     story_characters → story_series.author_id, with the seeded author
--     (Nontsikelelo) as the orphan fallback.
--   - characters.character_slug (nullable text) — explicit identifier
--     supplied in the import JSON. Per-author uniqueness via a partial
--     UNIQUE index that ignores nulls (legacy rows stay valid).
--   - CHECK constraint enforcing slug shape so malformed slugs fail at
--     the DB layer in addition to the validator.
--
-- Slug rules: lowercase ASCII letters + digits + hyphens, 1–64 chars,
-- no leading or trailing hyphen. Mirrors the validator regex in
-- packages/shared/src/story-types.ts so both layers reject the same
-- inputs.

ALTER TABLE characters
  ADD COLUMN author_id      uuid REFERENCES authors(id),
  ADD COLUMN character_slug text;

-- Backfill author_id deterministically: per character, pick the most
-- recently launched series's author. DISTINCT ON makes the choice
-- provably unique even if a character ends up linked to multiple
-- series under different authors in the future.
UPDATE characters c
SET author_id = sub.author_id
FROM (
  SELECT DISTINCT ON (sc.character_id)
         sc.character_id,
         ss.author_id
  FROM story_characters sc
  JOIN story_series ss ON ss.id = sc.series_id
  ORDER BY sc.character_id, ss.created_at DESC
) sub
WHERE sub.character_id = c.id
  AND c.author_id IS NULL;

-- Orphan characters (no story_characters link) fall back to the seeded
-- author so the NOT NULL lock can apply.
UPDATE characters
SET author_id = (SELECT id FROM authors WHERE slug = 'nontsikelelo-mabaso')
WHERE author_id IS NULL;

ALTER TABLE characters ALTER COLUMN author_id SET NOT NULL;

-- Slug shape — mirrors the validator regex.
ALTER TABLE characters
  ADD CONSTRAINT characters_slug_format CHECK (
    character_slug IS NULL
    OR character_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'
  );

-- Per-author uniqueness, only when slug is present. Legacy slugless
-- rows are not constrained.
CREATE UNIQUE INDEX characters_author_slug_unique
  ON characters (author_id, character_slug)
  WHERE character_slug IS NOT NULL;
