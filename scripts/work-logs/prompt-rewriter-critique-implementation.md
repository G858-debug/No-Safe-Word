# Prompt Rewriter + Critique Panel — Implementation Log

**Date:** 2026-04-27  
**Commit:** 684bec2  
**Branch:** main

---

## Diagnostics (pre-build)

**State model in ImageGeneration.tsx:**  
`PromptState` holds per-card state (`promptText`, `savedPromptText`, overrides, etc.). `generateOne()` PATCHes the prompt to DB if `promptText !== savedPromptText`, then calls `/api/stories/${seriesId}/generate-image`. The new rewriter runs before the PATCH, not after.

**Mistral API:**  
Key (`MISTRAL_API_KEY`) confirmed in `.env.local`. No existing Mistral usage in the codebase — this is the first integration. Using native `fetch` to avoid adding a new SDK dependency to `packages/image-gen`.

**Models used:**  
- Part A (rewriting): `mistral-small-latest` (Mistral Small, $0.0002/call)  
- Part B (critique): `pixtral-12b-2409` (Pixtral 12B, ~$0.001/call)

**Image card layout:**  
Critique panel inserted into Zone 1 (always-visible, above the prompt-toggle button). Rewriter toggle inserted into Zone 2 (the collapsible editing area), between `LockedCharacterBlock` and the `Textarea`. The toggle is Hunyuan-only (`imageModel === "hunyuan3"` guard on render).

**`images` table:**  
No `critique` column existed. Added via migration `20260427000000_add_critique_to_images.sql` and applied to prod via Supabase MCP.

---

## Part A: Prompt Rewriter

### Files created

| Path | Purpose |
|------|---------|
| `packages/image-gen/src/prompts/hunyuan-rewriter-system.ts` | System prompt string (export `HUNYUAN_REWRITER_SYSTEM`) |
| `packages/image-gen/src/prompt-rewriter.ts` | `rewritePromptForHunyuan()` — Mistral Small call |
| `apps/web/app/api/stories/images/[promptId]/rewrite/route.ts` | `POST /api/stories/images/[promptId]/rewrite` |

### How it works

1. User clicks Generate (with rewriter toggle ON, story on hunyuan3).
2. `generateOne()` calls `POST /api/stories/images/[promptId]/rewrite` with `{ prompt: state.promptText }`.
3. The route reads `image_type` and character names from the DB, then calls `rewritePromptForHunyuan()`.
4. `rewritePromptForHunyuan()` sends the original prompt + character names to Mistral Small with a system prompt encoding Patterns A–D.
5. The rewritten prompt is returned to the frontend.
6. `generateOne()` updates the textbox (`promptText`) and the saved baseline (`savedPromptText`) to the rewritten version, then PATCHes it to DB.
7. `generate-image` runs with the rewritten prompt already in the DB.

### Rewriter toggle behaviour

- Toggle is `useRewriter: boolean` in `PromptState`, defaulting to `true` for all cards.
- Only rendered (and only active) when `imageModel === "hunyuan3"`. Flux 2 Dev uses reference images, not text; the rewriter would be meaningless.
- If rewrite fails: the card shows a detailed error message with instructions to disable the toggle and retry. No silent fallback to the original.
- If the user edits the textbox after a rewrite and hits Regenerate with the toggle still ON: the textbox content is rewritten again. This is intentional — the rewriter adapts whatever is in the textbox, including manual edits. This is the "surprising behaviour" noted in the spec, documented here.

### What the system prompt does

The system prompt in `hunyuan-rewriter-system.ts` encodes:
- The four reliable patterns (A–D) with exact template language and the critical phrases (`"from the same direction as the camera"`, `"lips pressed firmly together in contact, mouths closed and sealed"`, etc.)
- Three patterns to avoid
- A selection guide (which pattern fits which intimate act)
- Universal rules (self-contained, named light source, never `"warm lighting"`, etc.)
- The visual signature suffix (required on every output)
- Output format: plain text only, no preamble

---

## Part B: Critique Panel

### Files created

| Path | Purpose |
|------|---------|
| `packages/image-gen/src/image-critic.ts` | `critiqueGeneratedImage()` — Pixtral 12B call |
| `apps/web/app/api/stories/images/[promptId]/critique/route.ts` | `POST /api/stories/images/[promptId]/critique` |
| `supabase/migrations/20260427000000_add_critique_to_images.sql` | `images.critique text` column |

### How it works

1. After `generateOne()` resolves with a successful image URL (both Hunyuan sync path and Flux async polling path), a fire-and-forget async block triggers critique.
2. The block calls `POST /api/stories/images/[promptId]/critique`.
3. The route reads `image_id` and the latest `images.stored_url` + `images.prompt` (assembled prompt, not raw scene description) from the DB.
4. `critiqueGeneratedImage()` sends the image URL (Pixtral accepts HTTPS URLs directly — no base64 needed) + the assembled prompt to Pixtral 12B.
5. The critique is persisted to `images.critique` and returned to the frontend.
6. The critique panel in Zone 1 of the card shows a "Analysing image…" spinner while `critiqueLoading` is true, then the critique text.

### Critique panel UI

- Location: Zone 1 (always-visible), below the error message, above the prompt-toggle button.
- Shows only when `critiqueLoading || critiqueText` is truthy. Hidden until the first generation.
- Cleared (reset to null) at the start of each `generateOne()` call so the previous critique doesn't linger while the new image generates.
- If the critique API fails (network error, Pixtral refuses, etc.): `critiqueLoading` goes false silently. The card shows nothing rather than an error. Generation is not affected.

### What Pixtral is asked to do

The critique system prompt instructs Pixtral to:
- Identify factual mismatches between the prompt and the image (wrong composition, missing elements, wrong positioning)
- Suggest specific phrase changes to fix issues
- NOT make subjective aesthetic judgments
- NOT refuse to evaluate explicit content
- Return a 3–5 sentence plain-text paragraph

---

## Surprising Behaviours

**Rewriting a rewrite is stable (not infinite mutation).** Mistral Small applied to its own output on the second `Regenerate` click produces a very similar prompt (changes are minor cleanup). Tested manually with Pattern A output — the second rewrite was identical to the first.

**Pixtral accepts Supabase Storage URLs directly.** No base64 conversion needed. Pixtral's vision API resolves HTTPS image URLs natively. This simplifies the critique route significantly.

**The `images.prompt` column holds the assembled prompt (character blocks + scene + visual signature), not the raw scene description.** This is the right input for Pixtral — it can compare what was actually sent to the model against the output. The raw `story_image_prompts.prompt` (scene description only) would give an incomplete picture.

---

## Known Issues

**Critique latency.** Pixtral 12B takes 8–15 seconds depending on image size and API load. The UX handles this with a spinner, but the critique appears noticeably after the image itself. This is acceptable.

**Rewriter doesn't run on batch generation path.** `handleBatchGenerate()` calls `generateOne()` in a loop, which does run the rewriter for each image individually. However, each sequential rewrite adds ~1–2 seconds latency per image. On a full batch of 20 images this adds 20–40 seconds. Acceptable given the quality improvement.

**`useRewriter` defaults to `true` even for images that are SFW or atmospheric.** The rewriter system prompt handles SFW gracefully (minimal rewriting, return cleaned original). But it does add API cost for every SFW image. Low cost ($0.0002/call) makes this acceptable for now.

**No retry on Mistral rate limit.** If Mistral rate-limits during a batch, the affected image shows an error. User must retry individually. No exponential backoff implemented yet.

---

## Recommended Next Session

1. **Ship The Lobola List.** The pipeline is now: portrait approved → scene generated with Hunyuan → rewriter enforces Pattern A/B/C/D → Pixtral critiques. Run the full pipeline end-to-end on Lobola List, reviewing at least 10 generated images and their critiques.

2. **Monitor critique quality on first 50 generations.** Are critiques specific (reference actual elements) or generic? If Pixtral hallucinates or refuses on some image types, adjust the critic system prompt in `image-critic.ts`.

3. **Tune the rewriter system prompt if patterns are still wrong.** If Mistral misapplies patterns (e.g., chooses Pattern C when A would be better), refine the selection guide in `hunyuan-rewriter-system.ts`. The system prompt is in its own file precisely for this.

4. **Consider adding a "last critique" persistence to `story_image_prompts`.** Currently the critique is stored on `images.critique` (the image row), not visible from the prompt row. A `latest_critique` text column on `story_image_prompts` would surface it in the page-load data fetch without a second query.
