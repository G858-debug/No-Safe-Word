"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Upload,
  Loader2,
  BookOpen,
  Users,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import {
  validateImportPayload,
  type StoryImportPayload,
} from "@/lib/story-types";

interface ImportResultData {
  series_id: string;
  slug: string;
  posts_created: number;
  characters_linked: number;
  image_prompts_queued: number;
}

export default function ImportPage() {
  const router = useRouter();
  const [jsonInput, setJsonInput] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validPayload, setValidPayload] = useState<StoryImportPayload | null>(
    null
  );
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultData | null>(
    null
  );
  const [importError, setImportError] = useState<string | null>(null);

  function handleValidate() {
    setValidationErrors([]);
    setValidPayload(null);
    setImportResult(null);
    setImportError(null);

    // Try to parse JSON first
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonInput);
    } catch {
      setValidationErrors(["Invalid JSON — check your syntax"]);
      return;
    }

    const result = validateImportPayload(parsed);
    if (!result.valid) {
      setValidationErrors(result.errors);
      return;
    }

    setValidPayload(result.payload);
  }

  async function handleImport() {
    if (!validPayload) return;

    setImporting(true);
    setImportError(null);

    try {
      const res = await fetch("/api/stories/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      });

      const data = await res.json();

      if (!res.ok) {
        setImportError(data.details || data.error || "Import failed");
        return;
      }

      setImportResult(data);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Import failed"
      );
    } finally {
      setImporting(false);
    }
  }

  // Count total image prompts from the payload for preview
  function countImagePrompts(payload: StoryImportPayload): number {
    return payload.posts.reduce((total, post) => {
      return (
        total +
        (post.images.facebook_sfw?.length || 0) +
        (post.images.website_nsfw_paired?.length || 0) +
        (post.images.website_only?.length || 0)
      );
    }, 0);
  }

  return (
    <div>
      {/* Back link */}
      <Link
        href="/dashboard/stories"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to stories
      </Link>

      {/* Success state — import complete */}
      {importResult && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              Story Imported Successfully
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md bg-muted p-3 text-center">
                <p className="text-2xl font-bold">{importResult.posts_created}</p>
                <p className="text-xs text-muted-foreground">Posts</p>
              </div>
              <div className="rounded-md bg-muted p-3 text-center">
                <p className="text-2xl font-bold">
                  {importResult.characters_linked}
                </p>
                <p className="text-xs text-muted-foreground">Characters</p>
              </div>
              <div className="rounded-md bg-muted p-3 text-center">
                <p className="text-2xl font-bold">
                  {importResult.image_prompts_queued}
                </p>
                <p className="text-xs text-muted-foreground">Image Prompts</p>
              </div>
              <div className="rounded-md bg-muted p-3 text-center">
                <p className="truncate text-sm font-mono font-bold">
                  {importResult.slug}
                </p>
                <p className="text-xs text-muted-foreground">Slug</p>
              </div>
            </div>

            <Button
              onClick={() =>
                router.push(`/dashboard/stories/${importResult.series_id}`)
              }
              className="w-full"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Go to Story
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Input state — not yet imported */}
      {!importResult && (
        <div className="space-y-4">
          {/* JSON Input */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Paste Story JSON</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  // Clear validation state on edit
                  setValidPayload(null);
                  setValidationErrors([]);
                  setImportError(null);
                }}
                placeholder='{"series": { "title": "...", ... }, "characters": [...], "posts": [...]}'
                className="min-h-[300px] font-mono text-sm"
              />
              <div className="mt-4 flex gap-3">
                <Button
                  variant="secondary"
                  onClick={handleValidate}
                  disabled={!jsonInput.trim()}
                >
                  Validate
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!validPayload || importing}
                >
                  {importing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Import
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-destructive">
                  <XCircle className="h-4 w-4" />
                  Validation Failed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {validationErrors.map((err, i) => (
                    <li
                      key={i}
                      className="text-sm text-destructive-foreground"
                    >
                      &bull; {err}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Validation success preview */}
          {validPayload && (
            <Card className="border-green-500/30 bg-green-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Validation Passed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-lg font-semibold">
                      {validPayload.series.title}
                    </p>
                    {validPayload.series.description && (
                      <p className="text-sm text-muted-foreground">
                        {validPayload.series.description}
                      </p>
                    )}
                    {validPayload.series.hashtag && (
                      <Badge variant="outline" className="mt-1">
                        {validPayload.series.hashtag}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5" />
                      {validPayload.posts.length} posts
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {validPayload.characters.length} characters
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {countImagePrompts(validPayload)} image prompts
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Import error */}
          {importError && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="pt-6">
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <XCircle className="h-4 w-4 shrink-0" />
                  {importError}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
