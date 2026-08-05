-- Restrict video-generation lifecycle tables to RPC-controlled writes.
-- Authenticated users retain read access through RLS.
-- Service-role privileges remain unchanged.

revoke all privileges
on table public.video_generations
from public, anon, authenticated;

revoke all privileges
on table public.video_generation_attempts
from public, anon, authenticated;

grant select
on table public.video_generations
to authenticated;

grant select
on table public.video_generation_attempts
to authenticated;