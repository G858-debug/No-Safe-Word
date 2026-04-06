# Image Editing Workflows — Pipeline Reference

## Overview

After initial image generation, the user has access to several post-generation editing tools. These are ComfyUI workflow variants that modify an existing generated image rather than generating from scratch.

All editing workflows run on the same RunPod serverless infrastructure as generation, using the same Juggernaut Ragnarok checkpoint.

## Inpainting

**Purpose:** Fix a specific region of a generated image without regenerating the whole thing.

**Use cases:**
- Fix a bad hand (extra fingers, wrong position)
- Correct an expression that doesn't match the prompt
- Fix clothing that bled into skin or vice versa
- Correct a background element
- Fix anatomical errors in a specific body region

**ComfyUI approach:**
- Use `SetLatentNoiseMask` node with a binary mask defining the region to regenerate
- Denoise strength: 0.5–0.8 for the masked region (higher = more change)
- The unmasked regions are preserved exactly
- The inpainting checkpoint variant (if available) gives better edge blending

**Implementation notes:**
- The user selects a rectangular or freeform region in the UI
- The region is converted to a binary mask
- The original image + mask + modified prompt are sent to the inpainting workflow
- The result replaces only the masked region

## img2img Refinement

**Purpose:** Nudge the overall composition or style of a generated image without destroying identity.

**Use cases:**
- The pose is right but the lighting feels off
- The composition is close but needs subtle adjustment
- Want to add more detail or refine textures
- The image is good but feels slightly "AI" — add film grain or texture

**ComfyUI approach:**
- Load the generated image as the init image
- Apply the prompt (can be modified from the original)
- Denoise strength: 0.2–0.4 (CRITICAL — higher values destroy the original image)
- Same sampler/scheduler as txt2img (DPM++ 2M SDE Karras)

**Implementation notes:**
- The user can adjust denoise strength via slider
- The prompt can be edited before running img2img
- Multiple passes at low denoise can incrementally refine without destroying
- 0.2 = subtle refinement, 0.3 = moderate changes, 0.4 = significant changes

## Upscaling

**Purpose:** Increase image resolution for final publication quality.

**Recommended pipeline:**
1. Generate at SDXL native resolution (832×1216 or 1024×1024)
2. Upscale 1.5x using 4xNMKD-Siax_200k upscaler
3. 15 steps, 0.3 denoise for the upscale pass

**ComfyUI approach:**
- `ImageUpscaleWithModel` node with 4xNMKD-Siax_200k
- Follow with a KSampler at low denoise (0.3) to refine the upscaled image
- This adds detail that pure upscaling misses

**Implementation notes:**
- Upscaling should be the LAST step — after all other edits
- The upscaler model needs to be on the RunPod network volume
- Output images are ~1.5x larger in both dimensions

## FaceDetailer

**Purpose:** Improve facial features in a generated image.

**Use cases:**
- Face is slightly blurry at the generated resolution
- Facial features don't match the character LoRA well enough
- Eyes or teeth have minor artifacts
- Face is too small in a full-body shot

**ComfyUI approach:**
- Uses the Impact Pack's FaceDetailer node
- Automatically detects faces in the image
- Runs a second-pass generation focused on just the face region
- Character LoRA is applied during the face pass for identity consistency

**Implementation notes:**
- For dual-character scenes: run two FaceDetailer passes, one per character LoRA
- FaceDetailer strength: 0.4–0.6 (too high will create an uncanny "pasted on" look)
- Already in the current pipeline — carries forward unchanged

## Workflow Integration

The Story Publisher UI should present these as options per generated image:

```
[Generated Image]
[Prompt field — editable]
[Regenerate] [Approve]
[Edit ▼]
  ├── Inpaint Region...
  ├── Refine (img2img)...
  ├── Upscale
  └── Fix Face (FaceDetailer)
```

Each editing operation produces a new image version. The user can compare before/after and choose which to keep.

## ControlNet (Phase 2 — Planned)

ControlNet is NOT implemented in the initial pipeline but is architecturally planned for Phase 2.

**Planned use cases:**
- **OpenPose** for two-character scene composition — provide a skeleton wireframe to control where each character appears in the frame
- **Depth conditioning** for SFW/NSFW progression pair continuity — use the same depth map for both versions to ensure spatial layout matches

**Requirements when implementing:**
- OpenPose SDXL model on RunPod network volume
- Pose skeleton generation (from reference images or manual editor)
- ControlNet conditioning nodes added to the ComfyUI workflow
- Conditioning strength parameter (0.3–0.7 typical range)

This will be implemented after the core pipeline is validated with real story output.
