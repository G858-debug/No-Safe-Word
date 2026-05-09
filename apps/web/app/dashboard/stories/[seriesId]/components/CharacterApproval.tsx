"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CharacterCard } from "./CharacterCard";
import type { ImageModel } from "@no-safe-word/shared";

export interface PortraitDimensions {
  requested_width: number | null;
  requested_height: number | null;
  actual_width: number | null;
  actual_height: number | null;
  fallback_reason: string | null;
}

export interface CharacterFromAPI {
  id: string;
  character_id: string | null;
  name: string | null;
  description: Record<string, unknown> | null;
  role: string | null;
  prose_description: string | null;
  approved: boolean;
  approved_image_id: string | null;
  approved_fullbody_image_id: string | null;
  approved_image_url: string | null;
  approved_fullbody_image_url: string | null;
  approved_seed: number | null;
  approved_prompt: string | null;
  portrait_prompt_locked: string | null;
  // Visible-fallback metadata for the approved face/body images.
  // Populated when Siray rejected the higher-resolution request and
  // we retried at the documented cap. Null = pre-instrumentation row
  // or no approved image.
  face_image_dimensions: PortraitDimensions | null;
  body_image_dimensions: PortraitDimensions | null;

  // Phase 3a — Stage 9 character profile card fields. Optional for
  // backwards compatibility with anything that builds a CharacterFromAPI
  // outside the API endpoint; the endpoint always populates them.
  archetype_tag?: string | null;
  vibe_line?: string | null;
  wants?: string | null;
  needs?: string | null;
  defining_quote?: string | null;
  watch_out_for?: string | null;
  bio_short?: string | null;
  card_image_id?: string | null;
  card_image_url?: string | null;
  card_image_prompt?: string | null;
  card_approved_at?: string | null;
  card_approved?: boolean;

  /**
   * Set when this character's approved portrait was inherited from an
   * earlier series. Drives the "Reused from [Series Title]" chip in
   * Stage 8 and Stage 9 UIs and the "card image may not match current
   * prompt" warning in Stage 9. Null = native to this series (or no
   * portrait approved yet). Heuristic — see API route comment.
   */
  reused_from?: {
    series_id: string;
    series_title: string;
    slug: string;
  } | null;
}

interface Props {
  seriesId: string;
  onAllReady?: () => void;
  /** Story's image model. Threaded into CharacterCard so it can label which
   *  model generates the body portrait (face is always Nano Banana 2). */
  imageModel: ImageModel;
  /**
   * Fired with the fresh character list every time this component re-fetches
   * (initial mount + after any card-level update). Lets the parent page keep
   * its own `characters` state in sync so cross-tab gates (e.g. "Approve
   * Characters First" on the Cover tab) update immediately without a page
   * refresh.
   */
  onCharactersChange?: (characters: CharacterFromAPI[]) => void;
}

export default function CharacterApproval({ seriesId, onAllReady, imageModel, onCharactersChange }: Props) {
  const [characters, setCharacters] = useState<CharacterFromAPI[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch(`/api/stories/${seriesId}/characters`);
      if (!res.ok) return;
      const data = await res.json();
      const fresh = data.characters || [];
      setCharacters(fresh);
      onCharactersChange?.(fresh);
    } catch {
      // Silently fail — user can refresh
    } finally {
      setLoading(false);
    }
  }, [seriesId, onCharactersChange]);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  // Note: onAllReady is intentionally NOT called automatically.
  // The user should navigate to Images manually when ready.
  // Auto-switching tabs caused a bug where users couldn't navigate back.

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => (
          <Card key={i}>
            <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
            <CardContent><Skeleton className="h-32 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Characters</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No characters found for this series.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {characters.map(char => (
        <CharacterCard
          key={char.id}
          character={char}
          seriesId={seriesId}
          imageModel={imageModel}
          onUpdate={fetchCharacters}
        />
      ))}
    </div>
  );
}
