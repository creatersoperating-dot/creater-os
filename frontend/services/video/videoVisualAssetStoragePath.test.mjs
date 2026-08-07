import assert from "node:assert/strict";
import test from "node:test";

import { videoVisualAssetStoragePath } from "./videoVisualAssetStoragePath.ts";

const trusted = ["user-id", "brand-id", "project-id", "generation-id", 2];

test("Gemini authoritative assets use PNG paths derived only from trusted identifiers", () => {
  assert.equal(videoVisualAssetStoragePath(...trusted, "png"),
    "user-id/brand-id/project-id/generation-id/scenes/2.png");
  assert.equal(videoVisualAssetStoragePath.length, 6);
});

test("mock authoritative assets retain SVG paths", () => {
  assert.equal(videoVisualAssetStoragePath(...trusted, "svg"),
    "user-id/brand-id/project-id/generation-id/scenes/2.svg");
});
