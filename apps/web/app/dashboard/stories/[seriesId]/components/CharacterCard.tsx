"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  };
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
  onUpdate: () => void;
}

export function CharacterCard({ character, onUpdate }: Props) {
  const [loraProgress, setLoraProgress] = useState<LoraProgress | null>(null);
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const [genImageUrl, setGenImageUrl] = useState<string | null>(null);
  const [genImageId, setGenImageId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const desc = character.characters.description as Record<string, string>;
  const name = character.characters.name;

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
          {desc.gender}, {desc.age}, {desc.ethnicity}
          {desc.distinguishingFeatures ? ` — ${desc.distinguishingFeatures}` : ""}
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
            loraProgress={loraProgress}
            onTrain={handleTrainLora}
            onResume={handleResumeTraining}
            isTraining={isTraining}
            error={loraProgress?.progress?.error || null}
          />
        )}

        {currentStage === "training" && (
          <TrainingStage loraProgress={loraProgress} />
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
      </CardContent>
    </Card>
  );
}

// ── Stage sub-components ──

function PortraitStage({
  character, imageUrl, imageId, isGenerating, prompt, onPromptChange,
  onGenerate, onApprove, approvedPortraitUrl, approvedBodyUrl,
}: {
  character: CharacterFromAPI;
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
          <p className="text-sm text-muted-foreground">
            {needsPortrait
              ? "Generate a face portrait to establish the character's identity."
              : "Generate a full-body image to establish build and proportions."}
          </p>

          <Textarea
            placeholder="Optional: custom prompt override (min 20 chars)"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            className="min-h-[60px] text-sm"
          />

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
  character, loraProgress, onTrain, onResume, isTraining, error,
}: {
  character: CharacterFromAPI;
  loraProgress: LoraProgress | null;
  onTrain: () => void;
  onResume: () => void;
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
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">
          {status === "generating_dataset" ? "Generating training images..." : "Auto-reviewing images with Claude Vision..."}
        </p>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{ width: status === "generating_dataset" ? "40%" : "70%" }} />
        </div>
        <p className="text-xs text-muted-foreground">This may take a few minutes.</p>
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
            <a href={`dataset-approval/${character.id}`}>Review Dataset</a>
          </Button>
          <Button size="sm" onClick={onResume}>
            Continue Training
          </Button>
        </div>
      </div>
    );
  }

  // Failed — show error with retry
  if (status === "failed") {
    return (
      <div className="space-y-3">
        <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3">
          <p className="text-sm text-red-400">{loraProgress?.progress?.error || "Training failed"}</p>
        </div>
        <Button onClick={onTrain} variant="outline" size="sm">
          Retry Training
        </Button>
      </div>
    );
  }

  return null;
}

function TrainingStage({ loraProgress }: { loraProgress: LoraProgress | null }) {
  const status = loraProgress?.status || "training";
  const podId = loraProgress?.progress?.podId;

  const statusLabel: Record<string, string> = {
    captioning: "Captioning images...",
    packaging_dataset: "Packaging dataset...",
    training: "Training on RunPod...",
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{statusLabel[status] || "Training in progress..."}</p>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{
          width: status === "captioning" ? "20%" : status === "packaging_dataset" ? "35%" : "60%",
        }} />
      </div>
      {podId && (
        <p className="text-xs text-muted-foreground font-mono">Pod: {podId.substring(0, 16)}...</p>
      )}
      <p className="text-xs text-muted-foreground">Polling every 10 seconds. No action needed.</p>
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
