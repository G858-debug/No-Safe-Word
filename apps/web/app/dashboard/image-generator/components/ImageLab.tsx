"use client";

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, Clock } from "lucide-react";

export interface GeneratedImage {
  url: string;
  prompt: string;
  aspectRatio: string;
  timestamp: number;
}

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 — Portrait" },
  { value: "9:16", label: "9:16 — Tall" },
  { value: "1:1", label: "1:1 — Square" },
  { value: "4:3", label: "4:3 — Landscape" },
  { value: "16:9", label: "16:9 — Wide" },
];

export function ImageLab() {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [generating, setGenerating] = useState(false);
  const [current, setCurrent] = useState<GeneratedImage | null>(null);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);

    try {
      const resp = await fetch("/api/image-generator/generate-hunyuan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), aspectRatio }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Generation failed");

      const generated: GeneratedImage = {
        url: data.imageUrl,
        prompt: data.prompt || prompt,
        aspectRatio,
        timestamp: Date.now(),
      };

      setCurrent(generated);
      setHistory((prev) => [generated, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [prompt, aspectRatio, generating]);

  return (
    <div className="space-y-6">
      {/* Prompt input */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Prompt
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-1.5 min-h-[160px] text-sm"
              placeholder="Describe the scene in natural language…"
              disabled={generating}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleGenerate();
              }}
            />
          </div>

          <div className="flex items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Aspect Ratio
              </Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio} disabled={generating}>
                <SelectTrigger className="mt-1.5 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              size="lg"
              className="flex-1"
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Current result */}
      {generating && !current && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Running on HunyuanImage 3.0…</p>
          </CardContent>
        </Card>
      )}

      {current && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="font-mono text-xs">
                {current.aspectRatio}
              </Badge>
              <span className="text-xs text-muted-foreground">hunyuan-3-instruct (Siray.ai)</span>
            </div>
            <img
              src={current.url}
              alt="Generated"
              className="w-full rounded-lg border border-border object-contain max-h-[700px]"
            />
            <p className="text-xs text-muted-foreground font-mono whitespace-pre-wrap p-2 rounded bg-muted/50">
              {current.prompt}
            </p>
          </CardContent>
        </Card>
      )}

      {/* History strip */}
      {history.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">History</span>
              <span className="text-xs text-muted-foreground">({history.length})</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {history.map((img, i) => (
                <button
                  key={img.timestamp}
                  className={`flex-shrink-0 rounded-lg border-2 transition-colors ${
                    img.timestamp === current?.timestamp
                      ? "border-primary"
                      : "border-border hover:border-muted-foreground"
                  }`}
                  onClick={() => setCurrent(img)}
                >
                  <img
                    src={img.url}
                    alt={`Generation ${history.length - i}`}
                    className="h-20 w-20 rounded-md object-cover"
                  />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
