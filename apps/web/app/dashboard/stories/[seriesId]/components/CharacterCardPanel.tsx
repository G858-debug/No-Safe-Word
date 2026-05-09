"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { CharacterFromAPI } from "./CharacterApproval";

// ─────────────────────────────────────────────────────────────────────────
// Stage 9 — single-character profile card panel.
//
// Layout: card image + editable card_image_prompt on the left; the seven
// reader-facing text fields stacked on the right; Approve/Unapprove at the
// bottom.
//
// Manual editing only — no AI regen on the seven text fields. They come
// pre-populated from the imported JSON (written by Claude in the No Safe
// Word Project conversation with full story context); regenerating them
// without that context would degrade output. The Phase 3a publisher is for
// review + manual tweaks + approval.
//
// Race protection: a `submittingRef` per panel + per-state guards prevent
// double-clicks during the click→fetch→dispatch gap. Same pattern used by
// CharacterCard.tsx for portrait approval.
// ─────────────────────────────────────────────────────────────────────────

interface Props {
  seriesId: string;
  character: CharacterFromAPI;
  onUpdate: () => void;
}

type ImageGenState =
  | { kind: "idle" }
  | { kind: "generating"; jobId: string }
  | { kind: "error"; message: string };

const TEXT_FIELDS = [
  { key: "archetype_tag", label: "Archetype tag", multiline: false },
  { key: "vibe_line", label: "Vibe line", multiline: false },
  { key: "wants", label: "Wants", multiline: false },
  { key: "needs", label: "Needs", multiline: false },
  { key: "defining_quote", label: "Defining quote", multiline: false },
  { key: "watch_out_for", label: "Watch out for", multiline: false },
  { key: "bio_short", label: "Bio (short)", multiline: true },
] as const;

type TextFieldKey = (typeof TEXT_FIELDS)[number]["key"];
type EditableFieldKey = TextFieldKey | "card_image_prompt";

export function CharacterCardPanel({ seriesId, character, onUpdate }: Props) {
  // Local draft state for each editable field. Server values are the source
  // of truth; drafts let the user type without re-rendering on every
  // keystroke from a controlled-by-prop input.
  const [drafts, setDrafts] = useState<Record<EditableFieldKey, string>>(() =>
    seedDrafts(character)
  );
  const [savingField, setSavingField] = useState<EditableFieldKey | null>(null);
  const [savedField, setSavedField] = useState<EditableFieldKey | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [imageState, setImageState] = useState<ImageGenState>({ kind: "idle" });
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  // §E1 (b) resolution: when the character was reused from a prior series,
  // the inherited card_image_url was generated from the OLD card_image_prompt.
  // Show a warning until the operator regenerates or dismisses. Session-
  // scoped (resets on remount). Cleared automatically on regenerate.
  const [warningDismissed, setWarningDismissed] = useState(false);
  const showReuseWarning =
    Boolean(character.reused_from) &&
    Boolean(character.card_image_url) &&
    !warningDismissed;

  const isMountedRef = useRef(true);
  const submittingRef = useRef(false);
  // Keep drafts in sync with parent re-fetch when nothing is being typed.
  // If the user is mid-edit on a field, the diff in drafts[field] vs
  // character[field] keeps the typed value visible until blur. After save
  // the parent refetches; this effect re-syncs the drafts with new server
  // values for fields the user isn't currently editing.
  const lastSyncedFromServer = useRef(seedDrafts(character));

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const fresh = seedDrafts(character);
    setDrafts((prev) => {
      const next = { ...prev };
      // Only overwrite a draft when the prior server value matches the
      // current draft (i.e. the user hasn't typed since last sync).
      const lastSynced = lastSyncedFromServer.current;
      (Object.keys(fresh) as EditableFieldKey[]).forEach((key) => {
        if (prev[key] === lastSynced[key]) {
          next[key] = fresh[key];
        }
      });
      lastSyncedFromServer.current = fresh;
      return next;
    });
  }, [character]);

  // ─── Save a single field on blur ─────────────────────────────────────
  const saveField = useCallback(
    async (field: EditableFieldKey) => {
      if (!character.character_id) return;
      const draft = drafts[field];
      const current = (character[field] ?? "") as string;
      if (draft === current) return; // no-op

      setSavingField(field);
      setFieldError(null);
      try {
        const res = await fetch(
          `/api/characters/${character.character_id}/update-profile-fields`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: draft }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? `Save failed (HTTP ${res.status})`);
        }
        if (!isMountedRef.current) return;
        setSavedField(field);
        // Clear the saved indicator after a beat.
        setTimeout(() => {
          if (isMountedRef.current && setSavedField) setSavedField((curr) => (curr === field ? null : curr));
        }, 1500);
        onUpdate();
      } catch (err) {
        if (!isMountedRef.current) return;
        setFieldError(err instanceof Error ? err.message : "Save failed");
      } finally {
        if (isMountedRef.current) setSavingField(null);
      }
    },
    [character, drafts, onUpdate]
  );

  // ─── Image generation: submit + poll ─────────────────────────────────
  const waitForCompletion = useCallback(
    (jobId: string): Promise<{ url: string }> => {
      return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          if (!isMountedRef.current) {
            clearInterval(interval);
            reject(new Error("unmounted"));
            return;
          }
          try {
            const res = await fetch(`/api/status/${jobId}`);
            if (!res.ok) return;
            const data = (await res.json()) as {
              completed: boolean;
              imageUrl?: string | null;
              error?: string;
            };
            if (data.completed && data.imageUrl) {
              clearInterval(interval);
              resolve({ url: data.imageUrl });
            } else if (data.error) {
              clearInterval(interval);
              reject(new Error(data.error));
            }
          } catch {
            // transient — keep polling
          }
        }, 3000);
      });
    },
    []
  );

  const handleGenerate = useCallback(async () => {
    if (!character.character_id) return;
    if (imageState.kind === "generating" || submittingRef.current) return;
    if (!character.approved_fullbody_image_id) {
      setImageState({
        kind: "error",
        message:
          "Approve the body portrait in the Characters tab before generating a card image.",
      });
      return;
    }
    if (drafts.card_image_prompt.trim().length === 0) {
      setImageState({
        kind: "error",
        message: "Card image prompt is empty. Edit the prompt first.",
      });
      return;
    }

    submittingRef.current = true;
    try {
      // If the user typed into the prompt textarea but hasn't blurred yet,
      // make sure the latest text is on disk before kicking off generation.
      // The submit endpoint reads the persisted prompt unless prompt_override
      // is supplied — passing it explicitly avoids the race.
      const promptToUse = drafts.card_image_prompt.trim();
      const res = await fetch(
        `/api/characters/${character.character_id}/generate-card-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt_override: promptToUse,
            seriesId,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Generation failed (HTTP ${res.status})`);
      }
      const jobId: string = data.jobId;
      setImageState({ kind: "generating", jobId });
      // Regenerating produces a fresh card image that matches the live
      // prompt — the inherited-mismatch warning no longer applies.
      setWarningDismissed(true);

      try {
        await waitForCompletion(jobId);
        if (!isMountedRef.current) return;
        setImageState({ kind: "idle" });
        onUpdate(); // pull fresh card_image_url + card_image_id from DB
      } catch (err) {
        if (!isMountedRef.current) return;
        if (err instanceof Error && err.message === "unmounted") return;
        setImageState({
          kind: "error",
          message: err instanceof Error ? err.message : "Generation failed",
        });
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setImageState({
        kind: "error",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    } finally {
      submittingRef.current = false;
    }
  }, [character, drafts.card_image_prompt, imageState.kind, onUpdate, seriesId, waitForCompletion]);

  // ─── Approve / Unapprove ─────────────────────────────────────────────
  const allTextFieldsFilled = useMemo(
    () =>
      TEXT_FIELDS.every((f) => {
        const value = (character[f.key] ?? "") as string;
        return value.trim().length > 0;
      }),
    [character]
  );

  const canApprove =
    !character.card_approved &&
    allTextFieldsFilled &&
    Boolean(character.card_image_url) &&
    imageState.kind !== "generating" &&
    savingField === null;

  const handleApprove = useCallback(async () => {
    if (!character.character_id || !canApprove || approving) return;
    setApproving(true);
    setApprovalError(null);
    try {
      const res = await fetch(
        `/api/characters/${character.character_id}/approve-card`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Approval failed (HTTP ${res.status})`);
      }
      onUpdate();
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      if (isMountedRef.current) setApproving(false);
    }
  }, [character.character_id, canApprove, approving, onUpdate]);

  const handleUnapprove = useCallback(async () => {
    if (!character.character_id || approving) return;
    setApproving(true);
    setApprovalError(null);
    try {
      const res = await fetch(
        `/api/characters/${character.character_id}/approve-card`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Revoke failed (HTTP ${res.status})`);
      }
      onUpdate();
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      if (isMountedRef.current) setApproving(false);
    }
  }, [character.character_id, approving, onUpdate]);

  // ─── Render ──────────────────────────────────────────────────────────
  const generating = imageState.kind === "generating";
  const cardImageUrl = character.card_image_url;
  const role = character.role ?? "supporting";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base">
            {character.name ?? "(unnamed)"}
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {role}
          </Badge>
          {character.reused_from && (
            <Badge
              variant="secondary"
              className="text-xs"
              title={`Inherited from "${character.reused_from.series_title}"`}
            >
              Reused from {character.reused_from.series_title}
            </Badge>
          )}
        </div>
        {character.card_approved ? (
          <Badge className="gap-1 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/15">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approved
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Awaiting review
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* ── LEFT — card image + prompt ──────────────────────────── */}
          <div className="space-y-3">
            {showReuseWarning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                <span className="flex-1">
                  Card image inherited from{" "}
                  <span className="font-medium">
                    {character.reused_from!.series_title}
                  </span>
                  . The current prompt may not match the existing image —
                  regenerate to refresh, or dismiss to keep the inherited
                  image.
                </span>
                <button
                  type="button"
                  onClick={() => setWarningDismissed(true)}
                  className="rounded px-1.5 py-0.5 text-amber-100 hover:bg-amber-500/20"
                >
                  Dismiss
                </button>
              </div>
            )}
            <div>
              <Label htmlFor={`card-prompt-${character.id}`} className="text-xs">
                Card image prompt
                {savingField === "card_image_prompt" && (
                  <span className="ml-2 text-muted-foreground">Saving…</span>
                )}
                {savedField === "card_image_prompt" && (
                  <span className="ml-2 text-emerald-400">Saved</span>
                )}
              </Label>
              <Textarea
                id={`card-prompt-${character.id}`}
                className="mt-1 min-h-[120px] text-xs"
                value={drafts.card_image_prompt}
                onChange={(e) =>
                  setDrafts((d) => ({
                    ...d,
                    card_image_prompt: e.target.value,
                  }))
                }
                onBlur={() => saveField("card_image_prompt")}
                disabled={generating || character.card_approved}
              />
            </div>

            <div className="rounded-md border bg-muted/30 p-2">
              {generating ? (
                <div className="flex aspect-[4/5] items-center justify-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-xs">Generating…</span>
                  </div>
                </div>
              ) : cardImageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={cardImageUrl}
                  alt={`${character.name ?? "character"} card`}
                  className="aspect-[4/5] w-full rounded object-cover"
                />
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
                  No card image yet
                </div>
              )}
            </div>

            {imageState.kind === "error" && (
              <p className="text-xs text-destructive">{imageState.message}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={
                  generating ||
                  character.card_approved ||
                  !character.approved_fullbody_image_id ||
                  drafts.card_image_prompt.trim().length === 0
                }
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : cardImageUrl ? (
                  "Regenerate"
                ) : (
                  "Generate card image"
                )}
              </Button>
              {!character.approved_fullbody_image_id && (
                <span className="text-xs text-muted-foreground">
                  Body portrait required
                </span>
              )}
            </div>
          </div>

          {/* ── RIGHT — seven manual-edit text fields ───────────────── */}
          <div className="space-y-3">
            {TEXT_FIELDS.map(({ key, label, multiline }) => (
              <div key={key}>
                <Label htmlFor={`${key}-${character.id}`} className="text-xs">
                  {label}
                  {savingField === key && (
                    <span className="ml-2 text-muted-foreground">Saving…</span>
                  )}
                  {savedField === key && (
                    <span className="ml-2 text-emerald-400">Saved</span>
                  )}
                </Label>
                {multiline ? (
                  <Textarea
                    id={`${key}-${character.id}`}
                    className="mt-1 min-h-[80px] text-sm"
                    value={drafts[key]}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [key]: e.target.value }))
                    }
                    onBlur={() => saveField(key)}
                    disabled={character.card_approved}
                  />
                ) : (
                  <Input
                    id={`${key}-${character.id}`}
                    className="mt-1 text-sm"
                    value={drafts[key]}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [key]: e.target.value }))
                    }
                    onBlur={() => saveField(key)}
                    disabled={character.card_approved}
                  />
                )}
              </div>
            ))}

            {fieldError && (
              <p className="text-xs text-destructive">{fieldError}</p>
            )}
          </div>
        </div>

        {/* ── Approve row ─────────────────────────────────────────────── */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-xs text-muted-foreground">
            {character.card_approved && character.card_approved_at ? (
              <>Approved {new Date(character.card_approved_at).toLocaleString()}</>
            ) : (
              <>
                {!allTextFieldsFilled && "All seven text fields required. "}
                {!cardImageUrl && "Card image required. "}
                {generating && "Wait for image generation to finish. "}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {character.card_approved ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleUnapprove}
                disabled={approving}
              >
                {approving ? "…" : "Unapprove"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={!canApprove || approving}
              >
                {approving ? "Approving…" : "Approve card"}
              </Button>
            )}
          </div>
        </div>
        {approvalError && (
          <p className="mt-2 text-xs text-destructive">{approvalError}</p>
        )}
      </CardContent>
    </Card>
  );
}

// Initial draft state: pull current server values into editable strings.
// Empty string (rather than null) so controlled inputs don't switch
// uncontrolled→controlled and warn.
function seedDrafts(c: CharacterFromAPI): Record<EditableFieldKey, string> {
  return {
    archetype_tag: c.archetype_tag ?? "",
    vibe_line: c.vibe_line ?? "",
    wants: c.wants ?? "",
    needs: c.needs ?? "",
    defining_quote: c.defining_quote ?? "",
    watch_out_for: c.watch_out_for ?? "",
    bio_short: c.bio_short ?? "",
    card_image_prompt: c.card_image_prompt ?? "",
  };
}
