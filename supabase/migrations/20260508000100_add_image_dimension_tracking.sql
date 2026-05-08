-- Visible-fallback support for portrait generation.
--
-- When we ask Hunyuan via Siray for 1536-per-side and Siray rejects it, we
-- retry once at 1280-per-side. We never silently narrow: the actual delivered
-- dimensions and the rejection reason are persisted on the `images` row so
-- the UI can show a badge indicating the fallback fired.
--
-- requested_*  : what we asked for
-- actual_*     : what came back (and is stored)
-- dimension_fallback_reason : Siray's error message or our own reason
--
-- Flux 2 Dev does not have a Siray-style cap, but we populate these columns
-- on every generation so the UI logic can stay uniform (no fallback ever
-- fires for Flux; actual_* always equals requested_*).

ALTER TABLE images
  ADD COLUMN requested_width int,
  ADD COLUMN requested_height int,
  ADD COLUMN actual_width int,
  ADD COLUMN actual_height int,
  ADD COLUMN dimension_fallback_reason text;
