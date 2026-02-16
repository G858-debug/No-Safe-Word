"use client";

import { useState, useCallback } from "react";
import type {
  CharacterData,
  SceneData,
  GenerationSettings,
  GeneratedImage,
} from "@no-safe-word/shared";
import {
  DEFAULT_SETTINGS,
  DEFAULT_CHARACTER,
  DEFAULT_SCENE,
} from "@no-safe-word/shared";
import { buildPrompt, buildNegativePrompt, needsDarkSkinBiasCorrection } from "@no-safe-word/image-gen";

export function useGeneration() {
  const [character, setCharacter] = useState<CharacterData>(DEFAULT_CHARACTER);
  const [scene, setScene] = useState<SceneData>(DEFAULT_SCENE);
  const [settings, setSettings] =
    useState<GenerationSettings>(DEFAULT_SETTINGS);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollJob = useCallback(async (jobId: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    const poll = async () => {
      attempts++;
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) throw new Error("Failed to fetch job status");
        const job = await res.json();

        if (job.completed && job.imageUrl) {
          setImages((prev) =>
            prev.map((img) =>
              img.jobId === jobId
                ? {
                    ...img,
                    status: "completed" as const,
                    blobUrl: job.imageUrl,
                    blobUrlExpiration: job.imageUrlExpiration ?? "",
                  }
                : img
            )
          );
          return;
        }

        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
        } else {
          setImages((prev) =>
            prev.map((img) =>
              img.jobId === jobId
                ? { ...img, status: "failed" as const }
                : img
            )
          );
        }
      } catch {
        setImages((prev) =>
          prev.map((img) =>
            img.jobId === jobId
              ? { ...img, status: "failed" as const }
              : img
          )
        );
      }
    };

    poll();
  }, []);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    const prompt = buildPrompt(character, scene);
    const negativePrompt = buildNegativePrompt(scene, {
      darkSkinBiasCorrection: needsDarkSkinBiasCorrection(character),
    });

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character, scene, settings }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(
          errData?.error ?? `Generation request failed (${res.status})`
        );
      }

      const data = await res.json();

      const pendingImages: GeneratedImage[] = (data.jobs ?? []).map(
        (job: { jobId: string }) => ({
          id: job.jobId,
          jobId: job.jobId,
          blobUrl: "",
          blobUrlExpiration: "",
          prompt,
          negativePrompt,
          settings: { ...settings },
          createdAt: new Date().toISOString(),
          status: "pending" as const,
        })
      );

      setImages((prev) => [...pendingImages, ...prev]);

      for (const img of pendingImages) {
        pollJob(img.jobId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [character, scene, settings, pollJob]);

  const clearImages = useCallback(() => setImages([]), []);
  const removeImage = useCallback(
    (id: string) => setImages((prev) => prev.filter((img) => img.id !== id)),
    []
  );

  return {
    character,
    scene,
    settings,
    images,
    isGenerating,
    error,
    setCharacter,
    setScene,
    setSettings,
    generate,
    clearImages,
    removeImage,
  };
}
