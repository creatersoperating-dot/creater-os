-- Execute the guarded video-attachment RPC with its owner's privileges.
-- Direct authenticated writes to video lifecycle tables remain prohibited.

alter function public.attach_ready_video_generation(
  text,
  text,
  uuid,
  timestamp with time zone
)
security definer;

alter function public.attach_ready_video_generation(
  text,
  text,
  uuid,
  timestamp with time zone
)
set search_path = '';

revoke all
on function public.attach_ready_video_generation(
  text,
  text,
  uuid,
  timestamp with time zone
)
from public, anon, authenticated, service_role;

grant execute
on function public.attach_ready_video_generation(
  text,
  text,
  uuid,
  timestamp with time zone
)
to authenticated, service_role;