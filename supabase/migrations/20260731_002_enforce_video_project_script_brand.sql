alter table public.scripts
  add constraint scripts_user_brand_id_key
  unique (user_id, brand_id, id);

update public.video_projects as video_project
set script_id = null
where video_project.script_id is not null
  and not exists (
    select 1
    from public.scripts as script
    where script.user_id = video_project.user_id
      and script.brand_id = video_project.brand_id
      and script.id = video_project.script_id
  );

alter table public.video_projects
  drop constraint video_projects_script_fkey;

alter table public.video_projects
  add constraint video_projects_script_brand_fkey
  foreign key (user_id, brand_id, script_id)
  references public.scripts(user_id, brand_id, id)
  on delete set null (script_id)
  not valid;

alter table public.video_projects
  validate constraint video_projects_script_brand_fkey;
