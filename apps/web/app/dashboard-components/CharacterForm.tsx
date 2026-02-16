"use client";

import type { CharacterData } from "@no-safe-word/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CharacterFormProps {
  character: CharacterData;
  onChange: (data: CharacterData) => void;
}

export function CharacterForm({ character, onChange }: CharacterFormProps) {
  function update(field: keyof CharacterData, value: string) {
    onChange({ ...character, [field]: value });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Character Details</CardTitle>
        <CardDescription>
          Define the physical attributes of your character
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Character name (optional)"
              value={character.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select
              value={character.gender}
              onValueChange={(v) => update("gender", v)}
            >
              <SelectTrigger id="gender">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="non-binary">Non-binary</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="age">Age Range</Label>
            <Select
              value={character.age}
              onValueChange={(v) => update("age", v)}
            >
              <SelectTrigger id="age">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="young adult">Young Adult</SelectItem>
                <SelectItem value="mature">Mature</SelectItem>
                <SelectItem value="middle-aged">Middle-aged</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ethnicity">Ethnicity</Label>
            <Input
              id="ethnicity"
              placeholder="e.g. South African, Zulu, Afrikaans"
              value={character.ethnicity}
              onChange={(e) => update("ethnicity", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bodyType">Body Type</Label>
            <Input
              id="bodyType"
              placeholder="e.g. slim, athletic, curvy, muscular"
              value={character.bodyType}
              onChange={(e) => update("bodyType", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="skinTone">Skin Tone</Label>
            <Input
              id="skinTone"
              placeholder="e.g. dark brown, olive, fair"
              value={character.skinTone}
              onChange={(e) => update("skinTone", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="hairColor">Hair Color</Label>
            <Input
              id="hairColor"
              placeholder="e.g. black, brown, blonde"
              value={character.hairColor}
              onChange={(e) => update("hairColor", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="hairStyle">Hair Style</Label>
            <Input
              id="hairStyle"
              placeholder="e.g. long flowing, braided, dreadlocks"
              value={character.hairStyle}
              onChange={(e) => update("hairStyle", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="eyeColor">Eye Color</Label>
            <Input
              id="eyeColor"
              placeholder="e.g. brown, green, hazel"
              value={character.eyeColor}
              onChange={(e) => update("eyeColor", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expression">Expression</Label>
            <Input
              id="expression"
              placeholder="e.g. smiling, sultry, confident"
              value={character.expression}
              onChange={(e) => update("expression", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pose">Pose</Label>
            <Input
              id="pose"
              placeholder="e.g. standing, sitting, reclining"
              value={character.pose}
              onChange={(e) => update("pose", e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clothing">Clothing</Label>
            <Textarea
              id="clothing"
              placeholder="Describe the outfit in detail..."
              value={character.clothing}
              onChange={(e) => update("clothing", e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="features">Distinguishing Features</Label>
            <Textarea
              id="features"
              placeholder="Tattoos, piercings, scars, birthmarks..."
              value={character.distinguishingFeatures}
              onChange={(e) =>
                update("distinguishingFeatures", e.target.value)
              }
              rows={2}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
