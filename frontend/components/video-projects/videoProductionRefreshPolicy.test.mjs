import assert from "node:assert/strict";
import test from "node:test";

import { resolveDraftRefresh, resolveVideoPollIdentity, shouldContinueVideoPolling } from "./videoProductionRefreshPolicy.ts";

const dirty = { draft: "local edits", isDirty: true };
const clean = { draft: "server v1", isDirty: false };

test("dirty plan installs a successful manual refresh", () => {
  assert.deepEqual(resolveDraftRefresh(dirty, "manual", "server v2"), { draft: "server v2", isDirty: false });
});
test("dirty plan survives a failed manual refresh", () => {
  assert.equal(resolveDraftRefresh(dirty, "manual"), dirty);
});
test("dirty plan survives an aborted manual refresh", () => {
  assert.equal(resolveDraftRefresh(dirty, "manual", undefined), dirty);
});
test("dirty plan survives successful background polling", () => {
  assert.equal(resolveDraftRefresh(dirty, "poll", "server v2"), dirty);
});
test("clean plan installs a successful refresh", () => {
  assert.deepEqual(resolveDraftRefresh(clean, "manual", "server v2"), { draft: "server v2", isDirty: false });
});
test("clean plan survives a failed refresh", () => {
  assert.equal(resolveDraftRefresh(clean, "manual"), clean);
});
test("polling is bounded by both attempts and elapsed time", () => {
  assert.equal(shouldContinueVideoPolling(39, 89_999, true, 40, 90_000), true);
  assert.equal(shouldContinueVideoPolling(40, 10_000, true, 40, 90_000), false);
  assert.equal(shouldContinueVideoPolling(1, 90_000, true, 40, 90_000), false);
  assert.equal(shouldContinueVideoPolling(1, 1_000, false, 40, 90_000), false);
});
test("poll identity survives replacement DTOs and resets only for identity changes", () => {
  const current = { scope: 3, generationId: "generation-a", attempts: 17, startedAt: 500 };
  assert.equal(resolveVideoPollIdentity(current, 3, "generation-a"), current);
  assert.deepEqual(resolveVideoPollIdentity(current, 3, "generation-b"), { scope: 3, generationId: "generation-b", attempts: 0, startedAt: 0 });
  assert.deepEqual(resolveVideoPollIdentity(current, 4, "generation-a"), { scope: 4, generationId: "generation-a", attempts: 0, startedAt: 0 });
});
