-- Pose template library.
--
-- A reusable pose has:
--   - name: short label, used in dropdowns + Mistral prompts ("Plowcam")
--   - pose_description: text Mistral consumes when drafting; should
--     describe the body positions, camera framing, and any constraints
--     ("female lying face-down, arms forward, male behind from above…").
--   - image_id: FK to images table, the reference image that gets sent
--     to Siray as a third i2i conditioning input alongside the two
--     character face portraits.
--
-- Linked from story_image_prompts.pose_template_id; when set, scene
-- generation pulls the pose's reference URL and prepends to the i2i
-- references, and Mistral wraps the supplied pose_description with
-- setting/wardrobe/lighting from the scene.

CREATE TABLE pose_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  pose_description TEXT NOT NULL,
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pose_templates IS
  'Reusable pose presets. Each template carries a text description (consumed by Mistral) and a reference image (passed as a 3rd i2i input to Siray) so the same body composition can be applied across stories.';

ALTER TABLE story_image_prompts
  ADD COLUMN pose_template_id UUID REFERENCES pose_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN story_image_prompts.pose_template_id IS
  'Optional FK to pose_templates. When set, Mistral writes the prompt around the template''s pose_description and Siray receives the template''s reference image as a 3rd i2i input.';

CREATE INDEX idx_story_image_prompts_pose_template_id
  ON story_image_prompts(pose_template_id)
  WHERE pose_template_id IS NOT NULL;
