"use client";

import type { SceneData } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SceneBuilderProps {
  scene: SceneData;
  onChange: (data: SceneData) => void;
}

export function SceneBuilder({ scene, onChange }: SceneBuilderProps) {
  function update(field: keyof SceneData, value: string | string[]) {
    onChange({ ...scene, [field]: value });
  }

  function handleTagsChange(value: string) {
    const tags = value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    update("additionalTags", tags);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scene Builder</CardTitle>
        <CardDescription>
          Define the environment and tone of your scene
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode Toggle */}
        <div className="flex items-center gap-4 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={scene.mode === "nsfw"}
              onCheckedChange={(checked) =>
                update("mode", checked ? "nsfw" : "sfw")
              }
            />
            <Label>Content Mode</Label>
          </div>
          <Badge variant={scene.mode === "nsfw" ? "destructive" : "secondary"}>
            {scene.mode.toUpperCase()}
          </Badge>
        </div>

        {/* Shared Fields */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="setting">Setting / Location</Label>
            <Textarea
              id="setting"
              placeholder="e.g. Luxury apartment in Camps Bay, Beach at sunset, Studio loft"
              value={scene.setting}
              onChange={(e) => update("setting", e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lighting">Lighting</Label>
            <Select
              value={scene.lighting}
              onValueChange={(v) => update("lighting", v)}
            >
              <SelectTrigger id="lighting">
                <SelectValue placeholder="Select lighting" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="natural">Natural</SelectItem>
                <SelectItem value="studio">Studio</SelectItem>
                <SelectItem value="candlelight">Candlelight</SelectItem>
                <SelectItem value="neon">Neon</SelectItem>
                <SelectItem value="golden hour">Golden Hour</SelectItem>
                <SelectItem value="dramatic shadows">
                  Dramatic Shadows
                </SelectItem>
                <SelectItem value="soft diffused">Soft Diffused</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mood">Mood</Label>
            <Select
              value={scene.mood}
              onValueChange={(v) => update("mood", v)}
            >
              <SelectTrigger id="mood">
                <SelectValue placeholder="Select mood" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="romantic">Romantic</SelectItem>
                <SelectItem value="intense">Intense</SelectItem>
                <SelectItem value="playful">Playful</SelectItem>
                <SelectItem value="mysterious">Mysterious</SelectItem>
                <SelectItem value="passionate">Passionate</SelectItem>
                <SelectItem value="tender">Tender</SelectItem>
                <SelectItem value="confident">Confident</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Mode-Specific Description */}
        {scene.mode === "sfw" ? (
          <div className="space-y-2">
            <Label htmlFor="sfwDesc">Scene Description (SFW)</Label>
            <Textarea
              id="sfwDesc"
              placeholder="Describe the tasteful, artistic scene..."
              value={scene.sfwDescription}
              onChange={(e) => update("sfwDescription", e.target.value)}
              rows={4}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="nsfwDesc">Scene Description (NSFW)</Label>
            <Textarea
              id="nsfwDesc"
              placeholder="Describe the intimate scene..."
              value={scene.nsfwDescription}
              onChange={(e) => update("nsfwDescription", e.target.value)}
              rows={4}
            />
          </div>
        )}

        {/* Additional Tags */}
        <div className="space-y-2">
          <Label htmlFor="tags">Additional Tags</Label>
          <Input
            id="tags"
            placeholder="e.g. cinematic, film grain, bokeh, depth of field"
            value={scene.additionalTags.join(", ")}
            onChange={(e) => handleTagsChange(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated style and quality tags
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
