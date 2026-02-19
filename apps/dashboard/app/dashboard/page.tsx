"use client";

import { useGeneration } from "@/hooks/use-generation";
import { CharacterForm } from "@/app/components/CharacterForm";
import { SceneBuilder } from "@/app/components/SceneBuilder";
import { SettingsPanel } from "@/app/components/SettingsPanel";
import { ImageGallery } from "@/app/components/ImageGallery";
import { buildPrompt, buildNegativePrompt, needsAfricanFeatureCorrection } from "@no-safe-word/image-gen";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Sparkles, BookOpen, ArrowRight } from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "@/app/components/LogoutButton";

export default function DashboardPage() {
  const {
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
  } = useGeneration();

  const prompt = buildPrompt(character, scene);
  const negativePrompt = buildNegativePrompt(scene, {
    africanFeatureCorrection: needsAfricanFeatureCorrection(character),
  });

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">No Safe Word</h1>
            <p className="text-muted-foreground">
              AI Image Generation Dashboard
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/stories">
              <Button variant="secondary" className="gap-2">
                <BookOpen className="h-4 w-4" />
                Story Publisher
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <LogoutButton />
          </div>
        </header>

        {/* Input Forms via Tabs */}
        <Tabs defaultValue="character" className="mb-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="character">Character</TabsTrigger>
            <TabsTrigger value="scene">Scene</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="character">
            <CharacterForm character={character} onChange={setCharacter} />
          </TabsContent>
          <TabsContent value="scene">
            <SceneBuilder scene={scene} onChange={setScene} />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsPanel settings={settings} onChange={setSettings} />
          </TabsContent>
        </Tabs>

        {/* Prompt Preview */}
        <Card className="mb-6">
          <CardContent className="space-y-3 pt-6">
            <div>
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                Prompt
              </p>
              <p className="rounded-md bg-muted p-3 font-mono text-sm">
                {prompt || "Configure character and scene to preview prompt..."}
              </p>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                Negative Prompt
              </p>
              <p className="rounded-md bg-muted p-3 font-mono text-sm">
                {negativePrompt}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Generate Button */}
        <Button
          onClick={generate}
          disabled={isGenerating}
          size="lg"
          className="mb-8 h-14 w-full text-lg"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-5 w-5" />
              Generate Images
            </>
          )}
        </Button>

        {/* Error Display */}
        {error && (
          <div className="mb-6 rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <Separator className="mb-8" />

        {/* Image Gallery */}
        <ImageGallery
          images={images}
          isGenerating={isGenerating}
          onRemove={removeImage}
          onClear={clearImages}
        />
      </div>
    </div>
  );
}
