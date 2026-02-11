"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Upload,
  BookOpen,
  Users,
  Image as ImageIcon,
  Calendar,
} from "lucide-react";

interface SeriesSummary {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  total_parts: number;
  status: string;
  created_at: string;
  story_posts: { id: string }[];
  story_characters: { id: string }[];
  image_prompt_counts: {
    total: number;
    pending: number;
    generated: number;
    approved: number;
    failed: number;
  };
}

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

export default function StoriesPage() {
  const router = useRouter();
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSeries() {
      try {
        const res = await fetch("/api/stories");
        if (!res.ok) throw new Error("Failed to fetch stories");
        const data = await res.json();
        setSeries(data.series || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stories");
      } finally {
        setLoading(false);
      }
    }
    fetchSeries();
  }, []);

  return (
    <div>
      {/* Actions bar */}
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading..."
            : `${series.length} ${series.length === 1 ? "series" : "series"}`}
        </p>
        <Link href="/dashboard/stories/import">
          <Button>
            <Upload className="mr-2 h-4 w-4" />
            Import New Story
          </Button>
        </Link>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="mt-2 h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && series.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No stories yet</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              Import your first story to get started.
            </p>
            <Link href="/dashboard/stories/import">
              <Button>
                <Upload className="mr-2 h-4 w-4" />
                Import New Story
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Series grid */}
      {!loading && series.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => {
            const statusConfig = STATUS_CONFIG[s.status] || STATUS_CONFIG.draft;
            const imgCounts = s.image_prompt_counts;

            return (
              <Card
                key={s.id}
                className="cursor-pointer transition-colors hover:border-muted-foreground/50"
                onClick={() => router.push(`/dashboard/stories/${s.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">
                      {s.title}
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={`shrink-0 ${statusConfig.className}`}
                    >
                      {statusConfig.label}
                    </Badge>
                  </div>
                  {s.description && (
                    <CardDescription className="line-clamp-2">
                      {s.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-y-2 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>{s.total_parts} parts</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span>
                        {s.story_characters?.length || 0} characters
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <ImageIcon className="h-3.5 w-3.5" />
                      <span>
                        {imgCounts.approved}/{imgCounts.total} images approved
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>
                        {new Date(s.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Image progress bar */}
                  {imgCounts.total > 0 && (
                    <div className="mt-3">
                      <div className="h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-green-500 transition-all"
                          style={{
                            width: `${(imgCounts.approved / imgCounts.total) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
