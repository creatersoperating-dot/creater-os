import assert from "node:assert/strict";
import test from "node:test";

import { isExactAuthoritativeAssetSet } from "./videoAssetSetPolicy.ts";

const scenes = [
  { sceneId: "scene-a", sceneNumber: 1, sourceHash: "hash-a" },
  { sceneId: "scene-b", sceneNumber: 2, sourceHash: "hash-b" },
];
const valid = scenes.map((scene) => ({ ...scene, planId: "plan", planVersion: 2, ready: true, metadataValid: true, objectValid: true }));
const check = (assets) => isExactAuthoritativeAssetSet(scenes, assets, "plan", 2);

test("accepts an exact current asset set", () => assert.equal(check(valid), true));
test("rejects a missing asset", () => assert.equal(check(valid.slice(0, 1)), false));
test("rejects a duplicate scene asset", () => assert.equal(check([valid[0], { ...valid[0] }]), false));
test("rejects an extra or archived-scene asset", () => assert.equal(check([...valid, { ...valid[0], sceneId: "archived", sceneNumber: 3 }]), false));
test("rejects an asset from the wrong plan version", () => assert.equal(check([{ ...valid[0], planVersion: 1 }, valid[1]]), false));
test("rejects matching scene fields with an unrelated source hash", () => assert.equal(check([{ ...valid[0], sourceHash: "unrelated" }, valid[1]]), false));
test("rejects a missing Storage object", () => assert.equal(check([{ ...valid[0], objectValid: false }, valid[1]]), false));
test("rejects invalid path, MIME, size or content metadata", () => assert.equal(check([{ ...valid[0], metadataValid: false }, valid[1]]), false));
