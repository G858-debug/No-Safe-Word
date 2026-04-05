"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Clipboard, ImageIcon } from "lucide-react";

interface ImageUploaderProps {
  onImageSelected: (base64: string, mimeType: string) => void;
}

export function ImageUploader({ onImageSelected }: ImageUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // Strip the data:mime;base64, prefix
        const base64 = dataUrl.split(",")[1];
        onImageSelected(base64, file.type);
      };
      reader.readAsDataURL(file);
    },
    [onImageSelected]
  );

  // Global paste listener
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) processFile(file);
          return;
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [processFile]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <Card>
      <CardContent className="p-0">
        <div
          className={`flex flex-col items-center justify-center gap-6 rounded-lg border-2 border-dashed p-16 transition-colors ${
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="rounded-full bg-muted p-4">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
          </div>

          <div className="text-center">
            <p className="text-lg font-medium">Paste, drop, or upload an image</p>
            <p className="text-sm text-muted-foreground mt-1">
              Claude Vision will analyze it and suggest prompts, models, and settings to recreate it
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload File
            </Button>
            <Button variant="outline" disabled>
              <Clipboard className="h-4 w-4 mr-2" />
              Ctrl+V to Paste
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processFile(file);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
