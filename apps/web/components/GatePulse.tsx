"use client";

import { useEffect } from "react";

/**
 * Briefly highlight the paragraph immediately above the email gate
 * after the reader returns from the magic-link click. The fragment
 * `#gate-position` anchors the scroll; the pulse draws the eye to
 * the half-finished sentence that triggered the sign-up so the
 * reader knows exactly where to resume reading.
 *
 * Renders nothing. Triggers exactly once on mount when:
 *   - the URL fragment is `#gate-position`
 *   - an element with id `gate-position` exists in the DOM
 *   - at least one <p> sits above the anchor in document order
 *
 * Native browser fragment-scroll can fire before the page has fully
 * hydrated, especially after a server redirect from /auth/confirm.
 * We scroll explicitly here as a belt-and-braces measure — the page
 * may already be at the right position, in which case scrollIntoView
 * is a no-op.
 */
export function GatePulse() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#gate-position") return;

    const anchor = document.getElementById("gate-position");
    if (!anchor) return;

    anchor.scrollIntoView({ behavior: "auto", block: "start" });

    // Walk all <p> elements in document order. The last one whose
    // tree-position precedes the anchor is the paragraph the reader
    // was on when the gate appeared. StoryRenderer outputs literal
    // <p> tags so a plain "p" selector is correct.
    const paragraphs = Array.from(document.querySelectorAll("p"));
    let target: HTMLParagraphElement | null = null;
    for (const p of paragraphs) {
      const pos = p.compareDocumentPosition(anchor);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
        target = p;
      } else {
        break;
      }
    }
    if (!target) return;

    target.classList.add("gate-pulse");
    const timeout = setTimeout(() => {
      target?.classList.remove("gate-pulse");
    }, 3000);

    return () => clearTimeout(timeout);
  }, []);

  return null;
}
