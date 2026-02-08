"use client";

import type { GenerationSettings } from "@/lib/types";
import {
  ASPECT_RATIOS,
  MODEL_PRESETS,
  SCHEDULERS,
} from "@/lib/constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Dices, HelpCircle } from "lucide-react";

interface SettingsPanelProps {
  settings: GenerationSettings;
  onChange: (data: GenerationSettings) => void;
}

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="ml-1 inline h-3.5 w-3.5 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  function update(field: keyof GenerationSettings, value: string | number) {
    onChange({ ...settings, [field]: value });
  }

  function handleAspectRatioChange(label: string) {
    const ratio = ASPECT_RATIOS.find((r) => r.label === label);
    if (ratio) {
      onChange({ ...settings, width: ratio.width, height: ratio.height });
    }
  }

  const currentRatio = ASPECT_RATIOS.find(
    (r) => r.width === settings.width && r.height === settings.height
  );

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle>Generation Settings</CardTitle>
          <CardDescription>
            Configure model and generation parameters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Model Selection */}
          <div className="space-y-2">
            <Label>
              Model
              <HelpTip text="The AI model used for image generation. Different models produce different styles." />
            </Label>
            <Select
              value={settings.modelUrn}
              onValueChange={(v) => update("modelUrn", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_PRESETS.map((model) => (
                  <SelectItem key={model.urn} value={model.urn}>
                    {model.name} ({model.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {MODEL_PRESETS.find((m) => m.urn === settings.modelUrn)
                ?.description ?? ""}
            </p>
          </div>

          {/* Aspect Ratio */}
          <div className="space-y-2">
            <Label>Resolution / Aspect Ratio</Label>
            <Select
              value={currentRatio?.label ?? "custom"}
              onValueChange={handleAspectRatioChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASPECT_RATIOS.map((ratio) => (
                  <SelectItem key={ratio.label} value={ratio.label}>
                    {ratio.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Sampling Steps */}
            <div className="space-y-2">
              <Label>
                Steps: {settings.steps}
                <HelpTip text="Number of denoising steps. More steps generally means higher quality but slower generation." />
              </Label>
              <Slider
                value={[settings.steps]}
                onValueChange={([v]) => update("steps", v)}
                min={1}
                max={50}
                step={1}
              />
            </div>

            {/* CFG Scale */}
            <div className="space-y-2">
              <Label>
                CFG Scale: {settings.cfgScale}
                <HelpTip text="Controls how closely the image follows the prompt. Higher values = more literal, lower = more creative." />
              </Label>
              <Slider
                value={[settings.cfgScale]}
                onValueChange={([v]) => update("cfgScale", v)}
                min={1}
                max={30}
                step={0.5}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Scheduler */}
            <div className="space-y-2">
              <Label>
                Scheduler
                <HelpTip text="The sampling algorithm used during generation. Each produces slightly different results." />
              </Label>
              <Select
                value={settings.scheduler}
                onValueChange={(v) => update("scheduler", v)}
              >
                <SelectTrigger>
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

            {/* CLIP Skip */}
            <div className="space-y-2">
              <Label>
                CLIP Skip
                <HelpTip text="Skips layers in the text encoder. Most models work best with 1 or 2." />
              </Label>
              <Select
                value={String(settings.clipSkip)}
                onValueChange={(v) => update("clipSkip", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Seed */}
            <div className="space-y-2">
              <Label>
                Seed
                <HelpTip text="Use -1 for random. Set a specific seed to reproduce results." />
              </Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={settings.seed}
                  onChange={(e) => update("seed", Number(e.target.value))}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => update("seed", -1)}
                  title="Random seed"
                >
                  <Dices className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Batch Size */}
            <div className="space-y-2">
              <Label>
                Batch Size
                <HelpTip text="Number of images to generate per request." />
              </Label>
              <Select
                value={String(settings.batchSize)}
                onValueChange={(v) => update("batchSize", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 image</SelectItem>
                  <SelectItem value="2">2 images</SelectItem>
                  <SelectItem value="3">3 images</SelectItem>
                  <SelectItem value="4">4 images</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
