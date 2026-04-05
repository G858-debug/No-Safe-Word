"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, RotateCcw, Clock, Coins } from "lucide-react";
import type { GeneratedImage } from "./ImageLab";

interface GenerationViewProps {
  originalImage: string;
  generated: GeneratedImage;
  history: GeneratedImage[];
  onSelectHistory: (img: GeneratedImage) => void;
  onEditAndRegenerate: () => void;
  onStartOver: () => void;
}

export function GenerationView({
  originalImage,
  generated,
  history,
  onSelectHistory,
  onEditAndRegenerate,
  onStartOver,
}: GenerationViewProps) {
  return (
    <div className="space-y-6">
      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3 text-muted-foreground">
              Original
            </h3>
            <img
              src={originalImage}
              alt="Original"
              className="w-full rounded-lg border border-border object-contain max-h-[600px]"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Generated
              </h3>
              <div className="flex items-center gap-2">
                {generated.seed > 0 && (
                  <Badge variant="secondary" className="text-xs font-mono">
                    Seed: {generated.seed}
                  </Badge>
                )}
                {generated.cost > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <Coins className="h-3 w-3 mr-1" />
                    {generated.cost} Buzz
                  </Badge>
                )}
              </div>
            </div>
            <img
              src={generated.url}
              alt="Generated"
              className="w-full rounded-lg border border-border object-contain max-h-[600px]"
            />
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={onEditAndRegenerate} className="flex-1">
          <Edit className="h-4 w-4 mr-2" />
          Edit & Regenerate
        </Button>
        <Button variant="outline" onClick={onStartOver}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Start Over
        </Button>
      </div>

      {/* Generation details */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-2">Generation Details</h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Model:</span>{" "}
              <span className="font-mono">{generated.config.checkpoint.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Scheduler:</span>{" "}
              <span className="font-mono">{generated.config.params.scheduler}</span>
              <span className="text-muted-foreground ml-3">Steps:</span>{" "}
              <span className="font-mono">{generated.config.params.steps}</span>
              <span className="text-muted-foreground ml-3">CFG:</span>{" "}
              <span className="font-mono">{generated.config.params.cfgScale}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Size:</span>{" "}
              <span className="font-mono">
                {generated.config.params.width}x{generated.config.params.height}
              </span>
              <span className="text-muted-foreground ml-3">Clip Skip:</span>{" "}
              <span className="font-mono">{generated.config.params.clipSkip}</span>
            </div>
            {generated.config.loras.length > 0 && (
              <div>
                <span className="text-muted-foreground">LoRAs:</span>{" "}
                {generated.config.loras.map((l) => (
                  <Badge key={l.urn} variant="secondary" className="ml-1 text-xs">
                    {l.name} ({l.strength})
                  </Badge>
                ))}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Prompt:</span>
              <p className="font-mono text-xs mt-1 p-2 rounded bg-muted/50 whitespace-pre-wrap">
                {generated.config.prompt}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* History strip */}
      {history.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">History</h3>
              <span className="text-xs text-muted-foreground">
                ({history.length} generations)
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {history.map((img, i) => (
                <button
                  key={`${img.timestamp}-${i}`}
                  className={`flex-shrink-0 rounded-lg border-2 transition-colors ${
                    img.timestamp === generated.timestamp
                      ? "border-primary"
                      : "border-border hover:border-muted-foreground"
                  }`}
                  onClick={() => onSelectHistory(img)}
                >
                  <img
                    src={img.url}
                    alt={`Generation ${i + 1}`}
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
