import type { Metadata } from "next";
import { Suspense } from "react";
import { supabase } from "@no-safe-word/story-engine";
import ContinueFlow from "./ContinueFlow";

interface PageProps {
  params: Promise<{ slug: string; partNumber: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { data: series } = await supabase
    .from("story_series")
    .select("title")
    .eq("slug", slug)
    .single();

  const title = series?.title || "Continue Reading";
  return {
    title: `Continue Reading — ${title}`,
    description: `Enter your WhatsApp number to continue reading ${title} on No Safe Word.`,
  };
}

export default async function ContinuePage({ params }: PageProps) {
  const { slug, partNumber: partNumberStr } = await params;
  const partNumber = parseInt(partNumberStr, 10) || 1;

  // Fetch story info for display
  const { data: series } = await supabase
    .from("story_series")
    .select("title, slug")
    .eq("slug", slug)
    .single();

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8 sm:py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1
            className="text-2xl font-bold text-amber-50 sm:text-3xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Continue reading where it gets good
          </h1>
          {series && (
            <p className="mt-3 text-sm text-warm-300">
              {series.title} — Part {partNumber}
            </p>
          )}
        </div>

        <Suspense>
          <ContinueFlow
            storySlug={slug}
            partNumber={partNumber}
            storyTitle={series?.title || null}
          />
        </Suspense>
      </div>
    </div>
  );
}
