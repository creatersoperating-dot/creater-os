import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.resolve(root, "../supabase/migrations/20260801_008_stabilize_video_production.sql");
const servicePath = path.resolve(root, "services/video/videoProductionService.server.ts");

test("migration 008 uses secure lease recovery without destructive status backfill", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /add column heartbeat_at timestamptz[\s\S]*add column lease_expires_at timestamptz/);
  assert.match(sql, /create or replace function public\.claim_video_generation_operation[\s\S]*security definer[\s\S]*set search_path = ''/);
  assert.match(sql, /from public\.video_projects as project[\s\S]*for update/);
  assert.match(sql, /if v_active\.lease_expires_at > v_now then[\s\S]*return query select v_active\.id/);
  assert.match(sql, /failure_code = 'lease_expired'/);
  assert.match(sql, /insert into public\.video_generations/);
  assert.doesNotMatch(sql, /lease_migration_expired/);
  assert.match(sql, /revoke all on function public\.claim_video_generation_operation[\s\S]*from anon/);
  assert.match(sql, /grant execute on function public\.claim_video_generation_operation[\s\S]*to authenticated/);
});

test("migration 008 enforces exact assets before ready and attachment", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /create unique index video_visual_assets_generation_scene_id_idx/);
  assert.match(sql, /create trigger video_generations_validate_ready_asset_set/);
  assert.match(sql, /create trigger video_projects_validate_video_asset_set/);
  assert.match(sql, /scene\.is_active/);
  assert.match(sql, /object\.metadata->>'mimetype'/);
  assert.match(sql, /asset\.source_scene_plan_version is distinct from v_plan\.version/);
  assert.match(sql, /video_generations_enforce_status_progression/);
});

test("service validates authoritative assets before render and again before ready", async () => {
  const source = await readFile(servicePath, "utf8");
  const prepare = source.indexOf("visualAdapter.generateVisualAssets({");
  const firstValidation = source.indexOf("this.validateExactAssetSet(", prepare);
  const render = source.indexOf("rendererAdapter.render(renderRequest)");
  const secondValidation = source.indexOf("this.validateExactAssetSet(", render);
  const ready = source.indexOf('this.db.rpc("complete_video_generation"', render);
  assert.ok(prepare >= 0 && prepare < firstValidation && firstValidation < render);
  assert.ok(render < secondValidation && secondValidation < ready);
  assert.match(source, /p_next_status: "generating_assets"[\s\S]*p_next_status: "rendering"[\s\S]*p_next_status: "uploading"[\s\S]*complete_video_generation/);
});

test("scene-plan writes authenticate before bounded strict parsing", async () => {
  const [route, api, policy] = await Promise.all([
    readFile(path.resolve(root, "app/api/brands/[brandId]/projects/[projectId]/scene-plan/route.ts"), "utf8"),
    readFile(path.resolve(root, "services/video/videoApiResponse.server.ts"), "utf8"),
    readFile(path.resolve(root, "services/video/videoSceneRequestPolicy.ts"), "utf8"),
  ]);
  assert.ok(route.indexOf("VideoProductionService.authenticated()") < route.indexOf("readVideoRequestBody(request)"));
  assert.match(api, /MAX_BODY_BYTES/);
  assert.match(api, /TextEncoder\(\)\.encode\(text\)\.byteLength/);
  assert.match(policy, /allowedKeys/);
  assert.match(policy, /Number\.isInteger/);
});

test("project deletion keeps cleanup server-side and finalized deletion controlled", async () => {
  const [sql, source] = await Promise.all([readFile(migrationPath, "utf8"), readFile(servicePath, "utf8")]);
  assert.match(sql, /create or replace function public\.begin_video_project_deletion[\s\S]*deletion_state = 'cleaning'/);
  assert.match(sql, /create or replace function public\.finish_video_project_deletion[\s\S]*storage\.objects/);
  assert.match(sql, /create or replace function public\.can_delete_project_video_object/);
  assert.match(sql, /project_audio_delete_own/);
  assert.match(source, /begin_video_project_deletion/);
  assert.match(source, /audio_generations/);
  assert.ok(source.indexOf("removePrivateStorageObject(") < source.indexOf("finish_video_project_deletion"));
});

test("non-render routes do not reach native renderer modules", async () => {
  const roots = [
    "app/api/brands/[brandId]/projects/[projectId]/scene-plan/route.ts",
    "app/api/brands/[brandId]/projects/[projectId]/video-history/route.ts",
    "app/api/brands/[brandId]/projects/[projectId]/video-generations/[videoId]/attach/route.ts",
    "app/api/brands/[brandId]/projects/[projectId]/video-generations/[videoId]/access/route.ts",
  ];
  const visited = new Set();
  async function scan(file) {
    const absolute = path.resolve(root, file);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    const source = await readFile(absolute, "utf8");
    assert.doesNotMatch(source, /(?:sharp|h264-mp4-encoder|mockVideoProvider|videoProviderRegistry)/, `${file} reaches a render-only module`);
    for (const match of source.matchAll(/from\s+["'](@\/[^"']+|\.{1,2}\/[^"']+)["']/g)) {
      let target = match[1].startsWith("@/") ? path.resolve(root, match[1].slice(2)) : path.resolve(path.dirname(absolute), match[1]);
      if (!/\.[cm]?[jt]sx?$/.test(target)) target += ".ts";
      if (target.startsWith(root)) await scan(path.relative(root, target));
    }
  }
  for (const route of roots) await scan(route);
});
