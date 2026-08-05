alter table public.video_projects add column video_generation_id uuid;

alter table public.video_projects
  add constraint video_projects_video_generation_fkey
  foreign key (user_id, brand_id, id, video_generation_id)
  references public.video_generations(user_id, brand_id, project_id, id)
  on delete set null (video_generation_id);

create index video_projects_video_generation_idx
  on public.video_projects (user_id, video_generation_id)
  where video_generation_id is not null;

create or replace function public.attach_ready_video_generation(
  p_brand_id text,
  p_project_id text,
  p_video_generation_id uuid,
  p_expected_project_updated_at timestamptz
)
returns setof public.video_projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_script public.scripts%rowtype;
  v_audio public.audio_generations%rowtype;
  v_plan public.video_scene_plans%rowtype;
  v_generation public.video_generations%rowtype;
  v_expected_path text;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if nullif(trim(p_brand_id), '') is null or nullif(trim(p_project_id), '') is null
    or p_video_generation_id is null or p_expected_project_updated_at is null then
    raise exception 'Valid video attachment scope is required.' using errcode = '22023';
  end if;

  select project.* into v_project from public.video_projects as project
  where project.user_id = v_user_id and project.brand_id = trim(p_brand_id)
    and project.id = trim(p_project_id) for update;
  if not found then return; end if;
  if v_project.updated_at is distinct from p_expected_project_updated_at then return; end if;
  if v_project.script_id is null or v_project.audio_generation_id is null then
    raise exception 'Current script and narration are required.' using errcode = '23514';
  end if;

  select script.* into v_script from public.scripts as script
  where script.user_id = v_user_id and script.brand_id = v_project.brand_id
    and script.id = v_project.script_id for share;
  if not found then raise exception 'Current script was not found.' using errcode = '23503'; end if;

  select audio.* into v_audio from public.audio_generations as audio
  where audio.user_id = v_user_id and audio.brand_id = v_project.brand_id
    and audio.project_id = v_project.id and audio.id = v_project.audio_generation_id
    and audio.status = 'ready' for share;
  if not found then raise exception 'Current narration is unavailable.' using errcode = '23514'; end if;

  if v_audio.source_script_id is distinct from v_project.script_id
    or v_audio.source_script_updated_at is distinct from v_script.updated_at
    or v_audio.source_content_sha256 is distinct from encode(extensions.digest(v_script.content, 'sha256'), 'hex') then
    raise exception 'Current narration is stale.' using errcode = '23514';
  end if;

  select plan.* into v_plan from public.video_scene_plans as plan
  where plan.user_id = v_user_id and plan.brand_id = v_project.brand_id
    and plan.project_id = v_project.id for share;
  if not found then raise exception 'Current scene plan is unavailable.' using errcode = '23514'; end if;

  if v_plan.status is distinct from 'ready'
    or v_plan.source_script_id is distinct from v_project.script_id
    or v_plan.source_audio_generation_id is distinct from v_project.audio_generation_id
    or v_plan.source_script_updated_at is distinct from v_script.updated_at
    or v_plan.source_content_sha256 is distinct from encode(extensions.digest(v_script.content, 'sha256'), 'hex')
    or v_plan.source_audio_updated_at is distinct from v_audio.updated_at
    or v_plan.source_audio_sha256 is distinct from v_audio.source_content_sha256 then
    raise exception 'Current scene plan is stale.' using errcode = '23514';
  end if;

  select generation.* into v_generation from public.video_generations as generation
  where generation.user_id = v_user_id and generation.brand_id = v_project.brand_id
    and generation.project_id = v_project.id and generation.id = p_video_generation_id
    and generation.status = 'ready' for share;
  if not found then raise exception 'Ready video was not found.' using errcode = '23503'; end if;

  v_expected_path := concat(v_user_id::text, '/', v_project.brand_id, '/',
    v_project.id, '/', p_video_generation_id::text, '/render.mp4');

  if v_generation.source_script_id is distinct from v_project.script_id
    or v_generation.source_script_updated_at is distinct from v_script.updated_at
    or v_generation.source_content_sha256 is distinct from encode(extensions.digest(v_script.content, 'sha256'), 'hex')
    or v_generation.source_audio_generation_id is distinct from v_project.audio_generation_id
    or v_generation.source_audio_updated_at is distinct from v_audio.updated_at
    or v_generation.source_audio_sha256 is distinct from v_audio.source_content_sha256
    or v_generation.source_scene_plan_id is distinct from v_plan.id
    or v_generation.source_scene_plan_version is distinct from v_plan.version
    or v_generation.source_scene_plan_hash is distinct from v_plan.plan_hash
    or v_generation.storage_bucket is distinct from 'project-videos'
    or v_generation.storage_path is distinct from v_expected_path
    or v_generation.mime_type is distinct from 'video/mp4'
    or v_generation.format is distinct from 'mp4'
    or v_generation.file_size_bytes is null or v_generation.file_size_bytes <= 0
    or v_generation.content_sha256 !~ '^[0-9a-f]{64}$'
    or v_generation.cleanup_pending
    or not exists (
      select 1 from storage.objects as object
      where object.bucket_id = v_generation.storage_bucket
        and object.name = v_generation.storage_path
        and coalesce(object.metadata->>'mimetype', '') = 'video/mp4'
        and coalesce(object.metadata->>'size', '') ~ '^[0-9]+$'
        and (object.metadata->>'size')::bigint = v_generation.file_size_bytes
    )
    or (
      select count(*) from public.video_visual_assets as asset
      where asset.user_id = v_user_id
        and asset.brand_id = v_project.brand_id
        and asset.project_id = v_project.id
        and asset.generation_id = v_generation.id
        and asset.scene_plan_id = v_plan.id
        and asset.status = 'ready'
        and asset.mime_type = 'image/svg+xml'
        and asset.format = 'svg'
        and asset.file_size_bytes > 0
        and asset.content_sha256 ~ '^[0-9a-f]{64}$'
        and asset.source_scene_sha256 ~ '^[0-9a-f]{64}$'
        and asset.cleanup_pending = false
        and exists (
          select 1 from storage.objects as object
          where object.bucket_id = asset.storage_bucket
            and object.name = asset.storage_path
            and coalesce(object.metadata->>'mimetype', '') = 'image/svg+xml'
            and coalesce(object.metadata->>'size', '') ~ '^[0-9]+$'
            and (object.metadata->>'size')::bigint = asset.file_size_bytes
        )
    ) <> v_generation.scene_count then
    raise exception 'Video generation provenance is stale.' using errcode = '23514';
  end if;

  update public.video_projects as project set
    video_generation_id = p_video_generation_id,
    status = case when project.status = 'voice' then 'video' else project.status end
  where project.user_id = v_user_id and project.brand_id = v_project.brand_id
    and project.id = v_project.id returning project.* into v_project;

  return next v_project;
end;
$$;

revoke all on function public.attach_ready_video_generation(text, text, uuid, timestamptz) from public;
revoke all on function public.attach_ready_video_generation(text, text, uuid, timestamptz) from anon;
grant execute on function public.attach_ready_video_generation(text, text, uuid, timestamptz) to authenticated;

create or replace function public.clear_project_video_when_sources_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.script_id is distinct from new.script_id
    or old.audio_generation_id is distinct from new.audio_generation_id then
    new.video_generation_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_project_video_when_sources_change() from public;
revoke all on function public.clear_project_video_when_sources_change() from anon;

create trigger video_projects_clear_video_on_sources_change
before update of script_id, audio_generation_id on public.video_projects
for each row execute function public.clear_project_video_when_sources_change();

create or replace function public.sync_video_script_metadata_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := encode(extensions.digest(new.content, 'sha256'), 'hex');
begin
  if old.content is not distinct from new.content
    and old.updated_at is distinct from new.updated_at then
    update public.video_scene_plans set source_script_updated_at = new.updated_at
    where user_id = new.user_id and brand_id = new.brand_id
      and source_script_id = new.id and source_content_sha256 = v_hash;

    update public.video_generations set source_script_updated_at = new.updated_at
    where user_id = new.user_id and brand_id = new.brand_id
      and source_script_id = new.id and source_content_sha256 = v_hash;
  end if;
  return new;
end;
$$;

create or replace function public.sync_video_audio_metadata_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'ready' and new.status = 'ready'
    and old.source_script_id is not distinct from new.source_script_id
    and old.source_content_sha256 is not distinct from new.source_content_sha256
    and old.updated_at is distinct from new.updated_at then
    update public.video_scene_plans set source_audio_updated_at = new.updated_at
    where user_id = new.user_id and brand_id = new.brand_id
      and project_id = new.project_id and source_audio_generation_id = new.id
      and source_audio_sha256 = new.source_content_sha256;

    update public.video_generations set source_audio_updated_at = new.updated_at
    where user_id = new.user_id and brand_id = new.brand_id
      and project_id = new.project_id and source_audio_generation_id = new.id
      and source_audio_sha256 = new.source_content_sha256;
  end if;
  return new;
end;
$$;

create trigger scripts_sync_video_metadata_provenance
after update of content, updated_at on public.scripts
for each row execute function public.sync_video_script_metadata_provenance();
create trigger audio_generations_sync_video_metadata_provenance
after update of source_script_id, source_content_sha256, status, updated_at on public.audio_generations
for each row execute function public.sync_video_audio_metadata_provenance();

revoke all on function public.sync_video_script_metadata_provenance() from public;
revoke all on function public.sync_video_script_metadata_provenance() from anon;
revoke all on function public.sync_video_audio_metadata_provenance() from public;
revoke all on function public.sync_video_audio_metadata_provenance() from anon;

create or replace function public.clear_project_video_for_plan_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_brand_id text;
  v_project_id text;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_brand_id := old.brand_id;
    v_project_id := old.project_id;
  else
    v_user_id := new.user_id;
    v_brand_id := new.brand_id;
    v_project_id := new.project_id;
  end if;

  update public.video_projects as project set video_generation_id = null
  where project.user_id = v_user_id
    and project.brand_id = v_brand_id
    and project.id = v_project_id
    and project.video_generation_id is not null;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.clear_project_video_for_plan_change() from public;
revoke all on function public.clear_project_video_for_plan_change() from anon;

create trigger video_scene_plans_clear_current_video
after update of version, plan_hash on public.video_scene_plans
for each row when (old.version is distinct from new.version or old.plan_hash is distinct from new.plan_hash)
execute function public.clear_project_video_for_plan_change();
create trigger video_scene_items_clear_current_video
after insert or update or delete on public.video_scene_items
for each row execute function public.clear_project_video_for_plan_change();

create or replace function public.clear_project_video_for_generation_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_brand_id text;
  v_project_id text;
  v_generation_id uuid;
begin
  if tg_table_name = 'video_generations' then
    if old.status = 'ready' and new.status <> 'ready' then
      update public.video_projects set video_generation_id = null
      where user_id = old.user_id and brand_id = old.brand_id
        and id = old.project_id and video_generation_id = old.id;
    end if;
  else
    if tg_op = 'DELETE' then
      v_user_id := old.user_id;
      v_brand_id := old.brand_id;
      v_project_id := old.project_id;
      v_generation_id := old.generation_id;
    else
      v_user_id := new.user_id;
      v_brand_id := new.brand_id;
      v_project_id := new.project_id;
      v_generation_id := new.generation_id;
    end if;

    update public.video_projects set video_generation_id = null
    where user_id = v_user_id
      and brand_id = v_brand_id
      and id = v_project_id
      and video_generation_id = v_generation_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.clear_project_video_for_generation_change() from public;
revoke all on function public.clear_project_video_for_generation_change() from anon;

create trigger video_generations_clear_current_video
after update of status on public.video_generations
for each row execute function public.clear_project_video_for_generation_change();
create trigger video_visual_assets_clear_current_video
after update or delete on public.video_visual_assets
for each row execute function public.clear_project_video_for_generation_change();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-videos', 'project-videos', false, 209715200,
  array['video/mp4', 'image/svg+xml']::text[])
on conflict (id) do update set
  name = excluded.name, public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy project_videos_select_own on storage.objects
for select to authenticated using (
  bucket_id = 'project-videos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    exists (
      select 1 from public.video_generations as generation
      where generation.user_id = (select auth.uid())
        and generation.brand_id = (storage.foldername(name))[2]
        and generation.project_id = (storage.foldername(name))[3]
        and generation.id::text = (storage.foldername(name))[4]
        and generation.storage_bucket = bucket_id and generation.storage_path = name
    )
    or exists (
      select 1 from public.video_visual_assets as asset
      where asset.user_id = (select auth.uid())
        and asset.storage_bucket = bucket_id and asset.storage_path = name
    )
  )
);

create policy project_videos_insert_own on storage.objects
for insert to authenticated with check (
  bucket_id = 'project-videos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    exists (
      select 1 from public.video_generations as generation
      where generation.user_id = (select auth.uid())
        and generation.brand_id = (storage.foldername(name))[2]
        and generation.project_id = (storage.foldername(name))[3]
        and generation.id::text = (storage.foldername(name))[4]
        and generation.storage_bucket = bucket_id and generation.storage_path = name
        and generation.status = 'uploading'
    )
    or exists (
      select 1 from public.video_visual_assets as asset
      where asset.user_id = (select auth.uid())
        and asset.storage_bucket = bucket_id and asset.storage_path = name
        and asset.status = 'uploading'
    )
  )
);

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
          and generation.status in (
            'queued', 'planning', 'generating_assets', 'rendering',
            'uploading', 'failed', 'cancelled'
          )
          and not exists (
            select 1 from public.video_projects as project
            where project.user_id = generation.user_id
              and project.brand_id = generation.brand_id
              and project.id = generation.project_id
              and project.video_generation_id = generation.id
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
          and asset.status in ('queued', 'generating', 'uploading', 'failed')
          and generation.status <> 'ready'
          and not exists (
            select 1 from public.video_projects as project
            where project.user_id = generation.user_id
              and project.brand_id = generation.brand_id
              and project.id = generation.project_id
              and project.video_generation_id = generation.id
          )
      )
    );
$$;

revoke all on function public.can_delete_project_video_object(text) from public;
revoke all on function public.can_delete_project_video_object(text) from anon;
grant execute on function public.can_delete_project_video_object(text) to authenticated;

create policy project_videos_delete_own on storage.objects
for delete to authenticated using (
  bucket_id = 'project-videos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.can_delete_project_video_object(name)
);
