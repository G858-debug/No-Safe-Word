"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface BlurbState {
  blurb_short_variants: string[] | null;
  blurb_short_selected: number | null;
  blurb_long_variants: string[] | null;
  blurb_long_selected: number | null;
}

interface Props {
  seriesId: string;
  onChange?: () => void;
}

const VARIANT_COUNT = 3;

export default function BlurbSelection({ seriesId, onChange }: Props) {
  const [state, setState] = useState<BlurbState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<"short" | "long" | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Editing state — at most one variant being edited at a time
  const [editingKey, setEditingKey] = useState<{
    kind: "short" | "long";
    index: number;
  } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/stories/${seriesId}`);
      if (!res.ok) { setError("Failed to load blurb state"); return; }
      const data = await res.json();
      setState(data.series as BlurbState);
    } catch {
      setError("Failed to load blurb state");
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => { fetchState(); }, [fetchState]);

  async function regenerateAll() {
    const ok = window.confirm(
      "Regenerate will overwrite all 6 current blurb variants (3 short, 3 long) and clear your selections. Continue?"
    );
    if (!ok) return;
    setRegenerating(true);
    setError(null);
    setEditingKey(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/regenerate-blurbs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Blurb regeneration failed"); return; }
      await fetchState();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Blurb regeneration failed");
    } finally {
      setRegenerating(false);
    }
  }

  async function select(kind: "short" | "long", selectedIndex: number) {
    setBusyKind(kind);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/select-blurb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, selectedIndex }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Selection failed"); return; }
      await fetchState();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Selection failed");
    } finally {
      setBusyKind(null);
    }
  }

  function startEdit(kind: "short" | "long", index: number, currentText: string) {
    setEditingKey({ kind, index });
    setEditDraft(currentText);
    setError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditDraft("");
  }

  async function saveEdit() {
    if (!editingKey) return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/update-blurb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: editingKey.kind,
          index: editingKey.index,
          text: editDraft,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save blurb"); return; }
      setEditingKey(null);
      setEditDraft("");
      await fetchState();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save blurb");
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading || !state) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
          <CardContent><Skeleton className="h-32 w-full" /></CardContent>
        </Card>
      </div>
    );
  }

  const shortVariants = state.blurb_short_variants ?? null;
  const longVariants = state.blurb_long_variants ?? null;
  const hasAnyVariants =
    (Array.isArray(shortVariants) && shortVariants.length === VARIANT_COUNT) ||
    (Array.isArray(longVariants) && longVariants.length === VARIANT_COUNT);

  if (!hasAnyVariants) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
        <Card>
          <CardHeader><CardTitle className="text-base">Blurbs</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No blurb variants exist for this story yet. You can either re-import with{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">marketing.blurb_short_variants</code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">marketing.blurb_long_variants</code>{" "}
              populated in the Stage 7 payload, or generate a full set with Claude.
            </p>
            <p className="text-xs text-muted-foreground">
              Each set is 3 short blurbs (1–2 sentences, for story cards and OG previews) plus 3 long blurbs (150–250 words, for the website detail page).
            </p>
            <div>
              <Button onClick={regenerateAll} disabled={regenerating}>
                {regenerating ? "Generating with Claude..." : "Generate blurbs with Claude"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const busy = busyKind !== null || savingEdit;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Regenerate all blurbs with Claude</p>
            <p className="text-xs text-muted-foreground">
              Overwrites both variant sets and clears selections.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={regenerateAll}
            disabled={regenerating || busy}
          >
            {regenerating ? "Generating..." : "Regenerate all blurbs"}
          </Button>
        </CardContent>
      </Card>

      <BlurbSection
        kind="short"
        title="Short blurb"
        helper="Used on story cards, OG link previews, and email subject lines."
        variants={shortVariants}
        selectedIndex={state.blurb_short_selected}
        disabled={busy}
        onSelect={(idx) => select("short", idx)}
        onStartEdit={(idx, text) => startEdit("short", idx, text)}
        editingIndex={editingKey?.kind === "short" ? editingKey.index : null}
        editDraft={editDraft}
        onChangeDraft={setEditDraft}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        savingEdit={savingEdit}
        prose={false}
      />

      <BlurbSection
        kind="long"
        title="Long blurb"
        helper="Used on the website story detail page. 150–250 words."
        variants={longVariants}
        selectedIndex={state.blurb_long_selected}
        disabled={busy}
        onSelect={(idx) => select("long", idx)}
        onStartEdit={(idx, text) => startEdit("long", idx, text)}
        editingIndex={editingKey?.kind === "long" ? editingKey.index : null}
        editDraft={editDraft}
        onChangeDraft={setEditDraft}
        onSaveEdit={saveEdit}
        onCancelEdit={cancelEdit}
        savingEdit={savingEdit}
        prose
      />
    </div>
  );
}

interface BlurbSectionProps {
  kind: "short" | "long";
  title: string;
  helper: string;
  variants: string[] | null;
  selectedIndex: number | null;
  disabled: boolean;
  onSelect: (index: number) => void;
  onStartEdit: (index: number, text: string) => void;
  editingIndex: number | null;
  editDraft: string;
  onChangeDraft: (text: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  savingEdit: boolean;
  prose: boolean;
}

function BlurbSection({
  kind,
  title,
  helper,
  variants,
  selectedIndex,
  disabled,
  onSelect,
  onStartEdit,
  editingIndex,
  editDraft,
  onChangeDraft,
  onSaveEdit,
  onCancelEdit,
  savingEdit,
  prose,
}: BlurbSectionProps) {
  if (!variants || variants.length !== VARIANT_COUNT) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No {kind} blurb variants were imported.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{title}</CardTitle>
          {selectedIndex !== null && (
            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
              Variant {selectedIndex + 1} selected
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {variants.map((text, i) => {
            const isSelected = selectedIndex === i;
            const isEditing = editingIndex === i;

            if (isEditing) {
              return (
                <div
                  key={i}
                  className="rounded-md border border-blue-500 bg-blue-500/5 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Variant {i + 1} — editing
                    </span>
                    {isSelected && (
                      <span className="text-xs font-medium text-blue-400">Selected</span>
                    )}
                  </div>
                  <Textarea
                    value={editDraft}
                    onChange={(e) => onChangeDraft(e.target.value)}
                    className={`text-sm ${prose ? "min-h-[180px]" : "min-h-[80px]"}`}
                    disabled={savingEdit}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={onSaveEdit}
                      disabled={savingEdit || !editDraft.trim()}
                    >
                      {savingEdit ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onCancelEdit}
                      disabled={savingEdit}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={i}
                className={`group rounded-md border p-4 transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/30"
                    : "border-border bg-muted/20"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Variant {i + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    {isSelected ? (
                      <span className="text-xs font-medium text-blue-400">Selected</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => !disabled && onSelect(i)}
                        disabled={disabled}
                        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                      >
                        Select
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => !disabled && onStartEdit(i, text)}
                      disabled={disabled}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <p
                  className={
                    prose
                      ? "text-sm leading-relaxed text-foreground whitespace-pre-line"
                      : "text-sm leading-relaxed text-foreground"
                  }
                >
                  {text}
                </p>
              </div>
            );
          })}
        </div>
        {selectedIndex !== null && kind === "short" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Selecting a different short blurb will trigger a cover re-composite if the cover is already complete.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export { BlurbSelection };
