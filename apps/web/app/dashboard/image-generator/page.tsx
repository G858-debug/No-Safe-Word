"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageIcon, Loader2, BookOpen, ArrowRight } from "lucide-react";
import { LogoutButton } from "@/app/dashboard-components/LogoutButton";

export default function ImageGeneratorPage() {
  const [prompt, setPrompt] = useState("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleGenerate() {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setImageBase64(null);

    try {
      const res = await fetch("/api/image-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
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
            // else still in queue/progress — keep polling
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
          <p className="text-muted-foreground">
            Test image prompts with the Flux Kontext pipeline
          </p>
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
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your image..."
          rows={4}
          className="mb-3 resize-none"
          disabled={isGenerating}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
          }}
        />

        {/* Generate button */}
        <div className="flex justify-end">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            size="lg"
            className="min-w-[140px]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </div>

        {/* Error display */}
        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
