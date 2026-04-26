"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { ImageUploader } from "./ImageUploader";
import { GenerationView } from "./GenerationView";

export interface GeneratedImage {
  url: string;
  prompt: string;
  aspectRatio: string;
  timestamp: number;
}

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 — Portrait" },
  { value: "9:16", label: "9:16 — Tall portrait" },
  { value: "1:1", label: "1:1 — Square" },
  { value: "4:3", label: "4:3 — Landscape" },
  { value: "16:9", label: "16:9 — Wide" },
];

type Phase = "upload" | "analyzing" | "editing" | "generating" | "complete";

export function ImageLab() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [currentGenerated, setCurrentGenerated] = useState<GeneratedImage | null>(null);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleImageSelected = useCallback(async (base64: string, mimeType: string) => {
    setOriginalImage(`data:${mimeType};base64,${base64}`);
    setPhase("analyzing");
    setError(null);

    try {
      const resp = await fetch("/api/image-generator/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || "Analysis failed");
      }

      const analysis = await resp.json();
      setPrompt(analysis.prompt || "");
      setAspectRatio(analysis.aspectRatio || "3:4");
      setPhase("editing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase("upload");
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setPhase("generating");
    setError(null);

    try {
      const resp = await fetch("/api/image-generator/generate-hunyuan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), aspectRatio }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || "Generation failed");
      }

      const { imageUrl, prompt: finalPrompt } = await resp.json();

      const generated: GeneratedImage = {
        url: imageUrl,
        prompt: finalPrompt || prompt,
        aspectRatio,
        timestamp: Date.now(),
      };

      setCurrentGenerated(generated);
      setHistory((prev) => [...prev, generated]);
      setPhase("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setPhase("editing");
    }
  }, [prompt, aspectRatio]);

  const handleEditAndRegenerate = useCallback(() => {
    setPhase("editing");
    setError(null);
  }, []);

  const handleStartOver = useCallback(() => {
    setPhase("upload");
    setOriginalImage(null);
    setPrompt("");
    setAspectRatio("3:4");
    setCurrentGenerated(null);
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {phase === "upload" && (
        <ImageUploader onImageSelected={handleImageSelected} />
      )}

      {phase === "analyzing" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-medium">Analyzing image with Claude Vision...</p>
              <p className="text-sm text-muted-foreground mt-1">
                Building a Hunyuan prompt from your image
              </p>
            </div>
            {originalImage && (
              <img
                src={originalImage}
                alt="Uploaded"
                className="mt-4 max-h-64 rounded-lg border border-border object-contain"
              />
            )}
          </CardContent>
        </Card>
      )}

      {(phase === "editing" || phase === "generating") && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Original image */}
          <div className="lg:col-span-1">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">Original</h3>
                  <Button variant="ghost" size="sm" onClick={handleStartOver}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    New
                  </Button>
                </div>
                {originalImage && (
                  <img
                    src={originalImage}
                    alt="Original"
                    className="w-full rounded-lg border border-border object-contain max-h-96"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Prompt editor */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Prompt
                  </Label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="mt-1.5 min-h-[180px] text-sm"
                    placeholder="Describe the scene in natural language..."
                    disabled={phase === "generating"}
                  />
                </div>

                <div className="w-48">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Aspect Ratio
                  </Label>
                  <Select
                    value={aspectRatio}
                    onValueChange={setAspectRatio}
                    disabled={phase === "generating"}
                  >
                    <SelectTrigger className="mt-1.5">
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
              </CardContent>
            </Card>

            <Button
              size="lg"
              className="w-full"
              onClick={handleGenerate}
              disabled={phase === "generating" || !prompt.trim()}
            >
              {phase === "generating" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating on HunyuanImage 3.0...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {phase === "complete" && originalImage && currentGenerated && (
        <GenerationView
          originalImage={originalImage}
          generated={currentGenerated}
          history={history}
          onSelectHistory={setCurrentGenerated}
          onEditAndRegenerate={handleEditAndRegenerate}
          onStartOver={handleStartOver}
        />
      )}
    </div>
  );
}
