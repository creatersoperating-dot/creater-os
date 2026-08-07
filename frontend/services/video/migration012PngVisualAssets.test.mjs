import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.resolve(root, "../supabase/migrations/20260806120000_012_add_png_visual_assets.sql");
const servicePath = path.resolve(root, "services/video/videoProductionService.server.ts");
const [sql, service] = await Promise.all([readFile(migrationPath, "utf8"), readFile(servicePath, "utf8")]);

test("migration 012 preserves SVG and adds exact PNG MIME and extension pairs", () => {
  assert.match(sql, /format = 'svg' and mime_type = 'image\/svg\+xml'/);
  assert.match(sql, /format = 'png' and mime_type = 'image\/png'/);
  assert.match(sql, /when 'svg' then '\.svg' when 'png' then '\.png'/);
  assert.match(sql, /storage_path = concat[\s\S]*'\.svg'/);
  assert.match(sql, /storage_path = concat[\s\S]*'\.png'/);
});

test("migration 012 keeps exact scene provenance and private object validation", () => {
  assert.match(sql, /video_visual_asset_contract_is_valid/);
  assert.match(sql, /source_scene_plan_version is not distinct from p_plan_version/);
  assert.match(sql, /source_scene_sha256 is not distinct from public\.video_scene_source_sha256/);
  assert.match(sql, /object\.bucket_id = p_asset\.storage_bucket/);
  assert.match(sql, /object\.metadata->>'mimetype'[\s\S]*p_asset\.mime_type/);
  assert.match(sql, /object\.metadata->>'size'[\s\S]*p_asset\.file_size_bytes/);
  assert.match(sql, /validate_project_video_asset_set/);
  assert.match(sql, /validate_ready_video_generation_asset_set/);
  assert.match(sql, /revoke all on function public\.video_visual_asset_contract_is_valid[\s\S]*authenticated/);
});

test("provider request identifiers are bounded, sanitized, and finalized with asset metadata", () => {
  assert.match(sql, /add column provider_request_id text/);
  assert.match(sql, /provider_request_id ~ '\^\[A-Za-z0-9\._:-\]\{1,128\}\$'/);
  assert.match(sql, /new\.provider_request_id[\s\S]*old\.provider_request_id/);
});

test("service persists before hydration and renders only the downloaded authoritative set", () => {
  const upload = service.indexOf(".upload(path, asset.bytes");
  const ready = service.indexOf('update({ status: "ready" })', upload);
  const hydrate = service.indexOf("this.validateExactAssetSet(", ready);
  const render = service.indexOf("rendererAdapter.render(renderRequest)", hydrate);
  assert.ok(upload >= 0 && upload < ready && ready < hydrate && hydrate < render);
  assert.match(service, /readMatchingObject[\s\S]*storage\.from\(BUCKET\)\.download\(path\)/);
  assert.match(service, /reuseOrGenerateVisualAssets/);
  assert.match(service, /cleanupPartialVisualAssetUploads/);
});
