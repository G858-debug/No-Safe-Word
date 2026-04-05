"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Search, Trash2, Sparkles } from "lucide-react";
import type { GenerationConfig, LoraInfo } from "./ImageLab";

interface ResourceEditorProps {
  config: GenerationConfig;
  onChange: (config: GenerationConfig) => void;
  onGenerate: () => void;
  onOpenSearch: (type: "Checkpoint" | "LORA") => void;
  isGenerating: boolean;
}

const SCHEDULERS = [
  { value: "EulerA", label: "Euler A" },
  { value: "Euler", label: "Euler" },
  { value: "DPM2MKarras", label: "DPM++ 2M Karras" },
  { value: "DPMSDEKarras", label: "DPM++ SDE Karras" },
  { value: "DPM2SAKarras", label: "DPM++ 2S a Karras" },
  { value: "DDIM", label: "DDIM" },
  { value: "LCM", label: "LCM" },
  { value: "UniPC", label: "UniPC" },
  { value: "Heun", label: "Heun" },
  { value: "DEIS", label: "DEIS" },
];

const DIMENSIONS = [
  { value: "1024x1024", label: "1024 x 1024 (1:1)" },
  { value: "832x1216", label: "832 x 1216 (2:3 Portrait)" },
  { value: "1216x832", label: "1216 x 832 (3:2 Landscape)" },
  { value: "896x1152", label: "896 x 1152 (3:4 Portrait)" },
  { value: "1152x896", label: "1152 x 896 (4:3 Landscape)" },
  { value: "768x1344", label: "768 x 1344 (9:16 Portrait)" },
  { value: "1344x768", label: "1344 x 768 (16:9 Landscape)" },
];

export function ResourceEditor({
  config,
  onChange,
  onGenerate,
  onOpenSearch,
  isGenerating,
}: ResourceEditorProps) {
  const updateParam = <K extends keyof GenerationConfig["params"]>(
    key: K,
    value: GenerationConfig["params"][K]
  ) => {
    onChange({
      ...config,
      params: { ...config.params, [key]: value },
    });
  };

  const updateLora = (index: number, updates: Partial<LoraInfo>) => {
    const newLoras = [...config.loras];
    newLoras[index] = { ...newLoras[index], ...updates };
    onChange({ ...config, loras: newLoras });
  };

  const removeLora = (index: number) => {
    onChange({ ...config, loras: config.loras.filter((_, i) => i !== index) });
  };

  const currentDimension = `${config.params.width}x${config.params.height}`;

  return (
    <div className="space-y-4">
      {/* Prompts */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Positive Prompt
            </Label>
            <Textarea
              value={config.prompt}
              onChange={(e) => onChange({ ...config, prompt: e.target.value })}
              className="mt-1.5 min-h-[120px] font-mono text-sm"
              placeholder="booru-style tags..."
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Negative Prompt
            </Label>
            <Textarea
              value={config.negativePrompt}
              onChange={(e) =>
                onChange({ ...config, negativePrompt: e.target.value })
              }
              className="mt-1.5 min-h-[60px] font-mono text-sm"
              placeholder="negative tags..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Model & LoRAs */}
      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Checkpoint */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Checkpoint Model
            </Label>
            <div className="mt-1.5 flex items-center gap-3">
              {config.checkpoint.thumbnailUrl && (
                <img
                  src={config.checkpoint.thumbnailUrl}
                  alt=""
                  className="h-10 w-10 rounded border border-border object-cover"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{config.checkpoint.name}</p>
                <p className="text-xs text-muted-foreground truncate">{config.checkpoint.urn}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenSearch("Checkpoint")}
              >
                <Search className="h-3.5 w-3.5 mr-1" />
                Change
              </Button>
            </div>
          </div>

          {/* LoRAs */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                LoRAs
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenSearch("LORA")}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add LoRA
              </Button>
            </div>

            {config.loras.length === 0 && (
              <p className="text-sm text-muted-foreground mt-1.5">
                No LoRAs added. Click &quot;Add LoRA&quot; to search CivitAI.
              </p>
            )}

            <div className="mt-2 space-y-3">
              {config.loras.map((lora, i) => (
                <div
                  key={`${lora.urn}-${i}`}
                  className="flex items-center gap-3 rounded-md border border-border p-2"
                >
                  {lora.thumbnailUrl && (
                    <img
                      src={lora.thumbnailUrl}
                      alt=""
                      className="h-8 w-8 rounded border border-border object-cover"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{lora.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground w-8">
                        {lora.strength.toFixed(2)}
                      </span>
                      <Slider
                        value={[lora.strength]}
                        onValueChange={([v]) => updateLora(i, { strength: v })}
                        min={0}
                        max={1.5}
                        step={0.05}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLora(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generation Parameters */}
      <Card>
        <CardContent className="p-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-3 block">
            Parameters
          </Label>
          <div className="grid grid-cols-2 gap-4">
            {/* Steps */}
            <div>
              <Label className="text-xs">Steps: {config.params.steps}</Label>
              <Slider
                value={[config.params.steps]}
                onValueChange={([v]) => updateParam("steps", v)}
                min={10}
                max={50}
                step={1}
                className="mt-1.5"
              />
            </div>

            {/* CFG Scale */}
            <div>
              <Label className="text-xs">CFG Scale: {config.params.cfgScale}</Label>
              <Slider
                value={[config.params.cfgScale]}
                onValueChange={([v]) => updateParam("cfgScale", v)}
                min={1}
                max={15}
                step={0.5}
                className="mt-1.5"
              />
            </div>

            {/* Scheduler */}
            <div>
              <Label className="text-xs">Scheduler</Label>
              <Select
                value={config.params.scheduler}
                onValueChange={(v) => updateParam("scheduler", v)}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULERS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dimensions */}
            <div>
              <Label className="text-xs">Dimensions</Label>
              <Select
                value={currentDimension}
                onValueChange={(v) => {
                  const [w, h] = v.split("x").map(Number);
                  onChange({
                    ...config,
                    params: { ...config.params, width: w, height: h },
                  });
                }}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMENSIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Clip Skip */}
            <div>
              <Label className="text-xs">Clip Skip</Label>
              <Select
                value={String(config.params.clipSkip)}
                onValueChange={(v) => updateParam("clipSkip", Number(v))}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Seed */}
            <div>
              <Label className="text-xs">Seed (-1 for random)</Label>
              <Input
                type="number"
                value={config.params.seed}
                onChange={(e) => updateParam("seed", Number(e.target.value))}
                className="mt-1.5"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generate Button */}
      <Button
        size="lg"
        className="w-full"
        onClick={onGenerate}
        disabled={isGenerating || !config.prompt.trim()}
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Generating on CivitAI...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-2" />
            Generate Image
          </>
        )}
      </Button>
    </div>
  );
}
