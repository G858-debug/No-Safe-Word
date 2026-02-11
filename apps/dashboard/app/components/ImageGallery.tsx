"use client";

import Image from "next/image";
import type { GeneratedImage } from "@no-safe-word/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download,
  ImageIcon,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";

interface ImageGalleryProps {
  images: GeneratedImage[];
  isGenerating: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function ImageGallery({
  images,
  isGenerating,
  onRemove,
  onClear,
}: ImageGalleryProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>Generated Images</CardTitle>
            {images.length > 0 && (
              <Badge variant="secondary">{images.length}</Badge>
            )}
          </div>
          {images.length > 0 && (
            <Button variant="destructive" size="sm" onClick={onClear}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear All
            </Button>
          )}
        </div>
        <CardDescription>
          Your generated images will appear here
        </CardDescription>
      </CardHeader>
      <CardContent>
        {images.length === 0 && !isGenerating ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ImageIcon className="mb-4 h-12 w-12" />
            <p className="text-center">
              No images generated yet.
              <br />
              Configure your character and scene above, then click Generate.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {images.map((image) => (
              <div key={image.id} className="group relative">
                {image.status === "completed" && image.blobUrl ? (
                  <div className="relative overflow-hidden rounded-lg border">
                    <Image
                      src={image.blobUrl}
                      alt={image.prompt}
                      width={image.settings.width}
                      height={image.settings.height}
                      className="h-auto w-full object-cover"
                    />
                    <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-transparent to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <p className="mb-2 line-clamp-2 text-xs text-white">
                        {image.prompt}
                      </p>
                      <p className="mb-2 text-xs text-white/70">
                        {image.settings.width}x{image.settings.height}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          asChild
                        >
                          <a
                            href={image.blobUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Download className="mr-1 h-3 w-3" />
                            Save
                          </a>
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onRemove(image.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : image.status === "failed" ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 p-8">
                    <XCircle className="mb-2 h-8 w-8 text-destructive" />
                    <p className="mb-3 text-sm text-destructive">
                      Generation failed
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRemove(image.id)}
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-lg border p-8">
                    <Skeleton className="mb-3 h-32 w-full rounded-lg" />
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
