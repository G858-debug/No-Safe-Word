"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AUTHOR_NOTES_KEYS, type AuthorNotes } from "@no-safe-word/shared";

// ─────────────────────────────────────────────────────────────────────────
// Stage 13 — Author's Notes review panel.
//
// Editable variant of the legacy read-only AuthorNotesPanel that used to
// live inside PublishPanel.tsx. Adds:
//   - editable textareas for the four formats (save-on-blur, mirrors
//     CharacterCardPanel pattern from Phase 3a)
//   - accompanying-image sub-panel (16:9, prompt textarea, generate/regen
//     button) that calls the Phase 2 generate-author-note-image endpoint
//   - "Approve author's notes" button gated on all four formats non-empty
//     plus an image URL
//   - "Revoke approval" affordance after approval
//
// Once approved, the server hard-locks edits + image regen (409 +
// approved_locked). The UI mirrors that lock by disabling all inputs and
// hiding the generate button. Revoke unlocks both UI and server.
//
// `onApprovalChange` lets the parent PublishPanel re-derive its
// `authorNotesReady` gate (which controls every publish action).
// ─────────────────────────────────────────────────────────────────────────

interface Props {
  seriesId: string;
  initialNotes: AuthorNotes;
  initialImagePrompt: string | null;
  initialImageUrl: string | null;
  initialApprovedAt: string | null;
  onApprovalChange?: (approvedAt: string | null) => void;
}

const FORMAT_SECTIONS: ReadonlyArray<{
  key: keyof AuthorNotes;
  label: string;
  rows: number;
  hint: string;
}> = [
  {
    key: "website_long",
    label: "Website Long",
    rows: 16,
    hint: "400–700 words. Renders paywalled on the website story page.",
  },
  {
    key: "email_version",
    label: "Email",
    rows: 12,
    hint: "200–350 words. Body of the email send.",
  },
  {
    key: "linkedin_post",
    label: "LinkedIn",
    rows: 10,
    hint: "150–250 words. Posted under the author persona.",
  },
  {
    key: "social_caption",
    label: "Social",
    rows: 6,
    hint: "60–120 words. Facebook / Instagram caption.",
  },
];

type EditableFieldKey = keyof AuthorNotes | "author_note_image_prompt";

type ImageGenState =
  | { kind: "idle" }
  | { kind: "generating"; jobId: string }
  | { kind: "error"; message: string };

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function AuthorNotesReviewPanel({
  seriesId,
  initialNotes,
  initialImagePrompt,
  initialImageUrl,
  initialApprovedAt,
  onApprovalChange,
}: Props) {
  // ─── Local state mirrors of the parent props ───────────────────────────
  // Drafts cover all five editable fields. Server values are written to
  // disk on blur; drafts let us avoid re-rendering every keystroke from a
  // controlled-by-prop input.
  const [drafts, setDrafts] = useState<Record<EditableFieldKey, string>>(() => ({
    website_long: initialNotes.website_long ?? "",
    email_version: initialNotes.email_version ?? "",
    linkedin_post: initialNotes.linkedin_post ?? "",
    social_caption: initialNotes.social_caption ?? "",
    author_note_image_prompt: initialImagePrompt ?? "",
  }));
  const [savedNotes, setSavedNotes] = useState<AuthorNotes>(initialNotes);
  const [savedImagePrompt, setSavedImagePrompt] = useState<string>(
    initialImagePrompt ?? ""
  );
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl);
  const [approvedAt, setApprovedAt] = useState<string | null>(initialApprovedAt);
  const approved = approvedAt !== null;

  const [savingField, setSavingField] = useState<EditableFieldKey | null>(null);
  const [savedField, setSavedField] = useState<EditableFieldKey | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [imageState, setImageState] = useState<ImageGenState>({ kind: "idle" });

  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const isMountedRef = useRef(true);
  const submittingRef = useRef(false);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Re-sync drafts when parent props change (e.g. after approve→revoke
  // round-trip the parent re-renders with fresh values). Only overwrite
  // a draft if it still matches the last server value (otherwise the user
  // is mid-edit and we'd clobber their typing).
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      const map: Record<EditableFieldKey, string> = {
        website_long: initialNotes.website_long ?? "",
        email_version: initialNotes.email_version ?? "",
        linkedin_post: initialNotes.linkedin_post ?? "",
        social_caption: initialNotes.social_caption ?? "",
        author_note_image_prompt: initialImagePrompt ?? "",
      };
      (Object.keys(map) as EditableFieldKey[]).forEach((key) => {
        const lastServer =
          key === "author_note_image_prompt"
            ? savedImagePrompt
            : (savedNotes[key as keyof AuthorNotes] ?? "");
        if (prev[key] === lastServer) {
          next[key] = map[key];
        }
      });
      return next;
    });
    setSavedNotes(initialNotes);
    setSavedImagePrompt(initialImagePrompt ?? "");
    setImageUrl(initialImageUrl);
    setApprovedAt(initialApprovedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNotes, initialImagePrompt, initialImageUrl, initialApprovedAt]);

  // ─── Save a single field on blur ─────────────────────────────────────
  const saveField = useCallback(
    async (field: EditableFieldKey) => {
      if (approved) return;
      const draft = drafts[field];
      const lastServer =
        field === "author_note_image_prompt"
          ? savedImagePrompt
          : (savedNotes[field as keyof AuthorNotes] ?? "");
      if (draft === lastServer) return;

      setSavingField(field);
      setFieldError(null);
      try {
        const res = await fetch(
          `/api/stories/${seriesId}/update-author-notes`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field, value: draft }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? `Save failed (HTTP ${res.status})`);
        }
        if (!isMountedRef.current) return;
        if (field === "author_note_image_prompt") {
          setSavedImagePrompt(draft);
        } else {
          setSavedNotes((prev) => ({ ...prev, [field]: draft }) as AuthorNotes);
        }
        setSavedField(field);
        setTimeout(() => {
          if (isMountedRef.current) {
            setSavedField((curr) => (curr === field ? null : curr));
          }
        }, 1500);
      } catch (err) {
        if (!isMountedRef.current) return;
        setFieldError(err instanceof Error ? err.message : "Save failed");
      } finally {
        if (isMountedRef.current) setSavingField(null);
      }
    },
    [seriesId, drafts, savedNotes, savedImagePrompt, approved]
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
    if (approved) return;
    if (imageState.kind === "generating" || submittingRef.current) return;
    if (drafts.author_note_image_prompt.trim().length === 0) {
      setImageState({
        kind: "error",
        message: "Image prompt is empty. Edit the prompt first.",
      });
      return;
    }

    submittingRef.current = true;
    try {
      const res = await fetch(
        `/api/stories/${seriesId}/generate-author-note-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt_override: drafts.author_note_image_prompt.trim(),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Generation failed (HTTP ${res.status})`);
      }
      const jobId: string = data.jobId;
      setImageState({ kind: "generating", jobId });

      try {
        const completion = await waitForCompletion(jobId);
        if (!isMountedRef.current) return;
        setImageUrl(completion.url);
        setSavedImagePrompt(drafts.author_note_image_prompt.trim());
        setImageState({ kind: "idle" });
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
  }, [seriesId, approved, imageState.kind, drafts.author_note_image_prompt, waitForCompletion]);

  // ─── Approve / Revoke ─────────────────────────────────────────────────
  const allFormatsFilled = useMemo(
    () =>
      AUTHOR_NOTES_KEYS.every((k) => {
        const value = savedNotes[k];
        return typeof value === "string" && value.trim().length > 0;
      }),
    [savedNotes]
  );

  const canApprove =
    !approved &&
    allFormatsFilled &&
    Boolean(imageUrl) &&
    imageState.kind !== "generating" &&
    savingField === null;

  const handleApprove = useCallback(async () => {
    if (!canApprove || approving) return;
    setApproving(true);
    setApprovalError(null);
    try {
      const res = await fetch(
        `/api/stories/${seriesId}/approve-author-notes`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Approval failed (HTTP ${res.status})`);
      }
      const stamp: string = data.author_note_approved_at;
      setApprovedAt(stamp);
      onApprovalChange?.(stamp);
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      if (isMountedRef.current) setApproving(false);
    }
  }, [seriesId, canApprove, approving, onApprovalChange]);

  const handleRevoke = useCallback(async () => {
    if (approving) return;
    setApproving(true);
    setApprovalError(null);
    try {
      const res = await fetch(
        `/api/stories/${seriesId}/revoke-author-notes-approval`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Revoke failed (HTTP ${res.status})`);
      }
      setApprovedAt(null);
      setShowRevokeConfirm(false);
      onApprovalChange?.(null);
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      if (isMountedRef.current) setApproving(false);
    }
  }, [seriesId, approving, onApprovalChange]);

  // ─── Render ──────────────────────────────────────────────────────────
  const generating = imageState.kind === "generating";
  const inputsDisabled = approved;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            Author&apos;s Notes
            {approved ? (
              <Badge className="gap-1 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/15">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approved
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Awaiting review
              </Badge>
            )}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {approved
              ? "Locked. Revoke approval to edit again."
              : "Review the four formats and the accompanying image, then approve to unblock the publish actions below."}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* ── LEFT — accompanying image ──────────────────────────── */}
          <div className="space-y-3">
            <div>
              <Label
                htmlFor={`author-note-prompt-${seriesId}`}
                className="text-xs"
              >
                Image prompt (16:9 landscape)
                {savingField === "author_note_image_prompt" && (
                  <span className="ml-2 text-muted-foreground">Saving…</span>
                )}
                {savedField === "author_note_image_prompt" && (
                  <span className="ml-2 text-emerald-400">Saved</span>
                )}
              </Label>
              <Textarea
                id={`author-note-prompt-${seriesId}`}
                className="mt-1 min-h-[120px] text-xs"
                value={drafts.author_note_image_prompt}
                onChange={(e) =>
                  setDrafts((d) => ({
                    ...d,
                    author_note_image_prompt: e.target.value,
                  }))
                }
                onBlur={() => saveField("author_note_image_prompt")}
                disabled={inputsDisabled || generating}
              />
            </div>

            <div className="rounded-md border bg-muted/30 p-2">
              {generating ? (
                <div className="flex aspect-video items-center justify-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-xs">Generating…</span>
                  </div>
                </div>
              ) : imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={imageUrl}
                  alt="Author's note accompanying image"
                  className="aspect-video w-full rounded object-cover"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
                  No accompanying image yet
                </div>
              )}
            </div>

            {imageState.kind === "error" && (
              <p className="text-xs text-destructive">{imageState.message}</p>
            )}

            {!approved && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={
                    generating ||
                    drafts.author_note_image_prompt.trim().length === 0
                  }
                >
                  {generating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating…
                    </>
                  ) : imageUrl ? (
                    "Regenerate"
                  ) : (
                    "Generate accompanying image"
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* ── RIGHT — four format tabs ──────────────────────────────── */}
          <div className="space-y-3">
            <Tabs defaultValue={FORMAT_SECTIONS[0].key} className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                {FORMAT_SECTIONS.map(({ key, label }) => (
                  <TabsTrigger key={key} value={key} className="gap-2">
                    <span>{label}</span>
                    <Badge variant="outline" className="text-xs font-normal">
                      {countWords(drafts[key])}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
              {FORMAT_SECTIONS.map(({ key, label, rows, hint }) => (
                <TabsContent key={key} value={key} className="mt-4">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor={`author-note-${key}-${seriesId}`}
                      className="text-xs"
                    >
                      {label}
                      {savingField === key && (
                        <span className="ml-2 text-muted-foreground">
                          Saving…
                        </span>
                      )}
                      {savedField === key && (
                        <span className="ml-2 text-emerald-400">Saved</span>
                      )}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {countWords(drafts[key])} words
                    </span>
                  </div>
                  <Textarea
                    id={`author-note-${key}-${seriesId}`}
                    className="mt-1 text-sm leading-relaxed"
                    rows={rows}
                    value={drafts[key]}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [key]: e.target.value }))
                    }
                    onBlur={() => saveField(key)}
                    disabled={inputsDisabled}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
                </TabsContent>
              ))}
            </Tabs>
            {fieldError && (
              <p className="text-xs text-destructive">{fieldError}</p>
            )}
          </div>
        </div>

        {/* ── Approve / Revoke row ────────────────────────────────────── */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-xs text-muted-foreground">
            {approved ? (
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Approved {approvedAt && new Date(approvedAt).toLocaleString()}
              </span>
            ) : (
              <>
                {!allFormatsFilled && "All four formats required. "}
                {!imageUrl && "Accompanying image required. "}
                {generating && "Wait for image generation to finish. "}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {approved ? (
              showRevokeConfirm ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    Revoke and edit again?
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowRevokeConfirm(false)}
                    disabled={approving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleRevoke}
                    disabled={approving}
                  >
                    {approving ? "Revoking…" : "Revoke"}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowRevokeConfirm(true)}
                  disabled={approving}
                >
                  Revoke approval
                </Button>
              )
            ) : (
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={!canApprove || approving}
              >
                {approving ? "Approving…" : "Approve author's notes"}
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
