"use client";

// Website Preview pane on the Publish tab.
//
// Owns all compositional state for the website-side reading
// experience: hero selection, image exclusion, drag-to-reposition for
// inline images, and the "Unplaced images" tray for orphans.
//
// Word-counting matches StoryRenderer exactly via lib/story-text.ts —
// position_after_word resolves to the same paragraph boundary in both
// the public chapter page and this preview.

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  AlertCircle,
  CheckCircle2,
  GripVertical,
  ImageOff,
  Pencil,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  splitBlocks,
  cumulativeParagraphWords,
  type StoryBlock,
} from "@/lib/story-text";
import {
  setExcluded,
  setHero,
  setImagePosition,
} from "@/lib/publisher-actions";

// ---------------------------------------------------------------------------
// Public types — match the prompt shape passed in from PublishPanel
// ---------------------------------------------------------------------------

export interface WebsiteImagePrompt {
  id: string;
  image_type: "facebook_sfw" | "website_nsfw_paired" | "website_only" | string;
  position: number;
  position_after_word: number | null;
  pairs_with: string | null;
  character_name: string | null;
  secondary_character_name?: string | null;
  image_id: string | null;
  status: string;
  is_chapter_hero: boolean;
  excluded_from_publish: boolean;
}

interface WebsitePreviewProps {
  postId: string;
  partNumber: number;
  title: string;
  websiteContent: string;
  prompts: WebsiteImagePrompt[];
  imageUrls: Record<string, string>;
  /** Update a single prompt in the parent's posts state. */
  onPromptPatch: (promptId: string, patch: Partial<WebsiteImagePrompt>) => void;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (v: string) => void;
  onStartEditing: () => void;
  onSaveEdit: () => void;
  onCancelEditing: () => void;
  saving: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRAY_ID = "publish-tray";

/** dnd-kit droppable id for the gap that sits AFTER the block at
 *  index `i`. The "before everything" gap is index -1 and renders
 *  before the first paragraph; the "after everything" gap is the
 *  last entry. The numeric value embedded in the id is the cumulative
 *  paragraph-word count at that gap (== position_after_word to write). */
function gapId(cumWords: number, slot: number): string {
  return `gap-${slot}-${cumWords}`;
}

function parseGapId(id: string): { slot: number; cumWords: number } | null {
  const m = /^gap-(-?\d+)-(\d+)$/.exec(id);
  if (!m) return null;
  return { slot: Number(m[1]), cumWords: Number(m[2]) };
}

function imageId(promptId: string): string {
  return `image-${promptId}`;
}

function parseImageId(id: string): string | null {
  return id.startsWith("image-") ? id.slice("image-".length) : null;
}

// Resolve the URL of the SFW row that a paired NSFW row would render
// next to. Used for tray thumbnails when the orphan has no own image
// (defensive — currently every approved row has an image_id).
function resolveImageUrl(
  prompt: WebsiteImagePrompt,
  imageUrls: Record<string, string>
): string | null {
  return prompt.image_id ? imageUrls[prompt.image_id] || null : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WebsitePreview({
  postId,
  partNumber,
  title,
  websiteContent,
  prompts,
  imageUrls,
  onPromptPatch,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEditing,
  onSaveEdit,
  onCancelEditing,
  saving,
}: WebsitePreviewProps) {
  const [error, setError] = useState<string | null>(null);
  const [heroPickerOpen, setHeroPickerOpen] = useState(false);
  const [heroExcludeConfirm, setHeroExcludeConfirm] = useState<string | null>(
    null
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );

  // ---------------------------------------------------------------------------
  // Derived: blocks, cumulative words, image partitioning
  // ---------------------------------------------------------------------------

  const blocks = useMemo<StoryBlock[]>(
    () => splitBlocks(websiteContent),
    [websiteContent]
  );
  const cumulative = useMemo(() => cumulativeParagraphWords(blocks), [blocks]);
  const totalWords = cumulative.at(-1) ?? 0;

  const facebookSfw = useMemo(
    () => prompts.filter((p) => p.image_type === "facebook_sfw"),
    [prompts]
  );

  const heroPrompt = useMemo(
    () =>
      facebookSfw.find((p) => p.is_chapter_hero && !p.excluded_from_publish) ||
      null,
    [facebookSfw]
  );

  // Inline images: any website-side prompt with a position, ordered by
  // position. Excluded rows stay in the layout (rendered dimmed) so
  // editors see what they removed.
  const inlineImages = useMemo(() => {
    return prompts
      .filter(
        (p) =>
          (p.image_type === "website_only" ||
            p.image_type === "website_nsfw_paired") &&
          p.position_after_word != null
      )
      .sort((a, b) => (a.position_after_word ?? 0) - (b.position_after_word ?? 0));
  }, [prompts]);

  const orphans = useMemo(() => {
    return prompts.filter(
      (p) =>
        (p.image_type === "website_only" ||
          p.image_type === "website_nsfw_paired") &&
        p.position_after_word == null
    );
  }, [prompts]);

  const orphanCount = orphans.length;

  // ---------------------------------------------------------------------------
  // Actions: optimistic update with rollback
  // ---------------------------------------------------------------------------

  const handleSetHero = useCallback(
    async (newHeroId: string | null) => {
      // Snapshot for rollback: every facebook_sfw row's hero flag.
      const before = new Map<string, boolean>();
      for (const p of facebookSfw) before.set(p.id, p.is_chapter_hero);

      for (const p of facebookSfw) {
        const next = newHeroId === p.id;
        if (p.is_chapter_hero !== next) {
          onPromptPatch(p.id, { is_chapter_hero: next });
        }
      }
      setHeroPickerOpen(false);

      try {
        await setHero(postId, newHeroId);
        setError(null);
      } catch (e) {
        before.forEach((was, id) => {
          onPromptPatch(id, { is_chapter_hero: was });
        });
        setError(e instanceof Error ? e.message : "Failed to set hero");
      }
    },
    [facebookSfw, onPromptPatch, postId]
  );

  const handleToggleExclude = useCallback(
    async (prompt: WebsiteImagePrompt) => {
      const wasExcluded = prompt.excluded_from_publish;
      const wasHero = prompt.is_chapter_hero;
      const next = !wasExcluded;

      // Confirm before excluding the hero — leaves the chapter with
      // no top image until a new hero is picked.
      if (next && wasHero) {
        if (heroExcludeConfirm !== prompt.id) {
          setHeroExcludeConfirm(prompt.id);
          return;
        }
        setHeroExcludeConfirm(null);
      }

      onPromptPatch(prompt.id, {
        excluded_from_publish: next,
        is_chapter_hero: next ? false : wasHero,
      });

      try {
        const result = await setExcluded(postId, prompt.id, next);
        // Reconcile with server truth.
        onPromptPatch(prompt.id, {
          excluded_from_publish: result.excluded,
          is_chapter_hero: result.heroCleared ? false : wasHero && !next,
        });
        setError(null);
      } catch (e) {
        onPromptPatch(prompt.id, {
          excluded_from_publish: wasExcluded,
          is_chapter_hero: wasHero,
        });
        setError(e instanceof Error ? e.message : "Failed to update");
      }
    },
    [postId, onPromptPatch, heroExcludeConfirm]
  );

  const handleSetPosition = useCallback(
    async (promptId: string, newPosition: number | null) => {
      const target = prompts.find((p) => p.id === promptId);
      if (!target) return;
      if (target.position_after_word === newPosition) return;
      const before = target.position_after_word;

      onPromptPatch(promptId, { position_after_word: newPosition });

      try {
        await setImagePosition(postId, promptId, newPosition);
        setError(null);
      } catch (e) {
        onPromptPatch(promptId, { position_after_word: before });
        setError(
          e instanceof Error ? e.message : "Failed to reposition image"
        );
      }
    },
    [postId, prompts, onPromptPatch]
  );

  // ---------------------------------------------------------------------------
  // Drag end
  // ---------------------------------------------------------------------------

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const promptId = parseImageId(String(active.id));
      if (!promptId) return;

      if (over.id === TRAY_ID) {
        void handleSetPosition(promptId, null);
        return;
      }

      const gap = parseGapId(String(over.id));
      if (gap) {
        void handleSetPosition(promptId, gap.cumWords);
      }
    },
    [handleSetPosition]
  );

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  // Group inline images by their cumulative-word slot so we can render
  // all images that anchor to the same gap together. If two images
  // share position_after_word=N, they render side-by-side at that gap.
  const imagesByGapSlot = useMemo(() => {
    // Map slot index → images at that slot. Slot index is the index of
    // the LAST block whose cumulative count <= image.position_after_word.
    const map = new Map<number, WebsiteImagePrompt[]>();

    for (const img of inlineImages) {
      const target = img.position_after_word ?? 0;
      // Find the largest slot s such that cumulative[s] >= target;
      // images render AFTER block s where s is the smallest index with
      // cumulative[s] >= target. If target > totalWords, render at end.
      let slot = blocks.length - 1;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].kind !== "paragraph") continue;
        if (cumulative[i] >= target) {
          slot = i;
          break;
        }
      }
      const arr = map.get(slot) ?? [];
      arr.push(img);
      map.set(slot, arr);
    }
    return map;
  }, [inlineImages, blocks, cumulative]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Banners */}
        {!heroPrompt && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>No hero set — pick one to publish this chapter.</span>
          </div>
        )}
        {orphanCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              {orphanCount} image{orphanCount === 1 ? "" : "s"} have no
              position. Drag from the tray into the prose.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
          {/* === Reading column === */}
          <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-6 sm:p-8">
            <h2 className="text-xl font-bold text-zinc-100 mb-1">{title}</h2>
            <p className="text-sm text-zinc-500 mb-6">Part {partNumber}</p>
            <Separator className="mb-6 bg-zinc-800" />

            {/* Hero slot */}
            <HeroSlot
              hero={heroPrompt}
              imageUrls={imageUrls}
              candidates={facebookSfw.filter((p) => !p.excluded_from_publish)}
              isOpen={heroPickerOpen}
              onOpen={() => setHeroPickerOpen(true)}
              onClose={() => setHeroPickerOpen(false)}
              onPick={handleSetHero}
              onToggleExclude={handleToggleExclude}
              heroExcludeConfirm={heroExcludeConfirm}
              onCancelHeroExclude={() => setHeroExcludeConfirm(null)}
            />

            {isEditing ? (
              <div className="space-y-2 mt-6 font-serif">
                <Textarea
                  value={editValue}
                  onChange={(e) => onEditValueChange(e.target.value)}
                  rows={16}
                  className="text-sm bg-zinc-900 text-zinc-200 border-zinc-700 leading-relaxed"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={onSaveEdit}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={onCancelEditing}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="group relative mt-6 font-serif">
                <button
                  onClick={onStartEditing}
                  className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-700 text-zinc-200 rounded-full p-1.5 z-20"
                  title="Edit website content"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>

                {/* First gap (before any block) */}
                <GapDropZone
                  slot={-1}
                  cumWords={0}
                  hasContentAbove={false}
                />

                {blocks.map((block, i) => (
                  <BlockWithGap
                    key={i}
                    block={block}
                    index={i}
                    cumulativeAfter={cumulative[i]}
                    images={imagesByGapSlot.get(i) ?? []}
                    imageUrls={imageUrls}
                    onToggleExclude={handleToggleExclude}
                    heroExcludeConfirm={heroExcludeConfirm}
                    onCancelHeroExclude={() => setHeroExcludeConfirm(null)}
                  />
                ))}

                {/* Final tail gap (writes position == totalWords; lands at end) */}
                <GapDropZone
                  slot={blocks.length}
                  cumWords={totalWords}
                  hasContentAbove
                  trailing
                />
              </div>
            )}
          </div>

          {/* === Tray column === */}
          <UnplacedTray
            orphans={orphans}
            imageUrls={imageUrls}
            onToggleExclude={handleToggleExclude}
          />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Hover an image to reposition or exclude · Click a hero to swap
        </p>
      </div>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// Hero slot
// ---------------------------------------------------------------------------

interface HeroSlotProps {
  hero: WebsiteImagePrompt | null;
  imageUrls: Record<string, string>;
  candidates: WebsiteImagePrompt[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (id: string | null) => void;
  onToggleExclude: (prompt: WebsiteImagePrompt) => void;
  heroExcludeConfirm: string | null;
  onCancelHeroExclude: () => void;
}

function HeroSlot({
  hero,
  imageUrls,
  candidates,
  isOpen,
  onOpen,
  onClose,
  onPick,
  onToggleExclude,
  heroExcludeConfirm,
  onCancelHeroExclude,
}: HeroSlotProps) {
  if (!hero) {
    return (
      <div className="space-y-2">
        <button
          onClick={onOpen}
          className="w-full aspect-[16/9] rounded-lg border-2 border-dashed border-red-500/40 bg-red-500/5 flex flex-col items-center justify-center gap-2 text-red-300 hover:bg-red-500/10 transition-colors"
        >
          <AlertCircle className="h-6 w-6" />
          <span className="text-sm font-medium">
            No hero set — click to choose
          </span>
        </button>
        {isOpen && (
          <HeroPicker
            candidates={candidates}
            currentId={null}
            imageUrls={imageUrls}
            onPick={onPick}
            onClose={onClose}
          />
        )}
      </div>
    );
  }

  const url = resolveImageUrl(hero, imageUrls);
  const isExcludedOverlay = hero.excluded_from_publish;
  const showHeroExcludeConfirm = heroExcludeConfirm === hero.id;

  return (
    <div className="space-y-2">
      <div className="group relative aspect-[16/9] rounded-lg overflow-hidden bg-zinc-900">
        {url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={hero.character_name || "Chapter hero"}
            className={`h-full w-full object-cover transition-opacity ${
              isExcludedOverlay ? "opacity-40" : ""
            }`}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-zinc-500">
            <ImageOff className="h-8 w-8" />
          </div>
        )}

        {isExcludedOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <button
              onClick={() => onToggleExclude(hero)}
              className="px-3 py-1.5 rounded-md bg-zinc-900/90 text-xs font-medium text-zinc-100 line-through hover:bg-zinc-800"
            >
              Excluded — click to restore
            </button>
          </div>
        )}

        <button
          onClick={onOpen}
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 flex items-center justify-center text-amber-100 text-sm font-medium"
        >
          <Star className="mr-2 h-4 w-4 fill-amber-300" />
          Change hero
        </button>

        {!isExcludedOverlay && (
          <button
            onClick={() => onToggleExclude(hero)}
            className="absolute top-2 right-2 z-10 rounded-full bg-black/70 hover:bg-black/90 text-white p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Exclude from publish"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-amber-500/90 text-amber-950 px-1.5 py-0.5 text-[10px] font-semibold">
          <Star className="h-3 w-3 fill-amber-950" />
          Hero
        </div>
      </div>

      {showHeroExcludeConfirm && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-2">
          <p>
            This is the chapter hero. Excluding it will leave the chapter with
            no top image until you pick a new hero.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={() => onToggleExclude(hero)}
            >
              Exclude anyway
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onCancelHeroExclude}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isOpen && (
        <HeroPicker
          candidates={candidates}
          currentId={hero.id}
          imageUrls={imageUrls}
          onPick={onPick}
          onClose={onClose}
        />
      )}
    </div>
  );
}

function HeroPicker({
  candidates,
  currentId,
  imageUrls,
  onPick,
  onClose,
}: {
  candidates: WebsiteImagePrompt[];
  currentId: string | null;
  imageUrls: Record<string, string>;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400 flex items-center justify-between">
        <span>No SFW images available on this chapter.</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={onClose}
        >
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-xs font-medium text-zinc-300">Choose chapter hero</p>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={onClose}
        >
          Close
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {candidates.map((c) => {
          const url = resolveImageUrl(c, imageUrls);
          const isCurrent = c.id === currentId;
          return (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className={`group relative aspect-square rounded overflow-hidden border-2 transition-colors ${
                isCurrent
                  ? "border-amber-400"
                  : "border-zinc-700 hover:border-zinc-500"
              }`}
              title={c.character_name || "Hero candidate"}
            >
              {url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={url}
                  alt={c.character_name || ""}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full bg-zinc-800 flex items-center justify-center text-zinc-500">
                  <ImageOff className="h-5 w-5" />
                </div>
              )}
              {isCurrent && (
                <div className="absolute top-1 right-1 rounded-full bg-amber-400 text-amber-950 p-0.5">
                  <CheckCircle2 className="h-3 w-3" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block rendering with drop gaps
// ---------------------------------------------------------------------------

interface BlockWithGapProps {
  block: StoryBlock;
  index: number;
  cumulativeAfter: number;
  images: WebsiteImagePrompt[];
  imageUrls: Record<string, string>;
  onToggleExclude: (prompt: WebsiteImagePrompt) => void;
  heroExcludeConfirm: string | null;
  onCancelHeroExclude: () => void;
}

function BlockWithGap({
  block,
  index,
  cumulativeAfter,
  images,
  imageUrls,
  onToggleExclude,
  heroExcludeConfirm,
  onCancelHeroExclude,
}: BlockWithGapProps) {
  return (
    <>
      {block.kind === "scene-break" && (
        <div
          className="my-8 flex items-center justify-center gap-3 text-zinc-600"
          aria-hidden="true"
        >
          <span className="h-px w-12 bg-zinc-700" />
          <span className="text-xs">&#10022;</span>
          <span className="h-px w-12 bg-zinc-700" />
        </div>
      )}
      {block.kind === "heading" && (
        <h2 className="mb-4 mt-10 text-2xl font-bold text-zinc-100">
          {block.text}
        </h2>
      )}
      {block.kind === "paragraph" && (
        <p className="mb-4 leading-relaxed text-zinc-300">
          {block.text.split("\n").map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      )}

      {/* Drop zone after this block, with any images anchored to this slot */}
      <GapDropZone
        slot={index}
        cumWords={cumulativeAfter}
        hasContentAbove
      >
        {images.map((img) => (
          <DraggableInlineImage
            key={img.id}
            prompt={img}
            imageUrls={imageUrls}
            onToggleExclude={onToggleExclude}
            heroExcludeConfirm={heroExcludeConfirm}
            onCancelHeroExclude={onCancelHeroExclude}
          />
        ))}
      </GapDropZone>
    </>
  );
}

// ---------------------------------------------------------------------------
// Gap drop zone
// ---------------------------------------------------------------------------

function GapDropZone({
  slot,
  cumWords,
  hasContentAbove,
  trailing = false,
  children,
}: {
  slot: number;
  cumWords: number;
  hasContentAbove: boolean;
  trailing?: boolean;
  children?: React.ReactNode;
}) {
  const id = gapId(cumWords, slot);
  const { isOver, setNodeRef } = useDroppable({ id });

  // The gap renders as a thin invisible band most of the time;
  // it grows visible while a drag is over it. When images are present,
  // the band wraps them and stays visible.
  const hasChildren = !!children && (Array.isArray(children) ? children.length > 0 : true);

  return (
    <div
      ref={setNodeRef}
      className={`relative transition-colors ${
        hasChildren ? "my-6" : trailing ? "mt-6 mb-2 h-4" : "h-3"
      } ${
        isOver
          ? "ring-2 ring-amber-400/70 ring-offset-2 ring-offset-zinc-950 rounded"
          : ""
      } ${hasContentAbove ? "" : "mt-0"}`}
    >
      {isOver && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-amber-400/60" />
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline image (draggable, with exclude overlay)
// ---------------------------------------------------------------------------

function DraggableInlineImage({
  prompt,
  imageUrls,
  onToggleExclude,
  heroExcludeConfirm,
  onCancelHeroExclude,
}: {
  prompt: WebsiteImagePrompt;
  imageUrls: Record<string, string>;
  onToggleExclude: (p: WebsiteImagePrompt) => void;
  heroExcludeConfirm: string | null;
  onCancelHeroExclude: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: imageId(prompt.id) });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  const url = resolveImageUrl(prompt, imageUrls);
  const isExcluded = prompt.excluded_from_publish;
  const isHero = prompt.is_chapter_hero;
  const showConfirm = heroExcludeConfirm === prompt.id;

  return (
    <figure
      ref={setNodeRef}
      style={style}
      className="group relative my-6 mx-auto max-w-md"
    >
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt={prompt.character_name || "Story illustration"}
          className={`rounded-lg w-full shadow-lg shadow-black/40 transition-opacity ${
            isExcluded ? "opacity-40" : ""
          }`}
        />
      ) : (
        <div className="aspect-[4/5] w-full rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-600">
          <ImageOff className="h-8 w-8" />
        </div>
      )}

      {isExcluded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onClick={() => onToggleExclude(prompt)}
            className="px-3 py-1.5 rounded-md bg-zinc-900/90 text-xs font-medium text-zinc-100 line-through hover:bg-zinc-800"
          >
            Excluded — click to restore
          </button>
        </div>
      )}

      {/* Drag handle (top-left). Pointer interaction routes through
          dnd-kit listeners to avoid swallowing the parent figure's
          click semantics. */}
      <button
        ref={null}
        type="button"
        {...listeners}
        {...attributes}
        className="absolute top-2 left-2 z-10 rounded bg-black/70 hover:bg-black/90 text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
        title="Drag to reposition"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Exclude (top-right) */}
      {!isExcluded && (
        <button
          onClick={() => onToggleExclude(prompt)}
          className="absolute top-2 right-2 z-10 rounded-full bg-black/70 hover:bg-black/90 text-white p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Exclude from publish"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {isHero && (
        <div className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-amber-500/90 text-amber-950 px-1.5 py-0.5 text-[10px] font-semibold">
          <Star className="h-3 w-3 fill-amber-950" />
          Hero
        </div>
      )}

      {showConfirm && (
        <div className="absolute inset-x-0 -bottom-2 translate-y-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-2 z-20">
          <p>
            This is the chapter hero. Excluding it will leave the chapter with
            no top image until you pick a new hero.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={() => onToggleExclude(prompt)}
            >
              Exclude anyway
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onCancelHeroExclude}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Unplaced images tray
// ---------------------------------------------------------------------------

function UnplacedTray({
  orphans,
  imageUrls,
  onToggleExclude,
}: {
  orphans: WebsiteImagePrompt[];
  imageUrls: Record<string, string>;
  onToggleExclude: (p: WebsiteImagePrompt) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: TRAY_ID });

  return (
    <aside
      ref={setNodeRef}
      className={`rounded-lg border bg-zinc-900/50 p-3 transition-colors ${
        isOver
          ? "border-amber-400/70 bg-amber-500/5"
          : "border-zinc-800"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Unplaced images
        </p>
        <span className="text-xs text-zinc-500">
          {orphans.length === 0 ? "0 unplaced" : orphans.length}
        </span>
      </div>
      {orphans.length === 0 ? (
        <p className="text-xs text-zinc-600 italic py-3 text-center">
          Drop here to remove an image from the prose flow.
        </p>
      ) : (
        <div className="space-y-2">
          {orphans.map((o) => (
            <TrayCard
              key={o.id}
              prompt={o}
              imageUrls={imageUrls}
              onToggleExclude={onToggleExclude}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function TrayCard({
  prompt,
  imageUrls,
  onToggleExclude,
}: {
  prompt: WebsiteImagePrompt;
  imageUrls: Record<string, string>;
  onToggleExclude: (p: WebsiteImagePrompt) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: imageId(prompt.id) });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  const url = resolveImageUrl(prompt, imageUrls);
  const isExcluded = prompt.excluded_from_publish;
  const names = [prompt.character_name, prompt.secondary_character_name]
    .filter(Boolean)
    .join(" + ");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative rounded border border-zinc-800 bg-zinc-950 p-1.5 flex items-center gap-2"
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="text-zinc-500 hover:text-zinc-200 cursor-grab active:cursor-grabbing"
        title="Drag into the prose"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-zinc-900">
        {url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={names || "Unplaced image"}
            className={`h-full w-full object-cover ${
              isExcluded ? "opacity-40" : ""
            }`}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-zinc-600">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-zinc-200 truncate">
          {names || "Unnamed scene"}
        </p>
        <p className="text-[10px] text-zinc-500 capitalize">
          {prompt.image_type.replace(/_/g, " ")}
        </p>
      </div>
      <button
        onClick={() => onToggleExclude(prompt)}
        className="text-zinc-500 hover:text-zinc-200 p-1"
        title={isExcluded ? "Restore" : "Exclude from publish"}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
