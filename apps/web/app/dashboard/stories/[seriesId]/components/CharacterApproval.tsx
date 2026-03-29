"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CharacterCard } from "./CharacterCard";

export interface CharacterFromAPI {
  id: string;
  character_id: string;
  approved: boolean;
  approved_image_id: string | null;
  approved_fullbody: boolean;
  approved_fullbody_image_id: string | null;
  active_lora_id: string | null;
  approved_image_url: string | null;
  approved_fullbody_image_url: string | null;
  pending_image_id: string | null;
  pending_image_url: string | null;
  pending_fullbody_image_id: string | null;
  pending_fullbody_image_url: string | null;
  characters: { id: string; name: string; description: Record<string, unknown> };
}

interface Props {
  seriesId: string;
  onAllReady?: () => void;
}

export default function CharacterApproval({ seriesId, onAllReady }: Props) {
  const [characters, setCharacters] = useState<CharacterFromAPI[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch(`/api/stories/${seriesId}/characters`);
      if (!res.ok) return;
      const data = await res.json();
      setCharacters(data.characters || []);
    } catch {
      // Silently fail — user can refresh
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  // Check if all characters are ready (deployed LoRA)
  useEffect(() => {
    if (characters.length === 0) return;
    const allReady = characters.every(c => c.approved && c.approved_fullbody && c.active_lora_id);
    if (allReady && onAllReady) onAllReady();
  }, [characters, onAllReady]);

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
          onUpdate={fetchCharacters}
        />
      ))}
    </div>
  );
}
