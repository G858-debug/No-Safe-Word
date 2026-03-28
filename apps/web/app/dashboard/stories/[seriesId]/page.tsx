"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  Users,
  Image as ImageIcon,
  Send,
  Hash,
  FileText,
  ArrowLeft,
  Zap,
} from "lucide-react";
import CharacterApproval, {
  type CharacterFromAPI,
} from "./components/CharacterApproval";
import ImageGeneration from "./components/ImageGeneration";
import PublishPanel from "./components/PublishPanel";
import type {
  StorySeriesRow,
  StoryPostRow,
  ImageEngine,
} from "@no-safe-word/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeriesData {
  series: StorySeriesRow;
  posts: (StoryPostRow & {
    story_image_prompts: {
      id: string;
      image_type: string;
      pairs_with: string | null;
      position: number;
      position_after_word: number | null;
      character_name: string | null;
      character_id: string | null;
      prompt: string;
      image_id: string | null;
      status: string;
    }[];
  })[];
  characters: CharacterFromAPI[];
  image_urls: Record<string, string>;
  image_prompt_counts: {
    total: number;
    pending: number;
    generating: number;
    generated: number;
    approved: number;
    failed: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  },
  characters_pending: {
    label: "Characters Pending",
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  },
  images_pending: {
    label: "Images Pending",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  review: {
    label: "In Review",
    className: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  published: {
    label: "Published",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  archived: {
    label: "Archived",
    className: "bg-zinc-500/20 text-zinc-500 border-zinc-500/30",
  },
};

const POST_STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  },
  images_pending: {
    label: "Images Pending",
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  },
  images_approved: {
    label: "Images Done",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  ready: {
    label: "Ready",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  published: {
    label: "Published",
    className: "bg-green-500/20 text-green-300 border-green-500/30",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SeriesDetailPage() {
  const params = useParams();
  const router = useRouter();
  const seriesId = params.seriesId as string;

  const [data, setData] = useState<SeriesData | null>(null);
  const [characters, setCharacters] = useState<CharacterFromAPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch series data + characters
  useEffect(() => {
    if (!seriesId) return;

    async function fetchData() {
      try {
        const [seriesRes, charsRes] = await Promise.all([
          fetch(`/api/stories/${seriesId}`),
          fetch(`/api/stories/${seriesId}/characters`),
        ]);

        if (!seriesRes.ok) throw new Error("Failed to load series");

        const seriesData = await seriesRes.json();
        setData(seriesData);

        if (charsRes.ok) {
          const charsData = await charsRes.json();
          setCharacters(charsData.characters || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load series");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [seriesId]);

  // LoRA readiness state for all characters
  const [loraStatus, setLoraStatus] = useState<Record<string, { name: string; deployed: boolean }>>({});
  const [loraCheckDone, setLoraCheckDone] = useState(false);

  // Check LoRA deployment status for all characters
  useEffect(() => {
    if (characters.length === 0) return;

    async function checkLoras() {
      const statuses: Record<string, { name: string; deployed: boolean }> = {};
      for (const ch of characters) {
        try {
          const res = await fetch(`/api/stories/characters/${ch.id}/lora-progress`);
          if (res.ok) {
            const data = await res.json();
            statuses[ch.id] = {
              name: ch.characters.name,
              deployed: data?.status === "deployed",
            };
          } else {
            statuses[ch.id] = { name: ch.characters.name, deployed: false };
          }
        } catch {
          statuses[ch.id] = { name: ch.characters.name, deployed: false };
        }
      }
      setLoraStatus(statuses);
      setLoraCheckDone(true);
    }

    checkLoras();
  }, [characters]);

  // Derived state
  const allCharsApproved =
    characters.length > 0 && characters.every((c) => c.approved && c.approved_fullbody);
  const allLorasDeployed =
    loraCheckDone && characters.length > 0 && characters.every((c) => loraStatus[c.id]?.deployed);
  const allReadyForImages = allCharsApproved && allLorasDeployed;

  // Engine update handler
  async function handleEngineChange(engine: ImageEngine) {
    try {
      const res = await fetch(`/api/stories/${seriesId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_engine: engine }),
      });
      if (!res.ok) throw new Error("Failed to update engine");
      setData((prev) =>
        prev ? { ...prev, series: { ...prev.series, image_engine: engine } } : prev
      );
    } catch (err) {
      console.error("Engine update failed:", err);
    }
  }

  // ------- Loading state -------
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-32" />
        </div>
        <Skeleton className="h-10 w-96" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  // ------- Error state -------
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/dashboard/stories")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Stories
        </Button>
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          {error || "Series not found"}
        </div>
      </div>
    );
  }

  const { series, posts, image_prompt_counts: imgCounts } = data;
  const statusConfig = STATUS_CONFIG[series.status] || STATUS_CONFIG.draft;

  return (
    <div className="space-y-6">
      {/* Back link + title */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2 text-muted-foreground"
          onClick={() => router.push("/dashboard/stories")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          All Stories
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {series.title}
            </h2>
            {series.description && (
              <p className="mt-1 text-muted-foreground">
                {series.description}
              </p>
            )}
          </div>
          <Badge variant="outline" className={statusConfig.className}>
            {statusConfig.label}
          </Badge>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{posts.length}</p>
              <p className="text-xs text-muted-foreground">Posts</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Users className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{characters.length}</p>
              <p className="text-xs text-muted-foreground">Characters</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">
                {imgCounts.approved}/{imgCounts.total}
              </p>
              <p className="text-xs text-muted-foreground">Images Approved</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Hash className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium truncate">
                {series.hashtag || "—"}
              </p>
              <p className="text-xs text-muted-foreground">Hashtag</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="gap-1.5">
            <FileText className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="characters" className="gap-1.5">
            <Users className="h-4 w-4" />
            Characters
          </TabsTrigger>
          <TabsTrigger value="images" className="gap-1.5">
            <ImageIcon className="h-4 w-4" />
            Images
          </TabsTrigger>
          <TabsTrigger value="publish" className="gap-1.5">
            <Send className="h-4 w-4" />
            Publish
          </TabsTrigger>
        </TabsList>

        {/* ====================== OVERVIEW TAB ====================== */}
        <div className={activeTab === "overview" ? "mt-6" : "hidden"}>
          <div className="space-y-6">
            {/* Series metadata */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Series Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="mt-0.5 font-medium">{statusConfig.label}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Total Parts</dt>
                    <dd className="mt-0.5 font-medium">
                      {series.total_parts}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Hashtag</dt>
                    <dd className="mt-0.5 font-medium">
                      {series.hashtag || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="mt-0.5 font-medium">
                      {new Date(series.created_at).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>

                {/* Image Engine selector */}
                <div className="pt-3 border-t">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-sm text-muted-foreground mb-1 block">
                        Image Engine
                      </label>
                      <Select
                        value={series.image_engine || "sdxl"}
                        onValueChange={(v) => handleEngineChange(v as ImageEngine)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sdxl">SDXL (Current Pipeline)</SelectItem>
                          <SelectItem value="kontext">
                            <span className="flex items-center gap-1.5">
                              Flux Kontext [dev]
                              <Zap className="h-3.5 w-3.5 text-yellow-500" />
                            </span>
                          </SelectItem>
                          <SelectItem value="nb2_uncanny">
                            <span className="flex items-center gap-1.5">
                              NB2 + UnCanny V2
                              <Zap className="h-3.5 w-3.5 text-purple-500" />
                            </span>
                          </SelectItem>
                          <SelectItem value="flux_pulid">
                            <span className="flex items-center gap-1.5">
                              Flux Krea + PuLID V3
                              <Zap className="h-3.5 w-3.5 text-green-500" />
                            </span>
                          </SelectItem>
                          <SelectItem value="flux2_pro">
                            <span className="flex items-center gap-1.5">
                              Flux 2 Pro (Replicate)
                              <Zap className="h-3.5 w-3.5 text-blue-500" />
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="flex-1 text-xs text-muted-foreground mt-5">
                      {series.image_engine === "nb2_uncanny"
                        ? "NB2 scene gen + Florence-2/SAM2 masking + UnCanny inpainting"
                        : series.image_engine === "flux_pulid"
                        ? "No LoRA training — PuLID face consistency + text body prompts"
                        : series.image_engine === "flux2_pro"
                        ? "Flux 2 Pro via Replicate — multi-reference character consistency, 4MP output, no LoRAs needed"
                        : "Better prompt adherence, native character consistency"}
                    </p>
                  </div>
                  {series.image_engine === "nb2_uncanny" && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="text-sm text-muted-foreground mb-1 block">
                          SFW Inpaint Prompt (body enhancement)
                        </label>
                        <textarea
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
                          placeholder="voluptuous woman, very large natural breasts, wide hips, huge round butt, narrow waist, fitted clothing showing curves"
                          defaultValue={series.sfw_inpaint_prompt || ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (series.sfw_inpaint_prompt || "")) {
                              fetch(`/api/stories/${seriesId}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ sfw_inpaint_prompt: val || null }),
                              }).then(() => {
                                setData((prev) =>
                                  prev ? { ...prev, series: { ...prev.series, sfw_inpaint_prompt: val || null } } : prev
                                );
                              });
                            }
                          }}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Enhances female body shape through clothing in SFW images
                        </p>
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground mb-1 block">
                          NSFW Inpaint Prompt (clothing removal)
                        </label>
                        <textarea
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
                          placeholder="bare skin, natural body, photorealistic skin texture"
                          defaultValue={series.inpaint_prompt || ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (series.inpaint_prompt || "")) {
                              fetch(`/api/stories/${seriesId}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ inpaint_prompt: val || null }),
                              }).then(() => {
                                setData((prev) =>
                                  prev ? { ...prev, series: { ...prev.series, inpaint_prompt: val || null } } : prev
                                );
                              });
                            }
                          }}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Describes what replaces masked clothing in NSFW paired images
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Progress summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Character approval progress */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-muted-foreground">
                      Character Approval
                    </span>
                    <span className="font-medium">
                      {characters.filter((c) => c.approved).length} /{" "}
                      {characters.length}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-green-500 transition-all"
                      style={{
                        width: `${characters.length > 0 ? (characters.filter((c) => c.approved).length / characters.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Image generation progress */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-muted-foreground">
                      Image Generation
                    </span>
                    <span className="font-medium">
                      {imgCounts.approved} / {imgCounts.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-blue-500 transition-all"
                      style={{
                        width: `${imgCounts.total > 0 ? (imgCounts.approved / imgCounts.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Posts list */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Posts ({posts.length})
                </CardTitle>
                <CardDescription>
                  All parts in this series
                </CardDescription>
              </CardHeader>
              <CardContent>
                {posts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No posts yet.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {posts.map((post) => {
                      const postStatus =
                        POST_STATUS_CONFIG[post.status] ||
                        POST_STATUS_CONFIG.draft;
                      const promptCount =
                        post.story_image_prompts?.length || 0;

                      return (
                        <div
                          key={post.id}
                          className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                              {post.part_number}
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium truncate text-sm">
                                {post.title}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {promptCount} image{promptCount !== 1 ? "s" : ""}
                              </p>
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={`shrink-0 text-xs ${postStatus.className}`}
                          >
                            {postStatus.label}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ===================== CHARACTERS TAB ===================== */}
        <div className={activeTab === "characters" ? "mt-6" : "hidden"}>
          <CharacterApproval
            seriesId={seriesId}
            characters={characters}
            imageEngine={series.image_engine}
            onProceedToImages={() => setActiveTab("images")}
            onCharacterApproved={(storyCharId, imageUrl, imageId, type) => {
              setCharacters((prev) =>
                prev.map((c) =>
                  c.id === storyCharId
                    ? type === "fullBody"
                      ? { ...c, approved_fullbody: true, approved_fullbody_image_url: imageUrl, approved_fullbody_image_id: imageId }
                      : { ...c, approved: true, approved_image_url: imageUrl, approved_image_id: imageId }
                    : c
                )
              );
            }}
          />
        </div>

        {/* ====================== IMAGES TAB ======================== */}
        <div className={activeTab === "images" ? "mt-6" : "hidden"}>
          <ImageGeneration
            seriesId={seriesId}
            posts={posts}
            imageUrls={data.image_urls}
            allCharactersApproved={allReadyForImages}
            imageEngine={series.image_engine}
          />
          {allCharsApproved && !allLorasDeployed && loraCheckDone && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 mt-4">
              <p className="text-sm font-medium text-amber-400 mb-2">
                LoRA training required before generating images
              </p>
              <ul className="text-sm text-amber-400/80 space-y-1">
                {characters
                  .filter((c) => !loraStatus[c.id]?.deployed)
                  .map((c) => (
                    <li key={c.id}>
                      {c.characters.name} — LoRA not deployed
                    </li>
                  ))}
              </ul>
              <button
                onClick={() => setActiveTab("characters")}
                className="mt-3 text-sm text-amber-400 underline hover:text-amber-300"
              >
                Go to Character Approval
              </button>
            </div>
          )}
        </div>

        {/* ====================== PUBLISH TAB ======================= */}
        <div className={activeTab === "publish" ? "mt-6" : "hidden"}>
          <PublishPanel
            seriesId={seriesId}
            posts={posts}
            imageUrls={data.image_urls}
          />
        </div>
      </Tabs>
    </div>
  );
}
