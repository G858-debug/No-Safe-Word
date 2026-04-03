-- Remove the file size limit on lora-training-datasets.
-- The default Supabase limit rejects SDXL LoRA .safetensors files which are
-- typically 50-150MB at dim 8. This bucket holds trained model weights only,
-- not user uploads, so no size cap is needed.
UPDATE storage.buckets
SET file_size_limit = NULL
WHERE id = 'lora-training-datasets';
