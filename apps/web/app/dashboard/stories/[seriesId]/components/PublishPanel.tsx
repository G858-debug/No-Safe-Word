"use client";

import { useState, useCallback, useMemo } from "react";
import type { AuthorNotes, CoverStatus } from "@no-safe-word/shared";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  Star,
} from "lucide-react";
import WebsitePreview, {
  type WebsiteImagePrompt,
} from "./WebsitePreview";
import { AuthorNotesReviewPanel } from "./AuthorNotesReviewPanel";
import { setExcluded } from "@/lib/publisher-actions";

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
  secondary_character_name?: string | null;
  prompt: string;
  image_id: string | null;
  status: string;
  is_chapter_hero: boolean;
  excluded_from_publish: boolean;
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
  buffer_post_id: string | null;
  buffer_status: string | null;
  buffer_error: string | null;
  story_image_prompts: ImagePromptData[];
}

interface BufferSchedulePreviewItem {
  postId: string;
  partNumber: number;
  title: string;
  scheduledAt: string;
  imageCount: number;
  hasFirstComment: boolean;
}

interface BufferSchedulePreviewAuthorNote {
  scheduledAt: string;
  socialCaption: string;
  imageUrl: string;
}

interface BufferSchedulePreview {
  plan: BufferSchedulePreviewItem[];
  authorNote: BufferSchedulePreviewAuthorNote | null;
  startDate: string;
  chainTailDate: string | null;
}

interface CoverPostPreview {
  seriesId: string;
  scheduledAt: string;
  text: string;
  imageUrl: string;
  firstComment: string;
}

/** Cover-reveal post state read from story_series.cover_post_*. */
export interface CoverPostState {
  bufferPostId: string | null;
  status: string | null;
  error: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  facebookId: string | null;
  ctaLine: string | null;
}

interface PublishPanelProps {
  seriesId: string;
  posts: PostData[];
  imageUrls: Record<string, string>;
  coverStatus: CoverStatus;
  /** Optional editorial reflection block. When non-null, renders the Author's Notes review panel. */
  authorNotes: AuthorNotes | null;
  /** Phase 3b — accompanying-image prompt. Null when not yet authored. */
  authorNoteImagePrompt: string | null;
  /** Phase 3b — generated accompanying image URL. Null until the operator runs generation. */
  authorNoteImageUrl: string | null;
  /** Phase 3b — Stage 13 approval timestamp. Null until the reviewer approves. Drives the publish-action gate. */
  authorNoteApprovedAt: string | null;
  /** Series-level status — drives the Website Publishing badge + button enable. */
  seriesStatus: string;
  /** When the series went live on the public website. NULL until publish-website succeeds. */
  publishedAt: string | null;
  /** Lift series-published state up to the page so the header badge updates without a refetch. */
  onSeriesPublished?: (publishedAt: string) => void;
  /** Selected long blurb text. Null until operator picks one in Stage 10. */
  longBlurb: string | null;
  /** Composited 1600×2400 hero cover URL. Null until compositing completes. */
  coverHeroUrl: string | null;
  /** Hashtag set used by chapter posts (consistent per series). Falls back to ['#NoSafeWord']. */
  seriesHashtags: string[];
  /** Cover-reveal Buffer post state. */
  coverPost: CoverPostState;
}

interface PreconditionFailure {
  key: string;
  message: string;
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

/**
 * Default datetime-local string for the cover-reveal post: tomorrow at
 * 20:00 SAST (the night before a chapter-1 schedule that starts the
 * morning after). Format: yyyy-MM-ddTHH:mm.
 *
 * The <input type="datetime-local"> control reads/writes a wall-clock
 * value in the user's local timezone, which is what the operator
 * expects to type ("8 PM Sunday"). The server converts to UTC.
 */
function defaultCoverPostDatetime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const COVER_POST_STATUS_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  sending: {
    label: "Sending",
    className: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  },
  sent: {
    label: "Sent",
    className: "bg-green-500/20 text-green-300 border-green-500/30",
  },
  error: {
    label: "Failed",
    className: "bg-red-500/20 text-red-300 border-red-500/30",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PublishPanel({
  seriesId,
  posts: initialPosts,
  imageUrls,
  coverStatus,
  authorNotes,
  authorNoteImagePrompt: initialAuthorNoteImagePrompt,
  authorNoteImageUrl: initialAuthorNoteImageUrl,
  authorNoteApprovedAt: initialAuthorNoteApprovedAt,
  seriesStatus: initialSeriesStatus,
  publishedAt: initialPublishedAt,
  onSeriesPublished,
  longBlurb,
  coverHeroUrl,
  seriesHashtags,
  coverPost: initialCoverPost,
}: PublishPanelProps) {
  const coverApproved =
    coverStatus === "approved" ||
    coverStatus === "compositing" ||
    coverStatus === "complete";
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

  // Buffer scheduling state — separate flow from the legacy DB-only
  // "Schedule All". Operator clicks Preview first, then Schedule.
  const [bufferPreview, setBufferPreview] =
    useState<BufferSchedulePreview | null>(null);
  const [bufferPreviewLoading, setBufferPreviewLoading] = useState(false);
  const [bufferScheduling, setBufferScheduling] = useState(false);
  const [bufferCancelling, setBufferCancelling] = useState(false);
  // Operator-picked start date for Chapter 1 (yyyy-mm-dd, local format).
  // Defaults to today + 4 days so operator has runway. Optional — when
  // empty, the server falls back to "day after the global chain tail".
  const [bufferStartDate, setBufferStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 4);
    return d.toISOString().slice(0, 10);
  });

  // Cover-reveal Buffer post state.
  const [coverPost, setCoverPost] = useState<CoverPostState>(initialCoverPost);
  const [coverPostScheduledAt, setCoverPostScheduledAt] = useState<string>(
    () => initialCoverPost.scheduledFor ?? defaultCoverPostDatetime()
  );
  const [coverPostCtaLine, setCoverPostCtaLine] = useState<string>(
    initialCoverPost.ctaLine ?? ""
  );
  const [coverPostPreview, setCoverPostPreview] =
    useState<CoverPostPreview | null>(null);
  const [coverPostPreviewLoading, setCoverPostPreviewLoading] = useState(false);
  const [coverPostScheduling, setCoverPostScheduling] = useState(false);
  const [coverPostCancelling, setCoverPostCancelling] = useState(false);

  // Feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Website-publish state. Series status + timestamp shadow the props
  // so a successful publish reflects in the badge without waiting for a
  // parent refetch. The parent is also notified via onSeriesPublished.
  const [seriesStatus, setSeriesStatus] = useState(initialSeriesStatus);
  const [publishedAt, setPublishedAt] = useState<string | null>(
    initialPublishedAt
  );
  const [websitePublishing, setWebsitePublishing] = useState(false);
  const [websiteFailures, setWebsiteFailures] = useState<
    PreconditionFailure[] | null
  >(null);
  const isWebsitePublished = seriesStatus === "published";

  // Phase 3b — Stage 13 approval timestamp mirror. AuthorNotesReviewPanel
  // owns the editing flow but reports approval flips up via a callback
  // so this panel's `authorNotesReady` gate (computed below) snaps the
  // publish-action disabled props on the same render.
  const [authorNoteApprovedAt, setAuthorNoteApprovedAt] = useState<
    string | null
  >(initialAuthorNoteApprovedAt);

  // The gate: if the story has no notes (`authorNotes` null), publish is
  // unaffected. If notes exist, every publish action below waits for
  // approval. Single computation, applied across all gated buttons.
  const authorNotesReady = !authorNotes || authorNoteApprovedAt !== null;

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const statusSummary = useMemo(() => {
    const total = posts.length;
    const published = posts.filter((p) => p.status === "published").length;
    const scheduled = posts.filter((p) => p.status === "scheduled").length;
    return { total, published, scheduled };
  }, [posts]);

  // Excluded images are soft-hidden from publish and don't gate the
  // "ready to publish" state: an editor can fix a bad SFW image by
  // excluding it instead of regenerating, and the chapter should still
  // ship as long as the rest is approved.
  const allImagesApproved = useMemo(() => {
    return posts.every((post) =>
      post.story_image_prompts.every(
        (ip) => ip.excluded_from_publish || ip.status === "approved"
      )
    );
  }, [posts]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // Approved, non-excluded SFW images for the Facebook composer (and
  // download-as-image action). Excluded rows ship neither to FB nor
  // to the website. Approval gating still lives on the Images tab.
  const getPostSfwImages = useCallback(
    (
      post: PostData
    ): Array<{ promptId: string; url: string; alt: string; excluded: boolean }> => {
      return post.story_image_prompts
        .filter(
          (ip) =>
            ip.image_type === "facebook_sfw" &&
            ip.status === "approved" &&
            ip.image_id &&
            imageUrls[ip.image_id]
        )
        .sort((a, b) => a.position - b.position)
        .map((ip) => ({
          promptId: ip.id,
          url: imageUrls[ip.image_id as string],
          alt: ip.character_name || post.title,
          excluded: ip.excluded_from_publish,
        }));
    },
    [imageUrls]
  );

  const postImagesReady = useCallback((post: PostData): boolean => {
    return post.story_image_prompts.every(
      (ip) => ip.excluded_from_publish || ip.status === "approved"
    );
  }, []);

  // Apply a partial patch to a single image prompt within the local
  // posts state. Used by WebsitePreview's optimistic updates and by
  // the Facebook preview's exclude toggle.
  const patchPrompt = useCallback(
    (postId: string, promptId: string, patch: Partial<ImagePromptData>) => {
      setPosts((prev) =>
        prev.map((p) =>
          p.id !== postId
            ? p
            : {
                ...p,
                story_image_prompts: p.story_image_prompts.map((ip) =>
                  ip.id === promptId ? { ...ip, ...patch } : ip
                ),
              }
        )
      );
    },
    []
  );

  // Toggle excluded_from_publish on a Facebook-side image. Same
  // optimistic+rollback pattern as WebsitePreview, but inlined here
  // because the Facebook preview is much smaller and doesn't need the
  // dnd-kit machinery.
  const handleToggleFacebookExclude = useCallback(
    async (postId: string, prompt: ImagePromptData) => {
      const wasExcluded = prompt.excluded_from_publish;
      const wasHero = prompt.is_chapter_hero;
      const next = !wasExcluded;

      patchPrompt(postId, prompt.id, {
        excluded_from_publish: next,
        is_chapter_hero: next ? false : wasHero,
      });

      try {
        const result = await setExcluded(postId, prompt.id, next);
        patchPrompt(postId, prompt.id, {
          excluded_from_publish: result.excluded,
          is_chapter_hero: result.heroCleared ? false : wasHero && !next,
        });
      } catch (e) {
        patchPrompt(postId, prompt.id, {
          excluded_from_publish: wasExcluded,
          is_chapter_hero: wasHero,
        });
        setActionError(
          e instanceof Error ? e.message : "Failed to update exclude flag"
        );
      }
    },
    [patchPrompt]
  );

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

  const publishWebsite = useCallback(async () => {
    if (isWebsitePublished || websitePublishing) return;

    const ok = window.confirm(
      "This will make the entire story visible on nosafeword.co.za immediately. This cannot be undone via this UI. Continue?"
    );
    if (!ok) return;

    setWebsitePublishing(true);
    setActionError(null);
    setWebsiteFailures(null);

    try {
      const res = await fetch(
        `/api/stories/${seriesId}/publish-website`,
        { method: "POST" }
      );

      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as {
          failures?: PreconditionFailure[];
        };
        setWebsiteFailures(body.failures ?? []);
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Publish failed");
      }

      const body = (await res.json()) as {
        published_at: string | null;
        posts_updated: number;
      };
      const stamp = body.published_at ?? new Date().toISOString();

      setSeriesStatus("published");
      setPublishedAt(stamp);
      // Mirror on every post we know about so the per-post status pills
      // flip immediately. The RPC promotes every status except
      // 'published' itself.
      setPosts((prev) =>
        prev.map((p) =>
          p.status === "published"
            ? p
            : { ...p, status: "published", published_at: stamp }
        )
      );
      onSeriesPublished?.(stamp);
      setActionSuccess(
        `Story is live. ${body.posts_updated} chapter${body.posts_updated === 1 ? "" : "s"} promoted to published.`
      );
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setWebsitePublishing(false);
    }
  }, [
    seriesId,
    isWebsitePublished,
    websitePublishing,
    onSeriesPublished,
  ]);

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
      const sfwImages = getPostSfwImages(post);
      if (sfwImages.length === 0) return;

      const safeTitle = post.title.replace(/[^a-z0-9]/gi, "_");
      sfwImages.forEach((img, idx) => {
        const a = document.createElement("a");
        a.href = img.url;
        a.download =
          sfwImages.length === 1
            ? `${safeTitle}_sfw.jpg`
            : `${safeTitle}_sfw_${idx + 1}.jpg`;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    },
    [getPostSfwImages]
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

  // ---- Buffer scheduling -------------------------------------------------

  const previewBufferSchedule = useCallback(async () => {
    setBufferPreviewLoading(true);
    setActionError(null);
    try {
      const url = new URL(
        `/api/stories/${seriesId}/buffer-schedule/preview`,
        window.location.origin
      );
      if (bufferStartDate) {
        url.searchParams.set("startDate", bufferStartDate);
      }
      const res = await fetch(url.toString());
      if (!res.ok) {
        const err = (await res.json()) as { error?: string; details?: string };
        throw new Error(err.details || err.error || "Preview failed");
      }
      const data = (await res.json()) as BufferSchedulePreview;
      setBufferPreview(data);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Buffer preview failed"
      );
    } finally {
      setBufferPreviewLoading(false);
    }
  }, [seriesId, bufferStartDate]);

  const scheduleViaBuffer = useCallback(async () => {
    if (
      !bufferPreview ||
      (bufferPreview.plan.length === 0 && !bufferPreview.authorNote)
    ) {
      return;
    }
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString("en-ZA", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Africa/Johannesburg",
      });
    const firstIso =
      bufferPreview.plan.length > 0
        ? bufferPreview.plan[0].scheduledAt
        : bufferPreview.authorNote!.scheduledAt;
    const lastIso = bufferPreview.authorNote
      ? bufferPreview.authorNote.scheduledAt
      : bufferPreview.plan[bufferPreview.plan.length - 1].scheduledAt;
    const chapterPart =
      bufferPreview.plan.length > 0
        ? `${bufferPreview.plan.length} chapter${
            bufferPreview.plan.length === 1 ? "" : "s"
          }`
        : "";
    const notePart = bufferPreview.authorNote ? "author's note" : "";
    const itemsLabel = [chapterPart, notePart].filter(Boolean).join(" + ");
    const ok = window.confirm(
      `Schedule ${itemsLabel} on Buffer? First post: ${fmt(
        firstIso
      )} SAST. Last post: ${fmt(lastIso)} SAST.`
    );
    if (!ok) return;

    setBufferScheduling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/buffer-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          bufferStartDate ? { startDate: bufferStartDate } : {}
        ),
      });

      const data = (await res.json()) as {
        scheduled?: Array<{
          postId: string;
          bufferPostId: string;
          scheduledAt: string;
        }>;
        skipped?: Array<{ postId: string; reason: string }>;
        partial?: boolean;
        failure?: { postId: string; error: string };
        error?: string;
        details?: string;
      };

      if (!res.ok && !data.partial) {
        throw new Error(data.details || data.error || "Buffer scheduling failed");
      }

      if (data.scheduled && data.scheduled.length > 0) {
        setPosts((prev) =>
          prev.map((p) => {
            const match = data.scheduled?.find((s) => s.postId === p.id);
            return match
              ? {
                  ...p,
                  status: "scheduled",
                  scheduled_for: match.scheduledAt,
                  buffer_post_id: match.bufferPostId,
                  buffer_status: "scheduled",
                  buffer_error: null,
                }
              : p;
          })
        );
      }

      const scheduledCount = data.scheduled?.length ?? 0;
      const skippedCount = data.skipped?.length ?? 0;
      const skippedSuffix =
        skippedCount > 0
          ? ` Skipped ${skippedCount} already-scheduled chapter${skippedCount === 1 ? "" : "s"}.`
          : "";

      if (data.partial && data.failure) {
        const failedItem = bufferPreview.plan.find(
          (p) => p.postId === data.failure!.postId
        );
        const failedLabel = failedItem
          ? `Part ${failedItem.partNumber}: ${failedItem.title}`
          : `chapter id ${data.failure.postId}`;
        setActionError(
          `Scheduled ${scheduledCount}/${bufferPreview.plan.length}. Stopped at ${failedLabel}: ${data.failure.error}.${skippedSuffix}`
        );
      } else {
        setActionSuccess(
          `Scheduled ${scheduledCount} chapter${scheduledCount === 1 ? "" : "s"} on Buffer.${skippedSuffix}`
        );
        setTimeout(() => setActionSuccess(null), 4000);
        setBufferPreview(null);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Buffer scheduling failed"
      );
    } finally {
      setBufferScheduling(false);
    }
  }, [seriesId, bufferPreview, bufferStartDate]);

  const cancelBufferSchedule = useCallback(async () => {
    const ok = window.confirm(
      "Cancel every Buffer-scheduled chapter for this story? Posts already published on Facebook are not affected."
    );
    if (!ok) return;

    setBufferCancelling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/buffer-schedule`, {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        cancelled?: string[];
        failures?: Array<{ postId: string; error: string }>;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Cancel failed");
      }
      if (data.cancelled && data.cancelled.length > 0) {
        const cancelledIds = new Set(data.cancelled);
        setPosts((prev) =>
          prev.map((p) =>
            cancelledIds.has(p.id)
              ? {
                  ...p,
                  status: "draft",
                  scheduled_for: null,
                  buffer_post_id: null,
                  buffer_status: null,
                  buffer_error: null,
                }
              : p
          )
        );
      }
      const failureCount = data.failures?.length ?? 0;
      if (failureCount > 0) {
        setActionError(
          `Cancelled ${data.cancelled?.length ?? 0}, but ${failureCount} could not be cancelled (already published or in flight).`
        );
      } else {
        setActionSuccess(
          `Cancelled ${data.cancelled?.length ?? 0} scheduled post${
            data.cancelled?.length === 1 ? "" : "s"
          }.`
        );
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Cancel failed"
      );
    } finally {
      setBufferCancelling(false);
    }
  }, [seriesId]);

  // ---- Cover-reveal Buffer post --------------------------------------

  const previewCoverPost = useCallback(async () => {
    setCoverPostPreviewLoading(true);
    setActionError(null);
    try {
      // datetime-local strings are wall-clock (no TZ). new Date(...)
      // interprets them as the user's local time, which is what the
      // operator means when typing "8 PM Sunday".
      const scheduledIso = new Date(coverPostScheduledAt).toISOString();
      const url = new URL(
        `/api/stories/${seriesId}/cover-post/preview`,
        window.location.origin
      );
      url.searchParams.set("scheduledAt", scheduledIso);
      url.searchParams.set("ctaLine", coverPostCtaLine);
      const res = await fetch(url.toString());
      if (!res.ok) {
        const err = (await res.json()) as { error?: string; details?: string };
        throw new Error(err.details || err.error || "Preview failed");
      }
      const data = (await res.json()) as CoverPostPreview;
      setCoverPostPreview(data);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Cover post preview failed"
      );
    } finally {
      setCoverPostPreviewLoading(false);
    }
  }, [seriesId, coverPostScheduledAt, coverPostCtaLine]);

  const scheduleCoverPost = useCallback(async () => {
    if (!coverPostCtaLine.trim()) {
      setActionError("Type a CTA line before scheduling.");
      return;
    }
    const scheduledIso = new Date(coverPostScheduledAt).toISOString();
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString("en-ZA", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Africa/Johannesburg",
      });
    const ok = window.confirm(
      `Schedule the cover-reveal post on Buffer for ${fmt(
        scheduledIso
      )} SAST?`
    );
    if (!ok) return;

    setCoverPostScheduling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/cover-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledAt: scheduledIso,
          ctaLine: coverPostCtaLine,
        }),
      });
      const data = (await res.json()) as {
        bufferPostId?: string;
        bufferStatus?: string;
        scheduledAt?: string;
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(data.details || data.error || "Cover post failed");
      }
      setCoverPost({
        bufferPostId: data.bufferPostId ?? null,
        status: data.bufferStatus ?? "pending",
        error: null,
        scheduledFor: data.scheduledAt ?? scheduledIso,
        publishedAt: null,
        facebookId: null,
        ctaLine: coverPostCtaLine,
      });
      setCoverPostPreview(null);
      setActionSuccess("Cover-reveal post scheduled on Buffer.");
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Cover post failed"
      );
    } finally {
      setCoverPostScheduling(false);
    }
  }, [seriesId, coverPostScheduledAt, coverPostCtaLine]);

  const cancelCoverPost = useCallback(async () => {
    const ok = window.confirm(
      "Cancel the cover-reveal post on Buffer? You can re-schedule afterwards."
    );
    if (!ok) return;

    setCoverPostCancelling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/stories/${seriesId}/cover-post`, {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        cancelled?: boolean;
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(data.details || data.error || "Cancel failed");
      }
      setCoverPost({
        bufferPostId: null,
        status: null,
        error: null,
        scheduledFor: null,
        publishedAt: null,
        facebookId: null,
        ctaLine: null,
      });
      setActionSuccess("Cover-reveal post cancelled.");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Cancel failed"
      );
    } finally {
      setCoverPostCancelling(false);
    }
  }, [seriesId]);

  const coverPostScheduledNow =
    coverPost.bufferPostId != null && coverPost.status !== "error";

  const hasBufferScheduledPosts = useMemo(
    () => posts.some((p) => p.buffer_post_id != null),
    [posts]
  );

  // A chapter is schedulable on Buffer if it has never been sent
  // (buffer_post_id IS NULL) or a previous Buffer attempt failed
  // (buffer_status='error'). status='published' from the
  // website-publish flow does NOT mean it has shipped to Facebook.
  const bufferSchedulableCount = useMemo(
    () =>
      posts.filter(
        (p) => p.buffer_post_id == null || p.buffer_status === "error"
      ).length,
    [posts]
  );

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
  // Sub-renders: Facebook & Website previews
  // ---------------------------------------------------------------------------

  function renderFacebookPreview(post: PostData) {
    const sfwImages = getPostSfwImages(post);
    const promptById = new Map(
      post.story_image_prompts.map((ip) => [ip.id, ip])
    );
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

          {/* Image(s) — multi-photo posts stack vertically, matching Facebook's layout.
              The ✕ overlay toggles excluded_from_publish; excluded rows render
              dimmed but stay visible so editors see what they removed. */}
          {sfwImages.length > 0 && (
            <div className="w-full">
              {sfwImages.map((img, idx) => {
                const prompt = promptById.get(img.promptId);
                const isHero = prompt?.is_chapter_hero === true;
                return (
                  <div
                    key={img.promptId}
                    className={`group relative ${idx > 0 ? "border-t border-white" : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.alt}
                      className={`w-full object-cover transition-opacity ${
                        img.excluded ? "opacity-40" : ""
                      }`}
                    />
                    {img.excluded && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <button
                          onClick={() => prompt && handleToggleFacebookExclude(post.id, prompt)}
                          className="pointer-events-auto px-3 py-1.5 rounded-md bg-zinc-900/90 text-xs font-medium text-zinc-100 line-through hover:bg-zinc-800"
                        >
                          Excluded — click to restore
                        </button>
                      </div>
                    )}
                    {!img.excluded && prompt && (
                      <button
                        onClick={() => handleToggleFacebookExclude(post.id, prompt)}
                        className="absolute top-2 right-2 z-10 rounded-full bg-black/70 hover:bg-black/90 text-white p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Exclude from publish"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isHero && (
                      <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-amber-500/90 text-amber-950 px-1.5 py-0.5 text-[10px] font-semibold">
                        <Star className="h-3 w-3 fill-amber-950" />
                        Hero
                      </div>
                    )}
                  </div>
                );
              })}
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
      <WebsitePreview
        postId={post.id}
        partNumber={post.part_number}
        title={post.title}
        websiteContent={post.website_content}
        prompts={post.story_image_prompts as WebsiteImagePrompt[]}
        imageUrls={imageUrls}
        onPromptPatch={(promptId, patch) =>
          patchPrompt(post.id, promptId, patch as Partial<ImagePromptData>)
        }
        isEditing={isEditing}
        editValue={editValue}
        onEditValueChange={setEditValue}
        onStartEditing={() => startEditing(post.id, "website_content")}
        onSaveEdit={saveEdit}
        onCancelEditing={cancelEditing}
        saving={saving}
      />
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

      {/* =================== STAGE 13: AUTHOR'S NOTES REVIEW =================== */}
      {/* Sits at the top of PublishPanel — review/approve before any publish
          action below unblocks. Hidden entirely when the story has no
          author_notes (entertainment-only stories ship without notes). */}
      {authorNotes && (
        <AuthorNotesReviewPanel
          seriesId={seriesId}
          initialNotes={authorNotes}
          initialImagePrompt={initialAuthorNoteImagePrompt}
          initialImageUrl={initialAuthorNoteImageUrl}
          initialApprovedAt={initialAuthorNoteApprovedAt}
          onApprovalChange={setAuthorNoteApprovedAt}
        />
      )}

      {/* ================ SECTION 1: WEBSITE PUBLISHING ================ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Website Publishing
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Publishes the entire story to nosafeword.co.za immediately.
                Decoupled from Facebook scheduling.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isWebsitePublished ? (
                <Badge
                  variant="outline"
                  className="bg-green-500/20 text-green-300 border-green-500/30 text-xs"
                >
                  Published
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs"
                >
                  Draft
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {publishedAt && isWebsitePublished && (
            <p className="text-xs text-muted-foreground">
              Live since{" "}
              <span className="font-medium text-foreground">
                {new Date(publishedAt).toLocaleString()}
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={publishWebsite}
              disabled={
                isWebsitePublished || websitePublishing || !authorNotesReady
              }
            >
              {websitePublishing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : isWebsitePublished ? (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              ) : (
                <Globe className="mr-2 h-4 w-4" />
              )}
              {isWebsitePublished
                ? "Already Published"
                : websitePublishing
                  ? "Publishing..."
                  : "Publish Whole Story to Website Now"}
            </Button>
          </div>

          {websiteFailures && websiteFailures.length > 0 && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 text-red-300">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">
                  Cannot publish — {websiteFailures.length} precondition
                  {websiteFailures.length === 1 ? "" : "s"} not met
                </span>
              </div>
              <ul className="space-y-1.5 pl-6">
                {websiteFailures.map((f) => (
                  <li
                    key={f.key}
                    className="list-disc text-red-400/90"
                  >
                    {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================ SECTION 2: FACEBOOK SCHEDULING =============== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4" />
                Facebook Scheduling
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Stagger Facebook posts over time, or push them out now.
                Independent of website publishing.
              </p>
            </div>
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
          {/* Blocker: cover not approved */}
          {!coverApproved && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Cover not approved</p>
                <p className="text-red-400/70">
                  An approved cover is required before publishing. Go to the
                  Cover tab to generate and approve a variant.
                </p>
              </div>
            </div>
          )}

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
              disabled={
                !coverApproved ||
                !authorNotesReady ||
                statusSummary.published === statusSummary.total
              }
            >
              <Calendar className="mr-2 h-4 w-4" />
              Schedule All
            </Button>

            {/* Publish All */}
            <Button
              onClick={publishAll}
              disabled={
                !coverApproved ||
                !authorNotesReady ||
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

          {/* Hint: when all posts are website-published but not yet sent to
              Buffer, the two buttons above are disabled. Point the user to the
              Buffer scheduling section below so they don't get stuck. */}
          {statusSummary.published === statusSummary.total &&
            bufferSchedulableCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-400">
                <Send className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    Ready for Facebook — use Buffer scheduling below
                  </p>
                  <p className="text-blue-400/70">
                    All chapters are website-published. To schedule them on
                    Facebook, scroll down to{" "}
                    <span className="font-medium">
                      Facebook Scheduling via Buffer
                    </span>{" "}
                    and click <span className="font-medium">Preview Schedule</span>{" "}
                    then <span className="font-medium">Schedule on Buffer</span>.
                  </p>
                </div>
              </div>
            )}

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

      {/* ============ SECTION 3a: FACEBOOK COVER REVEAL POST ============ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4" />
                Facebook Cover Reveal Post
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Posts the cover image and long blurb to Facebook the night before
                Chapter 1. One-time per story.
              </p>
            </div>
            {coverPost.status && (
              <Badge
                variant="outline"
                className={
                  COVER_POST_STATUS_BADGE[coverPost.status]?.className ??
                  "bg-zinc-500/20 text-zinc-300 border-zinc-500/30"
                }
              >
                {COVER_POST_STATUS_BADGE[coverPost.status]?.label ??
                  coverPost.status}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Cover preview + long blurb side-by-side */}
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="shrink-0">
              {coverHeroUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverHeroUrl}
                  alt="Cover preview"
                  className="w-[160px] rounded-md border border-border"
                />
              ) : (
                <div className="flex h-[240px] w-[160px] items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
                  No composited cover yet
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Label className="text-xs text-muted-foreground">
                Selected long blurb
              </Label>
              {longBlurb ? (
                <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed whitespace-pre-line">
                  {longBlurb}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                  No long blurb selected. Pick one in the Blurbs tab first.
                </p>
              )}
              <Label className="text-xs text-muted-foreground">Hashtags</Label>
              <div className="rounded-md border border-border bg-muted/20 p-2 text-xs font-mono text-muted-foreground">
                {seriesHashtags.join(" ")}
              </div>
            </div>
          </div>

          {/* Datetime + CTA inputs */}
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div>
              <Label htmlFor="cover-post-when" className="text-xs">
                Schedule for
              </Label>
              <Input
                id="cover-post-when"
                type="datetime-local"
                value={coverPostScheduledAt}
                onChange={(e) => setCoverPostScheduledAt(e.target.value)}
                disabled={coverPostScheduledNow}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Local time. Default: tomorrow 20:00.
              </p>
            </div>
            <div>
              <Label htmlFor="cover-post-cta" className="text-xs">
                CTA line
              </Label>
              <Textarea
                id="cover-post-cta"
                value={coverPostCtaLine}
                onChange={(e) => setCoverPostCtaLine(e.target.value)}
                placeholder="First chapter Monday at 8pm SAST. New chapter every night this week."
                disabled={coverPostScheduledNow}
                className="mt-1 min-h-[60px]"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={previewCoverPost}
              disabled={
                coverPostPreviewLoading ||
                !longBlurb ||
                !coverHeroUrl ||
                !coverPostCtaLine.trim()
              }
            >
              {coverPostPreviewLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              Preview Cover Post
            </Button>
            <Button
              onClick={scheduleCoverPost}
              disabled={
                coverPostScheduledNow ||
                coverPostScheduling ||
                !longBlurb ||
                !coverHeroUrl ||
                !coverPostCtaLine.trim() ||
                !authorNotesReady
              }
            >
              {coverPostScheduling ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Schedule Cover Post on Buffer
            </Button>
            {coverPost.bufferPostId && coverPost.status !== "sent" && (
              <Button
                variant="ghost"
                onClick={cancelCoverPost}
                disabled={coverPostCancelling}
                className="text-red-400 hover:text-red-300"
              >
                {coverPostCancelling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                Cancel
              </Button>
            )}
          </div>

          {/* Status / error / current schedule */}
          {coverPost.scheduledFor && (
            <p className="text-xs text-muted-foreground">
              Scheduled for{" "}
              <span className="font-medium text-foreground">
                {new Date(coverPost.scheduledFor).toLocaleString("en-ZA", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "Africa/Johannesburg",
                })}{" "}
                SAST
              </span>
            </p>
          )}
          {coverPost.status === "error" && coverPost.error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <span className="font-medium">Buffer error:</span> {coverPost.error}
            </div>
          )}

          {/* Preview rendered output */}
          {coverPostPreview && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <h4 className="font-medium text-sm">Assembled cover post</h4>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Post body</Label>
                <pre className="whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs">
                  {coverPostPreview.text}
                </pre>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  First comment
                </Label>
                <pre className="whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs">
                  {coverPostPreview.firstComment}
                </pre>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Image URL
                </Label>
                <p className="break-all rounded border border-border bg-background p-2 text-xs font-mono text-muted-foreground">
                  {coverPostPreview.imageUrl}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ SECTION 3b: FACEBOOK SCHEDULING VIA BUFFER ============ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4" />
                Facebook Scheduling via Buffer
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Hands publishing off to Buffer. Posts go live at 8:00 PM SAST,
                one chapter per day starting on the date you pick below.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div>
              <Label htmlFor="buffer-start-date" className="text-xs">
                Start date for Chapter 1
              </Label>
              <Input
                id="buffer-start-date"
                type="date"
                value={bufferStartDate}
                onChange={(e) => {
                  setBufferStartDate(e.target.value);
                  // Stale preview after the date changes — force a re-click.
                  setBufferPreview(null);
                }}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Chapter 1 lands on this date at 20:00 SAST. Each subsequent
                chapter follows on the next day.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={previewBufferSchedule}
              disabled={
                !coverApproved ||
                !authorNotesReady ||
                bufferPreviewLoading ||
                bufferSchedulableCount === 0
              }
            >
              {bufferPreviewLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              Preview Schedule
            </Button>

            <Button
              onClick={scheduleViaBuffer}
              disabled={
                !bufferPreview ||
                (bufferPreview.plan.length === 0 &&
                  !bufferPreview.authorNote) ||
                bufferScheduling ||
                !authorNotesReady
              }
            >
              {bufferScheduling ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Schedule on Buffer
            </Button>

            {hasBufferScheduledPosts && (
              <Button
                variant="ghost"
                onClick={cancelBufferSchedule}
                disabled={bufferCancelling}
                className="text-red-400 hover:text-red-300"
              >
                {bufferCancelling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                Cancel scheduled posts
              </Button>
            )}
          </div>

          {bufferPreview && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">
                  Plan ({bufferPreview.plan.length} chapter
                  {bufferPreview.plan.length === 1 ? "" : "s"}
                  {bufferPreview.authorNote ? " + author note" : ""})
                </h4>
                {bufferPreview.chainTailDate && (
                  <p className="text-xs text-muted-foreground">
                    Chained after{" "}
                    {new Date(bufferPreview.chainTailDate).toLocaleDateString(
                      "en-ZA",
                      {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        timeZone: "Africa/Johannesburg",
                      }
                    )}
                  </p>
                )}
              </div>
              {bufferPreview.plan.length === 0 && !bufferPreview.authorNote ? (
                <p className="text-sm text-muted-foreground">
                  Nothing to schedule — every chapter is already published.
                </p>
              ) : (
                <div className="rounded border border-border bg-background p-3 space-y-1.5 max-h-64 overflow-y-auto">
                  {bufferPreview.plan.map((item) => (
                    <div
                      key={item.postId}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground truncate mr-4">
                        Part {item.partNumber}: {item.title}{" "}
                        <span className="text-xs">
                          ({item.imageCount} image
                          {item.imageCount === 1 ? "" : "s"}
                          {item.hasFirstComment ? ", + first comment" : ""})
                        </span>
                      </span>
                      <span className="font-medium shrink-0">
                        {new Date(item.scheduledAt).toLocaleString("en-ZA", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "Africa/Johannesburg",
                        })}{" "}
                        SAST
                      </span>
                    </div>
                  ))}
                  {bufferPreview.authorNote && (
                    <div className="flex items-center justify-between text-sm border-t border-border pt-1.5">
                      <span className="text-muted-foreground truncate mr-4">
                        Author&apos;s note{" "}
                        <span className="text-xs">(social caption + image)</span>
                      </span>
                      <span className="font-medium shrink-0">
                        {new Date(
                          bufferPreview.authorNote.scheduledAt
                        ).toLocaleString("en-ZA", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "Africa/Johannesburg",
                        })}{" "}
                        SAST
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Author's Notes review moved to the top of the panel (Phase 3b). */}

      {/* =================== PER-POST SECTIONS =================== */}
      {posts.map((post) => {
        const isExpanded = expandedPosts.has(post.id);
        const postStatus =
          POST_STATUS_CONFIG[post.status] || POST_STATUS_CONFIG.draft;
        const sfwImages = getPostSfwImages(post);
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

              {post.buffer_post_id && (
                <Badge
                  variant="outline"
                  title={post.buffer_error ?? undefined}
                  className={`shrink-0 text-xs ${
                    post.buffer_status === "sent"
                      ? "bg-green-500/20 text-green-300 border-green-500/30"
                      : post.buffer_status === "error"
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : post.buffer_status === "sending"
                          ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                          : "bg-purple-500/20 text-purple-300 border-purple-500/30"
                  }`}
                >
                  Buffer:{" "}
                  {post.buffer_status === "error"
                    ? "Failed"
                    : post.buffer_status === "sent"
                      ? "Sent"
                      : post.buffer_status === "sending"
                        ? "Sending"
                        : "Scheduled"}
                </Badge>
              )}
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
                      !imagesReady ||
                      !authorNotesReady
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

                    {/* Download image(s) */}
                    {sfwImages.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadImage(post)}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {sfwImages.length > 1
                          ? `Images (${sfwImages.length})`
                          : "Image"}
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

// AuthorNotesPanel was relocated + made editable in Phase 3b — see
// AuthorNotesReviewPanel.tsx. The panel now renders at the top of
// PublishPanel and gates every publish action below.
