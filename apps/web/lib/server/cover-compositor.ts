import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import React from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

// ============================================================
// Cover typography compositor
// ============================================================
// Pure layout/rendering library. Takes an approved 1024×1536 base
// image buffer + title/author (+ optional blurb for Prompt 4) and
// produces a JPEG buffer sized for one of four downstream uses.
//
// satori (JSX → SVG) → resvg (SVG → PNG) → sharp (PNG → JPEG).
//
// Fonts are loaded once at module load and cached in memory. The
// compose function does not read the filesystem. Do NOT fetch fonts
// at runtime.
//
// The component is written with React.createElement to keep this in a
// .ts file (no TSX), since Next.js route handlers import it and
// changing file extensions would cascade. Readability cost is real
// but small — the layouts are shallow.
// ============================================================

export type CoverSize = "hero" | "card" | "og" | "email";

export interface ComposeCoverInput {
  /** 1024×1536 raw base image buffer (PNG/JPEG — sharp normalises it). */
  baseImageBuffer: Buffer;
  /** Book title, e.g. "THE LOBOLA LIST". */
  title: string;
  /** Author credit line. Currently always "Nontsikelelo Mabaso". */
  author: string;
  /**
   * Short blurb for landscape layouts (og/email). Prompt 4 integration;
   * ignored in Prompt 3 but accepted so callers don't need to be updated
   * again when blurb wiring lands.
   */
  blurbShort?: string;
  size: CoverSize;
}

export interface ComposeCoverOutput {
  buffer: Buffer;
  width: number;
  height: number;
  /** 8-char sha256 prefix over the JPEG buffer. Used for cache-busting filenames. */
  contentHash: string;
}

// ──────────────────────────── Size specs ────────────────────────────

const SIZE_SPECS: Record<
  CoverSize,
  {
    width: number;
    height: number;
    orientation: "portrait" | "landscape";
  }
> = {
  hero: { width: 1600, height: 2400, orientation: "portrait" },
  card: { width: 600, height: 900, orientation: "portrait" },
  og: { width: 1200, height: 630, orientation: "landscape" },
  email: { width: 1200, height: 600, orientation: "landscape" },
};

// ─────────────────────────── Color tokens ───────────────────────────

const COLOR_OFF_WHITE = "#F5F0E8";
const COLOR_CREAM = "#E5DFD4";
const COLOR_MUTED = "#B8AEA2";
const COLOR_BURGUNDY = "#3A0F14";
const COLOR_AMBER = "#C9A961";

// ───────────────────────── Font loading ─────────────────────────────

// Resolve from the app directory at module load. These paths are
// stable relative to the repo layout; do not lazy-load per request.
const FONTS_DIR = path.join(process.cwd(), "apps/web/public/fonts");

// Module-level cache. A single promise is shared by all callers so we
// don't race on first load.
let _fontsPromise: Promise<{ cormorant: Buffer; inter: Buffer }> | null = null;

function loadFonts(): Promise<{ cormorant: Buffer; inter: Buffer }> {
  if (_fontsPromise) return _fontsPromise;

  _fontsPromise = (async () => {
    // Next.js collects `process.cwd()` differently between dev (repo
    // root) and production (sometimes the app dir). Try both.
    const candidates = [
      path.join(process.cwd(), "apps/web/public/fonts"),
      path.join(process.cwd(), "public/fonts"),
      FONTS_DIR,
    ];

    for (const dir of candidates) {
      try {
        const cormorant = await fs.readFile(path.join(dir, "CormorantGaramond.ttf"));
        const inter = await fs.readFile(path.join(dir, "Inter.ttf"));
        return { cormorant, inter };
      } catch {
        // try next candidate
      }
    }

    throw new Error(
      `Cover compositor failed to load font files. Looked in: ${candidates.join(", ")}. ` +
        `Ensure apps/web/public/fonts/{CormorantGaramond,Inter}.ttf exist.`
    );
  })();

  return _fontsPromise;
}

// ───────────────────────── Layout builders ──────────────────────────

/**
 * Portrait layout (hero + card): base image full-bleed with bottom-
 * third gradient + centered title + author.
 *
 * Typography sizes are percentage-driven so the same builder serves
 * both hero (1600×2400) and card (600×900).
 */
function buildPortraitJsx(args: {
  baseImageDataUrl: string;
  width: number;
  height: number;
  title: string;
  author: string;
}): React.ReactElement {
  const { baseImageDataUrl, width, height, title, author } = args;

  // Typography scales relative to canvas width. Hero-sized values are
  // the design starting point (title ~96px / author ~20px at 1600w) —
  // card (600w) scales proportionally to ~36 / ~10.
  const titleSize = Math.round(width * 0.06); // 1600 → 96, 600 → 36
  const authorSize = Math.max(10, Math.round(width * 0.0125)); // 1600 → 20, 600 → 8 (clamped)
  const titleSpacing = Math.round(width * 0.00125); // 1600 → 2
  const authorSpacing = Math.max(2, Math.round(width * 0.003)); // 1600 → ~5
  const authorMarginTop = Math.round(height * 0.027); // 1600×2400 → ~64, 600×900 → ~24

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        width,
        height,
        position: "relative",
        backgroundColor: "#000",
      },
    },
    // Base image, full-bleed
    React.createElement("img", {
      src: baseImageDataUrl,
      width,
      height,
      style: {
        width: "100%",
        height: "100%",
        objectFit: "cover",
        position: "absolute",
        top: 0,
        left: 0,
      },
    }),
    // Gradient overlay: transparent at 55%, dark at bottom
    React.createElement("div", {
      style: {
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundImage:
          "linear-gradient(to bottom, rgba(20,15,20,0) 55%, rgba(20,15,20,0.85) 100%)",
      },
    }),
    // Text block — positioned at ~77% down
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          top: Math.round(height * 0.73),
          left: 0,
          width,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            fontFamily: "Cormorant Garamond",
            fontWeight: 600,
            fontSize: titleSize,
            letterSpacing: titleSpacing,
            color: COLOR_OFF_WHITE,
            textAlign: "center",
            lineHeight: 1.05,
            padding: `0 ${Math.round(width * 0.08)}px`,
            // satori needs display/flex/etc. to lay text out; keep simple
            display: "flex",
            justifyContent: "center",
          },
        },
        title
      ),
      React.createElement(
        "div",
        {
          style: {
            fontFamily: "Inter",
            fontWeight: 500,
            fontSize: authorSize,
            letterSpacing: authorSpacing,
            color: COLOR_CREAM,
            textTransform: "uppercase",
            marginTop: authorMarginTop,
            display: "flex",
            justifyContent: "center",
          },
        },
        author
      )
    )
  );
}

/**
 * Landscape layout (og + email): split composition. Left ~45% is the
 * base image cropped horizontally (center-cropped since base is
 * portrait-taller-than-wide). Right ~55% is a burgundy panel holding
 * title + author + a reserved area for the blurb (Prompt 4).
 */
/**
 * Truncate a blurb to fit the reserved 3-line space in landscape layouts.
 * Satori does not implement CSS line-clamp or text-overflow: ellipsis —
 * text overflows the container instead of being clipped. Clamp at the
 * input layer with a hard character cap that's safe for the smallest
 * landscape panel (email right column, ~420px wide, 14px font, ~3 lines).
 *
 * ~220 chars is conservative and gives visual room for variant length
 * variance without risking a 4th line.
 */
function truncateBlurbForLandscape(blurb: string): string {
  const MAX = 220;
  if (blurb.length <= MAX) return blurb;
  return blurb.slice(0, MAX - 1).trimEnd() + "…";
}

function buildLandscapeJsx(args: {
  baseImageDataUrl: string;
  width: number;
  height: number;
  title: string;
  author: string;
  blurbShort?: string;
}): React.ReactElement {
  const { baseImageDataUrl, width, height, title, author } = args;
  const blurbShort = args.blurbShort ? truncateBlurbForLandscape(args.blurbShort) : undefined;

  const leftWidth = Math.round(width * 0.45);
  const rightWidth = width - leftWidth - 2; // minus the 2px accent line

  // Typography sized from canvas height. OG/email are both ~600px
  // tall so values are close.
  const titleSize = args.width >= 1200 && args.height < 650 ? 52 : 48;
  const authorSize = 14;
  const blurbSize = args.width >= 1200 && args.height < 650 ? 16 : 14;
  const authorLetterSpacing = 3;

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        width,
        height,
        backgroundColor: COLOR_BURGUNDY,
      },
    },
    // Left: portrait base image, scaled to fit height, horizontally cropped.
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          width: leftWidth,
          height,
          overflow: "hidden",
          position: "relative",
        },
      },
      // The base image is 1024×1536 (2:3 portrait). Left panel is ~540×630
      // for OG — we need to scale the image to fit the panel HEIGHT, which
      // gives it a width of ~420 at og. That leaves 120px of empty panel
      // if we center-align. To cover the panel width, we scale so width
      // covers leftWidth. Base 1024w × 1536h scaled to leftWidth w →
      // height = leftWidth * 1.5. For og this is 810 > 630, so portions
      // top/bottom get cropped equally. object-fit:cover handles this.
      React.createElement("img", {
        src: baseImageDataUrl,
        width: leftWidth,
        height,
        style: {
          width: leftWidth,
          height,
          objectFit: "cover",
          objectPosition: "center top",
        },
      })
    ),
    // Accent line — 2px amber vertical separator
    React.createElement("div", {
      style: {
        width: 2,
        height,
        backgroundColor: COLOR_AMBER,
      },
    }),
    // Right: burgundy text panel
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          width: rightWidth,
          height,
          alignItems: "center",
          justifyContent: "center",
          padding: `${Math.round(height * 0.08)}px ${Math.round(rightWidth * 0.08)}px`,
          // Subtle radial gradient for depth
          backgroundImage: `radial-gradient(ellipse at center, rgba(94, 28, 36, 1) 0%, rgba(58, 15, 20, 1) 75%)`,
        },
      },
      React.createElement(
        "div",
        {
          style: {
            fontFamily: "Cormorant Garamond",
            fontWeight: 600,
            fontSize: titleSize,
            color: COLOR_OFF_WHITE,
            textAlign: "center",
            lineHeight: 1.1,
            letterSpacing: 1,
            display: "flex",
            justifyContent: "center",
          },
        },
        title
      ),
      React.createElement(
        "div",
        {
          style: {
            fontFamily: "Inter",
            fontWeight: 500,
            fontSize: authorSize,
            color: COLOR_CREAM,
            textTransform: "uppercase",
            letterSpacing: authorLetterSpacing,
            marginTop: 20,
            display: "flex",
            justifyContent: "center",
          },
        },
        author
      ),
      // Blurb placeholder spacing: always reserve a fixed block below
      // the author so adding a blurb in Prompt 4 does not reflow the
      // layout. When blurbShort is provided, fill that block with text;
      // when not, render an invisible div of the same height.
      React.createElement(
        "div",
        {
          style: {
            marginTop: 18,
            width: "100%",
            display: "flex",
            justifyContent: "center",
            minHeight: blurbSize * 3 * 1.5, // room for up to 3 lines
          },
        },
        blurbShort
          ? React.createElement(
              "div",
              {
                style: {
                  fontFamily: "Inter",
                  fontWeight: 400,
                  fontSize: blurbSize,
                  color: COLOR_MUTED,
                  textAlign: "center",
                  lineHeight: 1.5,
                  maxWidth: rightWidth * 0.85,
                  display: "flex",
                  justifyContent: "center",
                },
              },
              blurbShort
            )
          : null
      )
    )
  );
}

// ───────────────────────── Public API ───────────────────────────────

/**
 * Render a cover composite for one size. Sequentially-called by the
 * composite-cover endpoint (see route for why parallel would risk OOM).
 */
export async function composeCover(
  input: ComposeCoverInput
): Promise<ComposeCoverOutput> {
  const spec = SIZE_SPECS[input.size];
  const { cormorant, inter } = await loadFonts();

  // Encode the base image as a data URL so satori can embed it.
  // sharp normalises to PNG for consistent rendering.
  const normalisedBase = await sharp(input.baseImageBuffer).png().toBuffer();
  const baseImageDataUrl = `data:image/png;base64,${normalisedBase.toString("base64")}`;

  const jsx =
    spec.orientation === "portrait"
      ? buildPortraitJsx({
          baseImageDataUrl,
          width: spec.width,
          height: spec.height,
          title: input.title,
          author: input.author,
        })
      : buildLandscapeJsx({
          baseImageDataUrl,
          width: spec.width,
          height: spec.height,
          title: input.title,
          author: input.author,
          blurbShort: input.blurbShort,
        });

  const svg = await satori(jsx, {
    width: spec.width,
    height: spec.height,
    fonts: [
      { name: "Cormorant Garamond", data: cormorant, weight: 600, style: "normal" },
      { name: "Inter", data: inter, weight: 400, style: "normal" },
      { name: "Inter", data: inter, weight: 500, style: "normal" },
    ],
  });

  const pngData = new Resvg(svg).render().asPng();

  const jpegBuffer = await sharp(pngData)
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const contentHash = createHash("sha256").update(jpegBuffer).digest("hex").slice(0, 8);

  return {
    buffer: jpegBuffer,
    width: spec.width,
    height: spec.height,
    contentHash,
  };
}

/** Dimensions for a given size. Exported for the route layer to use in filename construction. */
export function sizeDimensions(size: CoverSize): { width: number; height: number } {
  return { width: SIZE_SPECS[size].width, height: SIZE_SPECS[size].height };
}
