import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = process.env.CIVITAI_API_KEY;
  if (!token) {
    return NextResponse.json({ error: "CIVITAI_API_KEY not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query") || "";
  const type = searchParams.get("type") || "Checkpoint"; // "Checkpoint" or "LORA"
  const limit = searchParams.get("limit") || "10";

  try {
    const url = new URL("https://civitai.com/api/v1/models");
    url.searchParams.set("query", query);
    url.searchParams.set("types", type);
    url.searchParams.set("limit", limit);
    url.searchParams.set("sort", "Highest Rated");
    url.searchParams.set("nsfw", "true");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ImageGenerator] CivitAI search failed:", response.status, errorText);
      return NextResponse.json({ error: `CivitAI API error: ${response.status}` }, { status: response.status });
    }

    const data = await response.json();

    const results = (data.items || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      thumbnailUrl: item.modelVersions?.[0]?.images?.[0]?.url || null,
      versions: (item.modelVersions || []).slice(0, 5).map((v: any) => ({
        id: v.id,
        name: v.name,
        urn: `urn:air:${v.baseModel?.toLowerCase()?.includes("pony") ? "sdxl" : v.baseModel?.toLowerCase()?.replace(" ", "") || "sdxl"}:${type === "LORA" ? "lora" : "checkpoint"}:civitai:${item.id}@${v.id}`,
        baseModel: v.baseModel || "Unknown",
        thumbnailUrl: v.images?.[0]?.url || null,
      })),
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[ImageGenerator] Search failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
