create table public.video_projects (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  brand_id text not null,
  script_id text,
  title text not null,
  topic text not null default '',
  status text not null default 'idea',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint video_projects_pkey
    primary key (user_id, id),

  constraint video_projects_brand_fkey
    foreign key (user_id, brand_id)
    references public.brands(user_id, id)
    on delete cascade,

  constraint video_projects_script_fkey
    foreign key (user_id, script_id)
    references public.scripts(user_id, id)
    on delete set null (script_id),

  constraint video_projects_status_check
    check (
      status in (
        'idea',
        'script',
        'voice',
        'video',
        'ready',
        'published'
      )
    ),

  constraint video_projects_title_check
    check (char_length(trim(title)) > 0)
);

create index video_projects_brand_id_idx
  on public.video_projects(user_id, brand_id);

create index video_projects_script_id_idx
  on public.video_projects(user_id, script_id);

create index video_projects_status_idx
  on public.video_projects(user_id, status);

create index video_projects_updated_at_idx
  on public.video_projects(user_id, updated_at desc);

create trigger video_projects_set_updated_at
before update on public.video_projects
for each row
execute function public.set_updated_at();

alter table public.video_projects enable row level security;

create policy video_projects_select_own
on public.video_projects
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy video_projects_insert_own
on public.video_projects
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy video_projects_update_own
on public.video_projects
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy video_projects_delete_own
on public.video_projects
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.video_projects from anon;

grant select, insert, update, delete
on table public.video_projects
to authenticated;