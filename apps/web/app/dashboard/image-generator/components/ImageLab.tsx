"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw } from "lucide-react";
import { ImageUploader } from "./ImageUploader";
import { ResourceEditor } from "./ResourceEditor";
import { CivitaiSearchDialog } from "./CivitaiSearchDialog";
import { GenerationView } from "./GenerationView";

export interface CheckpointInfo {
  name: string;
  urn: string;
  modelId?: number;
  versionId?: number;
  thumbnailUrl?: string;
}

export interface LoraInfo {
  name: string;
  urn: string;
  strength: number;
  thumbnailUrl?: string;
}

export interface GenerationParams {
  steps: number;
  cfgScale: number;
  scheduler: string;
  width: number;
  height: number;
  clipSkip: number;
  seed: number;
}

export interface GenerationConfig {
  prompt: string;
  negativePrompt: string;
  checkpoint: CheckpointInfo;
  loras: LoraInfo[];
  params: GenerationParams;
}

export interface GeneratedImage {
  url: string;
  seed: number;
  cost: number;
  config: GenerationConfig;
  timestamp: number;
}

type Phase =
  | "upload"
  | "analyzing"
  | "editing"
  | "generating"
  | "complete";

export function ImageLab() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [originalMimeType, setOriginalMimeType] = useState<string | null>(null);
  const [config, setConfig] = useState<GenerationConfig | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [currentGenerated, setCurrentGenerated] = useState<GeneratedImage | null>(null);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchType, setSearchType] = useState<"Checkpoint" | "LORA">("Checkpoint");
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleImageSelected = useCallback(async (base64: string, mimeType: string) => {
    setOriginalImage(`data:${mimeType};base64,${base64}`);
    setOriginalMimeType(mimeType);
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

      setConfig({
        prompt: analysis.prompt,
        negativePrompt: analysis.negativePrompt,
        checkpoint: analysis.suggestedCheckpoint,
        loras: analysis.suggestedLoras || [],
        params: analysis.params,
      });
      setPhase("editing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase("upload");
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!config) return;
    setPhase("generating");
    setError(null);

    try {
      // Build additionalNetworks from LoRAs — schema only accepts { strength } not type
      const additionalNetworks: Record<string, { strength: number }> = {};
      for (const lora of config.loras) {
        additionalNetworks[lora.urn] = { strength: lora.strength };
      }

      const resp = await fetch("/api/image-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.checkpoint.urn,
          prompt: config.prompt,
          negativePrompt: config.negativePrompt,
          params: config.params,
          additionalNetworks: Object.keys(additionalNetworks).length > 0 ? additionalNetworks : undefined,
        }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || "Generation failed");
      }

      const { token } = await resp.json();

      const pollStart = Date.now();
      const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

      // Start polling
      pollingRef.current = setInterval(async () => {
        // Hard timeout — stop polling after 5 minutes
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setError("Generation timed out after 5 minutes. CivitAI may be busy — try again.");
          setPhase("editing");
          return;
        }

        try {
          const statusResp = await fetch(`/api/image-generator/civitai-status/${encodeURIComponent(token)}`);
          const statusData = await statusResp.json();

          if (statusData.status === "completed") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;

            const images: GeneratedImage[] = (statusData.images || []).map((img: any) => ({
              url: img.url,
              seed: img.seed,
              cost: img.cost,
              config: { ...config },
              timestamp: Date.now(),
            }));

            if (images.length > 0) {
              setCurrentGenerated(images[0]);
              setGeneratedImages(images);
              setHistory((prev) => [...prev, ...images]);
            }
            setPhase("complete");
          } else if (statusData.status === "failed") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            setError(statusData.error || "Generation failed");
            setPhase("editing");
          }
        } catch {
          // Polling errors are transient, keep polling
        }
      }, 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setPhase("editing");
    }
  }, [config]);

  const handleEditAndRegenerate = useCallback(() => {
    setPhase("editing");
    setError(null);
  }, []);

  const handleStartOver = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setPhase("upload");
    setOriginalImage(null);
    setOriginalMimeType(null);
    setConfig(null);
    setGeneratedImages([]);
    setCurrentGenerated(null);
    setError(null);
  }, []);

  const handleOpenSearch = useCallback((type: "Checkpoint" | "LORA") => {
    setSearchType(type);
    setSearchOpen(true);
  }, []);

  const handleSearchSelect = useCallback((item: { name: string; urn: string; thumbnailUrl?: string }) => {
    if (!config) return;

    if (searchType === "Checkpoint") {
      setConfig({
        ...config,
        checkpoint: { name: item.name, urn: item.urn, thumbnailUrl: item.thumbnailUrl },
      });
    } else {
      setConfig({
        ...config,
        loras: [...config.loras, { name: item.name, urn: item.urn, strength: 0.75, thumbnailUrl: item.thumbnailUrl }],
      });
    }
    setSearchOpen(false);
  }, [config, searchType]);

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
                Detecting art style, composition, and generating reproduction tags
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

      {(phase === "editing" || phase === "generating") && config && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Original image preview */}
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

          {/* Resource editor */}
          <div className="lg:col-span-2">
            <ResourceEditor
              config={config}
              onChange={setConfig}
              onGenerate={handleGenerate}
              onOpenSearch={handleOpenSearch}
              isGenerating={phase === "generating"}
            />
          </div>
        </div>
      )}

      {phase === "complete" && originalImage && currentGenerated && (
        <GenerationView
          originalImage={originalImage}
          generated={currentGenerated}
          history={history}
          onSelectHistory={(img) => setCurrentGenerated(img)}
          onEditAndRegenerate={handleEditAndRegenerate}
          onStartOver={handleStartOver}
        />
      )}

      {searchOpen && (
        <CivitaiSearchDialog
          type={searchType}
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
