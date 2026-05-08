"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// MEET THE CAST — Phase 4 public-site character profile cards.
//
// Renders below the cover/blurb hero on the story detail page. Replaces
// the legacy "Characters" section that showed name + role + portrait only.
//
// Behaviour:
//   - One expanded card at a time
//   - Click a different card → previous collapses, new expands
//   - Click the same expanded card → collapses
//   - Click anywhere outside any card → collapses the active one
//   - Conditional render + opacity fade for the expanded body (no
//     height-auto transition — predictable mobile reflow, no overflow
//     gotchas)
//   - Siblings stay in their grid slot when one expands; the active
//     card grows downward, the row uses align-items: start so siblings
//     don't get stretched
// ─────────────────────────────────────────────────────────────────────────

export interface CastCharacter {
  /** story_characters.id — stable per linkage. Used as react key. */
  id: string;
  name: string;
  role: string | null;
  card_image_url: string | null;
  archetype_tag: string | null;
  vibe_line: string | null;
  wants: string | null;
  needs: string | null;
  defining_quote: string | null;
  watch_out_for: string | null;
  bio_short: string | null;
}

interface Props {
  characters: CastCharacter[];
}

export function MeetTheCast({ characters }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click-outside collapses the active card. We listen on the document
  // and ignore clicks that land inside the container — clicks inside on
  // a card are handled by the card's onClick (toggle/swap), so the
  // outside listener never fights with an inside selection.
  useEffect(() => {
    if (!activeId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current && containerRef.current.contains(target)) return;
      setActiveId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeId]);

  const onCardClick = useCallback((id: string) => {
    setActiveId((prev) => (prev === id ? null : id));
  }, []);

  if (characters.length === 0) return null;

  return (
    <section className="mb-12" aria-labelledby="cast-heading">
      <h2
        id="cast-heading"
        className="mb-6 text-sm font-semibold uppercase tracking-widest text-warm-400"
      >
        MEET THE CAST
      </h2>
      <div
        ref={containerRef}
        className="grid grid-cols-2 items-start gap-4 md:grid-cols-4"
      >
        {characters.map((char) => (
          <CastCard
            key={char.id}
            character={char}
            expanded={activeId === char.id}
            onToggle={() => onCardClick(char.id)}
          />
        ))}
      </div>
    </section>
  );
}

interface CastCardProps {
  character: CastCharacter;
  expanded: boolean;
  onToggle: () => void;
}

function CastCard({ character, expanded, onToggle }: CastCardProps) {
  const hasImage = Boolean(character.card_image_url);
  const expandedBodyId = `cast-body-${character.id}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={expandedBodyId}
      className={`group flex flex-col overflow-hidden rounded-xl border bg-surface-raised text-left transition-colors ${
        expanded
          ? "border-amber-600/60 shadow-[0_0_30px_-12px_rgba(217,119,6,0.45)]"
          : "border-amber-900/20 hover:border-amber-700/40"
      }`}
    >
      {hasImage ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={character.card_image_url ?? undefined}
          alt={character.name}
          className="aspect-[4/5] w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-[4/5] w-full items-center justify-center bg-surface-overlay">
          <span className="text-2xl text-warm-500">{character.name[0]}</span>
        </div>
      )}

      {/* Always-visible card footer — name, archetype, vibe line. */}
      <div className="space-y-1.5 p-3">
        <p
          className="text-base font-semibold leading-tight text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {character.name}
        </p>
        {character.archetype_tag && (
          <p className="inline-block rounded-full border border-amber-900/40 bg-amber-900/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300/90">
            {character.archetype_tag}
          </p>
        )}
        {character.vibe_line && (
          <p className="text-xs italic leading-snug text-warm-300">
            {character.vibe_line}
          </p>
        )}
      </div>

      {/* Expanded body — conditional render + opacity fade. align-items:
          start on the parent grid keeps sibling cards short while this
          one grows. */}
      {expanded && (
        <div
          id={expandedBodyId}
          className="border-t border-amber-900/20 bg-surface-overlay/40 px-3 py-4 text-sm text-warm-200 opacity-0 transition-opacity duration-300"
          style={{ animation: "fadeIn 250ms ease-out forwards" }}
        >
          {character.defining_quote && (
            <blockquote
              className="mb-4 border-l-2 border-amber-600/60 pl-3 text-xs italic leading-[1.7] text-warm-100 sm:text-sm"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {character.defining_quote}
            </blockquote>
          )}

          <dl className="space-y-3">
            {character.wants && (
              <Field label="Wants" value={character.wants} />
            )}
            {character.needs && (
              <Field label="Needs" value={character.needs} />
            )}
            {character.watch_out_for && (
              <Field label="Watch out for" value={character.watch_out_for} />
            )}
          </dl>

          {character.bio_short && (
            <p className="mt-4 text-xs leading-[1.7] text-warm-200 sm:text-sm">
              {character.bio_short}
            </p>
          )}
        </div>
      )}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-amber-700/80">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs leading-snug text-warm-200 sm:text-sm">
        {value}
      </dd>
    </div>
  );
}
