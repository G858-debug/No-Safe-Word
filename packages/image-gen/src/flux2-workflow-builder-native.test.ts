// Run with: npm test --workspace=@no-safe-word/image-gen
// Tests the native multi-reference Flux 2 workflow builder.
// B1 of the PuLID → native migration plan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlux2NativeWorkflow } from "./flux2-workflow-builder-native";

const BASE_OPTIONS = {
  prompt: "A Black South African woman, full body, soft light. photorealistic",
  width: 1664,
  height: 2496,
  seed: 12345,
  filenamePrefix: "test_output",
};

// ── Helpers ──────────────────────────────────────────────────────────────

function nodeClasses(workflow: Record<string, any>): string[] {
  return Object.values(workflow).map((n: any) => n.class_type);
}

function nodesByClass(
  workflow: Record<string, any>,
  className: string
): Array<{ id: string; node: any }> {
  return Object.entries(workflow)
    .filter(([, n]) => n.class_type === className)
    .map(([id, node]) => ({ id, node }));
}

function assertNoPuLID(workflow: Record<string, any>) {
  const json = JSON.stringify(workflow);
  assert.ok(
    !json.toLowerCase().includes("pulid"),
    "Workflow must not contain any PuLID nodes"
  );
}

function assertNoControlNet(workflow: Record<string, any>) {
  const json = JSON.stringify(workflow).toLowerCase();
  assert.ok(
    !json.includes("controlnet") && !json.includes("flux2fun"),
    "Workflow must not contain any ControlNet nodes"
  );
}

// ── Test 1: Zero references (author-note / text-only case) ───────────────

test("zero references: FluxGuidance reads directly from CLIPTextEncode", () => {
  const workflow = buildFlux2NativeWorkflow({ ...BASE_OPTIONS, references: [] });

  // Required structural nodes present
  const classes = nodeClasses(workflow);
  assert.ok(classes.includes("UNETLoader"), "UNETLoader missing");
  assert.ok(classes.includes("CLIPLoader"), "CLIPLoader missing");
  assert.ok(classes.includes("VAELoader"), "VAELoader missing");
  assert.ok(classes.includes("CLIPTextEncode"), "CLIPTextEncode missing");
  assert.ok(classes.includes("FluxGuidance"), "FluxGuidance missing");
  assert.ok(classes.includes("EmptyFlux2LatentImage"), "EmptyFlux2LatentImage missing");
  assert.ok(classes.includes("Flux2Scheduler"), "Flux2Scheduler missing");
  assert.ok(classes.includes("KSamplerSelect"), "KSamplerSelect missing");
  assert.ok(classes.includes("RandomNoise"), "RandomNoise missing");
  assert.ok(classes.includes("BasicGuider"), "BasicGuider missing");
  assert.ok(classes.includes("SamplerCustomAdvanced"), "SamplerCustomAdvanced missing");
  assert.ok(classes.includes("VAEDecode"), "VAEDecode missing");
  assert.ok(classes.includes("SaveImage"), "SaveImage missing");

  // No reference nodes
  assert.ok(!classes.includes("LoadImage"), "LoadImage should be absent with 0 refs");
  assert.ok(!classes.includes("VAEEncode"), "VAEEncode should be absent with 0 refs");
  assert.ok(!classes.includes("ReferenceLatent"), "ReferenceLatent should be absent with 0 refs");

  // FluxGuidance conditioning wired to CLIPTextEncode (node 200)
  const guidanceNode = workflow["400"];
  assert.ok(guidanceNode, "FluxGuidance must be at node id 400");
  assert.deepEqual(
    guidanceNode.inputs.conditioning,
    ["200", 0],
    "FluxGuidance.conditioning should point to CLIPTextEncode when no refs"
  );

  // BasicGuider conditioning wired to FluxGuidance
  const guiderNode = workflow["504"];
  assert.deepEqual(guiderNode.inputs.conditioning, ["400", 0]);

  // Sampler wiring
  const samplerNode = workflow["505"];
  assert.deepEqual(samplerNode.inputs.noise,   ["503", 0]);
  assert.deepEqual(samplerNode.inputs.guider,  ["504", 0]);
  assert.deepEqual(samplerNode.inputs.sampler, ["502", 0]);
  assert.deepEqual(samplerNode.inputs.sigmas,  ["501", 0]);
  assert.deepEqual(samplerNode.inputs.latent_image, ["500", 0]);

  // VAEDecode reads sampler output
  assert.deepEqual(workflow["600"].inputs.samples, ["505", 0]);

  // Seed is wired
  assert.equal(workflow["503"].inputs.noise_seed, BASE_OPTIONS.seed);

  // SaveImage prefix
  assert.equal(workflow["601"].inputs.filename_prefix, BASE_OPTIONS.filenamePrefix);

  assertNoPuLID(workflow);
  assertNoControlNet(workflow);
});

// Undefined references should behave identically to []
test("undefined references: treated identically to empty array", () => {
  const withEmpty  = buildFlux2NativeWorkflow({ ...BASE_OPTIONS, references: [] });
  const withUndef  = buildFlux2NativeWorkflow({ ...BASE_OPTIONS });
  assert.deepEqual(withEmpty, withUndef);
});

// ── Test 2: One reference (body portrait / character card / single-char scene) ─

test("one reference: single LoadImage → VAEEncode → ReferenceLatent chain", () => {
  const refs = [{ name: "ref_face_abc.jpeg" }];
  const workflow = buildFlux2NativeWorkflow({ ...BASE_OPTIONS, references: refs });

  // Exactly one of each reference node
  assert.equal(nodesByClass(workflow, "LoadImage").length, 1, "Expected exactly 1 LoadImage");
  assert.equal(nodesByClass(workflow, "VAEEncode").length, 1, "Expected exactly 1 VAEEncode");
  assert.equal(nodesByClass(workflow, "ReferenceLatent").length, 1, "Expected exactly 1 ReferenceLatent");

  // Node IDs follow the 300+i*10 pattern
  assert.ok(workflow["300"], "LoadImage should be at id 300");
  assert.ok(workflow["301"], "VAEEncode should be at id 301");
  assert.ok(workflow["302"], "ReferenceLatent should be at id 302");

  // LoadImage gets the reference filename
  assert.equal(workflow["300"].inputs.image, "ref_face_abc.jpeg");

  // VAEEncode wired to LoadImage + VAELoader
  assert.deepEqual(workflow["301"].inputs.pixels, ["300", 0]);
  assert.deepEqual(workflow["301"].inputs.vae,    ["102", 0]);

  // ReferenceLatent: conditioning from CLIPTextEncode, latent from VAEEncode
  assert.deepEqual(workflow["302"].inputs.conditioning, ["200", 0]);
  assert.deepEqual(workflow["302"].inputs.latent,       ["301", 0]);

  // FluxGuidance reads from the final ReferenceLatent
  assert.deepEqual(workflow["400"].inputs.conditioning, ["302", 0]);

  assertNoPuLID(workflow);
  assertNoControlNet(workflow);
});

// ── Test 3: Two references (cover / two-character scene) ─────────────────

test("two references: two-stage LoadImage → VAEEncode → ReferenceLatent chain", () => {
  const refs = [
    { name: "ref_protagonist.jpeg" },
    { name: "ref_love_interest.jpeg" },
  ];
  const workflow = buildFlux2NativeWorkflow({ ...BASE_OPTIONS, references: refs });

  // Two of each reference node
  assert.equal(nodesByClass(workflow, "LoadImage").length, 2, "Expected 2 LoadImages");
  assert.equal(nodesByClass(workflow, "VAEEncode").length, 2, "Expected 2 VAEEncodes");
  assert.equal(nodesByClass(workflow, "ReferenceLatent").length, 2, "Expected 2 ReferenceLatents");

  // First reference — nodes 300, 301, 302
  assert.equal(workflow["300"].inputs.image, "ref_protagonist.jpeg");
  assert.deepEqual(workflow["301"].inputs.pixels, ["300", 0]);
  assert.deepEqual(workflow["302"].inputs.conditioning, ["200", 0]);
  assert.deepEqual(workflow["302"].inputs.latent, ["301", 0]);

  // Second reference — nodes 310, 311, 312
  assert.ok(workflow["310"], "Second LoadImage should be at id 310");
  assert.ok(workflow["311"], "Second VAEEncode should be at id 311");
  assert.ok(workflow["312"], "Second ReferenceLatent should be at id 312");

  assert.equal(workflow["310"].inputs.image, "ref_love_interest.jpeg");
  assert.deepEqual(workflow["311"].inputs.pixels, ["310", 0]);
  assert.deepEqual(workflow["311"].inputs.vae,    ["102", 0]);

  // Second ReferenceLatent chains from the first ReferenceLatent (302)
  assert.deepEqual(workflow["312"].inputs.conditioning, ["302", 0]);
  assert.deepEqual(workflow["312"].inputs.latent,       ["311", 0]);

  // FluxGuidance reads from the final (second) ReferenceLatent
  assert.deepEqual(workflow["400"].inputs.conditioning, ["312", 0]);

  assertNoPuLID(workflow);
  assertNoControlNet(workflow);
});

// ── Test 4: ControlNet option is silently ignored ─────────────────────────

test("controlNet option is silently ignored — no ControlNet nodes emitted", () => {
  const refs = [{ name: "ref_face.jpeg" }];
  const workflow = buildFlux2NativeWorkflow({
    ...BASE_OPTIONS,
    references: refs,
    controlNet: {
      controlImageName: "pose.jpeg",
      strength: 0.7,
      preprocessor: "openpose",
    },
  });

  assertNoControlNet(workflow);
  // Conditioning chain still works correctly despite controlNet being passed
  assert.deepEqual(workflow["400"].inputs.conditioning, ["302", 0]);
});

// ── Test 5: steps override propagates to Flux2Scheduler ──────────────────

test("steps override is passed to Flux2Scheduler", () => {
  const workflow = buildFlux2NativeWorkflow({
    ...BASE_OPTIONS,
    references: [],
    steps: 20,
  });
  assert.equal(workflow["501"].inputs.steps, 20);
});

// ── Test 6: model name overrides propagate correctly ─────────────────────

test("unetName/clipName/vaeName overrides propagate to loaders", () => {
  const workflow = buildFlux2NativeWorkflow({
    ...BASE_OPTIONS,
    references: [],
    unetName: "custom-unet.safetensors",
    clipName: "custom-clip.safetensors",
    vaeName: "custom-vae.safetensors",
  });
  assert.equal(workflow["100"].inputs.unet_name, "custom-unet.safetensors");
  assert.equal(workflow["101"].inputs.clip_name, "custom-clip.safetensors");
  assert.equal(workflow["102"].inputs.vae_name,  "custom-vae.safetensors");
});

// ── Test 7: ref.strength is accepted but never wired to any node ──────────

test("ref strength field is accepted but not wired (ReferenceLatent is binary)", () => {
  const workflow = buildFlux2NativeWorkflow({
    ...BASE_OPTIONS,
    references: [{ name: "ref.jpeg", strength: 0.85 }],
  });
  const refNode = workflow["302"];
  // strength must not appear in any ReferenceLatent input
  assert.ok(!("strength" in refNode.inputs), "ReferenceLatent must not have a strength input");
  assert.ok(!("weight" in refNode.inputs),   "ReferenceLatent must not have a weight input");
});
