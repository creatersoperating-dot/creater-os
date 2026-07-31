create table public.brands (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  tagline text not null default '',
  description text not null default '',
  logo text,
  website text,

  primary_platform text not null,
  language text not null,
  target_country text not null,
  target_audience text not null,
  age_group text not null default '',
  experience_level text not null default '',

  primary_niche text not null,
  sub_niche text not null default '',
  content_pillars text[] not null default '{}'::text[],
  keywords text[] not null default '{}'::text[],
  competitors text[] not null default '{}'::text[],
  unique_value_proposition text not null default '',

  posting_frequency text not null default '',
  preferred_formats text[] not null default '{}'::text[],
  content_goals text[] not null default '{}'::text[],
  content_style text not null default '',

  tone text not null default '',
  personality text not null default '',
  writing_style text not null default '',
  preferred_words text[] not null default '{}'::text[],
  forbidden_words text[] not null default '{}'::text[],
  emoji_style text not null default '',

  monetization_goal text not null default '',
  revenue_streams text[] not null default '{}'::text[],
  target_subscribers bigint not null default 0,
  target_revenue numeric not null default 0,

  mission text not null default '',
  vision text not null default '',
  core_values text[] not null default '{}'::text[],
  things_to_avoid text[] not null default '{}'::text[],
  brand_rules text[] not null default '{}'::text[],
  important_context text not null default '',

  status text not null default 'Draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint brands_pkey primary key (user_id, id),
  constraint brands_primary_platform_check check (
    primary_platform in (
      'YouTube',
      'Instagram',
      'TikTok',
      'LinkedIn',
      'X',
      'Facebook'
    )
  ),
  constraint brands_status_check check (
    status in ('Draft', 'Active', 'Archived')
  ),
  constraint brands_target_subscribers_check check (
    target_subscribers >= 0
  ),
  constraint brands_target_revenue_check check (
    target_revenue >= 0
  )
);

create table public.scripts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  brand_id text not null,
  title text not null,
  topic text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint scripts_pkey primary key (user_id, id),
  constraint scripts_brand_fkey foreign key (user_id, brand_id)
    references public.brands(user_id, id)
    on delete cascade
);

create index brands_user_updated_idx
  on public.brands (user_id, updated_at desc);

create index scripts_brand_updated_idx
  on public.scripts (user_id, brand_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger brands_set_updated_at
before update on public.brands
for each row
execute function public.set_updated_at();

create trigger scripts_set_updated_at
before update on public.scripts
for each row
execute function public.set_updated_at();

alter table public.brands enable row level security;
alter table public.scripts enable row level security;

create policy "brands_select_own"
on public.brands
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "brands_insert_own"
on public.brands
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "brands_update_own"
on public.brands
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "brands_delete_own"
on public.brands
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "scripts_select_own"
on public.scripts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "scripts_insert_own"
on public.scripts
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "scripts_update_own"
on public.scripts
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "scripts_delete_own"
on public.scripts
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.brands from anon;
revoke all on table public.scripts from anon;

grant select, insert, update, delete
  on table public.brands
  to authenticated;

grant select, insert, update, delete
  on table public.scripts
  to authenticated;
