# Flux 2 Migration: PuLID → Native Multi-Reference

**Status:** Design (Phase R1) — READ-ONLY research. No code changed.
**Date:** 2026-05-16
**Branch target:** TBD (sandbox first, then cutover)

## Summary

- The current Flux 2 Dev pipeline uses **PuLID** (`ApplyPulidFlux` + `FixPulidFluxPatch`) to inject face identity. PuLID is broken under ComfyUI 5.8.x because of forward-pass hook ordering; the runtime guards in [`infra/runpod/patch_pulid.py:57-78`](../../infra/runpod/patch_pulid.py#L57-L78) explicitly fall through with un-conditioned output when `pulid_temp_attrs["timesteps"]` is missing — producing images with **zero face identity** but no error in any log.
- We migrate to Flux 2's **native multi-reference** support via the built-in `ReferenceLatent` node. This is ComfyUI core (no custom nodes), uses standard `VAEEncode` to attach reference images to the conditioning stream, and bypasses the entire mid-forward-pass-hook architecture that PuLID requires.
- Identity now flows as **encoded latents on the conditioning**, not as face embeddings injected into model weights. Flux 2 reads `reference_latents` from conditioning natively, so there's nothing to hook, nothing to patch.
- The TS workflow builder is the only place that changes meaningfully; route handlers and the RunPod transport are unchanged. A new worker image strips PuLID/InsightFace/EVA-CLIP entirely.
- Cutover is gated by a feature flag (`FLUX2_USE_NATIVE_MULTIREF`) and a separate sandbox RunPod endpoint, so production stays on PuLID-but-broken until the new path is verified.

## Q1 — ComfyUI version

**Current worker base:** `runpod/worker-comfyui:5.8.5-base` pinned at [`infra/runpod/Dockerfile.base:1`](../../infra/runpod/Dockerfile.base#L1).

**ComfyUI version inside that base:** the upstream Dockerfile uses `ARG COMFYUI_VERSION=latest` and installs via `comfy-cli` (`comfy install --version ${COMFYUI_VERSION} --nvidia`) — see worker-comfyui's [main Dockerfile](https://github.com/runpod-workers/worker-comfyui/blob/main/Dockerfile). The `5.8.5-base` image on Docker Hub was pushed ~2 months ago (mid-March 2026 per Docker Hub tag metadata). At that time, `comfy --version latest` would have resolved to roughly **ComfyUI v0.17.x–v0.18.x** based on the upstream `comfyanonymous/ComfyUI` release history:
- v0.18.0 published 2026-03-21
- v0.17.2 published 2026-03-15
- v0.17.0 published 2026-03-13

This is **well past the v0.3.72/v0.3.75 cut-line** where Flux 2 native nodes were first introduced. Per the Comfy Org blog post ([FLUX.2 Day-0 Support in ComfyUI](https://blog.comfy.org/p/flux2-state-of-the-art-visual-intelligence)), the minimum is v0.3.72 and v0.3.75 was the "FP8 workflows stable" cut. Both `EmptyFlux2LatentImage` and `Flux2Scheduler` are confirmed native after v0.3.72; `ReferenceLatent` is a long-standing core ComfyUI conditioning node (predates Flux entirely) — sources: [ComfyUI docs Flux 2 tutorial](https://docs.comfy.org/tutorials/flux/flux-2-dev), [Issue #10920 about v0.3.73 Flux 2 perf](https://github.com/Comfy-Org/ComfyUI/issues/10920).

**Latest worker-comfyui tag available:** `5.8.5-base` is the most recent release on Docker Hub. Tags in `runpod-workers/worker-comfyui` go 4.x → 5.0.0 → … → 5.8.5; nothing newer.

**Latest ComfyUI release:** v0.21.1 (published 2026-05-13). Recent line: v0.21.1 / v0.21.0 (2026-05-11) / v0.20.1 (2026-04-27) / v0.19.x (2026-04-13 to 04-17) / v0.18.x (2026-03-21 to 03-25). All have native Flux 2 nodes.

**Upgrade required?** **NO at the worker-base level** — `runpod/worker-comfyui:5.8.5-base` is the latest. **MAYBE at the ComfyUI level** — we don't know which exact version landed in that base image, only that it's almost certainly ≥ v0.17.x and therefore has the nodes we need. To be safe:

**Recommended approach:** Add a `RUN comfy update` (or `RUN cd /comfyui && git fetch && git checkout v0.21.1`) step in `Dockerfile.base` after the `FROM runpod/worker-comfyui:5.8.5-base` line, pinning to a known-good ComfyUI version (suggested: **v0.21.1**, the current latest stable). This makes the ComfyUI version explicit and auditable instead of inheriting "whatever comfy-cli chose 2 months ago."

**Built-in node verification (all expected to exist in v0.17+):** `UNETLoader`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode`, `LoadImage`, `VAEEncode`, `VAEDecode`, `SaveImage`, `EmptyFlux2LatentImage` (new with Flux 2), `Flux2Scheduler` (new with Flux 2), `ReferenceLatent` (core, predates Flux 2), `FluxGuidance` (core, since Flux 1), `KSamplerSelect` (core), `SamplerCustomAdvanced` (core), `BasicGuider` (core), `RandomNoise` (core). All confirmed by the target architecture spec and Comfy Org docs.

## Q2 — Code change inventory

| File | Lines | Description | Status |
|---|---|---|---|
| [`packages/image-gen/src/flux2-workflow-builder.ts`](../../packages/image-gen/src/flux2-workflow-builder.ts) | 1-255 (entire file) | Builds the current PuLID workflow JSON (UNETLoader → ModelSamplingFlux → PuLID chain 290-310 → KSampler chain 500-503). The `Flux2ReferenceImage` interface stays; the JSON shape is rewritten. | **REWRITE** (or add native variant in a new file; see Q4) |
| [`packages/image-gen/src/flux2-workflow-builder.ts`](../../packages/image-gen/src/flux2-workflow-builder.ts) | 113-161 | The PuLID node block (`PulidFluxInsightFaceLoader`, `PulidFluxEvaClipLoader`, `PulidFluxModelLoader`, `LoadImage`, `ApplyPulidFlux`, `FixPulidFluxPatch`). | **REMOVE** (replaced by ReferenceLatent chain) |
| [`packages/image-gen/src/flux2-workflow-builder.ts`](../../packages/image-gen/src/flux2-workflow-builder.ts) | 29-34 | `Flux2ReferenceImage` interface (currently has `strength` field for PuLID weight). | **KEEP shape, deprecate `strength`** — `ReferenceLatent` is binary on/off. If we later want per-ref weighting, [`comfyui-ReferenceLatentPlus`](https://github.com/shootthesound/comfyui-ReferenceLatentPlus) can be added (custom node). |
| [`packages/image-gen/src/flux2-generator.ts`](../../packages/image-gen/src/flux2-generator.ts) | 1-139 (entire file) | Wraps `buildFlux2Workflow` and submits to RunPod. Public API (`generateFlux2Image`, `Flux2GenerateOptions`, `Flux2GenerateResult`) stays unchanged. | **MODIFY** (read feature flag + dispatch to old/new builder; ~5 line change at `buildFlux2Workflow` call site). |
| [`packages/image-gen/src/runpod.ts`](../../packages/image-gen/src/runpod.ts) | 1-317 | Low-level RunPod submit/poll. Model-agnostic. | **UNCHANGED** |
| [`packages/image-gen/src/hunyuan-generator.ts`](../../packages/image-gen/src/hunyuan-generator.ts) | — | Hunyuan path. Untouched by this migration. | **UNCHANGED** |
| [`apps/web/app/api/stories/characters/[storyCharId]/generate-body/route.ts`](../../apps/web/app/api/stories/characters/%5BstoryCharId%5D/generate-body/route.ts) | 202-216 | Calls `generateFlux2Image({ references: [{ name, base64 }] })`. Caller doesn't know about PuLID; dispatch is internal. | **UNCHANGED** |
| [`apps/web/app/api/stories/[seriesId]/generate-cover/route.ts`](../../apps/web/app/api/stories/%5BseriesId%5D/generate-cover/route.ts) | 403-433 | Builds `references` array (1-2 refs), calls `generateFlux2Image`. | **UNCHANGED** |
| [`apps/web/app/api/stories/[seriesId]/generate-image/route.ts`](../../apps/web/app/api/stories/%5BseriesId%5D/generate-image/route.ts) | 363-390 | Same shape — builds references, calls `generateFlux2Image`. | **UNCHANGED** |
| [`apps/web/app/api/characters/[characterId]/generate-card-image/route.ts`](../../apps/web/app/api/characters/%5BcharacterId%5D/generate-card-image/route.ts) | 243-256 | Same shape. | **UNCHANGED** |
| [`apps/web/app/api/stories/[seriesId]/generate-author-note-image/route.ts`](../../apps/web/app/api/stories/%5BseriesId%5D/generate-author-note-image/route.ts) | 174 | Calls with `references: []`. | **UNCHANGED** (empty-refs branch must be supported in the new builder too — just omits the `ReferenceLatent` nodes). |
| [`apps/web/lib/server/generate-cover-prompt.ts`](../../apps/web/lib/server/generate-cover-prompt.ts) | (search) | Mentions "PuLID" in prompt-engineering copy/comments. | **MODIFY** (text-only cleanup; remove or rephrase any PuLID-specific guidance once we confirm where it appears). |
| [`apps/web/lib/server/get-portrait-urls.ts`](../../apps/web/lib/server/get-portrait-urls.ts) | (search) | Mentions "PuLID" in comments. | **MODIFY** (comment cleanup only). |
| [`packages/image-gen/src/workflow-builder.ts`](../../packages/image-gen/src/workflow-builder.ts) | — | Legacy SDXL/Juggernaut workflow builder. Separate from Flux 2. | **UNCHANGED** (deprecated path, not in this migration's scope). |
| [`packages/shared/src/story-types.ts`](../../packages/shared/src/story-types.ts) | — | Mentions PuLID in type-level comments. | **MODIFY** (comments only). |
| [`scripts/test-flux2-controlnet.ts`](../../scripts/test-flux2-controlnet.ts) | — | Ad-hoc test script referencing PuLID. | **REMOVE or MODIFY** (low priority; not in prod path). |
| [`docs/pipeline-audit-20260419.md`](../../docs/pipeline-audit-20260419.md) | — | Snapshot doc; historical. | **UNCHANGED** (point-in-time record). |
| [`CLAUDE.md`](../../CLAUDE.md) | — | Project instructions, mentions PuLID. | **MODIFY** (update Flux 2 section once new path is verified — Phase B5). |

**Caller-visible API contract:** `generateFlux2Image(options: Flux2GenerateOptions)` keeps the same signature. `options.references` keeps the same `Array<{ name, base64, strength? }>` shape. The `strength` field becomes a no-op on the native path but stays in the type for backward compat / future `ReferenceLatentPlus` adoption.

## Q3 — Worker image change inventory

| File / line | Current purpose | Status | Reason |
|---|---|---|---|
| [`infra/runpod/Dockerfile.base:1`](../../infra/runpod/Dockerfile.base#L1) | `FROM runpod/worker-comfyui:5.8.5-base` | **KEEP** (or bump if a newer worker-comfyui ships) | Latest available. |
| [`Dockerfile.base:5-7`](../../infra/runpod/Dockerfile.base#L5-L7) | ComfyUI-ppm clone (FluxKontextImageScale) | **KEEP** | Used by other workflows; not PuLID-coupled. |
| [`Dockerfile.base:15-22`](../../infra/runpod/Dockerfile.base#L15-L22) | apt install cmake/libgl/build-essential/python3-dev | **MODIFY** | `build-essential`/`python3-dev` were added to compile InsightFace from source. Without InsightFace, these are unneeded. Keep `libgl1`/`libglib2.0-0` only. |
| [`Dockerfile.base:24-35`](../../infra/runpod/Dockerfile.base#L24-L35) | Cython + InsightFace 0.7.3 source build + `ComfyUI_PuLID_Flux_ll` clone + facenet-pytorch | **REMOVE** | All PuLID-only dependencies. |
| [`Dockerfile.base:37-38`](../../infra/runpod/Dockerfile.base#L37-L38) | `COPY patch_pulid.py /tmp/patch_pulid.py` | **REMOVE** | `patch_pulid.py` itself goes away. |
| [`Dockerfile.base:40-49`](../../infra/runpod/Dockerfile.base#L40-L49) | InsightFace `buffalo_l` pre-download + verification | **REMOVE** | Only needed by PuLID. |
| [`Dockerfile.base:51-59`](../../infra/runpod/Dockerfile.base#L51-L59) | `comfyui_controlnet_aux` clone (DWPreprocessor) | **KEEP** | Used by Flux2Fun ControlNet for pose conditioning. (Re-evaluate in Q6 — see "ControlNet for couple body positioning".) |
| [`Dockerfile.base:61-66`](../../infra/runpod/Dockerfile.base#L61-L66) | `comfyui-flux2fun-controlnet` clone | **KEEP** for now | Provides ControlNet for pose; orthogonal to PuLID. But: the patch_pulid.py also patched this repo's `flux_patch.py` for ComfyUI 5.8.x compat — without that patch, this custom node may break on newer ComfyUI. Needs re-verification. |
| [`Dockerfile.base:68-74`](../../infra/runpod/Dockerfile.base#L68-L74) | `RUN python3 /tmp/patch_pulid.py …` | **REMOVE the PuLID arg.** If Flux2Fun is kept, need a smaller patch script that just adds `**kwargs` to its `flux_patch.py`. | The original patch script targeted both PuLID and Flux2Fun. Flux2Fun still needs its kwargs patch; PuLID is gone. |
| [`Dockerfile.base:80-86`](../../infra/runpod/Dockerfile.base#L80-L86) | V2 pipeline custom nodes (Florence-2, SAM2) gated on `BUILD_V2_PIPELINE` | **KEEP** | Unrelated to PuLID. Currently off (`default=false`); already gated. |
| [`Dockerfile.base:92-93`](../../infra/runpod/Dockerfile.base#L92-L93) | `download-models.sh` copy + chmod | **KEEP** | The script itself is modified (see below). |
| [`infra/runpod/Dockerfile:7`](../../infra/runpod/Dockerfile#L7) | `ARG BASE_IMAGE=ghcr.io/g858-debug/nsw-comfyui-base:latest` | **KEEP** | Thin layer references base; tag/cutover handled in Q5. |
| [`Dockerfile:12-28`](../../infra/runpod/Dockerfile#L12-L28) | Character LoRA download handler, nsw_refresh_models, nsw_region_masks, patch_handler.py | **KEEP** | Orthogonal to PuLID. |
| [`infra/runpod/patch_pulid.py`](../../infra/runpod/patch_pulid.py) | Entire file — patches PuLID + Flux2Fun for ComfyUI 5.8.x | **DELETE OR SPLIT.** Recommended: rename to `patch_flux2fun.py` and strip out the PuLID-specific blocks (patches 2, 3a, 3b were PuLID-only; patch 1's `**kwargs` is still needed for Flux2Fun). | PuLID infrastructure is the whole point of this migration. |
| [`infra/runpod/download-models.sh:250-257`](../../infra/runpod/download-models.sh#L250-L257) | Downloads `pulid_flux_v0.9.1.safetensors` to `/runpod-volume/models/pulid/` | **REMOVE** | PuLID weights unused. |
| [`download-models.sh:259-266`](../../infra/runpod/download-models.sh#L259-L266) | Downloads `EVA02_CLIP_L_336_psz14_s6B.pt` (EVA-CLIP) to `/runpod-volume/models/clip_vision/` | **REMOVE** | PuLID-only vision encoder. |
| [`download-models.sh:301-344`](../../infra/runpod/download-models.sh#L301-L344) | **SECOND** PuLID patch — applied every container startup (in addition to Docker build patch_pulid.py) | **REMOVE entirely** | This is a startup-time monkeypatch over PuLID's `__call__` methods. Becomes dead code when PuLID is removed. |
| `download-models.sh` — add | Flux 2 model downloads (UNET, text encoder, VAE) | **ADD** | Currently those files are expected to exist on the network volume; the script doesn't download them. We should ensure all three are downloaded by this script as a backstop, in case a fresh volume is used. Filenames: `flux2-dev-fp8_scaled.safetensors` (current) or `flux2_dev_fp8mixed.safetensors` (official example) — see Q6 risk. |
| [`infra/runpod/extra_model_paths.yaml:18`](../../infra/runpod/extra_model_paths.yaml#L18) | `pulid: models/pulid` mapping | **REMOVE** | No PuLID models to find. |
| [`extra_model_paths.yaml:15`](../../infra/runpod/extra_model_paths.yaml#L15) | `clip_vision: models/clip_vision` mapping | **KEEP** (general-purpose; not PuLID-only). | Other models could live here. |
| [`extra_model_paths.yaml:16`](../../infra/runpod/extra_model_paths.yaml#L16) | `insightface: models/insightface` mapping | **REMOVE** | InsightFace was PuLID-only. |
| [`infra/runpod/handler_wrapper.py`](../../infra/runpod/handler_wrapper.py) | Wraps base worker handler to download character LoRAs. | **UNCHANGED** | Not PuLID-coupled. |
| [`infra/runpod/patch_handler.py:236, 271, 278-287`](../../infra/runpod/patch_handler.py#L236) | Build-time injection of `/api/nsw/diagnostics` route. PuLID diagnostic blocks: `comfyui_pulid_nodes` listing, `insightface_buffalo_l` directory check, `/tmp/pulid_import.log` reader. | **MODIFY** | Remove the PuLID diagnostic blocks; they'll just report "not found" after migration. Harmless if left, but better to clean up. |
| [`infra/runpod/start-wrapper.sh`](../../infra/runpod/start-wrapper.sh) | Wraps `/start.sh` to run `download-models.sh` first. | **CHECK** | If it does a PuLID import test that writes `/tmp/pulid_import.log` (per `patch_handler.py:285-287`), remove that block. |
| [`infra/runpod/workflows/sdxl-body-lora.json`](../../infra/runpod/workflows/sdxl-body-lora.json) | Legacy SDXL workflow JSON. | **UNCHANGED** | Not Flux 2. |
| [`.github/workflows/build-runpod-base.yml:7-13`](../../.github/workflows/build-runpod-base.yml#L7-L13) | Triggers on `patch_pulid.py`, `download-insightface.py`, `diagnose-ipadapter.py`. | **MODIFY** | Remove triggers for files we're deleting. Keep `patch_flux2fun.py` if we split. |

**Estimated worker image size reduction:** removing InsightFace 0.7.3 (with face3d mesh extension built from source), facenet-pytorch, `ComfyUI_PuLID_Flux_ll`, PuLID Flux model (~1.1GB), EVA-CLIP model (~856MB), and buffalo_l ONNX models (~230MB) is roughly **2.5–3 GB on disk** plus a ~10–15 minute build-time reduction (no more InsightFace source compile).

## Q4 — Feature flag strategy

**Env var name:** `FLUX2_USE_NATIVE_MULTIREF`
**Default:** `false` (so production stays on PuLID until explicit cutover).
**Read where:** top of `generateFlux2Image()` in [`packages/image-gen/src/flux2-generator.ts`](../../packages/image-gen/src/flux2-generator.ts#L74) — single read, passed down to the builder. Callers (body, cover, scene, card, author-note routes) are unaware.

**File layout:**
- Keep current builder at [`packages/image-gen/src/flux2-workflow-builder.ts`](../../packages/image-gen/src/flux2-workflow-builder.ts) (PuLID path) — unchanged.
- Add new builder at `packages/image-gen/src/flux2-workflow-builder-native.ts` with the same `Flux2WorkflowOptions` signature and a new exported `buildFlux2NativeWorkflow(options)` function returning the ReferenceLatent-based JSON.
- This keeps both paths cleanly separated for diffing/review and lets us delete the old file entirely once we cut over (Phase B5).

**Branching pattern in `flux2-generator.ts`:**

```ts
import { buildFlux2Workflow } from "./flux2-workflow-builder";
import { buildFlux2NativeWorkflow } from "./flux2-workflow-builder-native";

export async function generateFlux2Image(options: Flux2GenerateOptions): Promise<Flux2GenerateResult> {
  const useNative = process.env.FLUX2_USE_NATIVE_MULTIREF === "true";

  // ... endpoint resolution (also flag-aware; see Q5) ...

  const workflow = useNative
    ? buildFlux2NativeWorkflow({ prompt, width, height, seed, references: refNames, ... })
    : buildFlux2Workflow({ prompt, width, height, seed, references: refNames, controlNet: ..., ... });

  // ... rest is identical: submitRunPodJob(workflow, images, ...) ...
}
```

**Caller impact:** **none.** Every existing call site passes the same `Flux2GenerateOptions` shape. The `controlImage` field still works on the PuLID path; on the native path it's a separate decision (see Q6 — ControlNet may need to be re-implemented because the chain differs).

**Important worker-side constraint:** the new worker image will NOT have the `ComfyUI_PuLID_Flux_ll` custom node, so it CANNOT execute the old PuLID workflow JSON. The feature flag works because we deploy two separate RunPod endpoints — one running the old (PuLID) image, one running the new (native-multiref) image. The flag flips the endpoint AND the workflow JSON together (see Q5).

## Q5 — Sandbox endpoint plan

**Image tag:** `ghcr.io/g858-debug/nsw-comfyui-worker:multiref-<short-sha>`. CI workflow [`build-runpod-image.yml`](../../.github/workflows/build-runpod-image.yml) already pushes `:sha-<short>` for every build — add a branch / tag check so commits on a `flux2-native-multiref` branch ALSO push a `:multiref-<short-sha>` and `:multiref-latest` tag. Don't auto-update any endpoint from those tags.

**Sandbox RunPod endpoint provisioning:** manual via the RunPod console. Steps:
1. Create a new serverless endpoint, call it `nsw-image-gen-multiref-sandbox`.
2. Region: same as production (`EU-RO-1`) so the existing network volume `nsw-comfyui-models` (`0ibg3mpboj`) can be mounted (avoids re-downloading multi-GB Flux 2 models).
3. GPU class: same as production (`AMPERE_48,ADA_24`).
4. Docker image: `ghcr.io/g858-debug/nsw-comfyui-worker:multiref-latest`.
5. Set `workersMin=0, workersMax=1, idleTimeout=120s` (sandbox-cheap settings).
6. Record the new endpoint ID; store it in Railway as `RUNPOD_FLUX2_SANDBOX_ENDPOINT_ID`.

**Why manual vs scripted:** [`update-endpoint.sh`](../../infra/runpod/update-endpoint.sh) updates an existing endpoint's template via GraphQL but doesn't create a new one. Creating an endpoint via GraphQL is doable but adds risk for a one-time provisioning step; manual is safer. If we end up needing more sandboxes, scripting it becomes worth it.

**Railway env var pattern (in `flux2-generator.ts`):**

```ts
const endpointId =
  options.endpointId ??
  (useNative ? process.env.RUNPOD_FLUX2_SANDBOX_ENDPOINT_ID : undefined) ??
  process.env.RUNPOD_FLUX2_ENDPOINT_ID ??
  process.env.RUNPOD_ENDPOINT_ID;
```

`FLUX2_USE_NATIVE_MULTIREF=true` AND `RUNPOD_FLUX2_SANDBOX_ENDPOINT_ID=<sandbox>` together flip BOTH the workflow shape and the endpoint. Either alone causes a clear mismatch (new workflow on old worker → error; old workflow on new worker → error). Hard failures, not silent ones. Good.

**Rollback:** delete `FLUX2_USE_NATIVE_MULTIREF` from Railway (or set to `false`). No code change, no redeploy needed beyond Railway's env-var apply. Workers don't change — the sandbox endpoint sits idle, production endpoint keeps serving.

**Cutover (Phase B5):** flip the production endpoint template (via `update-endpoint.sh` against the prod endpoint id) to the new image, set `FLUX2_USE_NATIVE_MULTIREF=true` as the default, delete the sandbox endpoint, delete the old workflow builder + PuLID infra. After cutover, the env var becomes dead code and can be removed.

## Q6 — Risks

1. **ComfyUI version inside `worker-comfyui:5.8.5-base` is opaque.** The base image was built with `COMFYUI_VERSION=latest` ~2 months ago. We assume it's ≥ v0.17.x and has the Flux 2 nodes. If it's older or comfy-cli's "latest" resolved oddly, `EmptyFlux2LatentImage` / `Flux2Scheduler` will be missing.
   - **Impact:** workflow validation fails at the worker → RunPod returns FAILED → caller sees error. Loud, not silent. But forces a worker rebuild.
   - **Mitigation:** in the new `Dockerfile.base`, add `RUN cd /comfyui && git fetch && git checkout v0.21.1` (or `RUN comfy update`) to pin a known-good ComfyUI version explicitly. Verify the nodes are present with a quick `python3 -c "from comfy import nodes; assert 'EmptyFlux2LatentImage' in nodes.NODE_CLASS_MAPPINGS"` at build time.

2. **Model filename ambiguity: `flux2-dev-fp8_scaled.safetensors` (currently used) vs `flux2_dev_fp8mixed.safetensors` (official example).** The Comfy Org Flux 2 tutorial points at `flux2_dev_fp8mixed.safetensors`; our worker has `flux2-dev-fp8_scaled.safetensors` referenced at [`flux2-workflow-builder.ts:20`](../../packages/image-gen/src/flux2-workflow-builder.ts#L20).
   - **Impact:** if `_scaled` and `_mixed` are different quantization strategies, behavior may diverge from what the example workflow demonstrates. May affect quality, VRAM, or speed.
   - **Mitigation:** confirm which file is actually on the network volume (read `/runpod-volume/models/diffusion_models/`). If only `_scaled` is present, keep using it — it's a valid Flux 2 Dev quantization. Optionally download `_mixed` as a side-by-side in download-models.sh and test both in Phase B3.

3. **VAE encoding of body-shot reference images may give weaker identity than PuLID's face-embedding extraction did when working.** PuLID extracts a face vector from InsightFace and conditions the entire denoise on it. Native multi-ref encodes the WHOLE image as latents — including pose, clothing, background — and adds it to the conditioning. The model decides how much identity to copy.
   - **Impact:** for body portraits where face occupies ~10% of the frame, the model may copy clothing/pose more than face. Could *worsen* identity vs working PuLID (but better than current zero-identity PuLID). Cover and scene generations may also pick up unwanted artifacts (background, lighting) from the reference.
   - **Mitigation:** Phase B3 test plan must include face-cropped reference variants (a tightly-cropped face reference will copy face only). If body-shot reference proves weak, fall back to passing the cropped face image. Phase B4 can add `comfyui-ReferenceLatentPlus` if per-reference weight tuning is needed.

4. **ControlNet (Flux2Fun for pose) chain integration.** Current PuLID workflow chains: `UNET → ModelSampling → PuLID → KSampler.model`. ControlNet currently inserts between `CLIPTextEncode` and `KSampler.positive/negative` ([`flux2-workflow-builder.ts:177-220`](../../packages/image-gen/src/flux2-workflow-builder.ts#L177-L220)). Native multi-ref uses `SamplerCustomAdvanced + BasicGuider`, NOT `KSampler` — different inputs.
   - **Impact:** ControlNet integration needs to be re-thought. It can probably still work (BasicGuider accepts cond inputs that can come from ControlNetApplyAdvanced), but the exact wiring is untested.
   - **Mitigation:** Phase B1 builder MUST support the empty-ControlNet path first (most callers don't use it). Phase B4 adds back the ControlNet path with sandbox testing. The only caller currently passing `controlImage` is `scripts/test-flux2-controlnet.ts` — production routes don't use ControlNet for Flux 2 yet. Low blast radius.

5. **VRAM impact.** Multi-ref + VAE encoding per ref may use more memory than PuLID at inference time (each ref produces a latent tensor held alongside the noise tensor). On a 48GB ADA card we have headroom, but on cold starts when other models are still loaded, this could OOM.
   - **Impact:** OOM crash on first 2-ref body portrait. Hard failure, not silent.
   - **Mitigation:** Phase B3 includes a 2-character cover generation as a primary test. If VRAM-tight, downsize reference images before VAEEncode (sharp resize to ~1024 long edge before base64 encoding in the JS layer).

6. **Cold start time may improve or worsen.** Removing InsightFace's source-compile + buffalo_l download (~250MB) + EVA-CLIP (~856MB) + PuLID weights (~1.1GB) reduces image size by ~2.5-3GB. ComfyUI cold-start should be FASTER. But: if the new worker has to first-time-download `flux2-vae.safetensors` etc., the first cold start could be slower until the network volume warms.
   - **Impact:** sandbox-only first-cold-start latency, easy to absorb.
   - **Mitigation:** sandbox endpoint shares the production network volume `0ibg3mpboj`, so the Flux 2 models are already there. First cold start should be normal.

7. **Hunyuan path UNAFFECTED but the worker image is shared in name only.** Hunyuan routes go to Replicate (Siray), not RunPod. There's no Hunyuan workflow on the RunPod worker.
   - **Impact:** none. Hunyuan continues to work regardless of this migration.

8. **`update-endpoint.sh` hardcodes the production endpoint id (`vj6jc0gd61l9ov`).** If anyone runs CI between now and cutover, it could rewrite the prod endpoint's template to the latest `:latest` worker image — which during this migration would either be (a) the still-PuLID-based image (no harm) or (b) the new native-multiref image (silent prod migration). Risk concentrates around the cutover window.
   - **Impact:** premature prod cutover if the image-build CI fires.
   - **Mitigation:** Phase B2 pushes the new image to a DIFFERENT tag (`:multiref-*`), NOT `:latest`. CI's "update prod endpoint" step targets `:latest`, so until we explicitly retag `:latest = :multiref-*`, prod is safe.

## Q7 — Phase plan

| Phase | Scope | Deliverable | Depends on | Time estimate |
|---|---|---|---|---|
| **B1** | Implement `flux2-workflow-builder-native.ts` with native multi-ref node graph (UNETLoader → CLIPLoader → VAELoader → CLIPTextEncode → FluxGuidance → N×[LoadImage→VAEEncode→ReferenceLatent] → EmptyFlux2LatentImage → Flux2Scheduler → KSamplerSelect → RandomNoise → BasicGuider → SamplerCustomAdvanced → VAEDecode → SaveImage). Add the `FLUX2_USE_NATIVE_MULTIREF` flag dispatch in `flux2-generator.ts`. Unit-test the workflow JSON shape against the target spec (no RunPod call yet). | New file + ~5 LOC change in `flux2-generator.ts` + a JSON snapshot test. | Phase R1 sign-off. | **2-4 hours** including reading the official `flux2_example.png` workflow to verify exact node connections. |
| **B2** | New Docker base image: strip PuLID/InsightFace/EVA-CLIP, pin ComfyUI to v0.21.1 explicitly, split `patch_pulid.py` → `patch_flux2fun.py` (kwargs-only). New `download-models.sh` without PuLID/EVA-CLIP downloads. Updated `extra_model_paths.yaml`. Build via `gh workflow run build-runpod-base.yml`, push to `:multiref-<sha>`. Build app layer too, push `:multiref-<sha>` for worker image. **Do NOT update the prod endpoint.** | New base + worker images on GHCR. No production impact. | B1. | **3-5 hours** (one base-image rebuild is ~45 min CI time; iteration on missing deps could add another round). |
| **B3** | Provision the sandbox RunPod endpoint manually; set `RUNPOD_FLUX2_SANDBOX_ENDPOINT_ID` in Railway; set `FLUX2_USE_NATIVE_MULTIREF=true` only on a Railway preview env (NOT production). Run end-to-end test: face approval → body portrait (1 ref) → verify face identity present. Compare side-by-side with current broken PuLID output. | One verified body portrait render with intact face identity. | B2. | **2-3 hours** (assumes sandbox endpoint cold-starts cleanly; first cold start can take 10-15 min on RunPod). |
| **B4** | Test all four Flux 2 generation paths on sandbox: body portrait (1 ref), cover (1-2 refs), scene image (1-2 refs), character card (1-2 refs). For each, verify face identity, scene fidelity, and absence of soft-failures. Tune ReferenceLatent strategy (full-body ref vs face crop) per stage. If ControlNet is needed by any path, prove out the BasicGuider integration. | Sandbox-validated coverage of all four Flux 2 image stages. | B3. | **4-8 hours** depending on how many iterations the strength/cropping tuning takes. |
| **B5** | Production cutover: retag `:multiref-latest` as `:latest`, run `update-endpoint.sh` against the prod endpoint, set `FLUX2_USE_NATIVE_MULTIREF=true` as default in Railway prod env. Smoke-test a body portrait on prod. Delete the sandbox endpoint. Delete `flux2-workflow-builder.ts` (PuLID), `patch_pulid.py`, the PuLID startup patch block in `download-models.sh`, PuLID diagnostic blocks in `patch_handler.py`. Update `CLAUDE.md` Flux 2 section. Remove `FLUX2_USE_NATIVE_MULTIREF` reads (it's now the only path). | PR with all PuLID infra deleted; production running native multi-ref. | B4 + explicit user go-ahead. | **2-3 hours** (most of the time is verification, not code). |

**Total estimate:** ~13-23 hours of work across B1-B5, plus ≥30 minutes of CI wait per base-image rebuild (typically 1-2 rebuilds end-to-end). Realistic calendar: **2-3 working days**, gated by CI build times and your sandbox testing pace.

## Open questions for the user

1. **Network volume model verification.** Before B2 strips PuLID downloads, can you confirm which Flux 2 diffusion model file is currently on `/runpod-volume/models/diffusion_models/`? We need to know if it's `flux2-dev-fp8_scaled.safetensors` (current code) or `flux2_dev_fp8mixed.safetensors` (official example) or both. This affects the workflow's `UNETLoader.unet_name` parameter and whether we need to download a different file.

2. **Pin or float ComfyUI version?** Option A: pin to `v0.21.1` (predictable, tied to a known-tested version). Option B: `comfy update` at every base rebuild (always-fresh, but base-rebuild outcomes change without code change). Recommendation: **A** for stability; floating is a deploy footgun.

3. **Keep or remove `comfyui-flux2fun-controlnet`?** It's currently kept (Q3 row 8) because it provides pose ControlNet. But the only caller is `scripts/test-flux2-controlnet.ts`, not a production route. If you're sure no near-term plan uses pose ControlNet for Flux 2, we can drop it too and save another build step. **Decision needed before B2.**

4. **Cover-image-only smoke test before full B4?** Phase B4 covers all four stages but you may want to gate cutover purely on body portrait + cover validation, deferring scene + card to a follow-up. Acceptable, just affects B4 scope.

5. **`Revenue files/` directory** is untracked in the working tree. Unrelated to this migration but worth flagging since `git status` mentions it on every sync.

6. **Should we keep the legacy PuLID workflow JSON path as a permanent escape hatch?** Recommendation: **NO.** Once B5 cutover succeeds, delete it entirely — the worker can't run it anyway. Keeping dead code with a broken-pipeline footgun is worse than a clean cut.
