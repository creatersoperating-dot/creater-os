-- CreatorOS v0.7 release stabilization.
-- This migration is forward-only and assumes migrations 001-007 are applied.

alter table public.video_projects
  add column deletion_state text not null default 'active',
  add column deletion_started_at timestamptz;

alter table public.video_projects
  add constraint video_projects_deletion_state_check
  check (
    (deletion_state = 'active' and deletion_started_at is null)
    or (deletion_state = 'cleaning' and deletion_started_at is not null)
  );

alter table public.video_generations
  add column heartbeat_at timestamptz,
  add column lease_expires_at timestamptz;

alter table public.video_visual_assets
  add column source_scene_plan_version integer;

-- CreatorOS accepts video scene plans up to the existing migration-006
-- platform contract of 30 minutes. Individual providers may advertise a lower
-- limit, which the server must reject before calling this migration's claim RPC.
create or replace function public.creatoros_max_video_duration_ms()
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$ select 1800000::bigint $$;
revoke all on function public.creatoros_max_video_duration_ms() from public;
revoke all on function public.creatoros_max_video_duration_ms() from anon;

update public.video_visual_assets as asset
set source_scene_plan_version = generation.source_scene_plan_version
from public.video_generations as generation
where generation.user_id = asset.user_id
  and generation.brand_id = asset.brand_id
  and generation.project_id = asset.project_id
  and generation.id = asset.generation_id;

alter table public.video_visual_assets
  alter column source_scene_plan_version set not null,
  add constraint video_visual_assets_plan_version_check
    check (source_scene_plan_version >= 1);

create unique index video_visual_assets_generation_scene_id_idx
  on public.video_visual_assets (user_id, generation_id, scene_id);

create or replace function public.video_scene_source_canonical(
  p_title text, p_narration_text text, p_visual_prompt text,
  p_visual_type text, p_duration_ms bigint, p_transition text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select concat(
    'v1|', octet_length(convert_to(p_title, 'UTF8')), ':', p_title,
    '|', octet_length(convert_to(p_narration_text, 'UTF8')), ':', p_narration_text,
    '|', octet_length(convert_to(p_visual_prompt, 'UTF8')), ':', p_visual_prompt,
    '|', octet_length(convert_to(p_visual_type, 'UTF8')), ':', p_visual_type,
    '|', octet_length(convert_to(p_duration_ms::text, 'UTF8')), ':', p_duration_ms::text,
    '|', octet_length(convert_to(p_transition, 'UTF8')), ':', p_transition
  );
$$;

create or replace function public.video_scene_source_sha256(
  p_title text, p_narration_text text, p_visual_prompt text,
  p_visual_type text, p_duration_ms bigint, p_transition text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(public.video_scene_source_canonical(
    p_title, p_narration_text, p_visual_prompt, p_visual_type, p_duration_ms, p_transition
  ), 'UTF8'), 'sha256'), 'hex');
$$;

revoke all on function public.video_scene_source_canonical(text, text, text, text, bigint, text) from public;
revoke all on function public.video_scene_source_canonical(text, text, text, text, bigint, text) from anon;
revoke all on function public.video_scene_source_sha256(text, text, text, text, bigint, text) from public;
revoke all on function public.video_scene_source_sha256(text, text, text, text, bigint, text) from anon;

-- Migration 006-era assets used SHA-256(JSON.stringify([title, narration,
-- prompt, type, duration, transition])). That representation differs from the
-- unambiguous v1 UTF-8 byte-length-prefixed representation above. Rewrite only
-- the stored provenance hash; object bytes, ownership, history, and timestamps
-- remain unchanged. The finalized-asset guard is disabled only for this
-- transaction-scoped forward migration and is restored before validation is
-- installed below.
alter table public.video_visual_assets
  disable trigger video_visual_assets_protect_finalized;
alter table public.video_visual_assets
  disable trigger video_visual_assets_set_updated_at;
update public.video_visual_assets as asset
set source_scene_sha256 = public.video_scene_source_sha256(
  asset.source_scene_title, asset.source_narration_text,
  asset.source_visual_prompt, asset.source_visual_type,
  asset.source_duration_ms, asset.source_transition
)
where asset.source_scene_sha256 is distinct from public.video_scene_source_sha256(
  asset.source_scene_title, asset.source_narration_text,
  asset.source_visual_prompt, asset.source_visual_type,
  asset.source_duration_ms, asset.source_transition
);
alter table public.video_visual_assets
  enable trigger video_visual_assets_set_updated_at;
alter table public.video_visual_assets
  enable trigger video_visual_assets_protect_finalized;

-- Existing active rows receive a short grace lease. This does not rewrite their
-- lifecycle state or attempts; an actually abandoned operation is preserved as
-- failed only when a later authenticated claim observes the expired lease.
update public.video_generations
set heartbeat_at = clock_timestamp(),
    lease_expires_at = clock_timestamp() + interval '30 seconds'
where status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading');

alter table public.video_generations
  add constraint video_generations_lease_check
  check (
    (
      status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
      and heartbeat_at is not null
      and lease_expires_at is not null
      and lease_expires_at > heartbeat_at
    )
    or (
      status not in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
      and lease_expires_at is null
    )
  );

-- Direct browser writes may only create or mutate active projects. Entering the
-- cleanup state is restricted to the authenticated server RPC below.
drop policy video_projects_insert_own on public.video_projects;
create policy video_projects_insert_own on public.video_projects
for insert to authenticated
with check ((select auth.uid()) = user_id and deletion_state = 'active');

drop policy video_projects_update_own on public.video_projects;
create policy video_projects_update_own on public.video_projects
for update to authenticated
using ((select auth.uid()) = user_id and deletion_state = 'active')
with check ((select auth.uid()) = user_id and deletion_state = 'active');

drop policy video_projects_delete_own on public.video_projects;
-- No direct delete policy is recreated. Final deletion is authorized only by
-- finish_video_project_deletion after private object absence is verified.

-- Lifecycle writes stop once project cleanup begins, while owned rows remain
-- readable so the server can enumerate and remove their private objects.
drop policy video_scene_plans_own on public.video_scene_plans;
create policy video_scene_plans_select_own on public.video_scene_plans
for select to authenticated using ((select auth.uid()) = user_id);
create policy video_scene_plans_insert_active on public.video_scene_plans
for insert to authenticated
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_projects as project
    where project.user_id = (select auth.uid())
      and project.brand_id = video_scene_plans.brand_id
      and project.id = video_scene_plans.project_id
      and project.deletion_state = 'active'
  )
);
create policy video_scene_plans_update_active on public.video_scene_plans
for update to authenticated using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_projects as project
    where project.user_id = (select auth.uid())
      and project.brand_id = video_scene_plans.brand_id
      and project.id = video_scene_plans.project_id
      and project.deletion_state = 'active'
  )
);

drop policy video_scene_items_own on public.video_scene_items;
create policy video_scene_items_select_own on public.video_scene_items
for select to authenticated using ((select auth.uid()) = user_id);
create policy video_scene_items_insert_active on public.video_scene_items
for insert to authenticated
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_projects as project
    where project.user_id = (select auth.uid())
      and project.brand_id = video_scene_items.brand_id
      and project.id = video_scene_items.project_id
      and project.deletion_state = 'active'
  )
);
create policy video_scene_items_update_active on public.video_scene_items
for update to authenticated using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_projects as project
    where project.user_id = (select auth.uid())
      and project.brand_id = video_scene_items.brand_id
      and project.id = video_scene_items.project_id
      and project.deletion_state = 'active'
  )
);

drop policy video_generations_own on public.video_generations;
create policy video_generations_select_own on public.video_generations
for select to authenticated using ((select auth.uid()) = user_id);
create policy video_generations_insert_active on public.video_generations
for insert to authenticated
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_projects as project
    where project.user_id = (select auth.uid())
      and project.brand_id = video_generations.brand_id
      and project.id = video_generations.project_id
      and project.deletion_state = 'active'
  )
);
create policy video_generations_update_active on public.video_generations
for update to authenticated using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_projects as project
    where project.user_id = (select auth.uid())
      and project.brand_id = video_generations.brand_id
      and project.id = video_generations.project_id
      and project.deletion_state = 'active'
  )
);

drop policy video_generation_attempts_own on public.video_generation_attempts;
create policy video_generation_attempts_select_own on public.video_generation_attempts
for select to authenticated using ((select auth.uid()) = user_id);
create policy video_generation_attempts_insert_active on public.video_generation_attempts
for insert to authenticated
with check (
  (select auth.uid()) = user_id and exists (
    select 1
    from public.video_generations as generation
    join public.video_projects as project
      on project.user_id = generation.user_id
      and project.brand_id = generation.brand_id
      and project.id = generation.project_id
    where generation.user_id = video_generation_attempts.user_id
      and generation.id = video_generation_attempts.generation_id
      and project.deletion_state = 'active'
  )
);
create policy video_generation_attempts_update_active on public.video_generation_attempts
for update to authenticated using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id and exists (
    select 1
    from public.video_generations as generation
    join public.video_projects as project
      on project.user_id = generation.user_id
      and project.brand_id = generation.brand_id
      and project.id = generation.project_id
    where generation.user_id = video_generation_attempts.user_id
      and generation.id = video_generation_attempts.generation_id
      and project.deletion_state = 'active'
  )
);

drop policy video_visual_assets_own on public.video_visual_assets;
create policy video_visual_assets_select_own on public.video_visual_assets
for select to authenticated using ((select auth.uid()) = user_id);
create policy video_visual_assets_insert_active on public.video_visual_assets
for insert to authenticated
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_generations as generation
    join public.video_projects as project
      on project.user_id = generation.user_id and project.brand_id = generation.brand_id
      and project.id = generation.project_id
    where generation.user_id = (select auth.uid())
      and generation.brand_id = video_visual_assets.brand_id
      and generation.project_id = video_visual_assets.project_id
      and generation.id = video_visual_assets.generation_id
      and generation.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
      and generation.lease_expires_at > clock_timestamp()
      and project.deletion_state = 'active'
  )
);
create policy video_visual_assets_update_active on public.video_visual_assets
for update to authenticated using (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_generations as generation
    join public.video_projects as project
      on project.user_id = generation.user_id and project.brand_id = generation.brand_id
      and project.id = generation.project_id
    where generation.user_id = (select auth.uid())
      and generation.id = video_visual_assets.generation_id
      and generation.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
      and generation.lease_expires_at > clock_timestamp()
      and project.deletion_state = 'active'
  )
)
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_generations as generation
    join public.video_projects as project
      on project.user_id = generation.user_id and project.brand_id = generation.brand_id
      and project.id = generation.project_id
    where generation.user_id = (select auth.uid())
      and generation.id = video_visual_assets.generation_id
      and generation.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
      and generation.lease_expires_at > clock_timestamp()
      and project.deletion_state = 'active'
  )
);

-- Audio production may remain readable for cleanup enumeration, but cannot
-- start or mutate after the owning project enters cleanup.
drop policy audio_generations_insert_own on public.audio_generations;
create policy audio_generations_insert_own on public.audio_generations
for insert to authenticated with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_projects as project
    where project.user_id = (select auth.uid())
      and project.brand_id = audio_generations.brand_id
      and project.id = audio_generations.project_id
      and project.deletion_state = 'active'
  )
);
drop policy audio_generations_update_own on public.audio_generations;
create policy audio_generations_update_own on public.audio_generations
for update to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.video_projects as project
    where project.user_id = (select auth.uid())
      and project.brand_id = audio_generations.brand_id
      and project.id = audio_generations.project_id
      and project.deletion_state = 'active'
  )
);
drop policy audio_generations_delete_own on public.audio_generations;

drop policy audio_generation_attempts_insert_own on public.audio_generation_attempts;
create policy audio_generation_attempts_insert_own on public.audio_generation_attempts
for insert to authenticated with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.audio_generations as generation
    join public.video_projects as project
      on project.user_id = generation.user_id
      and project.brand_id = generation.brand_id
      and project.id = generation.project_id
    where generation.user_id = audio_generation_attempts.user_id
      and generation.id = audio_generation_attempts.generation_id
      and project.deletion_state = 'active'
  )
);
drop policy audio_generation_attempts_update_own on public.audio_generation_attempts;
create policy audio_generation_attempts_update_own on public.audio_generation_attempts
for update to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.audio_generations as generation
    join public.video_projects as project
      on project.user_id = generation.user_id
      and project.brand_id = generation.brand_id
      and project.id = generation.project_id
    where generation.user_id = audio_generation_attempts.user_id
      and generation.id = audio_generation_attempts.generation_id
      and project.deletion_state = 'active'
  )
);
drop policy audio_generation_attempts_delete_own on public.audio_generation_attempts;

-- Generation and attempt lifecycle writes are RPC-only. Authenticated clients
-- retain read access, while the narrowly scoped SECURITY DEFINER functions
-- below perform all reservations, stage changes, completion, and failure.
revoke insert, update, delete on table public.video_generations from authenticated;
revoke insert, update, delete on table public.video_generation_attempts from authenticated;

-- New stabilization columns are part of the immutable finalized provenance.
create or replace function public.protect_video_stabilization_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'video_generations' and old.status = 'ready'
    and row(new.heartbeat_at, new.lease_expires_at)
      is distinct from row(old.heartbeat_at, old.lease_expires_at) then
    raise exception 'Finalized video generations are immutable.' using errcode = '42501';
  end if;
  if tg_table_name = 'video_visual_assets' and old.status = 'ready'
    and new.source_scene_plan_version is distinct from old.source_scene_plan_version then
    raise exception 'Finalized video visual assets are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger video_generations_protect_stabilization_fields
before update of heartbeat_at, lease_expires_at on public.video_generations
for each row execute function public.protect_video_stabilization_fields();
create trigger video_visual_assets_protect_stabilization_fields
before update of source_scene_plan_version on public.video_visual_assets
for each row execute function public.protect_video_stabilization_fields();
revoke all on function public.protect_video_stabilization_fields() from public;
revoke all on function public.protect_video_stabilization_fields() from anon;

-- Independently enforce one complete, current scene-plan asset set whenever a
-- ready generation is attached, including direct authenticated project writes.
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
      left join storage.objects as object
        on object.bucket_id = asset.storage_bucket and object.name = asset.storage_path
      where asset.user_id = new.user_id and asset.brand_id = new.brand_id
        and asset.project_id = new.id and asset.generation_id = v_generation.id
        and (
          scene.id is null
          or asset.scene_plan_id is distinct from v_plan.id
          or asset.source_scene_plan_version is distinct from v_plan.version
          or asset.source_scene_title is distinct from scene.title
          or asset.source_narration_text is distinct from scene.narration_text
          or asset.source_visual_prompt is distinct from scene.visual_prompt
          or asset.source_visual_type is distinct from scene.visual_type
          or asset.source_duration_ms is distinct from scene.duration_ms
          or asset.source_transition is distinct from scene.transition
          or asset.status <> 'ready' or asset.cleanup_pending
          or asset.format is distinct from 'svg' or asset.mime_type is distinct from 'image/svg+xml'
          or asset.width is null or asset.width <= 0 or asset.height is null or asset.height <= 0
          or asset.file_size_bytes is null or asset.file_size_bytes <= 0
          or asset.content_sha256 !~ '^[0-9a-f]{64}$'
          or asset.source_scene_sha256 is distinct from public.video_scene_source_sha256(
            scene.title, scene.narration_text, scene.visual_prompt,
            scene.visual_type, scene.duration_ms, scene.transition
          )
          or asset.storage_bucket is distinct from 'project-videos'
          or asset.storage_path is distinct from concat(new.user_id::text, '/', new.brand_id, '/', new.id, '/', v_generation.id::text, '/scenes/', asset.scene_number::text, '.svg')
          or object.name is null
          or coalesce(object.metadata->>'mimetype', '') <> 'image/svg+xml'
          or coalesce(object.metadata->>'size', '') !~ '^[0-9]+$'
          or (object.metadata->>'size')::bigint is distinct from asset.file_size_bytes
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

create trigger video_projects_validate_video_asset_set
before update of video_generation_id on public.video_projects
for each row execute function public.validate_project_video_asset_set();
revoke all on function public.validate_project_video_asset_set() from public;
revoke all on function public.validate_project_video_asset_set() from anon;

-- Keep active lifecycle states monotonic. Terminal rows are never reused.
-- A replay of the same operation remains idempotent and returns its historical
-- row; an explicit retry or a different operation after expiry reserves a new
-- generation row.
create or replace function public.enforce_video_generation_status_progression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_rank integer;
  v_new_rank integer;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status in ('failed', 'cancelled')
    and old.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading') then
    return new;
  end if;
  if old.status = 'ready' and new.status = 'failed'
    and new.failure_code = 'storage_object_missing'
    and new.failure_message = 'The finalized video object is missing.'
    and not exists (
      select 1 from storage.objects as object
      where object.bucket_id = old.storage_bucket and object.name = old.storage_path
    ) then
    return new;
  end if;
  if old.status in ('ready', 'failed', 'cancelled') then
    raise exception 'Terminal video generation status cannot regress.' using errcode = '23514';
  end if;

  v_old_rank := case old.status
    when 'queued' then 0 when 'planning' then 1 when 'generating_assets' then 2
    when 'rendering' then 3 when 'uploading' then 4 else 100 end;
  v_new_rank := case new.status
    when 'queued' then 0 when 'planning' then 1 when 'generating_assets' then 2
    when 'rendering' then 3 when 'uploading' then 4 when 'ready' then 5 else 100 end;
  if v_new_rank < v_old_rank then
    raise exception 'Video generation status cannot regress.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger video_generations_enforce_status_progression
before update of status on public.video_generations
for each row execute function public.enforce_video_generation_status_progression();
revoke all on function public.enforce_video_generation_status_progression() from public;
revoke all on function public.enforce_video_generation_status_progression() from anon;

-- A generation cannot enter ready until its current plan has one and only one
-- authoritative ready object-backed visual for every active scene.
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
      left join storage.objects as object
        on object.bucket_id = asset.storage_bucket and object.name = asset.storage_path
      where asset.user_id = new.user_id and asset.brand_id = new.brand_id
        and asset.project_id = new.project_id and asset.generation_id = new.id
        and (
          scene.id is null or asset.scene_plan_id is distinct from v_plan.id
          or asset.source_scene_plan_version is distinct from v_plan.version
          or asset.source_scene_title is distinct from scene.title
          or asset.source_narration_text is distinct from scene.narration_text
          or asset.source_visual_prompt is distinct from scene.visual_prompt
          or asset.source_visual_type is distinct from scene.visual_type
          or asset.source_duration_ms is distinct from scene.duration_ms
          or asset.source_transition is distinct from scene.transition
          or asset.status <> 'ready' or asset.cleanup_pending
          or asset.format is distinct from 'svg' or asset.mime_type is distinct from 'image/svg+xml'
          or asset.width is null or asset.width <= 0 or asset.height is null or asset.height <= 0
          or asset.file_size_bytes is null or asset.file_size_bytes <= 0
          or asset.content_sha256 !~ '^[0-9a-f]{64}$'
          or asset.source_scene_sha256 is distinct from public.video_scene_source_sha256(
            scene.title, scene.narration_text, scene.visual_prompt,
            scene.visual_type, scene.duration_ms, scene.transition
          )
          or asset.storage_bucket is distinct from 'project-videos'
          or asset.storage_path is distinct from concat(new.user_id::text, '/', new.brand_id, '/', new.project_id, '/', new.id::text, '/scenes/', asset.scene_number::text, '.svg')
          or object.name is null or coalesce(object.metadata->>'mimetype', '') <> 'image/svg+xml'
          or coalesce(object.metadata->>'size', '') !~ '^[0-9]+$'
          or (object.metadata->>'size')::bigint is distinct from asset.file_size_bytes
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

create trigger video_generations_validate_ready_asset_set
before update of status on public.video_generations
for each row execute function public.validate_ready_video_generation_asset_set();
revoke all on function public.validate_ready_video_generation_asset_set() from public;
revoke all on function public.validate_ready_video_generation_asset_set() from anon;

create or replace function public.claim_video_generation_operation(
  p_brand_id text,
  p_project_id text,
  p_operation_id uuid,
  p_generation_id uuid,
  p_retry_generation_id uuid,
  p_source_script_id text,
  p_source_audio_generation_id text,
  p_source_scene_plan_id uuid,
  p_provider text,
  p_model text,
  p_source_script_updated_at timestamptz,
  p_source_content_sha256 text,
  p_source_audio_updated_at timestamptz,
  p_source_audio_sha256 text,
  p_source_scene_plan_version integer,
  p_source_scene_plan_hash text,
  p_scene_count integer,
  p_duration_ms bigint,
  p_lease_ms integer
)
returns table (generation_id uuid, recovered boolean, recovery_message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_existing public.video_generations%rowtype;
  v_active public.video_generations%rowtype;
  v_recovered boolean := false;
  v_now timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if nullif(trim(p_brand_id), '') is null
    or nullif(trim(p_project_id), '') is null
    or p_operation_id is null or p_generation_id is null
    or p_source_scene_plan_id is null
    or p_generation_id is not distinct from p_retry_generation_id
    or p_duration_ms is null or p_duration_ms < 1
    or p_duration_ms > public.creatoros_max_video_duration_ms()
    or p_lease_ms < 15000 or p_lease_ms > 120000 then
    raise exception 'Valid video operation scope is required.' using errcode = '22023';
  end if;

  select project.* into v_project
  from public.video_projects as project
  where project.user_id = v_user_id
    and project.brand_id = trim(p_brand_id)
    and project.id = trim(p_project_id)
  for update;
  if not found then return; end if;
  v_now := clock_timestamp();
  if v_project.deletion_state <> 'active' then
    raise exception 'The video project is being deleted.' using errcode = '55000';
  end if;

  if p_retry_generation_id is not null then
    select generation.* into v_existing
    from public.video_generations as generation
    where generation.user_id = v_user_id
      and generation.brand_id = v_project.brand_id
      and generation.project_id = v_project.id
      and generation.id = p_retry_generation_id
      and generation.operation_id <> p_operation_id
      and generation.status = 'failed'
      and generation.source_script_id = p_source_script_id
      and generation.source_audio_generation_id = p_source_audio_generation_id
      and generation.source_scene_plan_id = p_source_scene_plan_id
      and generation.source_script_updated_at = p_source_script_updated_at
      and generation.source_content_sha256 = p_source_content_sha256
      and generation.source_audio_updated_at = p_source_audio_updated_at
      and generation.source_audio_sha256 = p_source_audio_sha256
      and generation.source_scene_plan_version = p_source_scene_plan_version
      and generation.source_scene_plan_hash = p_source_scene_plan_hash
    for update;
    if not found then
      raise exception 'The failed video operation is no longer retryable.' using errcode = '55000';
    end if;
  end if;

  select generation.* into v_existing
  from public.video_generations as generation
  where generation.user_id = v_user_id
    and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id
    and generation.operation_id = p_operation_id
  for update;

  if found then
    v_now := clock_timestamp();
    if v_existing.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
      and v_existing.lease_expires_at <= v_now then
      update public.video_generation_attempts set
        status = 'failed', failure_code = 'lease_expired',
        failure_message = 'The video operation lease expired before completion.',
        completed_at = v_now
      where public.video_generation_attempts.user_id = v_user_id
        and public.video_generation_attempts.generation_id = v_existing.id
        and public.video_generation_attempts.status = 'rendering';
      update public.video_generations set
        status = 'failed', failure_code = 'lease_expired',
        failure_message = 'The video operation lease expired before completion.',
        completed_at = v_now, lease_expires_at = null
      where user_id = v_user_id and id = v_existing.id;
      return query select v_existing.id, true,
        'This video operation expired and was preserved as failed. Start a new operation to retry.'::text;
      return;
    end if;
    return query select v_existing.id, false, null::text;
    return;
  end if;

  select generation.* into v_active
  from public.video_generations as generation
  where generation.user_id = v_user_id
    and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id
    and generation.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
  for update;

  if found then
    v_now := clock_timestamp();
    if v_active.lease_expires_at > v_now then
      return query select v_active.id, false, null::text;
      return;
    end if;

    update public.video_generation_attempts set
      status = 'failed', failure_code = 'lease_expired',
      failure_message = 'The video operation lease expired before completion.',
      completed_at = v_now
    where public.video_generation_attempts.user_id = v_user_id
      and public.video_generation_attempts.generation_id = v_active.id
      and public.video_generation_attempts.status = 'rendering';
    update public.video_generations set
      status = 'failed', failure_code = 'lease_expired',
      failure_message = 'The video operation lease expired before completion.',
      completed_at = v_now, lease_expires_at = null
    where user_id = v_user_id and id = v_active.id;
    v_recovered := true;
  end if;

  v_now := clock_timestamp();
  insert into public.video_generations (
    user_id, id, brand_id, project_id, operation_id,
    source_script_id, source_audio_generation_id, source_scene_plan_id,
    status, provider, model, source_script_updated_at,
    source_content_sha256, source_audio_updated_at, source_audio_sha256,
    source_scene_plan_version, source_scene_plan_hash, scene_count,
    duration_ms, storage_bucket, storage_path, heartbeat_at, lease_expires_at
  ) values (
    v_user_id, p_generation_id, v_project.brand_id, v_project.id, p_operation_id,
    p_source_script_id, p_source_audio_generation_id, p_source_scene_plan_id,
    'queued', trim(p_provider), trim(p_model), p_source_script_updated_at,
    p_source_content_sha256, p_source_audio_updated_at, p_source_audio_sha256,
    p_source_scene_plan_version, p_source_scene_plan_hash, p_scene_count,
    p_duration_ms, 'project-videos',
    concat(v_user_id::text, '/', v_project.brand_id, '/', v_project.id, '/', p_generation_id::text, '/render.mp4'),
    v_now, v_now + make_interval(secs => p_lease_ms / 1000.0)
  );

  return query select p_generation_id, v_recovered,
    case when v_recovered then
      'An expired video operation was preserved as failed and a new operation was reserved.'::text
    else null::text end;
end;
$$;

revoke all on function public.claim_video_generation_operation(
  text, text, uuid, uuid, uuid, text, text, uuid, text, text,
  timestamptz, text, timestamptz, text, integer, text, integer, bigint, integer
) from public;
revoke all on function public.claim_video_generation_operation(
  text, text, uuid, uuid, uuid, text, text, uuid, text, text,
  timestamptz, text, timestamptz, text, integer, text, integer, bigint, integer
) from anon;
grant execute on function public.claim_video_generation_operation(
  text, text, uuid, uuid, uuid, text, text, uuid, text, text,
  timestamptz, text, timestamptz, text, integer, text, integer, bigint, integer
) to authenticated;

create or replace function public.heartbeat_video_generation(
  p_brand_id text,
  p_project_id text,
  p_generation_id uuid,
  p_lease_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_project public.video_projects%rowtype;
  v_generation public.video_generations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_generation_id is null or p_lease_ms < 15000 or p_lease_ms > 120000 then
    raise exception 'Valid video lease scope is required.' using errcode = '22023';
  end if;

  select project.* into v_project from public.video_projects as project
  where project.user_id = v_user_id and project.brand_id = trim(p_brand_id)
    and project.id = trim(p_project_id) and project.deletion_state = 'active'
  for update;
  if not found then return false; end if;
  select generation.* into v_generation from public.video_generations as generation
  where generation.user_id = v_user_id and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id and generation.id = p_generation_id
    and generation.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
  for update;
  if not found then return false; end if;

  v_now := clock_timestamp();
  if v_generation.lease_expires_at <= v_now then return false; end if;
  update public.video_generations set
    heartbeat_at = v_now,
    lease_expires_at = v_now + make_interval(secs => p_lease_ms / 1000.0)
  where user_id = v_user_id and id = v_generation.id;
  return true;
end;
$$;

revoke all on function public.heartbeat_video_generation(text, text, uuid, integer) from public;
revoke all on function public.heartbeat_video_generation(text, text, uuid, integer) from anon;
grant execute on function public.heartbeat_video_generation(text, text, uuid, integer) to authenticated;

create or replace function public.start_video_generation_attempt(
  p_brand_id text, p_project_id text, p_generation_id uuid,
  p_provider text, p_model text
)
returns setof public.video_generations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_generation public.video_generations%rowtype;
  v_now timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select project.* into v_project from public.video_projects as project
  where project.user_id = v_user_id and project.brand_id = trim(p_brand_id)
    and project.id = trim(p_project_id) and project.deletion_state = 'active'
  for update;
  if not found then return; end if;
  select generation.* into v_generation from public.video_generations as generation
  where generation.user_id = v_user_id and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id and generation.id = p_generation_id
    and generation.status = 'queued'
  for update;
  if not found then return; end if;
  v_now := clock_timestamp();
  if v_generation.lease_expires_at <= v_now then return; end if;
  if trim(p_provider) is distinct from v_generation.provider
    or trim(p_model) is distinct from v_generation.model then
    return;
  end if;

  update public.video_generations as generation set
    status = 'planning', attempt_count = generation.attempt_count + 1,
    started_at = v_now, completed_at = null, failure_code = null,
    failure_message = null, cleanup_pending = false
  where generation.user_id = v_user_id and generation.id = v_generation.id
  returning generation.* into v_generation;

  insert into public.video_generation_attempts (
    user_id, generation_id, attempt_number, provider, model, status, started_at
  ) values (
    v_user_id, v_generation.id, v_generation.attempt_count,
    v_generation.provider, v_generation.model, 'rendering', v_now
  );
  return next v_generation;
end;
$$;

revoke all on function public.start_video_generation_attempt(text, text, uuid, text, text) from public;
revoke all on function public.start_video_generation_attempt(text, text, uuid, text, text) from anon;
grant execute on function public.start_video_generation_attempt(text, text, uuid, text, text) to authenticated;

create or replace function public.advance_video_generation_stage(
  p_generation_id uuid, p_expected_status text, p_next_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_generation public.video_generations%rowtype;
  v_now timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if not (
    (p_expected_status = 'planning' and p_next_status = 'generating_assets')
    or (p_expected_status = 'generating_assets' and p_next_status = 'rendering')
    or (p_expected_status = 'rendering' and p_next_status = 'uploading')
  ) then raise exception 'Invalid video lifecycle transition.' using errcode = '22023'; end if;

  select project.* into v_project from public.video_projects as project
  where project.user_id = v_user_id and project.deletion_state = 'active'
    and exists (
      select 1 from public.video_generations as generation
      where generation.user_id = v_user_id and generation.id = p_generation_id
        and generation.brand_id = project.brand_id and generation.project_id = project.id
    )
  for update;
  if not found then return false; end if;
  select generation.* into v_generation from public.video_generations as generation
  where generation.user_id = v_user_id and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id and generation.id = p_generation_id
    and generation.status = p_expected_status
  for update;
  if not found then return false; end if;
  v_now := clock_timestamp();
  if v_generation.lease_expires_at <= v_now then return false; end if;
  update public.video_generations set status = p_next_status
  where user_id = v_user_id and id = v_generation.id;
  return true;
end;
$$;

revoke all on function public.advance_video_generation_stage(uuid, text, text) from public;
revoke all on function public.advance_video_generation_stage(uuid, text, text) from anon;
grant execute on function public.advance_video_generation_stage(uuid, text, text) to authenticated;

create or replace function public.complete_video_generation(
  p_generation_id uuid, p_attempt_number integer, p_scenes_completed integer,
  p_width integer, p_height integer, p_duration_ms bigint,
  p_format text, p_mime_type text, p_file_size_bytes bigint,
  p_content_sha256 text, p_has_audio boolean
)
returns setof public.video_generations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_generation public.video_generations%rowtype;
  v_attempt public.video_generation_attempts%rowtype;
  v_now timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select project.* into v_project from public.video_projects as project
  where project.user_id = v_user_id and project.deletion_state = 'active'
    and exists (
      select 1 from public.video_generations as generation
      where generation.user_id = v_user_id and generation.id = p_generation_id
        and generation.brand_id = project.brand_id and generation.project_id = project.id
    )
  for update;
  if not found then return; end if;
  select generation.* into v_generation from public.video_generations as generation
  where generation.user_id = v_user_id and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id and generation.id = p_generation_id
    and generation.status = 'uploading'
  for update;
  if not found then return; end if;
  select attempt.* into v_attempt from public.video_generation_attempts as attempt
  where attempt.user_id = v_user_id and attempt.generation_id = v_generation.id
    and attempt.attempt_number = p_attempt_number and attempt.status = 'rendering'
  for update;
  if not found then return; end if;
  v_now := clock_timestamp();
  if v_generation.lease_expires_at <= v_now then return; end if;
  if p_attempt_number is null or p_attempt_number <> v_generation.attempt_count
    or v_attempt.provider is distinct from v_generation.provider
    or v_attempt.model is distinct from v_generation.model
    or p_scenes_completed is distinct from v_generation.scene_count
    or p_width is null or p_width < 1 or p_width > 7680
    or p_height is null or p_height < 1 or p_height > 7680
    or p_duration_ms is null or p_duration_ms < 1
    or p_duration_ms > public.creatoros_max_video_duration_ms()
    or v_generation.duration_ms < 1
    or v_generation.duration_ms > public.creatoros_max_video_duration_ms()
    or pg_catalog.abs(p_duration_ms - v_generation.duration_ms)
      > greatest(v_generation.duration_ms * 0.2, 250)
    or p_format is distinct from 'mp4'
    or p_mime_type is distinct from 'video/mp4'
    or p_file_size_bytes is null or p_file_size_bytes < 1 or p_file_size_bytes > 209715200
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_has_audio is null
    or v_generation.storage_bucket is distinct from 'project-videos'
    or v_generation.storage_path is distinct from concat(
      v_user_id::text, '/', v_generation.brand_id, '/', v_generation.project_id,
      '/', v_generation.id::text, '/render.mp4'
    )
    or not exists (
      select 1 from storage.objects as object
      where object.bucket_id = 'project-videos'
        and object.name = v_generation.storage_path
        and coalesce(object.metadata->>'mimetype', '') = 'video/mp4'
        and coalesce(object.metadata->>'size', '') ~ '^[0-9]+$'
        and (object.metadata->>'size')::numeric = p_file_size_bytes
    ) then
    return;
  end if;

  -- The generation transition runs first so its exact scene-set trigger must
  -- succeed before the attempt can be completed. Any later failure still rolls
  -- the entire function transaction back atomically.
  update public.video_generations as generation set
    status = 'ready', width = p_width, height = p_height, duration_ms = p_duration_ms,
    format = p_format, mime_type = p_mime_type, file_size_bytes = p_file_size_bytes,
    content_sha256 = p_content_sha256, has_audio = p_has_audio,
    completed_at = v_now, lease_expires_at = null
  where generation.user_id = v_user_id and generation.id = v_generation.id
  returning generation.* into v_generation;
  update public.video_generation_attempts set
    status = 'completed', scenes_completed = p_scenes_completed, completed_at = v_now
  where user_id = v_user_id and generation_id = v_generation.id
    and attempt_number = p_attempt_number and status = 'rendering';
  if not found then
    raise exception 'The active video attempt changed during completion.' using errcode = '40001';
  end if;
  return next v_generation;
end;
$$;

revoke all on function public.complete_video_generation(uuid, integer, integer, integer, integer, bigint, text, text, bigint, text, boolean) from public;
revoke all on function public.complete_video_generation(uuid, integer, integer, integer, integer, bigint, text, text, bigint, text, boolean) from anon;
grant execute on function public.complete_video_generation(uuid, integer, integer, integer, integer, bigint, text, text, bigint, text, boolean) to authenticated;

create or replace function public.fail_video_generation(
  p_generation_id uuid, p_attempt_number integer, p_failure_code text,
  p_failure_message text, p_cleanup_pending boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_generation public.video_generations%rowtype;
  v_attempt public.video_generation_attempts%rowtype;
  v_now timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select project.* into v_project from public.video_projects as project
  where project.user_id = v_user_id and project.deletion_state = 'active'
    and exists (
      select 1 from public.video_generations as generation
      where generation.user_id = v_user_id and generation.id = p_generation_id
        and generation.brand_id = project.brand_id and generation.project_id = project.id
    )
  for update;
  if not found then return false; end if;
  select generation.* into v_generation from public.video_generations as generation
  where generation.user_id = v_user_id and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id and generation.id = p_generation_id
    and generation.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
  for update;
  if not found then return false; end if;
  if p_attempt_number is null or p_attempt_number <> v_generation.attempt_count then return false; end if;
  select attempt.* into v_attempt from public.video_generation_attempts as attempt
  where attempt.user_id = v_user_id and attempt.generation_id = v_generation.id
    and attempt.attempt_number = p_attempt_number and attempt.status = 'rendering'
  for update;
  if not found then return false; end if;
  v_now := clock_timestamp();
  if v_generation.lease_expires_at <= v_now then return false; end if;
  update public.video_generation_attempts set
    status = 'failed', failure_code = p_failure_code,
    failure_message = p_failure_message, completed_at = v_now
  where user_id = v_user_id and generation_id = v_generation.id
    and attempt_number = p_attempt_number and status = 'rendering';
  update public.video_generations set
    status = 'failed', failure_code = p_failure_code,
    failure_message = p_failure_message, cleanup_pending = p_cleanup_pending,
    completed_at = v_now, lease_expires_at = null
  where user_id = v_user_id and id = v_generation.id;
  return true;
end;
$$;

revoke all on function public.fail_video_generation(uuid, integer, text, text, boolean) from public;
revoke all on function public.fail_video_generation(uuid, integer, text, text, boolean) from anon;
grant execute on function public.fail_video_generation(uuid, integer, text, text, boolean) to authenticated;

create or replace function public.fail_ready_video_storage_loss(
  p_brand_id text, p_project_id text, p_generation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_generation public.video_generations%rowtype;
  v_now timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select project.* into v_project from public.video_projects as project
  where project.user_id = v_user_id and project.brand_id = trim(p_brand_id)
    and project.id = trim(p_project_id) and project.deletion_state = 'active'
  for update;
  if not found then return false; end if;
  select generation.* into v_generation from public.video_generations as generation
  where generation.user_id = v_user_id and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id and generation.id = p_generation_id
    and generation.status = 'ready' for update;
  if not found then return false; end if;
  if exists (
    select 1 from storage.objects as object
    where object.bucket_id = v_generation.storage_bucket and object.name = v_generation.storage_path
  ) then return false; end if;
  v_now := clock_timestamp();
  update public.video_projects set video_generation_id = null
  where user_id = v_user_id and brand_id = v_project.brand_id and id = v_project.id
    and video_generation_id = v_generation.id;
  update public.video_generations set
    status = 'failed', failure_code = 'storage_object_missing',
    failure_message = 'The finalized video object is missing.', completed_at = v_now,
    cleanup_pending = false, lease_expires_at = null
  where user_id = v_user_id and id = v_generation.id;
  return true;
end;
$$;

revoke all on function public.fail_ready_video_storage_loss(text, text, uuid) from public;
revoke all on function public.fail_ready_video_storage_loss(text, text, uuid) from anon;
grant execute on function public.fail_ready_video_storage_loss(text, text, uuid) to authenticated;

create or replace function public.authorize_project_media_insert(
  p_bucket_id text, p_name text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_parts text[] := storage.foldername(p_name);
  v_brand_id text;
  v_project_id text;
begin
  if v_user_id is null or p_bucket_id not in ('project-videos', 'project-audio')
    or v_parts[1] is distinct from v_user_id::text then return false; end if;
  v_brand_id := v_parts[2];
  v_project_id := v_parts[3];
  if nullif(v_brand_id, '') is null or nullif(v_project_id, '') is null then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(pg_catalog.chr(31), v_user_id::text, v_brand_id, v_project_id), 20260801008
  ));

  if not exists (
    select 1 from public.video_projects as project
    where project.user_id = v_user_id and project.brand_id = v_brand_id
      and project.id = v_project_id and project.deletion_state = 'active'
  ) then return false; end if;

  if p_bucket_id = 'project-videos' then
    return exists (
      select 1 from public.video_generations as generation
      where generation.user_id = v_user_id and generation.brand_id = v_brand_id
        and generation.project_id = v_project_id and generation.id::text = v_parts[4]
        and generation.storage_bucket = p_bucket_id and generation.storage_path = p_name
        and generation.status = 'uploading' and generation.lease_expires_at > clock_timestamp()
    ) or exists (
      select 1
      from public.video_visual_assets as asset
      join public.video_generations as generation
        on generation.user_id = asset.user_id and generation.id = asset.generation_id
      where asset.user_id = v_user_id and asset.brand_id = v_brand_id
        and asset.project_id = v_project_id and asset.storage_bucket = p_bucket_id
        and asset.storage_path = p_name and asset.status = 'uploading'
        and generation.status = 'generating_assets'
        and generation.lease_expires_at > clock_timestamp()
    );
  end if;

  return array_length(v_parts, 1) = 4 and storage.filename(p_name) = 'narration.wav'
    and exists (
      select 1 from public.audio_generations as generation
      where generation.user_id = v_user_id and generation.brand_id = v_brand_id
        and generation.project_id = v_project_id and generation.id = v_parts[4]
        and generation.storage_bucket = p_bucket_id and generation.storage_path = p_name
        and generation.status = 'uploading'
    );
end;
$$;

revoke all on function public.authorize_project_media_insert(text, text) from public;
revoke all on function public.authorize_project_media_insert(text, text) from anon;
grant execute on function public.authorize_project_media_insert(text, text) to authenticated;

create or replace function public.begin_video_project_deletion(
  p_brand_id text,
  p_project_id text,
  p_expected_updated_at timestamptz
)
returns setof public.video_projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if nullif(trim(p_brand_id), '') is null or nullif(trim(p_project_id), '') is null then
    raise exception 'Valid project deletion scope is required.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(pg_catalog.chr(31), v_user_id::text, trim(p_brand_id), trim(p_project_id)), 20260801008
  ));
  select project.* into v_project
  from public.video_projects as project
  where project.user_id = v_user_id
    and project.brand_id = trim(p_brand_id)
    and project.id = trim(p_project_id)
  for update;
  if not found then return; end if;

  if v_project.deletion_state = 'cleaning' then
    return next v_project;
    return;
  end if;
  if p_expected_updated_at is null
    or v_project.updated_at is distinct from p_expected_updated_at then
    return;
  end if;

  update public.video_projects as project set
    deletion_state = 'cleaning', deletion_started_at = clock_timestamp()
  where project.user_id = v_user_id
    and project.brand_id = v_project.brand_id
    and project.id = v_project.id
  returning project.* into v_project;
  return next v_project;
end;
$$;

revoke all on function public.begin_video_project_deletion(text, text, timestamptz) from public;
revoke all on function public.begin_video_project_deletion(text, text, timestamptz) from anon;
grant execute on function public.begin_video_project_deletion(text, text, timestamptz) to authenticated;

create or replace function public.finish_video_project_deletion(
  p_brand_id text,
  p_project_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_deleted_id text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if nullif(trim(p_brand_id), '') is null or nullif(trim(p_project_id), '') is null then
    raise exception 'Valid project deletion scope is required.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(pg_catalog.chr(31), v_user_id::text, trim(p_brand_id), trim(p_project_id)), 20260801008
  ));
  select project.* into v_project
  from public.video_projects as project
    where project.user_id = v_user_id and project.brand_id = trim(p_brand_id)
      and project.id = trim(p_project_id) and project.deletion_state = 'cleaning'
  for update;
  if not found then return false; end if;

  if exists (
    select 1 from public.video_generations as generation
    join storage.objects as object
      on object.bucket_id = generation.storage_bucket and object.name = generation.storage_path
    where generation.user_id = v_user_id and generation.brand_id = trim(p_brand_id)
      and generation.project_id = trim(p_project_id)
  ) or exists (
    select 1 from public.video_visual_assets as asset
    join storage.objects as object
      on object.bucket_id = asset.storage_bucket and object.name = asset.storage_path
    where asset.user_id = v_user_id and asset.brand_id = trim(p_brand_id)
      and asset.project_id = trim(p_project_id)
  ) or exists (
    select 1 from public.audio_generations as generation
    join storage.objects as object
      on object.bucket_id = generation.storage_bucket and object.name = generation.storage_path
    where generation.user_id = v_user_id and generation.brand_id = trim(p_brand_id)
      and generation.project_id = trim(p_project_id)
  ) then
    raise exception 'Private project media cleanup is incomplete.' using errcode = '55000';
  end if;

  delete from public.video_projects as project
  where project.user_id = v_user_id and project.brand_id = trim(p_brand_id)
    and project.id = trim(p_project_id) and project.deletion_state = 'cleaning'
  returning project.id into v_deleted_id;
  return v_deleted_id is not null;
end;
$$;

revoke all on function public.finish_video_project_deletion(text, text) from public;
revoke all on function public.finish_video_project_deletion(text, text) from anon;
grant execute on function public.finish_video_project_deletion(text, text) to authenticated;

create or replace function public.can_delete_project_video_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and nullif(trim(p_name), '') is not null
    and (
      exists (
        select 1 from public.video_generations as generation
        where generation.user_id = auth.uid()
          and generation.storage_bucket = 'project-videos'
          and generation.storage_path = p_name
          and (
            (
              generation.status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading', 'failed', 'cancelled')
              and not exists (
                select 1 from public.video_projects as attached
                where attached.user_id = generation.user_id
                  and attached.brand_id = generation.brand_id
                  and attached.id = generation.project_id
                  and attached.video_generation_id = generation.id
              )
            )
            or exists (
              select 1 from public.video_projects as deleting
              where deleting.user_id = generation.user_id
                and deleting.brand_id = generation.brand_id
                and deleting.id = generation.project_id
                and deleting.deletion_state = 'cleaning'
            )
          )
      )
      or exists (
        select 1
        from public.video_visual_assets as asset
        join public.video_generations as generation
          on generation.user_id = asset.user_id
          and generation.id = asset.generation_id
        where asset.user_id = auth.uid()
          and asset.storage_bucket = 'project-videos'
          and asset.storage_path = p_name
          and (
            (
              asset.status in ('queued', 'generating', 'uploading', 'failed')
              and generation.status <> 'ready'
            )
            or exists (
              select 1 from public.video_projects as deleting
              where deleting.user_id = asset.user_id
                and deleting.brand_id = asset.brand_id
                and deleting.id = asset.project_id
                and deleting.deletion_state = 'cleaning'
            )
          )
      )
    );
$$;

revoke all on function public.can_delete_project_video_object(text) from public;
revoke all on function public.can_delete_project_video_object(text) from anon;
grant execute on function public.can_delete_project_video_object(text) to authenticated;

-- Storage INSERT authorization and deletion take the same project-scoped
-- transaction advisory lock. Deletion therefore waits for every previously
-- authorized insert to commit before it sets cleaning, while later inserts wait
-- for the marker and are rejected after it commits.
drop policy project_videos_insert_own on storage.objects;
create policy project_videos_insert_own on storage.objects
for insert to authenticated with check (
  bucket_id = 'project-videos' and public.authorize_project_media_insert(bucket_id, name)
);

drop policy project_audio_insert_own on storage.objects;
create policy project_audio_insert_own on storage.objects
for insert to authenticated with check (
  bucket_id = 'project-audio' and public.authorize_project_media_insert(bucket_id, name)
);

-- Narration objects are also immutable while ready/current, except during the
-- same explicit project cleanup state used for video objects.
drop policy project_audio_delete_own on storage.objects;
create policy project_audio_delete_own on storage.objects
for delete to authenticated using (
  bucket_id = 'project-audio'
  and array_length(storage.foldername(name), 1) = 4
  and storage.filename(name) = 'narration.wav'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.audio_generations as generation
    where generation.user_id = (select auth.uid())
      and generation.brand_id = (storage.foldername(name))[2]
      and generation.project_id = (storage.foldername(name))[3]
      and generation.id = (storage.foldername(name))[4]
      and generation.storage_bucket = bucket_id
      and generation.storage_path = name
      and (
        generation.status <> 'ready'
        or exists (
          select 1 from public.video_projects as project
          where project.user_id = generation.user_id
            and project.brand_id = generation.brand_id
            and project.id = generation.project_id
            and project.deletion_state = 'cleaning'
        )
      )
  )
);
