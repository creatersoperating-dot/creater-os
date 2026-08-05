create table public.video_scene_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  brand_id text not null,
  project_id text not null,
  source_script_id text,
  source_audio_generation_id text,
  status text not null default 'ready',
  version integer not null default 1,
  source_script_updated_at timestamptz not null,
  source_content_sha256 text not null,
  source_audio_updated_at timestamptz not null,
  source_audio_sha256 text not null,
  narration_duration_ms bigint not null,
  plan_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint video_scene_plans_pkey primary key (user_id, id),
  constraint video_scene_plans_project_key unique (user_id, brand_id, project_id),
  constraint video_scene_plans_scope_id_key unique (user_id, brand_id, project_id, id),
  constraint video_scene_plans_project_fkey
    foreign key (user_id, brand_id, project_id)
    references public.video_projects(user_id, brand_id, id)
    on delete cascade,
  constraint video_scene_plans_script_fkey
    foreign key (user_id, brand_id, source_script_id)
    references public.scripts(user_id, brand_id, id)
    on delete set null (source_script_id),
  constraint video_scene_plans_audio_fkey
    foreign key (user_id, brand_id, project_id, source_audio_generation_id)
    references public.audio_generations(user_id, brand_id, project_id, id)
    on delete set null (source_audio_generation_id),
  constraint video_scene_plans_status_check check (status in ('ready', 'stale')),
  constraint video_scene_plans_version_check check (version >= 1),
  constraint video_scene_plans_duration_check check (narration_duration_ms > 0),
  constraint video_scene_plans_hashes_check check (
    source_content_sha256 ~ '^[0-9a-f]{64}$'
    and source_audio_sha256 ~ '^[0-9a-f]{64}$'
    and plan_hash ~ '^[0-9a-f]{64}$'
  )
);

create table public.video_scene_items (
  user_id uuid not null,
  id uuid not null,
  plan_id uuid not null,
  brand_id text not null,
  project_id text not null,
  scene_number integer not null,
  title text not null,
  narration_text text not null default '',
  visual_prompt text not null,
  visual_type text not null,
  start_time_ms bigint not null,
  duration_ms bigint not null,
  transition text not null,
  status text not null default 'planned',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint video_scene_items_pkey primary key (user_id, id),
  constraint video_scene_items_scope_id_key unique (user_id, brand_id, project_id, plan_id, id),
  constraint video_scene_items_plan_fkey
    foreign key (user_id, brand_id, project_id, plan_id)
    references public.video_scene_plans(user_id, brand_id, project_id, id)
    on delete cascade,
  constraint video_scene_items_number_check check (scene_number between 1 and 24),
  constraint video_scene_items_title_check check (
    title = trim(title) and char_length(title) between 1 and 200
  ),
  constraint video_scene_items_prompt_check check (
    visual_prompt = trim(visual_prompt)
    and char_length(visual_prompt) between 1 and 2000
  ),
  constraint video_scene_items_visual_type_check check (
    visual_type in ('title', 'image', 'text', 'quote', 'outro')
  ),
  constraint video_scene_items_timing_check check (
    start_time_ms >= 0 and duration_ms between 250 and 120000
  ),
  constraint video_scene_items_transition_check check (
    transition in ('cut', 'fade', 'dissolve')
  ),
  constraint video_scene_items_status_check check (
    status in ('planned', 'asset_ready', 'asset_failed')
  )
);

create table public.video_generations (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  brand_id text not null,
  project_id text not null,
  operation_id uuid not null,
  source_script_id text,
  source_audio_generation_id text,
  source_scene_plan_id uuid not null,
  status text not null default 'queued',
  provider text not null,
  model text not null,
  source_script_updated_at timestamptz not null,
  source_content_sha256 text not null,
  source_audio_updated_at timestamptz not null,
  source_audio_sha256 text not null,
  source_scene_plan_version integer not null,
  source_scene_plan_hash text not null,
  scene_count integer not null,
  duration_ms bigint not null,
  width integer,
  height integer,
  format text,
  mime_type text,
  file_size_bytes bigint,
  content_sha256 text,
  storage_bucket text,
  storage_path text,
  has_audio boolean not null default false,
  failure_code text,
  failure_message text,
  cleanup_pending boolean not null default false,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint video_generations_pkey primary key (user_id, id),
  constraint video_generations_operation_key unique (user_id, project_id, operation_id),
  constraint video_generations_scope_id_key unique (user_id, brand_id, project_id, id),
  constraint video_generations_project_fkey
    foreign key (user_id, brand_id, project_id)
    references public.video_projects(user_id, brand_id, id)
    on delete cascade,
  constraint video_generations_script_fkey
    foreign key (user_id, brand_id, source_script_id)
    references public.scripts(user_id, brand_id, id)
    on delete set null (source_script_id),
  constraint video_generations_audio_fkey
    foreign key (user_id, brand_id, project_id, source_audio_generation_id)
    references public.audio_generations(user_id, brand_id, project_id, id)
    on delete set null (source_audio_generation_id),
  constraint video_generations_plan_fkey
    foreign key (user_id, brand_id, project_id, source_scene_plan_id)
    references public.video_scene_plans(user_id, brand_id, project_id, id),
  constraint video_generations_status_check check (
    status in (
      'queued', 'planning', 'generating_assets', 'rendering',
      'uploading', 'ready', 'failed', 'cancelled'
    )
  ),
  constraint video_generations_provider_check check (
    provider = trim(provider) and char_length(provider) between 1 and 100
  ),
  constraint video_generations_model_check check (
    model = trim(model) and char_length(model) between 1 and 200
  ),
  constraint video_generations_hashes_check check (
    source_content_sha256 ~ '^[0-9a-f]{64}$'
    and source_audio_sha256 ~ '^[0-9a-f]{64}$'
    and source_scene_plan_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint video_generations_source_check check (
    source_scene_plan_version >= 1 and scene_count between 1 and 24
    and duration_ms > 0
  ),
  constraint video_generations_dimensions_check check (
    (width is null and height is null)
    or (width > 0 and height > 0)
  ),
  constraint video_generations_format_check check (
    (format is null and mime_type is null)
    or (format = 'mp4' and mime_type = 'video/mp4')
  ),
  constraint video_generations_storage_check check (
    (storage_bucket is null and storage_path is null)
    or (
      storage_bucket = 'project-videos'
      and storage_path = concat(
        user_id::text, '/', brand_id, '/', project_id, '/', id::text, '/render.mp4'
      )
    )
  ),
  constraint video_generations_nonnegative_check check (
    (file_size_bytes is null or file_size_bytes >= 0)
    and attempt_count >= 0
  ),
  constraint video_generations_ready_check check (
    status <> 'ready'
    or (
      format = 'mp4' and mime_type = 'video/mp4'
      and width is not null and height is not null
      and file_size_bytes is not null and file_size_bytes > 0
      and content_sha256 ~ '^[0-9a-f]{64}$'
      and storage_bucket = 'project-videos'
      and storage_path is not null
      and cleanup_pending = false
    )
  ),
  constraint video_generations_failure_check check (
    status <> 'failed'
    or (
      failure_code is not null and char_length(trim(failure_code)) between 1 and 100
      and failure_code ~ '^[a-z0-9_.:-]+$'
      and failure_message is not null and char_length(trim(failure_message)) between 1 and 1000
      and failure_message !~ '[[:cntrl:]]'
    )
  )
);

create table public.video_generation_attempts (
  user_id uuid not null,
  generation_id uuid not null,
  attempt_number integer not null,
  provider text not null,
  model text not null,
  status text not null default 'rendering',
  scenes_completed integer not null default 0,
  failure_code text,
  failure_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint video_generation_attempts_pkey
    primary key (user_id, generation_id, attempt_number),
  constraint video_generation_attempts_generation_fkey
    foreign key (user_id, generation_id)
    references public.video_generations(user_id, id)
    on delete cascade,
  constraint video_generation_attempts_status_check check (
    status in ('rendering', 'completed', 'failed', 'cancelled')
  ),
  constraint video_generation_attempts_values_check check (
    attempt_number >= 1 and scenes_completed >= 0
  ),
  constraint video_generation_attempts_completion_check check (
    (status = 'rendering' and completed_at is null)
    or (status <> 'rendering' and completed_at is not null)
  ),
  constraint video_generation_attempts_failure_check check (
    status <> 'failed'
    or (
      failure_code is not null and failure_code ~ '^[a-z0-9_.:-]{1,100}$'
      and failure_message is not null and char_length(trim(failure_message)) between 1 and 1000
      and failure_message !~ '[[:cntrl:]]'
    )
  )
);

create table public.video_visual_assets (
  user_id uuid not null,
  id uuid not null,
  generation_id uuid not null,
  scene_plan_id uuid not null,
  scene_id uuid not null,
  brand_id text not null,
  project_id text not null,
  scene_number integer not null,
  source_scene_title text not null,
  source_narration_text text not null,
  source_visual_prompt text not null,
  source_visual_type text not null,
  source_duration_ms bigint not null,
  source_transition text not null,
  source_scene_sha256 text not null,
  status text not null default 'queued',
  provider text not null,
  model text not null,
  format text,
  mime_type text,
  width integer,
  height integer,
  file_size_bytes bigint,
  content_sha256 text,
  storage_bucket text not null default 'project-videos',
  storage_path text not null,
  failure_code text,
  failure_message text,
  cleanup_pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint video_visual_assets_pkey primary key (user_id, id),
  constraint video_visual_assets_generation_scene_key unique (user_id, generation_id, scene_number),
  constraint video_visual_assets_generation_fkey
    foreign key (user_id, brand_id, project_id, generation_id)
    references public.video_generations(user_id, brand_id, project_id, id)
    on delete cascade,
  constraint video_visual_assets_scene_fkey
    foreign key (user_id, brand_id, project_id, scene_plan_id, scene_id)
    references public.video_scene_items(user_id, brand_id, project_id, plan_id, id),
  constraint video_visual_assets_status_check check (
    status in ('queued', 'generating', 'uploading', 'ready', 'failed')
  ),
  constraint video_visual_assets_source_check check (
    char_length(source_scene_title) between 1 and 200
    and char_length(source_narration_text) <= 1000
    and char_length(source_visual_prompt) between 1 and 2000
    and source_visual_type in ('title', 'image', 'text', 'quote', 'outro')
    and source_duration_ms between 250 and 120000
    and source_transition in ('cut', 'fade', 'dissolve')
    and source_scene_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint video_visual_assets_format_check check (
    (format is null and mime_type is null)
    or (format = 'svg' and mime_type = 'image/svg+xml')
  ),
  constraint video_visual_assets_values_check check (
    scene_number between 1 and 24
    and storage_bucket = 'project-videos'
    and storage_path = concat(
      user_id::text, '/', brand_id, '/', project_id, '/',
      generation_id::text, '/scenes/', scene_number::text, '.svg'
    )
  ),
  constraint video_visual_assets_ready_check check (
    status <> 'ready'
    or (
      format = 'svg' and mime_type = 'image/svg+xml'
      and width > 0 and height > 0 and file_size_bytes > 0
      and content_sha256 ~ '^[0-9a-f]{64}$'
      and cleanup_pending = false
    )
  ),
  constraint video_visual_assets_failure_check check (
    status <> 'failed'
    or (
      failure_code is not null and failure_code ~ '^[a-z0-9_.:-]{1,100}$'
      and failure_message is not null and char_length(trim(failure_message)) between 1 and 1000
      and failure_message !~ '[[:cntrl:]]'
    )
  )
);

create unique index video_scene_items_active_plan_number_idx
  on public.video_scene_items (user_id, plan_id, scene_number)
  where is_active;

comment on column public.video_generations.content_sha256 is
  'Server-computed SHA-256. Storage SQL exposes size and MIME metadata but not an independently queryable content hash; finalized-object immutability and server access validation enforce the hash.';
comment on column public.video_visual_assets.content_sha256 is
  'Server-computed SHA-256. Finalized-object immutability prevents replacement after this hash is persisted.';

with ranked_active as (
  select user_id, id,
    row_number() over (
      partition by user_id, brand_id, project_id
      order by created_at desc, id desc
    ) as active_rank
  from public.video_generations
  where status in ('queued', 'planning', 'generating_assets', 'rendering', 'uploading')
)
update public.video_generations as generation set
  status = 'cancelled',
  failure_code = 'superseded_before_constraint',
  failure_message = 'Superseded before the active-generation constraint was enabled.',
  completed_at = now()
from ranked_active
where ranked_active.user_id = generation.user_id
  and ranked_active.id = generation.id
  and ranked_active.active_rank > 1;

create unique index video_generations_one_active_per_project_idx
  on public.video_generations (user_id, brand_id, project_id)
  where status in (
    'queued', 'planning', 'generating_assets', 'rendering', 'uploading'
  );

create index video_generations_history_idx
  on public.video_generations (user_id, brand_id, project_id, created_at desc);
create index video_visual_assets_generation_idx
  on public.video_visual_assets (user_id, generation_id, scene_number);

create trigger video_scene_plans_set_updated_at
before update on public.video_scene_plans
for each row execute function public.set_updated_at();
create trigger video_scene_items_set_updated_at
before update on public.video_scene_items
for each row execute function public.set_updated_at();
create trigger video_generations_set_updated_at
before update on public.video_generations
for each row execute function public.set_updated_at();
create trigger video_generation_attempts_set_updated_at
before update on public.video_generation_attempts
for each row execute function public.set_updated_at();
create trigger video_visual_assets_set_updated_at
before update on public.video_visual_assets
for each row execute function public.set_updated_at();

create or replace function public.protect_finalized_video_generation()
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
      select 1 from public.video_projects as project
      where project.user_id = old.user_id and project.brand_id = old.brand_id
        and project.id = old.project_id
    ) then
      raise exception 'Finalized video generations are immutable.' using errcode = '42501';
    end if;
    return old;
  end if;

  if not exists (
    select 1 from storage.objects as object
    where object.bucket_id = old.storage_bucket and object.name = old.storage_path
  ) and new.status = 'failed' then
    return new;
  end if;

  if row(new.status, new.duration_ms, new.width, new.height, new.format, new.mime_type,
      new.file_size_bytes, new.content_sha256, new.storage_bucket, new.storage_path,
      new.source_script_id, new.source_audio_generation_id, new.source_scene_plan_id,
      new.source_content_sha256, new.source_audio_sha256,
      new.source_scene_plan_version, new.source_scene_plan_hash)
    is distinct from
    row(old.status, old.duration_ms, old.width, old.height, old.format, old.mime_type,
      old.file_size_bytes, old.content_sha256, old.storage_bucket, old.storage_path,
      old.source_script_id, old.source_audio_generation_id, old.source_scene_plan_id,
      old.source_content_sha256, old.source_audio_sha256,
      old.source_scene_plan_version, old.source_scene_plan_hash) then
    raise exception 'Finalized video generations are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

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
      new.source_scene_sha256, new.format,
      new.mime_type, new.width, new.height, new.file_size_bytes, new.content_sha256,
      new.storage_bucket, new.storage_path)
    is distinct from
    row(old.status, old.scene_plan_id, old.scene_id, old.scene_number,
      old.source_scene_title, old.source_narration_text, old.source_visual_prompt,
      old.source_visual_type, old.source_duration_ms, old.source_transition,
      old.source_scene_sha256, old.format,
      old.mime_type, old.width, old.height, old.file_size_bytes, old.content_sha256,
      old.storage_bucket, old.storage_path) then
    raise exception 'Finalized video visual assets are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger video_generations_protect_finalized
before update or delete on public.video_generations
for each row execute function public.protect_finalized_video_generation();
create trigger video_visual_assets_protect_finalized
before update or delete on public.video_visual_assets
for each row execute function public.protect_finalized_video_visual_asset();

revoke all on function public.protect_finalized_video_generation() from public;
revoke all on function public.protect_finalized_video_generation() from anon;
revoke all on function public.protect_finalized_video_visual_asset() from public;
revoke all on function public.protect_finalized_video_visual_asset() from anon;

alter table public.video_scene_plans enable row level security;
alter table public.video_scene_items enable row level security;
alter table public.video_generations enable row level security;
alter table public.video_generation_attempts enable row level security;
alter table public.video_visual_assets enable row level security;

create policy video_scene_plans_own on public.video_scene_plans
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy video_scene_items_own on public.video_scene_items
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy video_generations_own on public.video_generations
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy video_generation_attempts_own on public.video_generation_attempts
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy video_visual_assets_own on public.video_visual_assets
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.video_scene_plans from anon;
revoke all on table public.video_scene_items from anon;
revoke all on table public.video_generations from anon;
revoke all on table public.video_generation_attempts from anon;
revoke all on table public.video_visual_assets from anon;
grant select, insert, update, delete on table public.video_scene_plans to authenticated;
grant select, insert, update, delete on table public.video_scene_items to authenticated;
grant select, insert, update, delete on table public.video_generations to authenticated;
grant select, insert, update, delete on table public.video_generation_attempts to authenticated;
grant select, insert, update, delete on table public.video_visual_assets to authenticated;

create or replace function public.save_video_scene_plan(
  p_brand_id text,
  p_project_id text,
  p_plan_id uuid,
  p_expected_project_updated_at timestamptz,
  p_expected_plan_updated_at timestamptz,
  p_scenes jsonb
)
returns setof public.video_scene_plans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.video_projects%rowtype;
  v_script public.scripts%rowtype;
  v_audio public.audio_generations%rowtype;
  v_existing public.video_scene_plans%rowtype;
  v_plan public.video_scene_plans%rowtype;
  v_scene jsonb;
  v_scene_count integer;
  v_index integer := 0;
  v_expected_start bigint := 0;
  v_duration bigint;
  v_total_duration bigint := 0;
  v_plan_hash text;
  v_normalized_script text;
  v_normalized_excerpt text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if nullif(trim(p_brand_id), '') is null
    or nullif(trim(p_project_id), '') is null
    or p_plan_id is null
    or p_expected_project_updated_at is null then
    raise exception 'Valid scene-plan scope is required.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_scenes) <> 'array' then
    raise exception 'Scenes must be an array.' using errcode = '22023';
  end if;

  v_scene_count := jsonb_array_length(p_scenes);
  if v_scene_count < 1 or v_scene_count > 24 then
    raise exception 'Scene count must be between 1 and 24.' using errcode = '23514';
  end if;

  select project.* into v_project
  from public.video_projects as project
  where project.user_id = v_user_id
    and project.brand_id = trim(p_brand_id)
    and project.id = trim(p_project_id)
  for update;

  if not found then return; end if;
  if v_project.updated_at is distinct from p_expected_project_updated_at then return; end if;
  if v_project.script_id is null or v_project.audio_generation_id is null then
    raise exception 'Current script and narration are required.' using errcode = '23514';
  end if;

  select script.* into v_script
  from public.scripts as script
  where script.user_id = v_user_id
    and script.brand_id = v_project.brand_id
    and script.id = v_project.script_id
  for share;
  if not found then raise exception 'Current script was not found.' using errcode = '23503'; end if;
  v_normalized_script := regexp_replace(trim(v_script.content), '[[:space:]]+', ' ', 'g');

  select audio.* into v_audio
  from public.audio_generations as audio
  where audio.user_id = v_user_id
    and audio.brand_id = v_project.brand_id
    and audio.project_id = v_project.id
    and audio.id = v_project.audio_generation_id
    and audio.status = 'ready'
    and audio.source_script_id = v_project.script_id
    and audio.source_script_updated_at = v_script.updated_at
    and audio.source_content_sha256 = encode(extensions.digest(v_script.content, 'sha256'), 'hex')
  for share;
  if not found then raise exception 'Current narration is stale.' using errcode = '23514'; end if;

  select plan.* into v_existing
  from public.video_scene_plans as plan
  where plan.user_id = v_user_id
    and plan.brand_id = v_project.brand_id
    and plan.project_id = v_project.id
  for update;

  if found then
    if p_expected_plan_updated_at is null
      or v_existing.updated_at is distinct from p_expected_plan_updated_at then
      return;
    end if;
  elsif p_expected_plan_updated_at is not null then
    return;
  end if;

  for v_scene in select value from jsonb_array_elements(p_scenes) loop
    v_index := v_index + 1;
    v_duration := (v_scene->>'durationMs')::bigint;
    v_normalized_excerpt := regexp_replace(trim(coalesce(v_scene->>'narrationText', '')), '[[:space:]]+', ' ', 'g');

    if (v_scene->>'id')::uuid is null
      or (v_scene->>'sceneNumber')::integer <> v_index
      or nullif(trim(v_scene->>'title'), '') is null
      or char_length(trim(v_scene->>'title')) > 200
      or nullif(trim(v_scene->>'visualPrompt'), '') is null
      or char_length(trim(v_scene->>'visualPrompt')) > 2000
      or char_length(v_normalized_excerpt) > 1000
      or (v_normalized_excerpt <> '' and position(v_normalized_excerpt in v_normalized_script) = 0)
      or (v_scene->>'visualType') not in ('title', 'image', 'text', 'quote', 'outro')
      or (v_scene->>'transition') not in ('cut', 'fade', 'dissolve')
      or (v_scene->>'startTimeMs')::bigint <> v_expected_start
      or v_duration < 250 or v_duration > 120000 then
      raise exception 'Scene plan contains invalid scene data.' using errcode = '23514';
    end if;

    if exists (
      select 1 from public.video_scene_items as existing_scene
      where existing_scene.user_id = v_user_id
        and existing_scene.id = (v_scene->>'id')::uuid
        and existing_scene.plan_id <> coalesce(v_existing.id, p_plan_id)
    ) then
      raise exception 'Scene identity belongs to another plan.' using errcode = '23514';
    end if;

    v_expected_start := v_expected_start + v_duration;
    v_total_duration := v_total_duration + v_duration;
  end loop;

  if v_total_duration > 1800000
    or abs(v_total_duration - v_audio.duration_ms) > greatest(ceil(v_audio.duration_ms * 0.2), 250) then
    raise exception 'Scene duration must approximately match narration.' using errcode = '23514';
  end if;

  v_plan_hash := encode(extensions.digest(p_scenes::text, 'sha256'), 'hex');

  if v_existing.id is null then
    insert into public.video_scene_plans (
      user_id, id, brand_id, project_id, source_script_id,
      source_audio_generation_id, status, version,
      source_script_updated_at, source_content_sha256,
      source_audio_updated_at, source_audio_sha256,
      narration_duration_ms, plan_hash
    ) values (
      v_user_id, p_plan_id, v_project.brand_id, v_project.id,
      v_project.script_id, v_project.audio_generation_id, 'ready', 1,
      v_script.updated_at,
      encode(extensions.digest(v_script.content, 'sha256'), 'hex'),
      v_audio.updated_at, v_audio.source_content_sha256,
      v_audio.duration_ms, v_plan_hash
    ) returning * into v_plan;
  else
    update public.video_scene_plans as plan set
      source_script_id = v_project.script_id,
      source_audio_generation_id = v_project.audio_generation_id,
      status = 'ready',
      version = plan.version + 1,
      source_script_updated_at = v_script.updated_at,
      source_content_sha256 = encode(extensions.digest(v_script.content, 'sha256'), 'hex'),
      source_audio_updated_at = v_audio.updated_at,
      source_audio_sha256 = v_audio.source_content_sha256,
      narration_duration_ms = v_audio.duration_ms,
      plan_hash = v_plan_hash
    where plan.user_id = v_user_id and plan.id = v_existing.id
    returning * into v_plan;

  end if;

  update public.video_scene_items set is_active = false
  where user_id = v_user_id and plan_id = v_plan.id and is_active;

  for v_scene in select value from jsonb_array_elements(p_scenes) loop
    insert into public.video_scene_items (
      user_id, id, plan_id, brand_id, project_id, scene_number,
      title, narration_text, visual_prompt, visual_type,
      start_time_ms, duration_ms, transition, status, is_active
    ) values (
      v_user_id, (v_scene->>'id')::uuid, v_plan.id,
      v_project.brand_id, v_project.id,
      (v_scene->>'sceneNumber')::integer,
      trim(v_scene->>'title'), coalesce(v_scene->>'narrationText', ''),
      trim(v_scene->>'visualPrompt'), v_scene->>'visualType',
      (v_scene->>'startTimeMs')::bigint, (v_scene->>'durationMs')::bigint,
      v_scene->>'transition', 'planned', true
    )
    on conflict (user_id, id) do update set
      scene_number = excluded.scene_number,
      title = excluded.title,
      narration_text = excluded.narration_text,
      visual_prompt = excluded.visual_prompt,
      visual_type = excluded.visual_type,
      start_time_ms = excluded.start_time_ms,
      duration_ms = excluded.duration_ms,
      transition = excluded.transition,
      status = 'planned',
      is_active = true
    where video_scene_items.plan_id = excluded.plan_id
      and video_scene_items.brand_id = excluded.brand_id
      and video_scene_items.project_id = excluded.project_id;
  end loop;

  return next v_plan;
end;
$$;

revoke all on function public.save_video_scene_plan(text, text, uuid, timestamptz, timestamptz, jsonb) from public;
revoke all on function public.save_video_scene_plan(text, text, uuid, timestamptz, timestamptz, jsonb) from anon;
grant execute on function public.save_video_scene_plan(text, text, uuid, timestamptz, timestamptz, jsonb) to authenticated;
