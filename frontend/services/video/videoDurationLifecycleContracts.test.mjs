import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration006 = await readFile(path.resolve(root, "../supabase/migrations/20260731_006_create_video_production.sql"), "utf8");
const migration008 = await readFile(path.resolve(root, "../supabase/migrations/20260801_008_stabilize_video_production.sql"), "utf8");
const service = await readFile(path.resolve(root, "services/video/videoProductionService.server.ts"), "utf8");
const mock = await readFile(path.resolve(root, "services/providers/video/mockVideoProvider.server.ts"), "utf8");
const scenePolicy = await readFile(path.resolve(root, "services/video/videoSceneRequestPolicy.ts"), "utf8");

function body(name, nextName) {
  const start = migration008.indexOf(`create or replace function public.${name}`);
  const end = migration008.indexOf(`create or replace function public.${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start);
  return migration008.slice(start, end);
}

test("migration 006 and 008 share the 30-minute platform contract", () => {
  assert.match(migration006, /v_total_duration > 1800000/);
  assert.match(migration008, /creatoros_max_video_duration_ms\(\)[\s\S]*select 1800000::bigint/);
  assert.match(scenePolicy, /CREATOROS_MAX_VIDEO_DURATION_MS/);
});

test("claim and completion use the same authoritative maximum", () => {
  const claim = body("claim_video_generation_operation", "heartbeat_video_generation");
  const complete = body("complete_video_generation", "fail_video_generation");
  assert.match(claim, /p_duration_ms > public\.creatoros_max_video_duration_ms\(\)/);
  assert.match(complete, /p_duration_ms > public\.creatoros_max_video_duration_ms\(\)/);
  assert.match(complete, /v_generation\.duration_ms > public\.creatoros_max_video_duration_ms\(\)/);
  assert.doesNotMatch(complete, /300000/);
  assert.match(complete, /abs\(p_duration_ms - v_generation\.duration_ms\)[\s\S]*greatest\(v_generation\.duration_ms \* 0\.2, 250\)/);
});

test("provider-specific duration rejection occurs before claim", () => {
  const validation = service.indexOf("evaluateVideoDurationEligibility(");
  const providerError = service.indexOf('durationEligibility.violation === "provider_limit_exceeded"', validation);
  const claim = service.indexOf('this.db.rpc("claim_video_generation_operation"', providerError);
  assert.ok(validation >= 0 && validation < providerError && providerError < claim);
  assert.match(service, /rendererAdapter\.descriptor\.capabilities\.maximumDurationMs/);
  assert.match(service, /provider_duration_unsupported/);
  assert.match(service, /supports videos up to.*minutes/);
});

test("mock provider keeps its lower limit bounded before expensive allocation", () => {
  const limit = mock.indexOf("const MOCK_MAX_VIDEO_DURATION_MS = 300_000");
  const preflight = mock.indexOf("plannedDurationMs > MOCK_MAX_VIDEO_DURATION_MS", limit);
  const allocate = mock.indexOf("allocateFrameCountsForDurations", preflight);
  assert.ok(limit >= 0 && limit < preflight && preflight < allocate);
  assert.match(mock, /maximumDurationMs: MOCK_MAX_VIDEO_DURATION_MS/);
});

test("a valid uploaded video above five minutes is not rejected by completion", () => {
  const complete = body("complete_video_generation", "fail_video_generation");
  assert.doesNotMatch(complete, /300000/);
  assert.match(complete, /creatoros_max_video_duration_ms/);
  assert.ok(complete.indexOf("storage.objects") < complete.indexOf("status = 'ready'"));
});
