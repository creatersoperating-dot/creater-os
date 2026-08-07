-- Expand authoritative video visual assets from SVG-only to SVG or PNG.
-- Existing SVG rows and all ownership, provenance, lifecycle, and private
-- storage protections remain in place.

alter table public.video_visual_assets
  add column provider_request_id text;

alter table public.video_visual_assets
  drop constraint video_visual_assets_format_check,
  drop constraint video_visual_assets_values_check,
  drop constraint video_visual_assets_ready_check;

alter table public.video_visual_assets
  add constraint video_visual_assets_format_check check (
    (format is null and mime_type is null)
    or (format = 'svg' and mime_type = 'image/svg+xml')
    or (format = 'png' and mime_type = 'image/png')
  ),
  add constraint video_visual_assets_values_check check (
    scene_number between 1 and 24
    and storage_bucket = 'project-videos'
    and (
      (format = 'svg' and storage_path = concat(
        user_id::text, '/', brand_id, '/', project_id, '/', generation_id::text,
        '/scenes/', scene_number::text, '.svg'
      ))
      or (format = 'png' and storage_path = concat(
        user_id::text, '/', brand_id, '/', project_id, '/', generation_id::text,
        '/scenes/', scene_number::text, '.png'
      ))
      or (format is null and mime_type is null and storage_path in (
        concat(user_id::text, '/', brand_id, '/', project_id, '/', generation_id::text, '/scenes/', scene_number::text, '.svg'),
        concat(user_id::text, '/', brand_id, '/', project_id, '/', generation_id::text, '/scenes/', scene_number::text, '.png')
      ))
    )
  ),
  add constraint video_visual_assets_ready_check check (
    status <> 'ready'
    or (
      (
        (format = 'svg' and mime_type = 'image/svg+xml')
        or (format = 'png' and mime_type = 'image/png')
      )
      and width > 0 and height > 0 and file_size_bytes > 0
      and content_sha256 ~ '^[0-9a-f]{64}$'
      and cleanup_pending = false
    )
  ),
  add constraint video_visual_assets_provider_request_id_check check (
    provider_request_id is null
    or provider_request_id ~ '^[A-Za-z0-9._:-]{1,128}$'
  );

comment on column public.video_visual_assets.provider_request_id is
  'Optional sanitized visual-provider response identifier. Never contains prompts, credentials, paths, or raw provider output.';

create or replace function public.video_visual_asset_contract_is_valid(
  p_asset public.video_visual_assets,
  p_scene public.video_scene_items,
  p_plan_id uuid,
  p_plan_version integer,
  p_generation_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce(
    p_scene.id is not null
    and p_asset.scene_plan_id is not distinct from p_plan_id
    and p_asset.source_scene_plan_version is not distinct from p_plan_version
    and p_asset.source_scene_title is not distinct from p_scene.title
    and p_asset.source_narration_text is not distinct from p_scene.narration_text
    and p_asset.source_visual_prompt is not distinct from p_scene.visual_prompt
    and p_asset.source_visual_type is not distinct from p_scene.visual_type
    and p_asset.source_duration_ms is not distinct from p_scene.duration_ms
    and p_asset.source_transition is not distinct from p_scene.transition
    and p_asset.status = 'ready'
    and not p_asset.cleanup_pending
    and (
      (p_asset.format = 'svg' and p_asset.mime_type = 'image/svg+xml')
      or (p_asset.format = 'png' and p_asset.mime_type = 'image/png')
    )
    and p_asset.width > 0 and p_asset.height > 0
    and p_asset.file_size_bytes > 0
    and p_asset.content_sha256 ~ '^[0-9a-f]{64}$'
    and p_asset.source_scene_sha256 is not distinct from public.video_scene_source_sha256(
      p_scene.title, p_scene.narration_text, p_scene.visual_prompt,
      p_scene.visual_type, p_scene.duration_ms, p_scene.transition
    )
    and p_asset.storage_bucket = 'project-videos'
    and p_asset.storage_path = concat(
      p_asset.user_id::text, '/', p_asset.brand_id, '/', p_asset.project_id,
      '/', p_generation_id::text, '/scenes/', p_asset.scene_number::text,
      case p_asset.format when 'svg' then '.svg' when 'png' then '.png' else '' end
    )
    and exists (
      select 1 from storage.objects as object
      where object.bucket_id = p_asset.storage_bucket
        and object.name = p_asset.storage_path
        and coalesce(object.metadata->>'mimetype', '') = p_asset.mime_type
        and coalesce(object.metadata->>'size', '') ~ '^[0-9]+$'
        and (object.metadata->>'size')::bigint is not distinct from p_asset.file_size_bytes
    ),
    false
  );
end;
$$;

revoke all on function public.video_visual_asset_contract_is_valid(
  public.video_visual_assets, public.video_scene_items, uuid, integer, uuid
) from public, anon, authenticated;

create or replace function public.validate_project_video_asset_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation public.video_generations%rowtype;
  v_plan public.video_scene_plans%rowtype;
  v_scene_count integer;
  v_asset_count integer;
begin
  if new.video_generation_id is null
    or new.video_generation_id is not distinct from old.video_generation_id then
    return new;
  end if;
  if new.deletion_state <> 'active' then
    raise exception 'A deleting project cannot attach video.' using errcode = '23514';
  end if;

  select generation.* into v_generation
  from public.video_generations as generation
  where generation.user_id = new.user_id
    and generation.brand_id = new.brand_id
    and generation.project_id = new.id
    and generation.id = new.video_generation_id
    and generation.status = 'ready';
  if not found then
    raise exception 'Ready video generation was not found.' using errcode = '23514';
  end if;

  select plan.* into v_plan
  from public.video_scene_plans as plan
  where plan.user_id = new.user_id
    and plan.brand_id = new.brand_id
    and plan.project_id = new.id
    and plan.id = v_generation.source_scene_plan_id
    and plan.status = 'ready';
  if not found or v_generation.source_scene_plan_version is distinct from v_plan.version
    or v_generation.source_scene_plan_hash is distinct from v_plan.plan_hash then
    raise exception 'The attached video scene plan is stale.' using errcode = '23514';
  end if;

  select count(*) into v_scene_count
  from public.video_scene_items as scene
  where scene.user_id = new.user_id and scene.plan_id = v_plan.id and scene.is_active;
  select count(*) into v_asset_count
  from public.video_visual_assets as asset
  where asset.user_id = new.user_id and asset.brand_id = new.brand_id
    and asset.project_id = new.id and asset.generation_id = v_generation.id;

  if v_scene_count <> v_generation.scene_count or v_asset_count <> v_scene_count
    or exists (
      select 1
      from public.video_visual_assets as asset
      left join public.video_scene_items as scene
        on scene.user_id = asset.user_id and scene.plan_id = v_plan.id
        and scene.id = asset.scene_id and scene.scene_number = asset.scene_number
        and scene.is_active
      where asset.user_id = new.user_id and asset.brand_id = new.brand_id
        and asset.project_id = new.id and asset.generation_id = v_generation.id
        and not public.video_visual_asset_contract_is_valid(
          asset, scene, v_plan.id, v_plan.version, v_generation.id
        )
    )
    or exists (
      select 1 from public.video_scene_items as scene
      where scene.user_id = new.user_id and scene.plan_id = v_plan.id and scene.is_active
        and not exists (
          select 1 from public.video_visual_assets as asset
          where asset.user_id = new.user_id and asset.generation_id = v_generation.id
            and asset.scene_id = scene.id and asset.scene_number = scene.scene_number
        )
    ) then
    raise exception 'The video scene visual set is not exact and complete.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_ready_video_generation_asset_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.video_scene_plans%rowtype;
  v_scene_count integer;
  v_asset_count integer;
begin
  if new.status <> 'ready' or old.status = 'ready' then return new; end if;

  select plan.* into v_plan
  from public.video_scene_plans as plan
  where plan.user_id = new.user_id and plan.brand_id = new.brand_id
    and plan.project_id = new.project_id and plan.id = new.source_scene_plan_id
    and plan.status = 'ready';
  if not found or new.source_scene_plan_version is distinct from v_plan.version
    or new.source_scene_plan_hash is distinct from v_plan.plan_hash then
    raise exception 'The ready video scene plan is stale.' using errcode = '23514';
  end if;

  select count(*) into v_scene_count from public.video_scene_items as scene
  where scene.user_id = new.user_id and scene.plan_id = v_plan.id and scene.is_active;
  select count(*) into v_asset_count from public.video_visual_assets as asset
  where asset.user_id = new.user_id and asset.brand_id = new.brand_id
    and asset.project_id = new.project_id and asset.generation_id = new.id;

  if v_scene_count <> new.scene_count or v_asset_count <> v_scene_count
    or exists (
      select 1
      from public.video_visual_assets as asset
      left join public.video_scene_items as scene
        on scene.user_id = asset.user_id and scene.plan_id = v_plan.id
        and scene.id = asset.scene_id and scene.scene_number = asset.scene_number
        and scene.is_active
      where asset.user_id = new.user_id and asset.brand_id = new.brand_id
        and asset.project_id = new.project_id and asset.generation_id = new.id
        and not public.video_visual_asset_contract_is_valid(
          asset, scene, v_plan.id, v_plan.version, new.id
        )
    )
    or exists (
      select 1 from public.video_scene_items as scene
      where scene.user_id = new.user_id and scene.plan_id = v_plan.id and scene.is_active
        and not exists (
          select 1 from public.video_visual_assets as asset
          where asset.user_id = new.user_id and asset.generation_id = new.id
            and asset.scene_id = scene.id and asset.scene_number = scene.scene_number
        )
    ) then
    raise exception 'The video scene visual set is not exact and complete.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_project_video_asset_set() from public, anon, authenticated;
revoke all on function public.validate_ready_video_generation_asset_set() from public, anon, authenticated;

create or replace function public.protect_finalized_video_visual_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'ready' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (
      select 1 from public.video_generations as generation
      where generation.user_id = old.user_id and generation.id = old.generation_id
    ) then
      raise exception 'Finalized video visual assets are immutable.' using errcode = '42501';
    end if;
    return old;
  end if;

  if not exists (
    select 1 from storage.objects as object
    where object.bucket_id = old.storage_bucket and object.name = old.storage_path
  ) and new.status = 'failed' then
    return new;
  end if;

  if row(new.status, new.scene_plan_id, new.scene_id, new.scene_number,
      new.source_scene_title, new.source_narration_text, new.source_visual_prompt,
      new.source_visual_type, new.source_duration_ms, new.source_transition,
      new.source_scene_sha256, new.source_scene_plan_version, new.provider, new.model,
      new.provider_request_id, new.format, new.mime_type, new.width, new.height,
      new.file_size_bytes, new.content_sha256, new.storage_bucket, new.storage_path,
      new.failure_code, new.failure_message, new.cleanup_pending)
    is distinct from
    row(old.status, old.scene_plan_id, old.scene_id, old.scene_number,
      old.source_scene_title, old.source_narration_text, old.source_visual_prompt,
      old.source_visual_type, old.source_duration_ms, old.source_transition,
      old.source_scene_sha256, old.source_scene_plan_version, old.provider, old.model,
      old.provider_request_id, old.format, old.mime_type, old.width, old.height,
      old.file_size_bytes, old.content_sha256, old.storage_bucket, old.storage_path,
      old.failure_code, old.failure_message, old.cleanup_pending) then
    raise exception 'Finalized video visual assets are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_finalized_video_visual_asset() from public, anon, authenticated;
