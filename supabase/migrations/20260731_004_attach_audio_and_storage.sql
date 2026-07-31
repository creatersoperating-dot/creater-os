alter table public.video_projects
  add column audio_generation_id text;

alter table public.video_projects
  add constraint video_projects_audio_generation_fkey
  foreign key (user_id, brand_id, id, audio_generation_id)
  references public.audio_generations(user_id, brand_id, project_id, id)
  on delete set null (audio_generation_id);

create index video_projects_audio_generation_idx
  on public.video_projects (user_id, audio_generation_id)
  where audio_generation_id is not null;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.attach_ready_audio_generation(
  p_brand_id text,
  p_project_id text,
  p_audio_generation_id text,
  p_expected_project_updated_at timestamptz
)
returns setof public.video_projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_brand_id text := nullif(trim(p_brand_id), '');
  v_project_id text := nullif(trim(p_project_id), '');
  v_audio_generation_id text := nullif(trim(p_audio_generation_id), '');
  v_expected_storage_path text;
  v_current_script_hash text;
  v_project public.video_projects%rowtype;
  v_audio_generation public.audio_generations%rowtype;
  v_script public.scripts%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if v_brand_id is null then
    raise exception 'brandId is required.' using errcode = '22023';
  end if;

  if v_project_id is null then
    raise exception 'projectId is required.' using errcode = '22023';
  end if;

  if v_audio_generation_id is null then
    raise exception 'audioGenerationId is required.' using errcode = '22023';
  end if;

  if p_expected_project_updated_at is null then
    raise exception 'expectedProjectUpdatedAt is required.' using errcode = '22023';
  end if;

  -- Lock the authoritative project before evaluating the optimistic guard.
  select project.*
  into v_project
  from public.video_projects as project
  where project.user_id = v_user_id
    and project.brand_id = v_brand_id
    and project.id = v_project_id
  for update;

  if not found then
    return;
  end if;

  -- A stale caller receives no row and can refetch without guessing state.
  if v_project.updated_at is distinct from p_expected_project_updated_at then
    return;
  end if;

  if v_project.script_id is null then
    raise exception 'The project has no attached script.' using errcode = '23514';
  end if;

  -- Hold the script stable while its timestamp and content hash are checked.
  select script.*
  into v_script
  from public.scripts as script
  where script.user_id = v_user_id
    and script.brand_id = v_brand_id
    and script.id = v_project.script_id
  for share;

  if not found then
    raise exception 'The project script no longer exists.' using errcode = '23503';
  end if;

  -- Hold the ready generation stable until the project attachment commits.
  select audio_generation.*
  into v_audio_generation
  from public.audio_generations as audio_generation
  where audio_generation.user_id = v_user_id
    and audio_generation.brand_id = v_brand_id
    and audio_generation.project_id = v_project_id
    and audio_generation.id = v_audio_generation_id
  for share;

  if not found then
    raise exception 'The audio generation was not found.' using errcode = '23503';
  end if;

  v_expected_storage_path := concat(
    v_user_id::text,
    '/',
    v_brand_id,
    '/',
    v_project_id,
    '/',
    v_audio_generation_id,
    '/narration.wav'
  );

  if v_audio_generation.status <> 'ready'
    or v_audio_generation.storage_bucket is distinct from 'project-audio'
    or v_audio_generation.storage_path is distinct from v_expected_storage_path
    or v_audio_generation.mime_type is distinct from 'audio/wav'
    or v_audio_generation.file_size_bytes is null
    or v_audio_generation.file_size_bytes < 0 then
    raise exception 'The audio generation is not ready for attachment.'
      using errcode = '23514';
  end if;

  if v_audio_generation.source_script_id is distinct from v_project.script_id then
    raise exception 'The audio generation does not match the attached script.'
      using errcode = '23514';
  end if;

  if v_audio_generation.source_script_updated_at is distinct from v_script.updated_at then
    raise exception 'The attached script changed after audio generation.'
      using errcode = '23514';
  end if;

  v_current_script_hash := encode(
    extensions.digest(v_script.content, 'sha256'),
    'hex'
  );

  if v_audio_generation.source_content_sha256 is distinct from v_current_script_hash then
    raise exception 'The attached script content does not match the audio generation.'
      using errcode = '23514';
  end if;

  update public.video_projects as project
  set
    audio_generation_id = v_audio_generation_id,
    status = case
      when project.status = 'script' then 'voice'
      else project.status
    end
  where project.user_id = v_user_id
    and project.brand_id = v_brand_id
    and project.id = v_project_id
  returning project.* into v_project;

  return next v_project;
end;
$$;

revoke all on function public.attach_ready_audio_generation(
  text,
  text,
  text,
  timestamptz
) from public;

revoke all on function public.attach_ready_audio_generation(
  text,
  text,
  text,
  timestamptz
) from anon;

grant execute on function public.attach_ready_audio_generation(
  text,
  text,
  text,
  timestamptz
) to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'project-audio',
  'project-audio',
  false,
  104857600,
  array['audio/wav']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Audio objects are immutable. A replacement always receives a new generation
-- ID and therefore a new {user}/{brand}/{project}/{generation} object path.
create policy project_audio_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-audio'
  and array_length(storage.foldername(name), 1) = 4
  and storage.filename(name) = 'narration.wav'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.audio_generations as audio_generation
    where audio_generation.user_id = (select auth.uid())
      and audio_generation.brand_id = (storage.foldername(name))[2]
      and audio_generation.project_id = (storage.foldername(name))[3]
      and audio_generation.id = (storage.foldername(name))[4]
      and audio_generation.storage_bucket = bucket_id
      and audio_generation.storage_path = name
  )
);

create policy project_audio_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-audio'
  and array_length(storage.foldername(name), 1) = 4
  and storage.filename(name) = 'narration.wav'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.audio_generations as audio_generation
    where audio_generation.user_id = (select auth.uid())
      and audio_generation.brand_id = (storage.foldername(name))[2]
      and audio_generation.project_id = (storage.foldername(name))[3]
      and audio_generation.id = (storage.foldername(name))[4]
      and audio_generation.storage_bucket = bucket_id
      and audio_generation.storage_path = name
  )
);

create policy project_audio_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-audio'
  and array_length(storage.foldername(name), 1) = 4
  and storage.filename(name) = 'narration.wav'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.audio_generations as audio_generation
    where audio_generation.user_id = (select auth.uid())
      and audio_generation.brand_id = (storage.foldername(name))[2]
      and audio_generation.project_id = (storage.foldername(name))[3]
      and audio_generation.id = (storage.foldername(name))[4]
      and audio_generation.storage_bucket = bucket_id
      and audio_generation.storage_path = name
  )
);
