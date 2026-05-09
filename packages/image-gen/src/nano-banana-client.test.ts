// Run with:  npm test --workspace=@no-safe-word/image-gen
// or directly: npx tsx --test packages/image-gen/src/nano-banana-client.test.ts
//
// Dispatcher contract (Phase B Epic): the face portrait route MUST submit
// to a Nano Banana 2 model regardless of the story's image_model. This
// guards the lowest-level shared helper for face portrait jobs. If anyone
// re-introduces a branch that picks a non-Nano-Banana-2 model here, this
// test will fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNanoBananaPayload } from "./nano-banana-client";

test("payload model is google/nano-banana-2-t2i for empty references", () => {
  const inputs = [
    { prompt: "any face", size: "1k" as const, aspectRatio: "1:1" as const },
    { prompt: "another", size: "2k" as const, aspectRatio: "2:3" as const },
    { prompt: "third",  size: "4k" as const, aspectRatio: "5:4" as const, seed: 42 },
  ];
  for (const input of inputs) {
    const { payload, isI2I } = buildNanoBananaPayload(input);
    assert.equal(payload.model, "google/nano-banana-2-t2i");
    assert.equal(isI2I, false);
    assert.equal(payload.images, undefined);
    assert.equal(payload.aspect_ratio, input.aspectRatio);
    assert.equal(payload.size, input.size);
  }
});

test("payload model is google/nano-banana-2-i2i for non-empty references", () => {
  const { payload, isI2I } = buildNanoBananaPayload({
    prompt: "with reference",
    size: "2k",
    aspectRatio: "1:1",
    referenceImageUrls: ["https://example.com/ref.jpg"],
  });
  assert.equal(payload.model, "google/nano-banana-2-i2i");
  assert.equal(isI2I, true);
  assert.deepEqual(payload.images, ["https://example.com/ref.jpg"]);
});

test("empty prompt throws", () => {
  assert.throws(
    () => buildNanoBananaPayload({ prompt: "   ", size: "2k", aspectRatio: "1:1" }),
    /prompt is empty/
  );
});

test("model is always one of the two Nano Banana 2 strings — fuzz", () => {
  const sizes: Array<"512" | "1k" | "2k" | "4k"> = ["512", "1k", "2k", "4k"];
  const ratios: Array<"1:1" | "2:3" | "3:2" | "4:5" | "5:4"> = [
    "1:1", "2:3", "3:2", "4:5", "5:4",
  ];
  const refs: Array<string[] | undefined> = [
    undefined, [], ["https://example.com/a.jpg"],
  ];
  const allowed = new Set([
    "google/nano-banana-2-t2i",
    "google/nano-banana-2-i2i",
  ]);
  for (const size of sizes) {
    for (const aspectRatio of ratios) {
      for (const referenceImageUrls of refs) {
        const { payload } = buildNanoBananaPayload({
          prompt: "test",
          size,
          aspectRatio,
          referenceImageUrls,
        });
        assert.ok(
          allowed.has(payload.model),
          `unexpected model: ${payload.model}`
        );
      }
    }
  }
});
