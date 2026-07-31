alter table public.audio_generations
  add column cleanup_pending boolean not null default false;

alter table public.audio_generations
  add constraint audio_generations_ready_cleanup_check
  check (status <> 'ready' or cleanup_pending = false);

create or replace function public.clear_project_audio_when_script_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.script_id is distinct from new.script_id then
    new.audio_generation_id := null;
  end if;

  return new;
end;
$$;

revoke all on function public.clear_project_audio_when_script_changes()
  from public;
revoke all on function public.clear_project_audio_when_script_changes()
  from anon;
revoke all on function public.clear_project_audio_when_script_changes()
  from authenticated;

create trigger video_projects_clear_audio_on_script_change
before update of script_id on public.video_projects
for each row
execute function public.clear_project_audio_when_script_changes();

create or replace function public.reconcile_project_audio_after_script_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content_hash text := encode(
    extensions.digest(new.content, 'sha256'),
    'hex'
  );
begin
  if old.content is distinct from new.content then
    update public.video_projects as project
    set audio_generation_id = null
    where project.user_id = new.user_id
      and project.brand_id = new.brand_id
      and project.script_id = new.id
      and project.audio_generation_id is not null;

    return new;
  end if;

  -- A title/topic-only edit advances scripts.updated_at without changing the
  -- narration source. Keep a valid current generation aligned with that
  -- metadata timestamp so the existing guarded attachment invariant remains
  -- usable without detaching matching audio.
  update public.audio_generations as audio_generation
  set source_script_updated_at = new.updated_at
  from public.video_projects as project
  where project.user_id = new.user_id
    and project.brand_id = new.brand_id
    and project.script_id = new.id
    and project.audio_generation_id is not null
    and audio_generation.user_id = project.user_id
    and audio_generation.brand_id = project.brand_id
    and audio_generation.project_id = project.id
    and audio_generation.id = project.audio_generation_id
    and audio_generation.source_script_id = new.id
    and audio_generation.source_content_sha256 = v_content_hash
    and audio_generation.status = 'ready'
    and audio_generation.cleanup_pending = false;

  -- Metadata edits do not cause invalidation by themselves, but they are an
  -- opportunity to detach any pointer that was already invalid for another
  -- reason.
  update public.video_projects as project
  set audio_generation_id = null
  where project.user_id = new.user_id
    and project.brand_id = new.brand_id
    and project.script_id = new.id
    and project.audio_generation_id is not null
    and not exists (
      select 1
      from public.audio_generations as audio_generation
      where audio_generation.user_id = project.user_id
        and audio_generation.brand_id = project.brand_id
        and audio_generation.project_id = project.id
        and audio_generation.id = project.audio_generation_id
        and audio_generation.source_script_id = new.id
        and audio_generation.source_script_updated_at = new.updated_at
        and audio_generation.source_content_sha256 = v_content_hash
        and audio_generation.status = 'ready'
        and audio_generation.cleanup_pending = false
    );

  return new;
end;
$$;

revoke all on function public.reconcile_project_audio_after_script_update()
  from public;
revoke all on function public.reconcile_project_audio_after_script_update()
  from anon;
revoke all on function public.reconcile_project_audio_after_script_update()
  from authenticated;

create trigger scripts_reconcile_current_project_audio
after update of content, updated_at on public.scripts
for each row
when (
  old.content is distinct from new.content
  or old.updated_at is distinct from new.updated_at
)
execute function public.reconcile_project_audio_after_script_update();

-- Preserve valid current narration across historical metadata-only script
-- edits by aligning the snapshot timestamp when the exact content hash still
-- matches. Content mismatches are never reconciled this way.
update public.audio_generations as audio_generation
set source_script_updated_at = script.updated_at
from public.video_projects as project,
  public.scripts as script
where project.audio_generation_id is not null
  and script.user_id = project.user_id
  and script.brand_id = project.brand_id
  and script.id = project.script_id
  and audio_generation.user_id = project.user_id
  and audio_generation.brand_id = project.brand_id
  and audio_generation.project_id = project.id
  and audio_generation.id = project.audio_generation_id
  and audio_generation.source_script_id = script.id
  and audio_generation.source_content_sha256 = encode(
    extensions.digest(script.content, 'sha256'),
    'hex'
  )
  and audio_generation.status = 'ready'
  and audio_generation.cleanup_pending = false
  and audio_generation.source_script_updated_at is distinct from script.updated_at;

-- Detach every existing pointer that cannot prove it is ready narration for
-- the project's current owned script and exact current content.
update public.video_projects as project
set audio_generation_id = null
where project.audio_generation_id is not null
  and not exists (
    select 1
    from public.audio_generations as audio_generation
    join public.scripts as script
      on script.user_id = project.user_id
      and script.brand_id = project.brand_id
      and script.id = project.script_id
    where audio_generation.user_id = project.user_id
      and audio_generation.brand_id = project.brand_id
      and audio_generation.project_id = project.id
      and audio_generation.id = project.audio_generation_id
      and audio_generation.source_script_id = project.script_id
      and audio_generation.source_script_updated_at = script.updated_at
      and audio_generation.source_content_sha256 = encode(
        extensions.digest(script.content, 'sha256'),
        'hex'
      )
      and audio_generation.status = 'ready'
      and audio_generation.cleanup_pending = false
      and audio_generation.storage_bucket = 'project-audio'
      and audio_generation.storage_path = concat(
        project.user_id::text,
        '/',
        project.brand_id,
        '/',
        project.id,
        '/',
        audio_generation.id,
        '/narration.wav'
      )
      and audio_generation.mime_type = 'audio/wav'
      and audio_generation.file_size_bytes is not null
  );

-- Reconcile legacy concurrent active rows before installing the invariant.
-- Prefer the operation furthest through the lifecycle, then the oldest stable
-- operation, as the one authoritative active generation.
with ranked_active_generations as (
  select
    audio_generation.user_id,
    audio_generation.id,
    audio_generation.attempt_count,
    row_number() over (
      partition by
        audio_generation.user_id,
        audio_generation.brand_id,
        audio_generation.project_id
      order by
        case audio_generation.status
          when 'uploading' then 0
          when 'generating' then 1
          else 2
        end,
        audio_generation.created_at,
        audio_generation.id
    ) as active_rank
  from public.audio_generations as audio_generation
  where audio_generation.status in ('queued', 'generating', 'uploading')
), duplicate_active_generations as (
  select user_id, id, attempt_count
  from ranked_active_generations
  where active_rank > 1
)
update public.audio_generation_attempts as attempt
set
  status = 'failed',
  failure_code = 'superseded_active_generation',
  failure_message = 'Narration generation was superseded during active-operation reconciliation.',
  completed_at = coalesce(attempt.completed_at, now())
from duplicate_active_generations as duplicate
where attempt.user_id = duplicate.user_id
  and attempt.generation_id = duplicate.id
  and attempt.attempt_number = duplicate.attempt_count
  and attempt.status in ('generating', 'completed');

with ranked_active_generations as (
  select
    audio_generation.user_id,
    audio_generation.id,
    row_number() over (
      partition by
        audio_generation.user_id,
        audio_generation.brand_id,
        audio_generation.project_id
      order by
        case audio_generation.status
          when 'uploading' then 0
          when 'generating' then 1
          else 2
        end,
        audio_generation.created_at,
        audio_generation.id
    ) as active_rank
  from public.audio_generations as audio_generation
  where audio_generation.status in ('queued', 'generating', 'uploading')
), duplicate_active_generations as (
  select user_id, id
  from ranked_active_generations
  where active_rank > 1
)
update public.audio_generations as audio_generation
set
  status = 'failed',
  failure_code = 'superseded_active_generation',
  failure_message = 'Narration generation was superseded during active-operation reconciliation.',
  completed_at = now()
from duplicate_active_generations as duplicate
where audio_generation.user_id = duplicate.user_id
  and audio_generation.id = duplicate.id;

create unique index audio_generations_one_active_per_project_idx
  on public.audio_generations (user_id, brand_id, project_id)
  where status in ('queued', 'generating', 'uploading');
