# Novita Stage A — Pre-Flight Report

**Date:** 2026-04-26  
**Status: STOPPED — Two hard blockers hit before any generation ran**

---

## What Was Checked

Before writing the generation script, the Novita API was queried for:
- Available checkpoints (`/v3/model?type=checkpoint`)
- Available LoRAs (`/v3/model?type=lora`)
- IP-Adapter / face reference support

This is the correct order — building the script first and discovering blockers during execution would have wasted time and credits.

---

## Blocker 1 — No Pony Checkpoints Available

This account key is restricted to a **whitelisted catalog of exactly 20 models**. The `?type=` and `?query=` filter parameters are accepted but silently ignored — every query returns the same fixed list regardless of filter. Pagination loops on `c_20` indefinitely.

**None of the requested Pony checkpoints exist:**

| Requested | Available? |
|---|---|
| Pony Realism v2.2 [SDXL] | ✗ Not in catalog |
| CyberRealistic Pony | ✗ Not in catalog |
| AutismMix Confetti | ✗ Not in catalog |
| Pony Diffusion V6 XL | ✗ Not in catalog |
| Any SDXL-Pony model | ✗ None whatsoever |

The only photorealistic NSFW checkpoint in the whitelist is:

| model_name | Architecture | NSFW | Notes |
|---|---|---|---|
| `pornmasterPro_fullV5-inpainting_135217.safetensors` | SD 1.5 | ✓ | Tagged: porn, realistic, vagina, penis, nudes. Inpainting variant but works for txt2img. |

Per the brief: *"None of the Pony Realism checkpoints exist on Novita → we'd need to discuss alternatives."* **Stopping here.**

---

## Blocker 2 — No IP-Adapter / Face Reference

All face-conditioning endpoints return 404 or silently strip parameters:

- `/v3/async/ip-adapter` → **404 Not Found**
- `/v3/async/instantid` → **404 Not Found**
- `/v3/async/face-swap` → **404 Not Found**
- `ip_adapter: [...]` inside txt2img body → silently stripped; `debug_info.request_info` confirms parameter was not passed to backend

Per the brief: *"IP-Adapter / face reference is not supported by Novita → we'd need a different consistency strategy."* **Stopping here.**

---

## LoRA Situation (not a hard stop, but also broken)

None of the four requested LoRAs exist in the whitelist:

| Requested | Available? |
|---|---|
| Skin Tone Slider PonyXL | ✗ Not in catalog |
| Realism LoRA Pony | ✗ Not in catalog |
| Detail Slider PonyXL | ✗ Not in catalog |
| Hourglass Body Shape v2 Pony | ✗ Not in catalog |

What IS available (5 LoRAs total, all SD 1.5):

| Name | model_name | Notes |
|---|---|---|
| GoodHands-beta2 | `GoodHands-beta2_39807` | Hand improvement |
| Weight Slider v2 | `weight_slider_v2_91681` | Fat/skinny slider |
| Hair Length Slider v1 | `hair_length_slider_v1_88944` | Hair length |
| Gender Slider v1 | `gender_slider_v1_87782` | Gender swap |
| MyBreastHelper Reduced | `MyBreastHelperReducedRS_77310` | NSFW breast size modifier |

This is a moot point given blockers 1 and 2, but worth noting that the Pony LoRA ecosystem does not exist on this account.

---

## What Worked Fine

- API key is valid and authenticates correctly.
- The txt2img endpoint itself (`/v3/async/txt2img`) responds and would generate images.
- ControlNet IS available (openpose, softedge, depth, canny — all SD 1.5 only).
- Lindiwe's approved portrait was found in the database and is accessible:  
  `https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/story-images/characters/c253f23b-dd7f-4a94-864a-dae88aac5569.jpeg`

---

## What Didn't Work

The core Stage A recipe — Pony SDXL + Pony LoRAs + IP-Adapter face reference — is entirely unavailable on this account tier. The three pillars of the test are all missing.

Running Stage A with SD 1.5 pornmasterPro + no face reference + no matching LoRAs would answer a completely different question than the one Stage A was designed to ask. It would not tell us whether Novita works for our case.

---

## Root Cause

Novita operates account tiers. The current key has a restricted whitelist that appears to be a default/free tier. The full CivitAI marketplace (which includes Pony models, SDXL, IP-Adapter, InstantID) is behind a higher tier.

---

## Options to Discuss

### Option A — Upgrade the Novita account tier
Novita's paid plans unlock the full CivitAI marketplace. This would give access to Pony Realism v2.2, all the requested LoRAs, and likely InstantID / IP-Adapter for face consistency. This is the cleanest path if Novita is the intended vendor.

**Unknowns:** What tier, what cost per generation on Pony XL, and whether IP-Adapter is actually available post-upgrade (the API showed no routes for it at all, which may be architectural rather than tier-based).

### Option B — Test on RunPod directly with a Pony checkpoint
We already have RunPod infrastructure. We could download a Pony Realism SDXL checkpoint to the network volume and run it through ComfyUI with PuLID (which is already in the Flux 2 Dev workflow). This answers the same question without needing Novita at all.

**Trade-off:** More setup work, but uses infrastructure we already control and understand.

### Option C — Use Replicate with a Pony model
Replicate has broader model coverage. Check whether a Pony Realism / SDXL Pony NSFW model with IP-Adapter support is available there (we already have a Replicate token from HunyuanImage).

**Trade-off:** Replicate pricing on SDXL is per-second GPU time; may be more expensive than Novita credits at scale.

### Option D — Drop the Pony recipe requirement
If the goal is NSFW realism with face consistency, test with what's available — SD 1.5 pornmasterPro on Novita, with ControlNet openpose for body positioning, and evaluate whether quality is sufficient without Pony. This is the fastest path to seeing output, but the result may not be good enough to draw conclusions.

---

## Recommendation

**Option A first, then report back.** Log in to Novita, check what the next tier includes and what it costs, specifically:
1. Does the upgraded tier include SDXL Pony models?
2. Does it include IP-Adapter / InstantID endpoints (or are those routes simply not built yet)?
3. What is the per-image cost on Pony Realism v2.2 at 832×1216, 30 steps?

If IP-Adapter routes are absent even on the paid tier (architectural gap, not a tier gap), then **Option B** (RunPod with PuLID) is the correct path since PuLID is already proven working in our Flux 2 Dev pipeline.

---

## No Images Generated

Per the brief: stage A generates 3 images, evaluates output, stops. Since both preconditions (Pony checkpoint + face reference) failed, no generations were run. Credit spend: $0.

---

## Lindiwe Portrait (for when you do run Stage A)

```
Character: Lindiwe Dlamini (protagonist, THE LOBOLA LIST)
character_id: efc71e1c-06aa-4cc1-993d-c852636ce10e
approved_image_id: c253f23b-dd7f-4a94-864a-dae88aac5569
stored_url: https://mqemiteirxwscxtamdtj.supabase.co/storage/v1/object/public/story-images/characters/c253f23b-dd7f-4a94-864a-dae88aac5569.jpeg
```
