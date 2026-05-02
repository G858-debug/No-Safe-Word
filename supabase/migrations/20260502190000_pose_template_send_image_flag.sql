-- Pose templates: opt-in flag for sending the reference image to Siray.
--
-- Default FALSE because Hunyuan i2i cannot separate "use this for pose"
-- from "use this for identity" — sending a reference photo containing
-- a recognisable person bleeds that person's face/skin/hair into the
-- rendered character, overriding the linked character's face portrait.
--
-- When FALSE we send only the pose_description text to Mistral; the
-- image is retained purely as a visual reference for the user (and as
-- the source they wrote the text description from).
--
-- Toggle ON only for identity-safe references: silhouettes, line
-- drawings, anatomical diagrams.

ALTER TABLE pose_templates
  ADD COLUMN send_image_to_model BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN pose_templates.send_image_to_model IS
  'When TRUE the pose template image is appended as a 3rd i2i reference for Siray. When FALSE (default) only the pose_description text is used. Keep FALSE for any image that contains a recognisable face/skin tone — Hunyuan i2i cannot separate pose from identity and will bleed the reference person into the rendered character. Toggle ON only for identity-safe references (silhouettes, line drawings, anatomy diagrams).';
