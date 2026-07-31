alter table public.video_projects
  add constraint video_projects_user_brand_id_key
  unique (user_id, brand_id, id);

create table public.audio_generations (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  brand_id text not null,
  project_id text not null,
  source_script_id text,
  operation_id uuid not null,
  status text not null default 'queued',
  provider text not null,
  model text not null,
  voice_id text not null,
  voice_label text not null,
  source_script_updated_at timestamptz not null,
  source_content_sha256 text not null,
  input_characters integer not null,
  segment_count integer not null default 0,
  storage_bucket text,
  storage_path text,
  mime_type text,
  file_size_bytes bigint,
  duration_ms bigint,
  provider_job_id text,
  provider_request_id text,
  failure_code text,
  failure_message text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint audio_generations_pkey
    primary key (user_id, id),

  constraint audio_generations_project_operation_key
    unique (user_id, project_id, operation_id),

  constraint audio_generations_user_brand_project_id_key
    unique (user_id, brand_id, project_id, id),

  constraint audio_generations_project_fkey
    foreign key (user_id, brand_id, project_id)
    references public.video_projects(user_id, brand_id, id)
    on delete cascade,

  -- The script identifier may become null only when its source script is
  -- deleted. The remaining source timestamp and hash preserve provenance.
  constraint audio_generations_source_script_fkey
    foreign key (user_id, brand_id, source_script_id)
    references public.scripts(user_id, brand_id, id)
    on delete set null (source_script_id),

  constraint audio_generations_status_check
    check (
      status in (
        'queued',
        'generating',
        'uploading',
        'ready',
        'failed',
        'cancelled'
      )
    ),

  constraint audio_generations_ids_check
    check (
      char_length(trim(id)) > 0
      and char_length(trim(brand_id)) > 0
      and char_length(trim(project_id)) > 0
      and (source_script_id is null or char_length(trim(source_script_id)) > 0)
    ),

  constraint audio_generations_provider_check
    check (provider = trim(provider) and char_length(provider) > 0),

  constraint audio_generations_model_check
    check (model = trim(model) and char_length(model) > 0),

  constraint audio_generations_voice_id_check
    check (voice_id = trim(voice_id) and char_length(voice_id) > 0),

  constraint audio_generations_voice_label_check
    check (voice_label = trim(voice_label) and char_length(voice_label) > 0),

  constraint audio_generations_source_hash_check
    check (source_content_sha256 ~ '^[0-9a-f]{64}$'),

  constraint audio_generations_nonnegative_values_check
    check (
      input_characters >= 0
      and segment_count >= 0
      and (file_size_bytes is null or file_size_bytes >= 0)
      and (duration_ms is null or duration_ms >= 0)
      and attempt_count >= 0
    ),

  constraint audio_generations_storage_bucket_check
    check (storage_bucket is null or storage_bucket = 'project-audio'),

  constraint audio_generations_storage_path_check
    check (
      storage_path is null
      or storage_path = concat(
        user_id::text,
        '/',
        brand_id,
        '/',
        project_id,
        '/',
        id,
        '/narration.wav'
      )
    ),

  constraint audio_generations_mime_type_check
    check (mime_type is null or mime_type = 'audio/wav'),

  constraint audio_generations_ready_metadata_check
    check (
      status <> 'ready'
      or (
        storage_bucket is not null
        and storage_bucket = 'project-audio'
        and storage_path is not null
        and char_length(trim(storage_path)) > 0
        and mime_type is not null
        and mime_type = 'audio/wav'
        and file_size_bytes is not null
      )
    ),

  constraint audio_generations_failure_details_check
    check (
      (
        failure_code is null
        or (
          failure_code = trim(failure_code)
          and char_length(failure_code) between 1 and 100
          and failure_code ~ '^[a-z0-9][a-z0-9_.:-]*$'
        )
      )
      and (
        failure_message is null
        or (
          failure_message = trim(failure_message)
          and char_length(failure_message) between 1 and 1000
          and failure_message !~ '[[:cntrl:]]'
        )
      )
      and (
        status <> 'failed'
        or (failure_code is not null and failure_message is not null)
      )
  )
);

create or replace function public.guard_audio_generation_source_script()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.source_script_id is null then
      raise exception 'source_script_id is required when creating audio.'
        using errcode = '23502';
    end if;

    return new;
  end if;

  if old.source_script_id is distinct from new.source_script_id then
    -- The source is immutable. The only permitted change is the FK-driven
    -- nulling that occurs after the referenced script has been deleted.
    if new.source_script_id is null
      and old.source_script_id is not null
      and not exists (
        select 1
        from public.scripts as script
        where script.user_id = old.user_id
          and script.brand_id = old.brand_id
          and script.id = old.source_script_id
      ) then
      return new;
    end if;

    raise exception 'The audio source script cannot be changed.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_audio_generation_source_script()
  from public;

revoke all on function public.guard_audio_generation_source_script()
  from anon;

create trigger audio_generations_source_script_guard
before insert or update of source_script_id on public.audio_generations
for each row
execute function public.guard_audio_generation_source_script();

create index audio_generations_project_history_idx
  on public.audio_generations (
    user_id,
    brand_id,
    project_id,
    created_at desc
  );

create index audio_generations_status_idx
  on public.audio_generations (user_id, status, updated_at desc);

create index audio_generations_source_script_idx
  on public.audio_generations (user_id, brand_id, source_script_id)
  where source_script_id is not null;

create index audio_generations_ready_project_idx
  on public.audio_generations (
    user_id,
    brand_id,
    project_id,
    completed_at desc
  )
  where status = 'ready';

create trigger audio_generations_set_updated_at
before update on public.audio_generations
for each row
execute function public.set_updated_at();

create table public.audio_generation_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id text not null,
  attempt_number integer not null,
  provider text not null,
  model text not null,
  voice_id text not null,
  status text not null default 'generating',
  provider_job_id text,
  provider_request_ids jsonb not null default '[]'::jsonb,
  segments_completed integer not null default 0,
  failure_code text,
  failure_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint audio_generation_attempts_pkey
    primary key (user_id, generation_id, attempt_number),

  constraint audio_generation_attempts_generation_fkey
    foreign key (user_id, generation_id)
    references public.audio_generations(user_id, id)
    on delete cascade,

  constraint audio_generation_attempts_status_check
    check (status in ('generating', 'completed', 'failed', 'cancelled')),

  constraint audio_generation_attempts_attempt_number_check
    check (attempt_number >= 0),

  constraint audio_generation_attempts_provider_check
    check (provider = trim(provider) and char_length(provider) > 0),

  constraint audio_generation_attempts_model_check
    check (model = trim(model) and char_length(model) > 0),

  constraint audio_generation_attempts_voice_id_check
    check (voice_id = trim(voice_id) and char_length(voice_id) > 0),

  constraint audio_generation_attempts_provider_request_ids_check
    check (jsonb_typeof(provider_request_ids) = 'array'),

  constraint audio_generation_attempts_segments_completed_check
    check (segments_completed >= 0),

  constraint audio_generation_attempts_completion_check
    check (
      (status = 'generating' and completed_at is null)
      or (status <> 'generating' and completed_at is not null)
    ),

  constraint audio_generation_attempts_failure_details_check
    check (
      (
        failure_code is null
        or (
          failure_code = trim(failure_code)
          and char_length(failure_code) between 1 and 100
          and failure_code ~ '^[a-z0-9][a-z0-9_.:-]*$'
        )
      )
      and (
        failure_message is null
        or (
          failure_message = trim(failure_message)
          and char_length(failure_message) between 1 and 1000
          and failure_message !~ '[[:cntrl:]]'
        )
      )
      and (
        status <> 'failed'
        or (failure_code is not null and failure_message is not null)
      )
    )
);

create index audio_generation_attempts_history_idx
  on public.audio_generation_attempts (
    user_id,
    generation_id,
    created_at desc
  );

create trigger audio_generation_attempts_set_updated_at
before update on public.audio_generation_attempts
for each row
execute function public.set_updated_at();

alter table public.audio_generations enable row level security;
alter table public.audio_generation_attempts enable row level security;

create policy audio_generations_select_own
on public.audio_generations
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy audio_generations_insert_own
on public.audio_generations
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy audio_generations_update_own
on public.audio_generations
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy audio_generations_delete_own
on public.audio_generations
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy audio_generation_attempts_select_own
on public.audio_generation_attempts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy audio_generation_attempts_insert_own
on public.audio_generation_attempts
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy audio_generation_attempts_update_own
on public.audio_generation_attempts
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy audio_generation_attempts_delete_own
on public.audio_generation_attempts
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.audio_generations from anon;
revoke all on table public.audio_generation_attempts from anon;

grant select, insert, update, delete
  on table public.audio_generations
  to authenticated;

grant select, insert, update, delete
  on table public.audio_generation_attempts
  to authenticated;
