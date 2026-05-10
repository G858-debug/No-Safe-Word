-- Set by /revoke-face when a body image exists at face-revoke time.
-- Cleared by /approve-body. UI derives effective staleness as
-- body_invalidated_at IS NOT NULL AND latest body image's created_at <=
-- body_invalidated_at, so a freshly-generated body clears the stale banner
-- immediately on render rather than only on approval.
--
-- All existing characters have NULL on this column (none are stale at
-- migration time — they were all approved face+body together under the
-- legacy atomic-pair flow).

ALTER TABLE characters
  ADD COLUMN body_invalidated_at timestamptz NULL;

COMMENT ON COLUMN characters.body_invalidated_at IS
  'Set by /revoke-face when a body image exists at revoke time; cleared by /approve-body. Effective staleness = (this NOT NULL) AND (latest body image created_at <= this).';
