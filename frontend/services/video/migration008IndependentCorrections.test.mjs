import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.resolve(root, "../supabase/migrations/20260801_008_stabilize_video_production.sql");
const migration006Path = path.resolve(root, "../supabase/migrations/20260731_006_create_video_production.sql");
const servicePath = path.resolve(root, "services/video/videoProductionService.server.ts");
const panelPath = path.resolve(root, "components/video-projects/VideoProductionPanel.tsx");
const sql = await readFile(migrationPath, "utf8");

function body(name, nextName) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  const end = nextName ? sql.indexOf(`create or replace function public.${nextName}`, start + 1) : sql.length;
  assert.ok(start >= 0 && end > start, `${name} function is present`);
  return sql.slice(start, end);
}

test("lease timestamps are refreshed only after blocking locks", () => {
  const claim = body("claim_video_generation_operation", "heartbeat_video_generation");
  assert.doesNotMatch(claim.slice(0, claim.indexOf("begin")), /clock_timestamp/);
  assert.ok(claim.indexOf("for update;") < claim.indexOf("v_now := clock_timestamp();"));
  assert.ok(claim.lastIndexOf("v_now := clock_timestamp();") < claim.indexOf("insert into public.video_generations"));
  assert.match(claim, /lease_expires_at[\s\S]*v_now \+ make_interval/);

  const heartbeat = body("heartbeat_video_generation", "start_video_generation_attempt");
  assert.doesNotMatch(heartbeat.slice(0, heartbeat.indexOf("begin")), /clock_timestamp/);
  const projectLock = heartbeat.indexOf("from public.video_projects as project");
  const generationLock = heartbeat.indexOf("from public.video_generations as generation", projectLock);
  assert.ok(projectLock < generationLock && generationLock < heartbeat.indexOf("v_now := clock_timestamp();"));
  assert.ok(heartbeat.indexOf("v_now := clock_timestamp();") < heartbeat.indexOf("lease_expires_at = v_now + make_interval"));
});

test("concurrent claims serialize and retries always reserve new rows", async () => {
  const migration006 = await readFile(migration006Path, "utf8");
  const claim = body("claim_video_generation_operation", "heartbeat_video_generation");
  assert.ok(claim.indexOf("from public.video_projects as project") < claim.indexOf("from public.video_generations as generation"));
  assert.match(claim, /from public\.video_projects as project[\s\S]*for update/);
  assert.match(migration006, /video_generations_one_active_per_project_idx[\s\S]*where status in/);
  assert.doesNotMatch(claim, /update public\.video_generations set\s+status = 'queued'/);
  assert.match(claim, /p_generation_id is not distinct from p_retry_generation_id/);
  assert.match(claim, /generation\.operation_id <> p_operation_id/);
  assert.match(claim, /p_retry_generation_id[\s\S]*generation\.status = 'failed'[\s\S]*insert into public\.video_generations/);
});

test("expired same-operation replay returns the terminal row and requires a new operation", async () => {
  const [claim, service] = [
    body("claim_video_generation_operation", "heartbeat_video_generation"),
    await readFile(servicePath, "utf8"),
  ];
  const sameOperation = claim.indexOf("and generation.operation_id = p_operation_id");
  const terminalReturn = claim.indexOf("return query select v_existing.id, true", sameOperation);
  const insert = claim.indexOf("insert into public.video_generations", sameOperation);
  assert.ok(sameOperation >= 0 && sameOperation < terminalReturn && terminalReturn < insert);
  assert.match(claim, /Start a new operation to retry/);
  assert.match(service, /generation\.operation_id === operationId/);
  assert.match(service, /const requestedGenerationId = crypto\.randomUUID\(\)/);
  assert.match(service, /requestedGenerationId === retryId/);
});

test("stale workers cannot mutate a recovered replacement generation", async () => {
  const [service, panel] = await Promise.all([readFile(servicePath, "utf8"), readFile(panelPath, "utf8")]);
  assert.match(panel, /const operationId = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(panel, /\.operationId\s*:\s*crypto\.randomUUID/);
  assert.match(service, /const requestedGenerationId = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(service, /const requestedGenerationId = retryId \?\?/);
  assert.match(sql, /revoke insert, update, delete on table public\.video_generations from authenticated/);
  assert.match(sql, /generation\.status = p_expected_status[\s\S]*generation\.lease_expires_at <= v_now/);
  assert.match(sql, /video_visual_assets_update_active[\s\S]*generation\.lease_expires_at > clock_timestamp\(\)/);
  assert.doesNotMatch(service, /from\("video_generations"\)\.update/);
});

test("ready-to-failed is limited to authoritative Storage loss and clears attachment", () => {
  const progression = body("enforce_video_generation_status_progression", "validate_ready_video_generation_asset_set");
  const loss = body("fail_ready_video_storage_loss", "authorize_project_media_insert");
  assert.match(progression, /old\.status = 'ready' and new\.status = 'failed'[\s\S]*failure_code = 'storage_object_missing'[\s\S]*not exists[\s\S]*storage\.objects/);
  assert.match(progression, /if old\.status in \('ready', 'failed', 'cancelled'\) then[\s\S]*raise exception/);
  assert.ok(loss.indexOf("storage.objects") < loss.indexOf("status = 'failed'"));
  assert.ok(loss.indexOf("video_generation_id = null") < loss.indexOf("status = 'failed'"));
  assert.doesNotMatch(loss, /status = case|project\.status/);
});

test("database exact-set checks recompute the canonical scene hash", () => {
  const ready = body("validate_ready_video_generation_asset_set", "claim_video_generation_operation");
  assert.match(sql, /create or replace function public\.video_scene_source_canonical/);
  assert.match(sql, /octet_length\(convert_to\(p_title, 'UTF8'\)\)/);
  assert.match(sql, /extensions\.digest\(convert_to\(public\.video_scene_source_canonical/);
  assert.match(ready, /asset\.source_scene_sha256 is distinct from public\.video_scene_source_sha256/);
  assert.match(sql, /validate_project_video_asset_set[\s\S]*source_scene_sha256 is distinct from public\.video_scene_source_sha256/);
});

test("legacy scene hashes are backfilled without changing finalized objects or timestamps", () => {
  const disableFinalized = sql.indexOf("disable trigger video_visual_assets_protect_finalized");
  const disableTimestamp = sql.indexOf("disable trigger video_visual_assets_set_updated_at");
  const backfill = sql.indexOf("update public.video_visual_assets as asset", disableTimestamp);
  const enableTimestamp = sql.indexOf("enable trigger video_visual_assets_set_updated_at", backfill);
  const enableFinalized = sql.indexOf("enable trigger video_visual_assets_protect_finalized", enableTimestamp);
  const validator = sql.indexOf("create or replace function public.validate_project_video_asset_set");
  assert.ok(disableFinalized >= 0 && disableFinalized < disableTimestamp && disableTimestamp < backfill);
  assert.ok(backfill < enableTimestamp && enableTimestamp < enableFinalized && enableFinalized < validator);
  assert.match(sql.slice(backfill, enableTimestamp), /source_scene_sha256 = public\.video_scene_source_sha256/);
  assert.doesNotMatch(sql.slice(backfill, enableTimestamp), /storage_path\s*=|content_sha256\s*=|updated_at\s*=/);
});

test("all lifecycle failure paths stop when project cleaning has begun", () => {
  for (const [name, nextName] of [
    ["heartbeat_video_generation", "start_video_generation_attempt"],
    ["start_video_generation_attempt", "advance_video_generation_stage"],
    ["advance_video_generation_stage", "complete_video_generation"],
    ["complete_video_generation", "fail_video_generation"],
    ["fail_video_generation", "fail_ready_video_storage_loss"],
    ["fail_ready_video_storage_loss", "authorize_project_media_insert"],
  ]) {
    const source = body(name, nextName);
    const project = source.indexOf("from public.video_projects as project");
    const active = source.indexOf("project.deletion_state = 'active'", project);
    const generation = source.indexOf("from public.video_generations as generation", active);
    assert.ok(project >= 0 && project < active && active < generation, `${name} locks an active project before its generation`);
  }
  const failure = body("fail_video_generation", "fail_ready_video_storage_loss");
  assert.ok(failure.indexOf("for update;") < failure.indexOf("update public.video_generation_attempts"));
});

test("completion requires an authoritative object and bounded consistent metadata", () => {
  const complete = body("complete_video_generation", "fail_video_generation");
  assert.match(complete, /storage_bucket is distinct from 'project-videos'/);
  assert.match(complete, /storage_path is distinct from concat/);
  assert.match(complete, /not exists \([\s\S]*from storage\.objects/);
  assert.match(complete, /object\.metadata->>'mimetype'[\s\S]*= 'video\/mp4'/);
  assert.match(complete, /object\.metadata->>'size'[\s\S]*\^\[0-9\]\+\$[\s\S]*::numeric = p_file_size_bytes/);
  assert.match(complete, /p_format is distinct from 'mp4'/);
  assert.match(complete, /p_mime_type is distinct from 'video\/mp4'/);
  assert.match(complete, /p_content_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(complete, /p_width < 1 or p_width > 7680[\s\S]*p_height < 1 or p_height > 7680/);
  assert.match(complete, /p_duration_ms < 1[\s\S]*p_duration_ms > public\.creatoros_max_video_duration_ms\(\)[\s\S]*abs\(p_duration_ms - v_generation\.duration_ms\)/);
  assert.match(complete, /p_scenes_completed is distinct from v_generation\.scene_count/);
  assert.match(complete, /p_attempt_number <> v_generation\.attempt_count/);
  assert.match(complete, /v_attempt\.provider is distinct from v_generation\.provider/);
});

test("ready validation precedes attempt completion and remains transaction-atomic", () => {
  const complete = body("complete_video_generation", "fail_video_generation");
  const ready = complete.indexOf("update public.video_generations as generation set");
  const attempt = complete.indexOf("update public.video_generation_attempts set", ready);
  assert.ok(ready >= 0 && ready < attempt);
  assert.match(complete, /raise exception 'The active video attempt changed during completion.'/);
  assert.match(sql, /create trigger video_generations_validate_ready_asset_set/);
});

test("attempt provider and model must match immutable claimed generation metadata", () => {
  const start = body("start_video_generation_attempt", "advance_video_generation_stage");
  assert.match(start, /trim\(p_provider\) is distinct from v_generation\.provider/);
  assert.match(start, /trim\(p_model\) is distinct from v_generation\.model/);
  assert.match(start, /v_generation\.provider, v_generation\.model, 'rendering'/);
});

test("Storage insert authorization and deletion share a transaction barrier", () => {
  const authorize = body("authorize_project_media_insert", "begin_video_project_deletion");
  const begin = body("begin_video_project_deletion", "finish_video_project_deletion");
  const finish = body("finish_video_project_deletion", "can_delete_project_video_object");
  for (const source of [authorize, begin, finish]) assert.match(source, /pg_advisory_xact_lock[\s\S]*hashtextextended[\s\S]*20260801008/);
  assert.ok(authorize.indexOf("pg_advisory_xact_lock") < authorize.indexOf("deletion_state = 'active'"));
  assert.ok(begin.indexOf("pg_advisory_xact_lock") < begin.indexOf("deletion_state = 'cleaning'"));
  assert.match(sql, /project_videos_insert_own[\s\S]*authorize_project_media_insert\(bucket_id, name\)/);
  assert.match(sql, /project_audio_insert_own[\s\S]*authorize_project_media_insert\(bucket_id, name\)/);
});

test("generation lifecycle privileges are RPC-only and signatures are restricted", () => {
  for (const name of [
    "claim_video_generation_operation", "heartbeat_video_generation", "start_video_generation_attempt",
    "advance_video_generation_stage", "complete_video_generation", "fail_video_generation",
    "fail_ready_video_storage_loss",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*from anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to authenticated`));
  }
  assert.match(sql, /revoke insert, update, delete on table public\.video_generation_attempts from authenticated/);
});

test("trigger order preserves narrow loss recovery and validates ready assets", () => {
  const names = [
    "video_generations_enforce_status_progression",
    "video_generations_protect_finalized",
    "video_generations_protect_stabilization_fields",
    "video_generations_set_updated_at",
    "video_generations_validate_ready_asset_set",
  ];
  assert.deepEqual([...names].sort(), names);
  assert.match(sql, /create trigger video_generations_enforce_status_progression/);
  assert.match(sql, /create trigger video_generations_protect_stabilization_fields/);
  assert.match(sql, /create trigger video_generations_validate_ready_asset_set/);
});

test("signed access marks only proven missing objects and never reuses public URLs", async () => {
  const service = await readFile(servicePath, "utf8");
  const entry = service.indexOf("const storageEntry = await this.storageEntry(path)");
  const loss = service.indexOf('this.db.rpc("fail_ready_video_storage_loss"', entry);
  const download = service.indexOf(".download(path)", entry);
  const signed = service.indexOf(".createSignedUrl(path", download);
  assert.ok(entry >= 0 && entry < loss && loss < download && download < signed);
  assert.doesNotMatch(service, /getPublicUrl|createPublicUrl/);
});
