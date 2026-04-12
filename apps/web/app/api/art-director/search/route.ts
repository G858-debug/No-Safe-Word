import { NextRequest, NextResponse } from "next/server";
import { searchMultipleQueries, parseImageMetadata } from "@/lib/art-director/civitai-client";

export async function POST(request: NextRequest) {
  try {
    const { queries, nsfw, limit } = await request.json();

    if (!queries || !Array.isArray(queries) || queries.length === 0) {
      return NextResponse.json(
        { error: "queries array is required" },
        { status: 400 }
      );
    }

    const results = await searchMultipleQueries(queries, {
      nsfw: nsfw ?? true,
      sort: "Most Reactions",
      period: "AllTime",
      limit: limit ?? 10,
    });

    // Enrich results with parsed recipes
    const enriched = results.map((img: any) => ({
      ...img,
      recipe: parseImageMetadata(img.meta),
    }));

    return NextResponse.json({ results: enriched });
  } catch (err) {
    console.error("[Art Director Search] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
