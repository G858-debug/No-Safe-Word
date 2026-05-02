"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Upload, Loader2 } from "lucide-react";

interface PoseTemplate {
  id: string;
  name: string;
  pose_description: string;
  reference_url: string | null;
  created_at: string;
}

export default function PoseTemplatesPage() {
  const [templates, setTemplates] = useState<PoseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/pose-templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !description.trim() || !file) {
      setError("All fields are required");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("pose_description", description.trim());
      formData.append("image", file);
      const res = await fetch("/api/pose-templates", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Upload failed");
        return;
      }
      setName("");
      setDescription("");
      setFile(null);
      // Reset the file input element
      const input = document.getElementById("pose-image-input") as HTMLInputElement | null;
      if (input) input.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this pose template? Image prompts using it will be unlinked but not regenerated.")) {
      return;
    }
    const res = await fetch(`/api/pose-templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data?.error ?? "Delete failed");
    }
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Pose templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reusable poses. Mistral wraps the chosen template&apos;s description with
          setting/wardrobe/lighting; the reference image is sent to Siray as a
          third i2i input alongside the character face portraits.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Add a new template</h2>
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Plowcam"
                className="mt-1 w-full rounded border border-border/50 bg-muted/30 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pose description (Mistral consumes this)
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe the body positions, camera framing, and any constraints. e.g. 'Female lying face-down on her front, head turned to camera, both arms stretched forward and resting on a pillow. Male partner kneeling behind from above, hands gripping her hips. Top-down camera angle showing her face prominently in the lower frame and his torso/arms in the upper frame.'"
                className="mt-1 resize-y bg-muted/30 text-sm"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reference image (sent to Siray as i2i input)
              </label>
              <input
                id="pose-image-input"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-muted/50 file:px-3 file:py-1.5 file:text-xs file:text-foreground hover:file:bg-muted"
                required
              />
              {file && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {file.name} ({Math.round(file.size / 1024)} KB)
                </p>
              )}
            </div>

            {error && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}

            <Button type="submit" disabled={uploading} className="text-sm">
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Add template
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">
          Existing templates ({templates.length})
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No templates yet. Add one above.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {templates.map((t) => (
              <Card key={t.id}>
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    {t.reference_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.reference_url}
                        alt={t.name}
                        className="h-32 w-32 rounded border border-border/50 object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{t.name}</h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDelete(t.id)}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                        {t.pose_description}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
