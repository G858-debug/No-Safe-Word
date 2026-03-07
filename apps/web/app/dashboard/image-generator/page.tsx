"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageIcon, Loader2, BookOpen, ArrowRight, Sparkles } from "lucide-react";
import { LogoutButton } from "@/app/dashboard-components/LogoutButton";
import type { CharacterOption } from "@/app/api/image-generator/characters/route";
import type { DetectionResult } from "@/app/api/image-generator/detect-character/route";

const NO_CHARACTER_VALUE = "__none__";

export default function ImageGeneratorPage() {
  const [prompt, setPrompt] = useState("");
  const [enhancementEnabled, setEnhancementEnabled] = useState(true);

  // Post-enhancement state
  const [confirmationShown, setConfirmationShown] = useState(false);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string>(NO_CHARACTER_VALUE);

  // Characters list
  const [characters, setCharacters] = useState<CharacterOption[]>([]);

  // Loading states
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Result
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load characters on mount
  useEffect(() => {
    fetch("/api/image-generator/characters")
      .then((r) => r.json())
      .then((data) => setCharacters(data.characters || []))
      .catch(() => {/* non-fatal */});
  }, []);

  function handlePromptChange(val: string) {
    setPrompt(val);
    // Reset confirmation when the prompt is edited
    if (confirmationShown) {
      setConfirmationShown(false);
      setDetection(null);
      setSelectedCharId(NO_CHARACTER_VALUE);
    }
  }

  async function handlePrepare() {
    if (!prompt.trim() || isEnhancing || isGenerating) return;
    setError(null);

    if (!enhancementEnabled) {
      // Skip Claude calls — just show confirmation immediately
      setConfirmationShown(true);
      return;
    }

    setIsEnhancing(true);
    try {
      // Run enhancement + detection in parallel
      const [enhanceRes, detectRes] = await Promise.allSettled([
        fetch("/api/image-generator/enhance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, nsfw: true }),
        }).then((r) => r.json()),
        fetch("/api/image-generator/detect-character", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, characters }),
        }).then((r) => r.json()),
      ]);

      // Apply enhancement — degrade gracefully if it failed
      if (enhanceRes.status === "fulfilled" && enhanceRes.value?.enhancedPrompt) {
        setPrompt(enhanceRes.value.enhancedPrompt);
      }

      // Apply detection — degrade gracefully if it failed
      if (detectRes.status === "fulfilled" && !detectRes.value?.error) {
        const det: DetectionResult = detectRes.value;
        setDetection(det);

        // Pre-select the detected character if medium/high confidence
        if (
          det.detected_character &&
          (det.confidence === "high" || det.confidence === "medium")
        ) {
          const match = characters.find(
            (c) => c.name.toLowerCase() === det.detected_character!.toLowerCase()
          );
          if (match) setSelectedCharId(match.id);
        }
      }
    } catch {
      // Fully failed — proceed without enhancement
    } finally {
      setIsEnhancing(false);
      setConfirmationShown(true);
    }
  }

  async function handleGenerate() {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setImageBase64(null);

    const characterId =
      selectedCharId !== NO_CHARACTER_VALUE ? selectedCharId : undefined;

    try {
      const res = await fetch("/api/image-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, characterId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start generation");

      const { jobId } = data;

      // Poll for completion
      await new Promise<void>((resolve, reject) => {
        pollRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/image-generator/status/${jobId}`);
            const status = await statusRes.json();

            if (status.completed) {
              clearInterval(pollRef.current!);
              setImageBase64(status.imageBase64);
              resolve();
            } else if (status.error) {
              clearInterval(pollRef.current!);
              reject(new Error(status.error));
            }
          } catch (pollErr) {
            clearInterval(pollRef.current!);
            reject(pollErr);
          }
        }, 3000);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  const selectedChar = characters.find((c) => c.id === selectedCharId);
  const prepareDisabled = !prompt.trim() || isEnhancing || isGenerating;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-3xl px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">Image Generator</h1>
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard/stories"
                className="inline-flex items-center gap-1.5 rounded-md border border-muted px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Story Publisher
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <LogoutButton />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">
              Test image prompts with the Flux Kontext pipeline
            </p>
            <div className="flex items-center gap-2">
              <Switch
                id="enhancement-toggle"
                checked={enhancementEnabled}
                onCheckedChange={setEnhancementEnabled}
              />
              <Label
                htmlFor="enhancement-toggle"
                className="cursor-pointer text-sm text-muted-foreground"
              >
                Auto-enhance
              </Label>
            </div>
          </div>
        </header>

        {/* Image display area */}
        <div className="mb-6 flex aspect-square w-full max-w-[600px] mx-auto items-center justify-center rounded-xl border border-muted bg-muted/20 overflow-hidden">
          {imageBase64 ? (
            <img
              src={`data:image/png;base64,${imageBase64}`}
              alt="Generated image"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              {isGenerating ? (
                <>
                  <Loader2 className="h-12 w-12 animate-spin opacity-40" />
                  <span className="text-sm">Generating...</span>
                </>
              ) : (
                <>
                  <ImageIcon className="h-12 w-12 opacity-25" />
                  <span className="text-sm opacity-50">No image yet</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Prompt textarea */}
        <Textarea
          value={prompt}
          onChange={(e) => handlePromptChange(e.target.value)}
          placeholder="Describe your image..."
          rows={4}
          className="mb-1 resize-none"
          disabled={isEnhancing || isGenerating}
        />

        {/* Enhancement loading indicator */}
        {isEnhancing && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Enhancing prompt...
          </p>
        )}

        {/* Prepare / Enhance button */}
        {!confirmationShown && (
          <div className="mt-3 flex justify-end">
            <Button
              onClick={handlePrepare}
              disabled={prepareDisabled}
              size="lg"
              className="min-w-[140px]"
            >
              {isEnhancing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enhancing...
                </>
              ) : enhancementEnabled ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Enhance
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </div>
        )}

        {/* Confirmation panel */}
        {confirmationShown && (
          <div className="mt-4">
            <Separator className="mb-4" />

            {/* Character LoRA selection */}
            <div className="mb-4 space-y-2">
              <Label className="text-sm font-medium">Character LoRA</Label>
              <Select value={selectedCharId} onValueChange={setSelectedCharId} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue placeholder="No character / generic scene" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHARACTER_VALUE}>
                    No character / generic scene
                  </SelectItem>
                  {characters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        {c.name}
                        {c.hasLora ? (
                          <Badge variant="outline" className="ml-1 text-xs text-green-400 border-green-400/30 bg-green-400/10">
                            LoRA
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="ml-1 text-xs text-zinc-500 border-zinc-500/30">
                            no LoRA
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Claude detection note */}
              {detection?.detected_character &&
                (detection.confidence === "high" || detection.confidence === "medium") && (
                  <p className="text-xs text-muted-foreground">
                    Claude detected:{" "}
                    <span className="text-foreground">{detection.detected_character}</span>{" "}
                    <span className="text-zinc-500">
                      ({detection.confidence} confidence) — {detection.reasoning}
                    </span>
                  </p>
                )}

              {/* LoRA status note for selected character */}
              {selectedChar && !selectedChar.hasLora && (
                <p className="text-xs text-amber-500/80">
                  No trained LoRA for {selectedChar.name} — identity will not be injected
                </p>
              )}
            </div>

            {/* Generate Image button row */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  setConfirmationShown(false);
                  setDetection(null);
                  setSelectedCharId(NO_CHARACTER_VALUE);
                }}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:pointer-events-none"
                disabled={isGenerating}
              >
                ← Edit prompt
              </button>
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                size="lg"
                className="min-w-[160px]"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Image"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
