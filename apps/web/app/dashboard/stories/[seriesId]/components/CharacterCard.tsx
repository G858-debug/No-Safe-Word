"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { CharacterFromAPI } from "./CharacterApproval";

// ── Stage types ──

type Stage = "portrait" | "dataset" | "training" | "validation" | "ready";

interface LoraProgress {
  loraId?: string;
  status: string;
  progress?: {
    stage: string;
    error?: string;
    validationScore?: number;
    podId?: string;
    triggerWord?: string;
    loraUrl?: string;
    filename?: string;
    deployed?: boolean;
    updatedAt?: string;
  };
}

function formatElapsed(updatedAt?: string): string | null {
  if (!updatedAt) return null;
  const mins = Math.round((Date.now() - new Date(updatedAt).getTime()) / 60_000);
  if (mins < 2) return null; // Don't show for very recent updates
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

// ── Default prompt builder (mirrors server-side pony-character-image.ts) ──

function buildDefaultPrompt(desc: Record<string, string>, stage: "face" | "body"): string {
  const gender = desc.gender || "female";
  const genderTag = gender === "male" ? "1boy" : "1girl";
  const tags: string[] = [genderTag];

  // Skin tone
  if (desc.skinTone) {
    const genderSuffix = gender === "male" ? "male" : "female";
    tags.push(`dark-skinned ${genderSuffix}`, "brown skin");
  }

  // Ethnicity features
  const eth = (desc.ethnicity || "").toLowerCase();
  if (eth.includes("african") || eth.includes("black")) {
    tags.push("full lips", "broad nose");
    const shortMale = gender === "male" && desc.hairStyle &&
      ["fade", "buzz", "crew", "shaved", "close crop", "taper", "waves"].some(s => desc.hairStyle.toLowerCase().includes(s));
    if (!shortMale) tags.push("afro-textured hair");
  }

  // Hair
  if (desc.hairColor) tags.push(`${desc.hairColor.toLowerCase()} hair`);
  if (desc.hairStyle) tags.push(desc.hairStyle.toLowerCase());

  // Eyes
  if (desc.eyeColor) tags.push(`${desc.eyeColor.toLowerCase()} eyes`);

  // Body (full-body only)
  if (stage === "body") {
    if (gender === "female") {
      tags.push("wide hips", "large breasts", "thick thighs", "narrow waist", "voluptuous");
    }
    if (desc.bodyType) tags.push(desc.bodyType.toLowerCase());
  }

  // Age
  if (desc.age) tags.push(`${desc.age} years old`);

  // Distinguishing features
  if (desc.distinguishingFeatures) tags.push(desc.distinguishingFeatures.toLowerCase());

  // Composition
  if (stage === "face") {
    if (gender === "male") {
      tags.push("solo male", "male focus", "masculine", "handsome", "sharp jawline",
        "looking at viewer", "portrait", "head and shoulders", "face focus",
        "soft studio lighting", "clean background", "shallow depth of field");
    } else {
      tags.push("solo female", "looking at viewer", "slight smile",
        "beautiful face", "detailed eyes", "portrait", "head and shoulders", "face focus",
        "soft studio lighting", "clean background", "shallow depth of field");
    }
  } else {
    // Clothing
    if (gender === "female") {
      tags.push("fitted mini skirt", "strappy crop top", "high heels", "fully clothed");
    } else {
      tags.push("fitted henley shirt", "jeans", "casual clothing", "fully clothed");
    }
    if (gender === "male") {
      tags.push("solo male", "male focus", "masculine",
        "standing", "confident pose", "looking at viewer",
        "full body", "head to toe", "warm studio lighting", "clean background");
    } else {
      tags.push("solo female", "standing", "confident pose", "looking at viewer",
        "full body", "head to toe", "warm studio lighting", "clean background");
    }
  }

  return tags.join(", ");
}

// ── Stage determination ──

function getStage(char: CharacterFromAPI, lora: LoraProgress | null): Stage {
  if (lora?.progress?.deployed) return "ready";
  if (lora?.status === "deployed") return "ready";

  if (lora?.status) {
    const s = lora.status;
    if (s === "validating") return "validation";
    if (["training", "captioning", "packaging_dataset"].includes(s)) return "training";
    if (["generating_dataset", "evaluating", "awaiting_dataset_approval"].includes(s)) return "dataset";
    if (s === "failed" || s === "error") {
      return char.approved && char.approved_fullbody ? "dataset" : "portrait";
    }
  }

  if (char.approved && char.approved_fullbody) return "dataset";
  return "portrait";
}

const STAGE_ORDER: Stage[] = ["portrait", "dataset", "training", "validation", "ready"];
const STAGE_LABELS: Record<Stage, string> = {
  portrait: "Portrait",
  dataset: "Training Dataset",
  training: "Training LoRA",
  validation: "Validation",
  ready: "Ready",
};

// ── Main component ──

interface Props {
  character: CharacterFromAPI;
  seriesId: string;
  onUpdate: () => void;
}

export function CharacterCard({ character, seriesId, onUpdate }: Props) {
  const [loraProgress, setLoraProgress] = useState<LoraProgress | null>(null);
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const [genImageUrl, setGenImageUrl] = useState<string | null>(null);
  const [genImageId, setGenImageId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initialDesc = character.characters.description as Record<string, string>;
  const name = character.characters.name;

  // Editable structured fields — initialized from DB, user can modify
  const [editableDesc, setEditableDesc] = useState<Record<string, string>>({ ...initialDesc });

  function updateField(key: string, value: string) {
    setEditableDesc(prev => {
      const updated = { ...prev, [key]: value };
      // Auto-regenerate prompt from updated fields
      const stage: "face" | "body" = character.approved ? "body" : "face";
      setPrompt(buildDefaultPrompt(updated, stage));
      return updated;
    });
  }

  // Pre-fill prompt with default for the current stage
  const currentPortraitStage: "face" | "body" = character.approved ? "body" : "face";
  useEffect(() => {
    if (!prompt) {
      setPrompt(buildDefaultPrompt(editableDesc, currentPortraitStage));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPortraitStage]);

  // Fetch LoRA progress on mount
  useEffect(() => {
    fetchLoraProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLoraProgress = useCallback(async () => {
    try {
      const res = await fetch(`/api/stories/characters/${character.id}/lora-progress`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status !== "no_lora") {
        setLoraProgress(data);
      }
    } catch { /* ignore */ }
  }, [character.id]);

  // Poll for generation job completion
  useEffect(() => {
    if (!genJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${genJobId}`);
        const data = await res.json();
        if (data.completed && data.imageUrl) {
          setGenImageUrl(data.imageUrl);
          setIsGenerating(false);
          setGenJobId(null);
          clearInterval(interval);
        } else if (data.error) {
          setError(data.error);
          setIsGenerating(false);
          setGenJobId(null);
          clearInterval(interval);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [genJobId]);

  // Poll for training progress
  useEffect(() => {
    const stage = getStage(character, loraProgress);
    if (stage !== "dataset" && stage !== "training" && stage !== "validation") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    // Only poll if there's an active LoRA status that warrants polling
    const s = loraProgress?.status;
    if (!s || s === "no_lora" || s === "deployed" || s === "failed" || s === "awaiting_dataset_approval") return;

    pollRef.current = setInterval(async () => {
      await fetchLoraProgress();
    }, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loraProgress?.status, character, fetchLoraProgress]);

  // Refresh parent when LoRA deploys
  useEffect(() => {
    if (loraProgress?.status === "deployed") {
      onUpdate();
    }
  }, [loraProgress?.status, onUpdate]);

  const currentStage = getStage(character, loraProgress);

  // ── Actions ──

  async function handleGenerate(stage: "face" | "body") {
    setError(null);
    setIsGenerating(true);
    setGenImageUrl(null);
    try {
      const res = await fetch(`/api/stories/characters/${character.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          type: stage === "body" ? "fullBody" : "portrait",
          customPrompt: prompt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setGenJobId(data.jobId);
      setGenImageId(data.imageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setIsGenerating(false);
    }
  }

  async function handleApprove(type: "portrait" | "fullBody") {
    if (!genImageId) return;
    setError(null);
    try {
      // Save edited structured data back to the characters table
      // so dataset generation uses the correct description
      const descChanged = JSON.stringify(editableDesc) !== JSON.stringify(initialDesc);
      if (descChanged) {
        const charRes = await fetch(`/api/characters`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: character.characters.id, description: editableDesc }),
        });
        if (!charRes.ok) {
          console.warn("Failed to save character description, continuing with approval");
        }
      }

      const res = await fetch(`/api/stories/characters/${character.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_id: genImageId, type }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Approval failed");
      }
      setGenImageUrl(null);
      setGenImageId(null);
      setPrompt("");
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    }
  }

  async function handleTrainLora() {
    setError(null);
    setIsTraining(true);
    try {
      const res = await fetch(`/api/stories/characters/${character.id}/train-lora`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Training failed to start");
      // Start polling
      await fetchLoraProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start training");
    } finally {
      setIsTraining(false);
    }
  }

  async function handleResumeTraining() {
    setError(null);
    try {
      const res = await fetch(`/api/stories/characters/${character.id}/resume-training`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Resume failed");
      await fetchLoraProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resume failed");
    }
  }

  async function handleResetToPortrait(resetFace: boolean) {
    if (!confirm(resetFace
      ? "This will clear the approved portrait and full-body, archive any LoRA, and start over. Continue?"
      : "This will clear the approved full-body, archive any LoRA, and let you regenerate the body. Continue?"
    )) return;
    setError(null);
    try {
      const res = await fetch(`/api/stories/characters/${character.id}/reset-portrait`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetFace }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Reset failed");
      }
      setLoraProgress(null);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  }

  async function handleForceReset() {
    try {
      const res = await fetch(`/api/stories/characters/${character.id}/lora-progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force-reset" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Reset failed");
      }
      await fetchLoraProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  }

  // ── Render ──

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{name}</CardTitle>
          <Badge variant={currentStage === "ready" ? "default" : "secondary"}>
            {currentStage === "ready" ? "Ready" : STAGE_LABELS[currentStage]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {editableDesc.gender}, {editableDesc.age}, {editableDesc.ethnicity}
          {editableDesc.distinguishingFeatures ? ` — ${editableDesc.distinguishingFeatures}` : ""}
        </p>
      </CardHeader>
      <CardContent>
        {/* Stepper */}
        <div className="space-y-1 mb-4">
          {STAGE_ORDER.map((stage, i) => {
            const isComplete = STAGE_ORDER.indexOf(currentStage) > i;
            const isActive = currentStage === stage;
            return (
              <div key={stage} className="flex items-center gap-2 text-sm">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isComplete ? "bg-green-600 text-white" :
                  isActive ? "bg-blue-600 text-white" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {isComplete ? "✓" : i + 1}
                </div>
                <span className={isActive ? "font-medium" : isComplete ? "text-muted-foreground" : "text-muted-foreground/50"}>
                  {STAGE_LABELS[stage]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 mb-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Active stage content */}
        {currentStage === "portrait" && (
          <PortraitStage
            character={character}
            editableDesc={editableDesc}
            onFieldChange={updateField}
            imageUrl={genImageUrl || character.pending_image_url}
            imageId={genImageId || character.pending_image_id}
            isGenerating={isGenerating}
            prompt={prompt}
            onPromptChange={setPrompt}
            onGenerate={handleGenerate}
            onApprove={handleApprove}
            approvedPortraitUrl={character.approved_image_url}
            approvedBodyUrl={character.approved_fullbody_image_url}
          />
        )}

        {currentStage === "dataset" && (
          <DatasetStage
            character={character}
            seriesId={seriesId}
            loraProgress={loraProgress}
            onTrain={handleTrainLora}
            onResume={handleResumeTraining}
            onForceReset={handleForceReset}
            isTraining={isTraining}
            error={loraProgress?.progress?.error || null}
          />
        )}

        {currentStage === "training" && (
          <TrainingStage loraProgress={loraProgress} onForceReset={handleForceReset} />
        )}

        {currentStage === "validation" && (
          <ValidationStage
            loraProgress={loraProgress}
            onRetrain={handleTrainLora}
          />
        )}

        {currentStage === "ready" && (
          <ReadyStage
            character={character}
            loraProgress={loraProgress}
          />
        )}

        {/* Reset to portrait — available from any stage past portrait */}
        {currentStage !== "portrait" && (
          <div className="mt-4 pt-3 border-t border-muted">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => handleResetToPortrait(true)}>
                Redo Portrait
              </Button>
              {character.approved && (
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => handleResetToPortrait(false)}>
                  Redo Full Body
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Stage sub-components ──

const EDITABLE_FIELDS: Array<{ key: string; label: string; face: boolean; body: boolean }> = [
  { key: "hairStyle", label: "Hair Style", face: true, body: true },
  { key: "hairColor", label: "Hair Color", face: true, body: true },
  { key: "skinTone", label: "Skin Tone", face: true, body: true },
  { key: "eyeColor", label: "Eye Color", face: true, body: false },
  { key: "ethnicity", label: "Ethnicity", face: true, body: true },
  { key: "bodyType", label: "Body Type", face: false, body: true },
  { key: "age", label: "Age", face: true, body: true },
  { key: "distinguishingFeatures", label: "Distinguishing Features", face: true, body: true },
];

function PortraitStage({
  character, editableDesc, onFieldChange, imageUrl, imageId, isGenerating, prompt, onPromptChange,
  onGenerate, onApprove, approvedPortraitUrl, approvedBodyUrl,
}: {
  character: CharacterFromAPI;
  editableDesc: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  imageUrl: string | null;
  imageId: string | null;
  isGenerating: boolean;
  prompt: string;
  onPromptChange: (p: string) => void;
  onGenerate: (stage: "face" | "body") => void;
  onApprove: (type: "portrait" | "fullBody") => void;
  approvedPortraitUrl: string | null;
  approvedBodyUrl: string | null;
}) {
  const needsPortrait = !character.approved;
  const needsBody = character.approved && !character.approved_fullbody;
  const stageLabel = needsPortrait ? "face" : "body";
  const approveLabel = needsPortrait ? "portrait" : "fullBody";
  const [showPrompt, setShowPrompt] = useState(false);

  const relevantFields = EDITABLE_FIELDS.filter(f => needsPortrait ? f.face : f.body);

  return (
    <div className="space-y-4">
      {/* Show approved images */}
      <div className="flex gap-3">
        {approvedPortraitUrl && (
          <div className="text-center">
            <img src={approvedPortraitUrl} alt="Portrait" className="w-24 h-32 object-cover rounded-md border" />
            <p className="text-xs text-green-600 mt-1">Portrait approved</p>
          </div>
        )}
        {approvedBodyUrl && (
          <div className="text-center">
            <img src={approvedBodyUrl} alt="Body" className="w-24 h-32 object-cover rounded-md border" />
            <p className="text-xs text-green-600 mt-1">Body approved</p>
          </div>
        )}
      </div>

      {/* Generation area */}
      {(needsPortrait || needsBody) && (
        <>
          {/* Editable character fields */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {relevantFields.map(({ key, label }) => (
              <div key={key} className={key === "distinguishingFeatures" ? "col-span-2" : ""}>
                <label className="text-[11px] text-muted-foreground mb-0.5 block">{label}</label>
                <Input
                  value={editableDesc[key] || ""}
                  onChange={(e) => onFieldChange(key, e.target.value)}
                  className="h-7 text-xs"
                  disabled={isGenerating}
                />
              </div>
            ))}
          </div>

          {/* Collapsible prompt preview */}
          <div>
            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPrompt ? "Hide generated prompt" : "Show generated prompt"}
            </button>
            {showPrompt && (
              <Textarea
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                className="mt-1 min-h-[80px] text-[11px] font-mono leading-relaxed bg-muted/30"
                disabled={isGenerating}
              />
            )}
          </div>

          {isGenerating ? (
            <div className="space-y-2">
              <Skeleton className="w-full h-64 rounded-md" />
              <p className="text-sm text-muted-foreground animate-pulse">Generating {stageLabel}...</p>
            </div>
          ) : imageUrl ? (
            <div className="space-y-3">
              <img src={imageUrl} alt="Generated" className="w-full max-w-sm rounded-md border" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onGenerate(stageLabel)}>
                  Regenerate
                </Button>
                <Button size="sm" onClick={() => onApprove(approveLabel)}>
                  Approve {needsPortrait ? "Portrait" : "Body"}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => onGenerate(stageLabel)}>
              Generate {needsPortrait ? "Portrait" : "Body"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function DatasetStage({
  character, seriesId, loraProgress, onTrain, onResume, onForceReset, isTraining, error,
}: {
  character: CharacterFromAPI;
  seriesId: string;
  loraProgress: LoraProgress | null;
  onTrain: () => void;
  onResume: () => void;
  onForceReset: () => void;
  isTraining: boolean;
  error: string | null;
}) {
  const status = loraProgress?.status;

  // No training started yet
  if (!status || status === "no_lora" || status === "pending") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Both portrait and body are approved. Start LoRA training to generate a character identity model.
        </p>
        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
        <Button onClick={onTrain} disabled={isTraining}>
          {isTraining ? "Starting..." : "Train Character LoRA"}
        </Button>
      </div>
    );
  }

  // Dataset generation / evaluation in progress
  if (status === "generating_dataset" || status === "evaluating") {
    const elapsed = formatElapsed(loraProgress?.progress?.updatedAt);
    const elapsedMin = loraProgress?.progress?.updatedAt
      ? Math.round((Date.now() - new Date(loraProgress.progress.updatedAt).getTime()) / 60_000)
      : 0;
    const isLikelyStuck = elapsedMin > 10;
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">
          {status === "generating_dataset" ? "Generating training images..." : "Auto-reviewing images with Claude Vision..."}
        </p>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${isLikelyStuck ? "bg-yellow-500" : "bg-blue-600 animate-pulse"}`} style={{ width: status === "generating_dataset" ? "40%" : "70%" }} />
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {isLikelyStuck
              ? `Appears stuck — running for ${elapsed}. Reset to retry.`
              : `This may take a few minutes.${elapsed ? ` Running for ${elapsed}.` : ""}`}
          </p>
          <Button variant="ghost" size="sm" className="h-6 text-xs" asChild>
            <Link href={`/dashboard/stories/${seriesId}/dataset-approval/${character.id}`}>View images so far</Link>
          </Button>
        </div>
        {isLikelyStuck && (
          <Button variant="destructive" size="sm" onClick={onForceReset}>
            Force Reset
          </Button>
        )}
      </div>
    );
  }

  // Awaiting human approval
  if (status === "awaiting_dataset_approval") {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">Dataset ready for review</p>
        <p className="text-sm text-muted-foreground">
          Images have been auto-curated. Review the dataset on the approval page, then continue.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/stories/${seriesId}/dataset-approval/${character.id}`}>Review Dataset</Link>
          </Button>
          <Button size="sm" onClick={onResume}>
            Continue Training
          </Button>
        </div>
      </div>
    );
  }

  // Failed — show detailed status with actionable options
  if (status === "failed") {
    const errMsg = loraProgress?.progress?.error || "Training failed";
    const isStale = errMsg.includes("stalled");

    // Parse "Only X images passed" from error message
    const passedMatch = errMsg.match(/(\d+) images? passed/);
    const neededMatch = errMsg.match(/need (\d+)/);
    const passed = passedMatch ? parseInt(passedMatch[1]) : null;
    const needed = neededMatch ? parseInt(neededMatch[1]) : 20;

    return (
      <div className="space-y-3">
        <div className={`rounded-md p-3 space-y-2 ${isStale ? "bg-yellow-500/10 border border-yellow-500/30" : "bg-red-500/10 border border-red-500/30"}`}>
          <p className={`text-sm font-medium ${isStale ? "text-yellow-400" : "text-red-400"}`}>
            {isStale ? "Pipeline stalled — automatic recovery" : passed !== null ? "Dataset evaluation incomplete" : "Training failed"}
          </p>
          {passed !== null ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full"
                    style={{ width: `${Math.min(100, (passed / needed) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-red-400 shrink-0">{passed}/{needed} passed</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {passed >= 15
                  ? "Close to the target — review the dataset and approve good images manually, or retry to generate fresh ones."
                  : "Most images failed quality checks. Try editing the character description (hair, features) and retry."}
              </p>
            </div>
          ) : (
            <p className={`text-xs ${isStale ? "text-yellow-400" : "text-red-400"}`}>{errMsg}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {passed !== null && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/stories/${seriesId}/dataset-approval/${character.id}`}>
                  View Dataset ({passed} passed)
                </Link>
              </Button>
              <Button onClick={onResume} variant="outline" size="sm">
                Continue with {passed} images
              </Button>
            </>
          )}
          <Button onClick={onTrain} size="sm">
            Regenerate Dataset
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

function TrainingStage({ loraProgress, onForceReset }: { loraProgress: LoraProgress | null; onForceReset: () => void }) {
  const status = loraProgress?.status || "training";
  const podId = loraProgress?.progress?.podId;
  const elapsed = formatElapsed(loraProgress?.progress?.updatedAt);
  const elapsedMin = loraProgress?.progress?.updatedAt
    ? Math.round((Date.now() - new Date(loraProgress.progress.updatedAt).getTime()) / 60_000)
    : 0;
  const isLikelyStuck = status === "training" ? elapsedMin > 90 : elapsedMin > 15;

  const statusLabel: Record<string, string> = {
    captioning: "Captioning images...",
    packaging_dataset: "Packaging dataset...",
    training: "Training on RunPod...",
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{statusLabel[status] || "Training in progress..."}</p>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${isLikelyStuck ? "bg-yellow-500" : "bg-blue-600 animate-pulse"}`} style={{
          width: status === "captioning" ? "20%" : status === "packaging_dataset" ? "35%" : "60%",
        }} />
      </div>
      {podId && (
        <p className="text-xs text-muted-foreground font-mono">Pod: {podId.substring(0, 16)}...</p>
      )}
      <p className="text-xs text-muted-foreground">
        {isLikelyStuck
          ? `Appears stuck — running for ${elapsed}. Reset to retry.`
          : `Polling every 10 seconds.${elapsed ? ` Running for ${elapsed}.` : ""}`}
      </p>
      {isLikelyStuck && (
        <Button variant="destructive" size="sm" onClick={onForceReset}>
          Force Reset
        </Button>
      )}
    </div>
  );
}

function ValidationStage({
  loraProgress, onRetrain,
}: {
  loraProgress: LoraProgress | null;
  onRetrain: () => void;
}) {
  const score = loraProgress?.progress?.validationScore;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Validating trained LoRA...</p>
      {score != null ? (
        <>
          <p className="text-sm">
            Face match score: <span className="font-bold">{score.toFixed(1)}/10</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Generating test images to verify character consistency.
          </p>
        </>
      ) : (
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{ width: "50%" }} />
        </div>
      )}
      <Button variant="outline" size="sm" onClick={onRetrain}>
        Retrain
      </Button>
    </div>
  );
}

function ReadyStage({
  character, loraProgress,
}: {
  character: CharacterFromAPI;
  loraProgress: LoraProgress | null;
}) {
  const trigger = loraProgress?.progress?.triggerWord;
  const filename = loraProgress?.progress?.filename;

  return (
    <div className="flex items-start gap-4">
      {character.approved_image_url && (
        <img
          src={character.approved_image_url}
          alt={character.characters.name}
          className="w-16 h-20 object-cover rounded-md border"
        />
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-green-600">Character ready for story images</p>
        {trigger && <p className="text-xs text-muted-foreground">Trigger: <code className="bg-muted px-1 rounded">{trigger}</code></p>}
        {filename && <p className="text-xs text-muted-foreground">LoRA: {filename}</p>}
      </div>
    </div>
  );
}
