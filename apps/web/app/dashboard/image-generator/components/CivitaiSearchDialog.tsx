"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Search } from "lucide-react";

interface SearchResult {
  id: number;
  name: string;
  type: string;
  thumbnailUrl: string | null;
  versions: {
    id: number;
    name: string;
    urn: string;
    baseModel: string;
    thumbnailUrl: string | null;
  }[];
}

interface CivitaiSearchDialogProps {
  type: "Checkpoint" | "LORA";
  onSelect: (item: { name: string; urn: string; thumbnailUrl?: string }) => void;
  onClose: () => void;
}

export function CivitaiSearchDialog({
  type,
  onSelect,
  onClose,
}: CivitaiSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const resp = await fetch(
          `/api/image-generator/civitai-search?query=${encodeURIComponent(q)}&type=${type}&limit=12`
        );
        if (!resp.ok) {
          const data = await resp.json();
          throw new Error(data.error || "Search failed");
        }
        const data = await resp.json();
        setResults(data.results || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [type]
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <Card className="relative z-10 w-full max-w-2xl max-h-[70vh] flex flex-col">
        <CardContent className="p-4 flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">
              Search CivitAI {type === "Checkpoint" ? "Checkpoints" : "LoRAs"}
            </h3>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Search input */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${type === "Checkpoint" ? "checkpoints" : "LoRAs"}...`}
              className="pl-9"
            />
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive text-center py-4">{error}</p>
            )}

            {!loading && !error && results.length === 0 && query.trim() && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No results found
              </p>
            )}

            {!loading && results.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {results.map((result) => {
                  const primaryVersion = result.versions[0];
                  if (!primaryVersion) return null;

                  return (
                    <button
                      key={result.id}
                      className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50"
                      onClick={() =>
                        onSelect({
                          name: result.name,
                          urn: primaryVersion.urn,
                          thumbnailUrl:
                            primaryVersion.thumbnailUrl || result.thumbnailUrl || undefined,
                        })
                      }
                    >
                      {(primaryVersion.thumbnailUrl || result.thumbnailUrl) && (
                        <img
                          src={primaryVersion.thumbnailUrl || result.thumbnailUrl!}
                          alt=""
                          className="h-14 w-14 rounded border border-border object-cover flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {result.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {primaryVersion.name}
                        </p>
                        <Badge variant="secondary" className="mt-1 text-xs">
                          {primaryVersion.baseModel}
                        </Badge>
                        {result.versions.length > 1 && (
                          <span className="text-xs text-muted-foreground ml-2">
                            +{result.versions.length - 1} versions
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
