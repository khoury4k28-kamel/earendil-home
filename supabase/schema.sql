-- Earendil Home: database structure and access rules.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- It holds no data. Safe to run again: nothing is dropped.

-- ---------------------------------------------------------------- team list
-- Only people whose sign-in email is in this table can read or change anything.
create table if not exists public.members (
  email    text primary key,
  role     text not null default 'member',
  added_at timestamptz not null default now()
);

-- True only when the signed-in ACCOUNT (not just an address in a token) has a
-- verified email that is on the team list.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.members m on lower(m.email) = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and m.role not in ('robot', 'slack')
  );
$$;
-- Members with role 'reader' can see everything and change nothing. The vault's
-- daily export signs in as one, so no all-powerful key is needed anywhere.
create or replace function public.can_write()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.members m on lower(m.email) = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and m.role not in ('reader', 'robot', 'slack')
  );
$$;

-- Role 'robot' is the upload account for the Radar and Documents files. It can
-- write those files and nothing else: it is not a member, so it reads no table.
create or replace function public.is_robot()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.members m on lower(m.email) = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and m.role = 'robot'
  );
$$;
revoke execute on function public.is_robot() from public, anon;
grant execute on function public.is_robot() to authenticated;

revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;
revoke execute on function public.can_write() from public, anon;
grant execute on function public.can_write() to authenticated;

-- ---------------------------------------------------------------- tables
create table if not exists public.settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.people (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  title text, team_id text, reports_to text,
  responsibilities text, focus text,
  email text, location text, note text, source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Where each person last opened the hub from: their device's time zone, and when.
alter table public.people add column if not exists tz text;
alter table public.people add column if not exists seen_at timestamptz;
-- The documents this person has pinned (ids from the Documents tab). Theirs alone.
alter table public.people add column if not exists pinned_docs text[];

create table if not exists public.teams (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  lead_id text, strategy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.goals (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  team_id text, target numeric, "current" numeric, unit text, due date, note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.milestones (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  team_id text, date date, date_label text,
  status text not null default 'upcoming',
  kind text not null default 'company',
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.tasks (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  owner_id text, team_id text, deal_id text, project_id text,
  status text not null default 'todo',
  due date,
  company_wide boolean not null default false,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- A task belongs to a project, or to none (a quick to-do).
alter table public.tasks add column if not exists project_id text;
-- A subtask sits under another task and goes when that task is deleted.
alter table public.tasks add column if not exists parent_id text references public.tasks(id) on delete cascade;

-- Longer pieces of work, each with its own tasks. A project may be about a deal.
create table if not exists public.projects (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  summary text,
  owner_id text,
  people_ids text[] not null default '{}',
  deal_id text,
  status text not null default 'active',
  due date,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.deals (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  organisation text, region text,
  kind text not null default 'customer',
  stage text not null default 'lead',
  size_low numeric, size_high numeric, size_note text,
  owner_id text,
  people_ids text[] not null default '{}',
  contact_ids text[] not null default '{}',
  next_step text, last_touch date, summary text, to_confirm text, source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Documents linked to a deal by hand (the deal page also finds some by name).
alter table public.deals add column if not exists document_ids text[] not null default '{}';

create table if not exists public.contacts (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  kind text not null default 'person',
  organisation text, title text,
  category text not null default 'partner',
  status text not null default 'In contact',
  email text, phone text, country text,
  owner_id text, last_touch date, notes text, source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.activity (
  id text primary key default gen_random_uuid()::text,
  entity_type text not null,
  entity_id text not null,
  body text not null,
  author text,        -- display name at the time of writing
  author_email text,  -- the verified sign-in email: the record of who wrote it
  source text default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Decks, brochures and pictures on the Documents tab. The files themselves are
-- in the private 'documents' storage bucket; file and thumb are paths in it.
create table if not exists public.documents (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  category text not null default 'Other',
  audience text not null default 'internal',
  kind text,
  file text not null,
  thumb text not null,
  w integer, h integer,
  date date, size bigint, pages integer,
  note text, live text, top integer,
  archive boolean not null default false,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- ---------------------------------------------------------------- who changed what, and when
create or replace function public.touch_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.jwt() ->> 'email'), new.updated_by);
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['settings','people','teams','goals','milestones','tasks','projects','deals','contacts','activity','documents'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch_row()', t);
  end loop;
end $$;

-- Notes are signed by the database, not the browser. author_email is the
-- verified sign-in email and is the record of who wrote a note; author is only
-- a display name looked up at the time. Neither can be edited afterwards.
alter table public.activity add column if not exists author_email text;
create or replace function public.stamp_note()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text := (select u.email from auth.users u where u.id = (select auth.uid()));
begin
  if tg_op = 'UPDATE' then
    new.author := old.author;
    new.author_email := old.author_email;
    new.created_at := old.created_at;
  elsif who is not null then
    new.created_at := now();
    new.author_email := who;
    -- A note taken from Slack keeps the name of whoever said it there.
    if exists (select 1 from public.members m where lower(m.email) = lower(who) and m.role = 'slack') then
      new.author := coalesce(nullif(new.author, ''), 'Slack');
    else
      new.author := coalesce((select p.name from public.people p where lower(p.email) = lower(who) limit 1), who);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp on public.activity;
create trigger stamp before insert or update on public.activity
  for each row execute function public.stamp_note();

-- ---------------------------------------------------------------- access rules
-- Nobody who isn't signed in gets anything. Signed-in people get rows only if
-- they are on the team list.
alter table public.members enable row level security;
revoke all on public.members from anon;
grant select on public.members to authenticated;
drop policy if exists "members can see the team list" on public.members;
create policy "members can see the team list" on public.members
  for select to authenticated using ((select public.is_member()));

do $$
declare t text;
begin
  foreach t in array array['settings','people','teams','goals','milestones','tasks','projects','deals','contacts','activity','documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "team reads" on public.%I', t);
    execute format('drop policy if exists "team adds" on public.%I', t);
    execute format('drop policy if exists "team edits" on public.%I', t);
    execute format('drop policy if exists "team deletes" on public.%I', t);
    execute format('create policy "team reads" on public.%I for select to authenticated using ((select public.is_member()))', t);
    execute format('create policy "team adds" on public.%I for insert to authenticated with check ((select public.can_write()))', t);
    execute format('create policy "team edits" on public.%I for update to authenticated using ((select public.can_write())) with check ((select public.can_write()))', t);
    execute format('create policy "team deletes" on public.%I for delete to authenticated using ((select public.can_write()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- live updates
-- Lets every open hub see a teammate's change without reloading.
do $$
declare t text;
begin
  foreach t in array array['settings','people','teams','goals','milestones','tasks','projects','deals','contacts','activity','documents'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- files
-- The news Radar and the Documents tab are files, kept in two private storage
-- buckets. Team members can read both. The upload account fills the Radar;
-- team members add, replace and remove documents from the hub itself.
-- Documents are PDFs and pictures, 50 MB at most.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('radar', 'radar', false, 5242880, array['application/json', 'image/jpeg', 'image/png', 'image/webp']),
       ('documents', 'documents', false, 52428800, array['application/json', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "hub files: team reads" on storage.objects;
drop policy if exists "hub files: robot adds" on storage.objects;
drop policy if exists "hub files: robot replaces" on storage.objects;
drop policy if exists "hub files: robot removes" on storage.objects;
create policy "hub files: team reads" on storage.objects for select to authenticated
  using (bucket_id in ('radar', 'documents') and ((select public.is_member()) or (select public.is_robot())));
create policy "hub files: robot adds" on storage.objects for insert to authenticated
  with check (bucket_id in ('radar', 'documents') and (select public.is_robot()));
create policy "hub files: robot replaces" on storage.objects for update to authenticated
  using (bucket_id in ('radar', 'documents') and (select public.is_robot()))
  with check (bucket_id in ('radar', 'documents') and (select public.is_robot()));
create policy "hub files: robot removes" on storage.objects for delete to authenticated
  using (bucket_id in ('radar', 'documents') and (select public.is_robot()));

-- Team members add and remove document files, in the two folders the hub uses
-- and nowhere else. They never overwrite: a replaced file gets a new name.
drop policy if exists "documents: team adds" on storage.objects;
drop policy if exists "documents: team replaces" on storage.objects;
drop policy if exists "documents: team removes" on storage.objects;
create policy "documents: team adds" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] in ('files', 'thumbs') and (select public.can_write()));
create policy "documents: team removes" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] in ('files', 'thumbs') and (select public.can_write()));

-- Who is online: the hub's presence channel ("online") is private. Only people
-- on the team list may join it, see who else is there and announce themselves.
drop policy if exists "hub online: team sees" on realtime.messages;
drop policy if exists "hub online: team announces" on realtime.messages;
create policy "hub online: team sees" on realtime.messages for select to authenticated
  using ((select public.is_member()) and (select realtime.topic()) = 'online' and extension = 'presence');
create policy "hub online: team announces" on realtime.messages for insert to authenticated
  with check ((select public.is_member()) and (select realtime.topic()) = 'online' and extension = 'presence');

-- ---------------------------------------------------------------- the Log
-- A person's own account of their day, in their own words. Unlike every other
-- table, a log entry can be read by its author and nobody else on the team:
-- people should feel free to write informally. What teammates see are the
-- ideas taken from it, saved as ordinary notes (activity rows, source 'log')
-- on the deal, project, contact or person they are about.
alter table public.activity add column if not exists log_id text;

create table if not exists public.logs (
  id text primary key default gen_random_uuid()::text,
  person_id text,
  author_email text,            -- the verified sign-in email: set by the database, never by the browser
  body text not null,           -- the entry, word for word
  source text not null default 'typed',   -- typed | voice
  device text not null default 'hub',     -- hub | phone
  status text not null default 'new',     -- new | read | applied | failed
  proposal jsonb,               -- what the reader suggested: ideas and updates, waiting for the author's OK
  applied jsonb,                -- what the author applied, so the entry can show what it changed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The signed-in person's verified address.
create or replace function public.my_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;
revoke execute on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated;

create or replace function public.stamp_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text := (select public.my_email());
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.author_email := old.author_email;
    new.created_at := old.created_at;
    new.body := old.body;       -- an entry is kept as it was written
  elsif who is not null then
    new.created_at := now();
    new.author_email := who;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp on public.logs;
create trigger stamp before insert or update on public.logs
  for each row execute function public.stamp_log();

alter table public.logs enable row level security;
revoke all on public.logs from anon;
grant select, insert, update, delete on public.logs to authenticated;
drop policy if exists "log: author reads" on public.logs;
drop policy if exists "log: author adds" on public.logs;
drop policy if exists "log: author edits" on public.logs;
drop policy if exists "log: author deletes" on public.logs;
create policy "log: author reads" on public.logs for select to authenticated
  using ((select public.is_member()) and author_email = (select public.my_email()));
create policy "log: author adds" on public.logs for insert to authenticated
  with check ((select public.can_write()) and author_email = (select public.my_email()));
create policy "log: author edits" on public.logs for update to authenticated
  using ((select public.can_write()) and author_email = (select public.my_email()))
  with check ((select public.can_write()) and author_email = (select public.my_email()));
create policy "log: author deletes" on public.logs for delete to authenticated
  using ((select public.can_write()) and author_email = (select public.my_email()));

-- Live updates, so an entry made on the phone shows on the desktop. The rules
-- above still apply: nobody is sent another person's entries.
do $$
begin
  alter publication supabase_realtime add table public.logs;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------- Slack
-- Messages from the Slack channels the hub's app has been invited to are read
-- by the "slack-events" function. What a message reports becomes a note on the
-- deal, project or contact it is about (an activity row, source 'slack', with
-- a link back to the message), and a contact it reports moves that record's
-- last-contact date forward. Anything that would change a record (a task done
-- or added, a stage moved, a new contact) is only suggested: it waits in
-- slack_suggestions until someone on the team applies or dismisses it.
--
-- The function signs in as its own account, role 'slack' in the team list.
-- That account is not a member: it can read and write no table. All it can do
-- is call the two functions below.
create or replace function public.is_slack()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.members m on lower(m.email) = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and m.role = 'slack'
  );
$$;
revoke execute on function public.is_slack() from public, anon;
grant execute on function public.is_slack() to authenticated;

-- Where a note came from, when it has an address (a Slack message).
alter table public.activity add column if not exists link text;

-- The messages already read, so one that Slack sends twice is read once.
-- The text of a message is never stored.
create table if not exists public.slack_seen (
  key text primary key,
  at timestamptz not null default now()
);
alter table public.slack_seen enable row level security;
revoke all on public.slack_seen from anon, authenticated;

create table if not exists public.slack_suggestions (
  id text primary key default gen_random_uuid()::text,
  type text not null,                       -- complete_task | add_task | move_stage | new_contact
  target_type text not null default 'none', -- deal | project | task | none
  target_id text,
  title text, stage text, name text, organisation text, date date,
  why text,                                 -- a few words on what in the message supports it
  author text,                              -- who said it in Slack
  person_id text,                           -- that person on the team, when the hub knows them
  channel text, link text,
  status text not null default 'open',      -- open | applied | dismissed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
drop trigger if exists touch on public.slack_suggestions;
create trigger touch before insert or update on public.slack_suggestions
  for each row execute function public.touch_row();

-- The team reads, decides and clears suggestions. Only the function adds them.
alter table public.slack_suggestions enable row level security;
revoke all on public.slack_suggestions from anon, authenticated;
grant select, update, delete on public.slack_suggestions to authenticated;
drop policy if exists "slack: team reads" on public.slack_suggestions;
drop policy if exists "slack: team decides" on public.slack_suggestions;
drop policy if exists "slack: team clears" on public.slack_suggestions;
create policy "slack: team reads" on public.slack_suggestions for select to authenticated
  using ((select public.is_member()));
create policy "slack: team decides" on public.slack_suggestions for update to authenticated
  using ((select public.can_write())) with check ((select public.can_write()));
create policy "slack: team clears" on public.slack_suggestions for delete to authenticated
  using ((select public.can_write()));
do $$
begin
  alter publication supabase_realtime add table public.slack_suggestions;
exception when duplicate_object then null;
end $$;

-- Step one for a new message: claim it, and get the names it may be about.
-- Returns null when the message was already claimed.
create or replace function public.slack_open(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not (select public.is_slack()) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.slack_seen where at < now() - interval '30 days';
  insert into public.slack_seen (key) values (left(p_key, 200)) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return null; end if;
  return jsonb_build_object(
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email)), '[]'::jsonb) from public.people p),
    'deals', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'organisation', d.organisation, 'stage', d.stage,
      'owner_id', d.owner_id, 'people_ids', d.people_ids, 'contact_ids', d.contact_ids)), '[]'::jsonb) from public.deals d),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'status', j.status, 'deal_id', j.deal_id)), '[]'::jsonb) from public.projects j),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'deal_id', t.deal_id, 'project_id', t.project_id, 'owner_id', t.owner_id)), '[]'::jsonb)
      from public.tasks t where t.status <> 'done'),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'organisation', c.organisation)), '[]'::jsonb) from public.contacts c)
  );
end;
$$;

-- Step two: save what the message meant. Every id is checked again here, and
-- nothing but notes, contact dates and suggestions can be written.
create or replace function public.slack_save(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_author text := left(coalesce(nullif(p->>'author', ''), 'Slack'), 120);
  v_person text := p->>'person_id';
  v_channel text := left(p->>'channel', 120);
  v_link text := left(p->>'link', 500);
  r jsonb;
  v_type text;
  v_id text;
  v_kind text;
  v_date date;
begin
  if not (select public.is_slack()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_link is not null and v_link !~ '^https://[a-z0-9-]+\.slack\.com/' then v_link := null; end if;
  if v_person is not null and not exists (select 1 from public.people where id = v_person) then v_person := null; end if;

  for r in select value from jsonb_array_elements(coalesce(p->'notes', '[]'::jsonb)) limit 4 loop
    v_type := r->>'about_type'; v_id := r->>'about_id';
    if coalesce(btrim(r->>'text'), '') = '' then continue; end if;
    if not ((v_type = 'deal' and exists (select 1 from public.deals where id = v_id))
         or (v_type = 'project' and exists (select 1 from public.projects where id = v_id))
         or (v_type = 'contact' and exists (select 1 from public.contacts where id = v_id))) then continue; end if;
    insert into public.activity (entity_type, entity_id, body, author, source, link)
      values (v_type, v_id, left(btrim(r->>'text'), 600), v_author, 'slack', v_link);
  end loop;

  -- A contact date only ever moves forward, and never past today (where the author is).
  for r in select value from jsonb_array_elements(coalesce(p->'touches', '[]'::jsonb)) limit 12 loop
    v_type := r->>'target_type'; v_id := r->>'target_id';
    begin
      v_date := least((r->>'date')::date, current_date + 1);   -- +1: the author may be a time zone ahead of this clock
    exception when others then v_date := current_date;
    end;
    v_date := coalesce(v_date, current_date);
    if v_type = 'deal' then
      update public.deals set last_touch = v_date where id = v_id and (last_touch is null or last_touch < v_date);
    elsif v_type = 'contact' then
      update public.contacts set last_touch = v_date where id = v_id and (last_touch is null or last_touch < v_date);
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p->'suggestions', '[]'::jsonb)) limit 6 loop
    v_kind := r->>'type'; v_type := coalesce(r->>'target_type', 'none'); v_id := r->>'target_id';
    if v_kind not in ('complete_task', 'add_task', 'move_stage', 'new_contact') then continue; end if;
    if v_kind = 'complete_task' and not exists (select 1 from public.tasks where id = v_id and status <> 'done') then continue; end if;
    if v_kind = 'move_stage' and (r->>'stage' not in ('lead', 'conversation', 'negotiating', 'signed', 'closed')
      or not exists (select 1 from public.deals where id = v_id and stage <> r->>'stage')) then continue; end if;
    if v_kind = 'add_task' and coalesce(btrim(r->>'title'), '') = '' then continue; end if;
    if v_kind = 'new_contact' and coalesce(btrim(r->>'name'), '') = '' then continue; end if;
    if v_kind = 'complete_task' then v_type := 'task';
    elsif v_kind = 'move_stage' then v_type := 'deal';
    elsif v_kind = 'add_task' and ((v_type = 'deal' and exists (select 1 from public.deals where id = v_id))
                                or (v_type = 'project' and exists (select 1 from public.projects where id = v_id))) then null;
    else v_type := 'none'; v_id := null;
    end if;
    begin
      v_date := (r->>'date')::date;
    exception when others then v_date := null;
    end;
    -- The same suggestion is not asked twice while the first is still waiting.
    if exists (select 1 from public.slack_suggestions s where s.status = 'open' and s.type = v_kind
      and coalesce(s.target_id, '') = coalesce(v_id, '') and coalesce(s.stage, '') = coalesce(r->>'stage', '')
      and lower(coalesce(s.title, '')) = lower(coalesce(btrim(r->>'title'), ''))
      and lower(coalesce(s.name, '')) = lower(coalesce(btrim(r->>'name'), ''))) then continue; end if;
    insert into public.slack_suggestions (type, target_type, target_id, title, stage, name, organisation, date, why, author, person_id, channel, link)
      values (v_kind, v_type, v_id, left(btrim(r->>'title'), 160), r->>'stage', left(btrim(r->>'name'), 120), left(btrim(r->>'organisation'), 120),
        v_date, left(r->>'why', 160), v_author, v_person, v_channel, v_link);
  end loop;
end;
$$;

revoke execute on function public.slack_open(text) from public, anon;
grant execute on function public.slack_open(text) to authenticated;
revoke execute on function public.slack_save(jsonb) from public, anon;
grant execute on function public.slack_save(jsonb) to authenticated;
