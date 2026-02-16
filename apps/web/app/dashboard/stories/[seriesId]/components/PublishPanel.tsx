"use client";

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Send,
  Copy,
  Download,
  Check,
  Loader2,
  Calendar,
  ChevronDown,
  ChevronRight,
  Pencil,
  X,
  AlertCircle,
  Globe,
  Eye,
  CheckCircle2,
  Play,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImagePromptData {
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
}

interface PostData {
  id: string;
  series_id: string;
  part_number: number;
  title: string;
  facebook_content: string;
  facebook_teaser: string | null;
  facebook_comment: string | null;
  website_content: string;
  hashtags: string[];
  status: string;
  facebook_post_id: string | null;
  published_at: string | null;
  scheduled_for: string | null;
  story_image_prompts: ImagePromptData[];
}

interface PublishPanelProps {
  seriesId: string;
  posts: PostData[];
  imageUrls: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POST_STATUS_CONFIG: Record<string, { label: string; className: string }> =
  {
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

export default function PublishPanel({
  seriesId,
  posts: initialPosts,
  imageUrls,
}: PublishPanelProps) {
  const [posts, setPosts] = useState(initialPosts);
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(
    new Set(initialPosts.length > 0 ? [initialPosts[0].id] : [])
  );

  // Editing state
  const [editingField, setEditingField] = useState<{
    postId: string;
    field: "facebook_content" | "website_content";
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Publish state
  const [publishing, setPublishing] = useState<string | null>(null);
  const [publishAllRunning, setPublishAllRunning] = useState(false);
  const [publishProgress, setPublishProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Clipboard state
  const [copied, setCopied] = useState<string | null>(null);

  // Schedule state
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleStartDate, setScheduleStartDate] = useState("");
  const [scheduleInterval, setScheduleInterval] = useState(3);
  const [scheduleTime, setScheduleTime] = useState("19:30");
  const [scheduling, setScheduling] = useState(false);

  // Feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const statusSummary = useMemo(() => {
    const total = posts.length;
    const published = posts.filter((p) => p.status === "published").length;
    const scheduled = posts.filter((p) => p.status === "scheduled").length;
    return { total, published, scheduled };
  }, [posts]);

  const allImagesApproved = useMemo(() => {
    return posts.every((post) =>
      post.story_image_prompts.every((ip) => ip.status === "approved")
    );
  }, [posts]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getPostSfwImage = useCallback(
    (post: PostData): string | null => {
      const sfwPrompt = post.story_image_prompts.find(
        (ip) =>
          ip.image_type === "facebook_sfw" &&
          ip.status === "approved" &&
          ip.image_id
      );
      return sfwPrompt?.image_id ? imageUrls[sfwPrompt.image_id] || null : null;
    },
    [imageUrls]
  );

  const getWebsiteImages = useCallback(
    (
      post: PostData
    ): Array<{ url: string; afterWord: number; alt: string }> => {
      const images: Array<{
        url: string;
        afterWord: number;
        alt: string;
      }> = [];

      for (const ip of post.story_image_prompts) {
        if (ip.status !== "approved" || !ip.image_id) continue;
        const url = imageUrls[ip.image_id];
        if (!url) continue;

        if (
          (ip.image_type === "website_only" ||
            ip.image_type === "website_nsfw_paired") &&
          ip.position_after_word != null
        ) {
          images.push({
            url,
            afterWord: ip.position_after_word,
            alt: ip.character_name || "Story illustration",
          });
        }
      }

      return images.sort((a, b) => a.afterWord - b.afterWord);
    },
    [imageUrls]
  );

  const postImagesReady = useCallback((post: PostData): boolean => {
    return post.story_image_prompts.every((ip) => ip.status === "approved");
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const togglePost = useCallback((postId: string) => {
    setExpandedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const startEditing = useCallback(
    (postId: string, field: "facebook_content" | "website_content") => {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      setEditingField({ postId, field });
      setEditValue(post[field]);
    },
    [posts]
  );

  const cancelEditing = useCallback(() => {
    setEditingField(null);
    setEditValue("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingField) return;
    setSaving(true);
    setActionError(null);

    try {
      const res = await fetch(
        `/api/stories/posts/${editingField.postId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [editingField.field]: editValue }),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }

      setPosts((prev) =>
        prev.map((p) =>
          p.id === editingField.postId
            ? { ...p, [editingField.field]: editValue }
            : p
        )
      );
      setEditingField(null);
      setEditValue("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [editingField, editValue]);

  const publishPost = useCallback(async (postId: string) => {
    setPublishing(postId);
    setActionError(null);

    try {
      const res = await fetch(`/api/stories/publish/${postId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: ["facebook"] }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Publish failed");
      }

      const data = await res.json();
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                status: "published",
                facebook_post_id: data.facebook_post_id,
                published_at: data.published_at,
              }
            : p
        )
      );

      setActionSuccess("Post published successfully!");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(null);
    }
  }, []);

  const publishAll = useCallback(async () => {
    const unpublished = posts.filter((p) => p.status !== "published");
    if (unpublished.length === 0) return;

    setPublishAllRunning(true);
    setPublishProgress({ current: 0, total: unpublished.length });
    setActionError(null);

    for (let i = 0; i < unpublished.length; i++) {
      setPublishProgress({ current: i + 1, total: unpublished.length });

      try {
        const res = await fetch(
          `/api/stories/publish/${unpublished[i].id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platforms: ["facebook"] }),
          }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(
            `Part ${unpublished[i].part_number}: ${err.error || "failed"}`
          );
        }

        const data = await res.json();
        setPosts((prev) =>
          prev.map((p) =>
            p.id === unpublished[i].id
              ? {
                  ...p,
                  status: "published",
                  facebook_post_id: data.facebook_post_id,
                  published_at: data.published_at,
                }
              : p
          )
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Publish failed");
        break;
      }

      // 5-second delay between posts (except after the last)
      if (i < unpublished.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    setPublishAllRunning(false);
    setPublishProgress(null);
    if (!actionError) {
      setActionSuccess("All posts published!");
      setTimeout(() => setActionSuccess(null), 3000);
    }
  }, [posts, actionError]);

  const copyToClipboard = useCallback(async (post: PostData) => {
    const text =
      post.facebook_content +
      (post.hashtags.length > 0 ? "\n\n" + post.hashtags.join(" ") : "");

    await navigator.clipboard.writeText(text);
    setCopied(post.id);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const downloadImage = useCallback(
    (post: PostData) => {
      const sfwUrl = getPostSfwImage(post);
      if (!sfwUrl) return;

      const a = document.createElement("a");
      a.href = sfwUrl;
      a.download = `${post.title.replace(/[^a-z0-9]/gi, "_")}_sfw.jpg`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [getPostSfwImage]
  );

  const handleSchedule = useCallback(async () => {
    if (!scheduleStartDate) return;
    setScheduling(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/stories/${seriesId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: scheduleStartDate,
          interval_days: scheduleInterval,
          time: scheduleTime,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Scheduling failed");
      }

      const data = await res.json();

      // Update local state — match by part_number
      if (data.schedule) {
        setPosts((prev) =>
          prev.map((p) => {
            const scheduled = data.schedule.find(
              (s: { part_number: number; scheduled_for: string }) =>
                s.part_number === p.part_number
            );
            return scheduled
              ? {
                  ...p,
                  status: "scheduled" as const,
                  scheduled_for: scheduled.scheduled_for,
                }
              : p;
          })
        );
      }

      setShowSchedule(false);
      setActionSuccess("Posts scheduled successfully!");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Scheduling failed"
      );
    } finally {
      setScheduling(false);
    }
  }, [seriesId, scheduleStartDate, scheduleInterval, scheduleTime]);

  // Schedule preview calculation
  const schedulePreview = useMemo(() => {
    if (!scheduleStartDate) return [];

    const unpublished = posts.filter((p) => p.status !== "published");
    const [hours, minutes] = scheduleTime.split(":").map(Number);
    const start = new Date(scheduleStartDate + "T00:00:00");
    start.setHours(hours, minutes, 0, 0);

    return unpublished.map((post, i) => {
      const date = new Date(start);
      date.setDate(date.getDate() + i * scheduleInterval);
      return {
        post,
        date: date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        time: date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      };
    });
  }, [posts, scheduleStartDate, scheduleInterval, scheduleTime]);

  // ---------------------------------------------------------------------------
  // Website content renderer — inserts images at word positions
  // ---------------------------------------------------------------------------

  function renderWebsiteContent(post: PostData) {
    const text = post.website_content;
    const images = getWebsiteImages(post);
    const paragraphs = text.split(/\n\n+/);

    if (images.length === 0) {
      return paragraphs.map((para, i) => (
        <p key={i} className="mb-4 leading-relaxed text-zinc-300">
          {para.split("\n").map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ));
    }

    const result: React.ReactNode[] = [];
    let cumulativeWords = 0;
    let imageIdx = 0;

    for (let p = 0; p < paragraphs.length; p++) {
      const para = paragraphs[p].trim();
      if (!para) continue;

      const wordCount = para.split(/\s+/).length;
      cumulativeWords += wordCount;

      result.push(
        <p key={`p-${p}`} className="mb-4 leading-relaxed text-zinc-300">
          {para.split("\n").map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      );

      // Insert images whose position falls within accumulated words
      while (
        imageIdx < images.length &&
        images[imageIdx].afterWord <= cumulativeWords
      ) {
        result.push(
          <figure key={`img-${imageIdx}`} className="my-6 mx-auto max-w-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[imageIdx].url}
              alt={images[imageIdx].alt}
              className="rounded-lg w-full shadow-lg shadow-black/40"
            />
          </figure>
        );
        imageIdx++;
      }
    }

    // Append remaining images
    while (imageIdx < images.length) {
      result.push(
        <figure
          key={`img-tail-${imageIdx}`}
          className="my-6 mx-auto max-w-md"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[imageIdx].url}
            alt={images[imageIdx].alt}
            className="rounded-lg w-full shadow-lg shadow-black/40"
          />
        </figure>
      );
      imageIdx++;
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Sub-renders: Facebook & Website previews
  // ---------------------------------------------------------------------------

  function renderFacebookPreview(post: PostData) {
    const sfwImageUrl = getPostSfwImage(post);
    const isEditing =
      editingField?.postId === post.id &&
      editingField.field === "facebook_content";

    return (
      <div className="space-y-3">
        {/* Facebook-styled card */}
        <div className="rounded-lg bg-white text-black shadow-lg overflow-hidden">
          {/* FB header */}
          <div className="flex items-center gap-3 px-4 pt-3 pb-2">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-sm shrink-0">
              NS
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                No Safe Word
              </p>
              <p className="text-xs text-gray-500">Just now &middot; 🌎</p>
            </div>
          </div>

          {/* Content */}
          <div className="px-4 pb-2">
            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  rows={8}
                  className="text-sm bg-gray-50 text-black border-gray-300 focus:border-blue-400"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={saveEdit}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-3 w-3" />
                    )}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-gray-600"
                    onClick={cancelEditing}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="group relative">
                <p className="text-sm whitespace-pre-wrap text-gray-900 leading-relaxed">
                  {post.facebook_content}
                </p>
                <button
                  onClick={() => startEditing(post.id, "facebook_content")}
                  className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-500 text-white rounded-full p-1"
                  title="Edit Facebook content"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Hashtags */}
          {post.hashtags.length > 0 && (
            <div className="px-4 pb-2">
              <p className="text-sm text-blue-600">
                {post.hashtags.join(" ")}
              </p>
            </div>
          )}

          {/* Image */}
          {sfwImageUrl && (
            <div className="w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sfwImageUrl}
                alt={post.title}
                className="w-full object-cover"
              />
            </div>
          )}

          {/* Like/Comment/Share bar */}
          <div className="border-t border-gray-200 px-4 py-2">
            <div className="flex items-center justify-around text-sm text-gray-500 font-medium">
              <span className="flex items-center gap-1 cursor-default">
                👍 Like
              </span>
              <span className="flex items-center gap-1 cursor-default">
                💬 Comment
              </span>
              <span className="flex items-center gap-1 cursor-default">
                ↗️ Share
              </span>
            </div>
          </div>

          {/* First comment preview */}
          {post.facebook_comment && (
            <div className="border-t border-gray-200 px-4 py-3">
              <div className="flex gap-2">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-[10px] shrink-0">
                  NS
                </div>
                <div className="rounded-2xl bg-gray-100 px-3 py-2">
                  <p className="font-semibold text-xs text-gray-900 mb-0.5">
                    No Safe Word
                  </p>
                  <p className="text-gray-800 text-xs leading-relaxed">
                    {post.facebook_comment}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Hover over text to edit &middot; Facebook post preview
        </p>
      </div>
    );
  }

  function renderWebsitePreviewPanel(post: PostData) {
    const isEditing =
      editingField?.postId === post.id &&
      editingField.field === "website_content";

    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-6 sm:p-8">
          {/* Title */}
          <h2 className="text-xl font-bold text-zinc-100 mb-1">
            {post.title}
          </h2>
          <p className="text-sm text-zinc-500 mb-6">
            Part {post.part_number}
          </p>

          <Separator className="mb-6 bg-zinc-800" />

          {/* Content with inline images */}
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={16}
                className="text-sm bg-zinc-900 text-zinc-200 border-zinc-700 font-serif leading-relaxed"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={saveEdit}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-3 w-3" />
                  )}
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={cancelEditing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="group relative font-serif">
              {renderWebsiteContent(post)}
              <button
                onClick={() => startEditing(post.id, "website_content")}
                className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-700 text-zinc-200 rounded-full p-1.5"
                title="Edit website content"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Hover over text to edit &middot; Website reading preview
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Status messages */}
      {actionError && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {actionSuccess}
        </div>
      )}

      {/* =================== SERIES-LEVEL CONTROLS =================== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Publishing Controls</CardTitle>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {statusSummary.published}/{statusSummary.total} published
              </span>
              {statusSummary.scheduled > 0 && (
                <Badge
                  variant="outline"
                  className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs"
                >
                  {statusSummary.scheduled} scheduled
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Warning: not all images approved */}
          {!allImagesApproved && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  Some images are not yet approved
                </p>
                <p className="text-yellow-400/70">
                  Posts with unapproved images cannot be published. Complete
                  the Images stage first.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {/* Schedule All */}
            <Button
              variant="outline"
              onClick={() => setShowSchedule(!showSchedule)}
              disabled={statusSummary.published === statusSummary.total}
            >
              <Calendar className="mr-2 h-4 w-4" />
              Schedule All
            </Button>

            {/* Publish All */}
            <Button
              onClick={publishAll}
              disabled={
                publishAllRunning ||
                statusSummary.published === statusSummary.total
              }
            >
              {publishAllRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {publishAllRunning && publishProgress
                ? `Publishing ${publishProgress.current}/${publishProgress.total}...`
                : "Publish All to Facebook"}
            </Button>
          </div>

          {/* Schedule form */}
          {showSchedule && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
              <h4 className="font-medium text-sm">Schedule Publishing</h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="start-date" className="text-xs">
                    Start Date
                  </Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={scheduleStartDate}
                    onChange={(e) => setScheduleStartDate(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="interval" className="text-xs">
                    Days Between Posts
                  </Label>
                  <Input
                    id="interval"
                    type="number"
                    min={1}
                    max={30}
                    value={scheduleInterval}
                    onChange={(e) =>
                      setScheduleInterval(Number(e.target.value))
                    }
                    className="bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="time" className="text-xs">
                    Time of Day
                  </Label>
                  <Input
                    id="time"
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="bg-background"
                  />
                </div>
              </div>

              {/* Schedule preview */}
              {schedulePreview.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-xs font-medium text-muted-foreground">
                    Preview
                  </h5>
                  <div className="rounded border border-border bg-background p-3 space-y-1.5 max-h-48 overflow-y-auto">
                    {schedulePreview.map(({ post, date, time }) => (
                      <div
                        key={post.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-muted-foreground truncate mr-4">
                          Part {post.part_number}: {post.title}
                        </span>
                        <span className="font-medium shrink-0">
                          {date} at {time}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSchedule}
                  disabled={!scheduleStartDate || scheduling}
                >
                  {scheduling ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  Confirm Schedule
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSchedule(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* =================== PER-POST SECTIONS =================== */}
      {posts.map((post) => {
        const isExpanded = expandedPosts.has(post.id);
        const postStatus =
          POST_STATUS_CONFIG[post.status] || POST_STATUS_CONFIG.draft;
        const sfwImageUrl = getPostSfwImage(post);
        const imagesReady = postImagesReady(post);
        const isPublishing = publishing === post.id;
        const isCopied = copied === post.id;

        return (
          <div key={post.id}>
            {/* Post header — collapsible */}
            <button
              onClick={() => togglePost(post.id)}
              className={`flex w-full items-center gap-3 border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                isExpanded
                  ? "rounded-t-lg border-b-0"
                  : "rounded-lg"
              }`}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {post.part_number}
              </span>
              <span className="font-medium text-sm truncate flex-1">
                {post.title}
              </span>

              {post.published_at && (
                <span className="text-xs text-muted-foreground shrink-0">
                  Published{" "}
                  {new Date(post.published_at).toLocaleDateString()}
                </span>
              )}
              {post.scheduled_for && post.status === "scheduled" && (
                <span className="text-xs text-orange-400 shrink-0">
                  Scheduled{" "}
                  {new Date(post.scheduled_for).toLocaleDateString()}{" "}
                  {new Date(post.scheduled_for).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              )}

              <Badge
                variant="outline"
                className={`shrink-0 text-xs ${postStatus.className}`}
              >
                {postStatus.label}
              </Badge>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="rounded-b-lg border border-t-0 bg-card/50 p-4 space-y-4">
                {/* ---- DESKTOP: Side by side ---- */}
                <div className="hidden lg:grid lg:grid-cols-2 lg:gap-6">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5" />
                      Facebook Preview
                    </h4>
                    {renderFacebookPreview(post)}
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5" />
                      Website Preview
                    </h4>
                    {renderWebsitePreviewPanel(post)}
                  </div>
                </div>

                {/* ---- MOBILE: Tabbed ---- */}
                <div className="lg:hidden space-y-3">
                  <MobilePreviewTabs
                    post={post}
                    renderFacebook={() => renderFacebookPreview(post)}
                    renderWebsite={() => renderWebsitePreviewPanel(post)}
                  />
                </div>

                <Separator />

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Publish to Facebook */}
                  <Button
                    onClick={() => publishPost(post.id)}
                    disabled={
                      isPublishing ||
                      publishAllRunning ||
                      post.status === "published" ||
                      !imagesReady
                    }
                    size="sm"
                  >
                    {isPublishing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : post.status === "published" ? (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    {post.status === "published"
                      ? "Published"
                      : isPublishing
                        ? "Publishing..."
                        : "Publish to Facebook"}
                  </Button>

                  {!imagesReady && post.status !== "published" && (
                    <span className="text-xs text-yellow-400">
                      All images must be approved first
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-2">
                    {/* Copy to clipboard */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(post)}
                    >
                      {isCopied ? (
                        <Check className="mr-2 h-4 w-4 text-green-400" />
                      ) : (
                        <Copy className="mr-2 h-4 w-4" />
                      )}
                      {isCopied ? "Copied!" : "Copy Text"}
                    </Button>

                    {/* Download image */}
                    {sfwImageUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadImage(post)}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Image
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MobilePreviewTabs — small sub-component for tabbed mobile layout
// ---------------------------------------------------------------------------

function MobilePreviewTabs({
  post,
  renderFacebook,
  renderWebsite,
}: {
  post: PostData;
  renderFacebook: () => React.ReactNode;
  renderWebsite: () => React.ReactNode;
}) {
  const [tab, setTab] = useState<"facebook" | "website">("facebook");

  return (
    <>
      <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 w-fit">
        <button
          onClick={() => setTab("facebook")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "facebook"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          Facebook
        </button>
        <button
          onClick={() => setTab("website")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "website"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          Website
        </button>
      </div>

      {tab === "facebook" ? renderFacebook() : renderWebsite()}
    </>
  );
}
