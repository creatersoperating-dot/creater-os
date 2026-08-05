-- Replace the shared stabilization trigger function with table-specific
-- functions. PostgreSQL trigger records only expose columns belonging to
-- their triggering table.

drop trigger if exists video_generations_protect_stabilization_fields
on public.video_generations;

drop trigger if exists video_visual_assets_protect_stabilization_fields
on public.video_visual_assets;

drop function if exists public.protect_video_stabilization_fields();

create or replace function public.protect_video_generation_stabilization_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'ready'
    and row(new.heartbeat_at, new.lease_expires_at)
      is distinct from row(old.heartbeat_at, old.lease_expires_at) then
    raise exception 'Finalized video generations are immutable.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.protect_video_visual_asset_stabilization_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'ready'
    and new.source_scene_plan_version
      is distinct from old.source_scene_plan_version then
    raise exception 'Finalized video visual assets are immutable.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger video_generations_protect_stabilization_fields
before update of heartbeat_at, lease_expires_at
on public.video_generations
for each row
execute function public.protect_video_generation_stabilization_fields();

create trigger video_visual_assets_protect_stabilization_fields
before update of source_scene_plan_version
on public.video_visual_assets
for each row
execute function public.protect_video_visual_asset_stabilization_fields();

revoke all
on function public.protect_video_generation_stabilization_fields()
from public, anon, authenticated;

revoke all
on function public.protect_video_visual_asset_stabilization_fields()
from public, anon, authenticated;