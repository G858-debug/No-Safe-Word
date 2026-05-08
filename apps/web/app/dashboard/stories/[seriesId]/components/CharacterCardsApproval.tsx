"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CharacterCardPanel } from "./CharacterCardPanel";
import type { CharacterFromAPI } from "./CharacterApproval";

// ─────────────────────────────────────────────────────────────────────────
// Stage 9 — Character Profile Cards (wrapper)
//
// Sibling to CharacterApproval (Stage 8). Fetches the same
// /api/stories/[seriesId]/characters endpoint but consumes the Phase 1+2+3a
// fields (the seven profile-form columns, card_image_*, card_approved_at).
// Renders one CharacterCardPanel per linked character.
//
// Re-fetches on every panel-level update so the per-card counter on the
// parent page (`characters.filter(c => c.card_approved).length`) stays
// current and the Cover/Blurbs gates unlock the moment the last card is
// approved.
//
// Type re-uses CharacterFromAPI (extended with optional Phase 3a fields)
// so page.tsx can drive both Stage 8 and Stage 9 from a single state slot.
// ─────────────────────────────────────────────────────────────────────────

interface Props {
  seriesId: string;
  /**
   * Fired with the fresh character list every time this component
   * re-fetches. Lets the parent page keep its `characters` state in sync so
   * the Cover/Blurbs gates pick up the new `card_approved` flags without a
   * page refresh — same pattern as CharacterApproval.
   */
  onCharactersChange?: (characters: CharacterFromAPI[]) => void;
}

export default function CharacterCardsApproval({
  seriesId,
  onCharactersChange,
}: Props) {
  const [characters, setCharacters] = useState<CharacterFromAPI[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch(`/api/stories/${seriesId}/characters`);
      if (!res.ok) return;
      const data = await res.json();
      const fresh = (data.characters || []) as CharacterFromAPI[];
      setCharacters(fresh);
      onCharactersChange?.(fresh);
    } catch {
      // Silently fail — user can refresh.
    } finally {
      setLoading(false);
    }
  }, [seriesId, onCharactersChange]);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Character Cards</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No characters found for this series.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Per-character profile cards for the website&apos;s &ldquo;MEET THE
        CAST&rdquo; section. Review and tweak the imported text fields, generate
        the card image, then approve. All seven text fields and the card image
        are required before approval. Cover and Blurbs unlock once every
        character is approved here.
      </div>
      {characters.map((char) => (
        <CharacterCardPanel
          key={char.id}
          seriesId={seriesId}
          character={char}
          onUpdate={fetchCharacters}
        />
      ))}
    </div>
  );
}
