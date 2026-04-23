"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// Narrow shape of the blurb-relevant fields returned by
// GET /api/stories/[seriesId] (which uses select("*") on story_series).
interface BlurbState {
  blurb_short_variants: string[] | null;
  blurb_short_selected: number | null;
  blurb_long_variants: string[] | null;
  blurb_long_selected: number | null;
}

interface Props {
  seriesId: string;
  /** Called after a selection succeeds so the parent can re-evaluate tab gating. */
  onChange?: () => void;
}

const VARIANT_COUNT = 3;

export default function BlurbSelection({ seriesId, onChange }: Props) {
  const [state, setState] = useState<BlurbState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<"short" | "long" | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/stories/${seriesId}`);
      if (!res.ok) {
        setError("Failed to load blurb state");
        return;
      }
      const data = await res.json();
      setState(data.series as BlurbState);
    } catch {
      setError("Failed to load blurb state");
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  async function regenerateAll() {
    const ok = window.confirm(
      "Regenerate will overwrite all 6 current blurb variants (3 short, 3 long) and clear your selections. Continue?"
    );
    if (!ok) return;

    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/regenerate-blurbs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Blurb regeneration failed");
        return;
      }
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
      if (!res.ok) {
        setError(data.error || "Selection failed");
        return;
      }
      await fetchState();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Selection failed");
    } finally {
      setBusyKind(null);
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
          <CardHeader>
            <CardTitle className="text-base">Blurbs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No blurb variants exist for this story yet. You can either
              re-import with{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                marketing.blurb_short_variants
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                marketing.blurb_long_variants
              </code>{" "}
              populated in the Stage 7 payload, or generate a full set with
              Claude.
            </p>
            <p className="text-xs text-muted-foreground">
              Each set is 3 short blurbs (1–2 sentences, for story cards and OG
              previews) plus 3 long blurbs (150–250 words, for the website
              detail page).
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
              Overwrites both variant sets and clears selections. You'll
              reselect from the new variants.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={regenerateAll}
            disabled={regenerating || busyKind !== null}
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
        disabled={busyKind !== null}
        onSelect={(idx) => select("short", idx)}
        prose={false}
      />

      <BlurbSection
        kind="long"
        title="Long blurb"
        helper="Used on the website story detail page. 150–250 words. Will not re-composite the cover."
        variants={longVariants}
        selectedIndex={state.blurb_long_selected}
        disabled={busyKind !== null}
        onSelect={(idx) => select("long", idx)}
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
  prose,
}: BlurbSectionProps) {
  if (!variants || variants.length !== VARIANT_COUNT) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No {kind} blurb variants were imported. Re-import with 3 entries to
            enable selection.
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
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelect(i)}
                disabled={disabled}
                className={`block w-full rounded-md border p-4 text-left transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/30"
                    : "border-border bg-muted/20 hover:border-muted-foreground/40"
                } ${disabled ? "cursor-default opacity-70" : "cursor-pointer"}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Variant {i + 1}
                  </span>
                  {isSelected ? (
                    <span className="text-xs font-medium text-blue-400">Selected</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Click to select</span>
                  )}
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
              </button>
            );
          })}
        </div>
        {selectedIndex !== null && kind === "short" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Selecting a different short blurb will trigger a cover re-composite
            if the cover is already complete.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Also exported as a named member so callers can either default-import
// or named-import, consistent with how CoverApproval is consumed.
export { BlurbSelection };
