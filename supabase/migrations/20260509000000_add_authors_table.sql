-- Phase 1: Author system foundation.
--
-- Introduces a first-class `authors` table so the platform can host work
-- from multiple authors. The cover-compositing typography currently
-- hardcodes "Nontsikelelo Mabaso"; subsequent migrations move that to
-- a foreign key on story_series.author_id, sourced from this table.
--
-- For now, this phase ships with one author row (Nontsikelelo). Adding
-- a second author becomes a single INSERT, not a code change.

CREATE TABLE authors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  portrait_url text,
  bio_short text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reuse the project's standard updated_at trigger function (defined in
-- supabase/schema.sql alongside the characters trigger).
CREATE TRIGGER authors_updated_at
  BEFORE UPDATE ON authors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Seed the existing author so the upcoming author_id NOT NULL constraint
-- on story_series can backfill cleanly.
INSERT INTO authors (name, slug)
VALUES ('Nontsikelelo Mabaso', 'nontsikelelo-mabaso');
