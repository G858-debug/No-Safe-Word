# Character Description Source Diagnostic Report

**Date:** 2026-04-27  
**Story:** THE LOBOLA LIST  
**Triggered by:** Image cards in Stage 11 showing character text that "appears to come from the JSON import"

---

## 1. Database State

All four characters linked to THE LOBOLA LIST have **both** `portrait_prompt_locked` and `approved_image_id` populated. Neither is null.

| Character | `character_id` | `portrait_prompt_locked` | `approved_image_id` |
|-----------|----------------|--------------------------|---------------------|
| Langa Mkhize | d757c016-20cf-43de-b671-a80842798e23 | Populated | 68a3e46f-… |
| Lindiwe Dlamini | efc71e1c-06aa-4cc1-993d-c852636ce10e | Populated | c253f23b-… |
| Sibusiso Ndlovu | cfc4548b-6e95-4186-8d4a-a566e6c6d454 | Populated | 312ba6ae-… |
| Zanele | b4344cb6-1615-4169-9e1c-3e6bbc4bcd2c | Populated | 1d51072b-… |

`story_characters.prose_description` is also populated for all four (a short human-readable summary unrelated to the image pipeline).

**Conclusion:** Possibility A (data state issue) is eliminated. The canonical field is populated.

---

## 2. UI Display Path

Data flow from DB to screen for the `LockedCharacterBlock`:

1. **`GET /api/stories/[seriesId]/characters`** (`characters/route.ts:16–26`)  
   Supabase join selects `portrait_prompt_locked` from the base `characters` table. The field is returned in the response at `route.ts:98`.

2. **`page.tsx:196–209`**  
   `fetch(/api/stories/${seriesId}/characters)` populates the `characters` state array of type `CharacterFromAPI`. The type definition at `CharacterApproval.tsx:25` includes `portrait_prompt_locked: string | null`.

3. **`ImageGeneration.tsx:238–249`**  
   `characterIdentityMap` is built inside `useMemo`. For each character it maps:
   ```ts
   m[c.character_id] = {
     portraitPromptLocked: c.portrait_prompt_locked,   // ← correct field
     …
   }
   ```

4. **`LockedCharacterBlock` (`ImageGeneration.tsx:1337–1357`)**  
   Reads `characterIdentityMap[primaryCharacterId]?.portraitPromptLocked`. Passes it into `buildSceneCharacterBlockFromLocked(name, locked)` to display — **line 1421**.  
   If locked is null it shows an amber "No portrait approved yet" warning instead — **line 1423–1428**.

**The UI reads `portrait_prompt_locked` at every step. There is no fallback to `description` in the display path.**

---

## 3. Generation Route Path

In `generate-image/route.ts:114–132` the Hunyuan scene path:

```ts
const { data: chars } = await supabase
  .from("characters")
  .select("id, name, description, approved_image_id, portrait_prompt_locked")
  .in("id", charIds);

for (const c of chars ?? []) {
  if (c.portrait_prompt_locked) {
    charBlocks[c.id] = buildSceneCharacterBlockFromLocked(   // ← primary path
      c.name, c.portrait_prompt_locked
    );
  } else if (c.description) {
    console.warn(`…character ${c.id} has no portrait_prompt_locked; falling back…`);
    charBlocks[c.id] = buildSceneCharacterBlock(             // ← fallback (warns)
      c.name, c.description as PortraitCharacterDescription
    );
  }
}
```

For all four Lobola List characters, `portrait_prompt_locked` is non-null, so the **primary path always fires**. The fallback path (description-derived block) would emit a `console.warn` and is not reached for these characters.

---

## 4. Are UI and Generation Reading the Same Field?

**Yes.** Both paths call `buildSceneCharacterBlockFromLocked(name, portrait_prompt_locked)`. Neither reaches the `description` fallback for The Lobola List characters.

---

## 5. Diagnosis: None of A, B, or C — the system is correct

The image cards are **not** reading from the JSON `description` field. The `LockedCharacterBlock` is displaying the output of `buildSceneCharacterBlockFromLocked`, which strips portrait framing/lighting/signature from `portrait_prompt_locked` and prepends the character name.

The reason the displayed text **resembles** the JSON description is that `portrait_prompt_locked` was itself generated from the structured `description` JSONB via `buildCharacterPortraitPrompt` at portrait-approval time. The content is the same information translated to natural language — it was always going to look like the original description fields.

**Concretely, for Lindiwe Dlamini:**

- `portrait_prompt_locked` (raw): `"A female, age 24, young adult. Black South African. Medium-brown skin, dark brown eyes, oval face, high cheekbones, full lips … Composed and controlled. Portrait, looking directly at the camera … Cinematic shallow depth of field … Photorealistic."`
- After `stripPortraitFraming` + name prefix (what the card shows): `"Lindiwe Dlamini: A female, age 24, young adult. Black South African. Medium-brown skin, dark brown eyes, oval face, high cheekbones, full lips … Composed and controlled."`

This is the `portrait_prompt_locked` field, not `description`. It reads like the import description because that's the underlying data source for the locked text.

---

## 6. Recommended Fix

**No fix needed.** The pipeline is operating as designed. The perception that the text "comes from the JSON import" is a false alarm — `portrait_prompt_locked` was derived from the import data at portrait-approval time and intentionally preserves that natural-language identity prose.

If the goal is to have `portrait_prompt_locked` contain text that diverges visually from the structured description (e.g. hand-written characterisation rather than assembled prose), the fix would be to edit the locked text after portrait approval — there is no UI for this today. That would be a new feature, not a bug fix.

If `console.warn` entries are visible in Railway logs saying `"has no portrait_prompt_locked; falling back to description-derived scene block"` for any other story, those do indicate characters whose portraits were approved before Phase B shipped and need re-approval. No such entries are expected for The Lobola List.

---

*Diagnostic performed 2026-04-27. Read-only. No code or data was changed.*
