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

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where lower(m.email) = lower((select auth.jwt() ->> 'email'))
  );
$$;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

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
  owner_id text, team_id text, deal_id text,
  status text not null default 'todo',
  due date,
  company_wide boolean not null default false,
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
  author text, source text default 'manual',
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
  foreach t in array array['settings','people','teams','goals','milestones','tasks','deals','contacts','activity'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch_row()', t);
  end loop;
end $$;

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
  foreach t in array array['settings','people','teams','goals','milestones','tasks','deals','contacts','activity'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "team reads" on public.%I', t);
    execute format('drop policy if exists "team adds" on public.%I', t);
    execute format('drop policy if exists "team edits" on public.%I', t);
    execute format('drop policy if exists "team deletes" on public.%I', t);
    execute format('create policy "team reads" on public.%I for select to authenticated using ((select public.is_member()))', t);
    execute format('create policy "team adds" on public.%I for insert to authenticated with check ((select public.is_member()))', t);
    execute format('create policy "team edits" on public.%I for update to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t);
    execute format('create policy "team deletes" on public.%I for delete to authenticated using ((select public.is_member()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- live updates
-- Lets every open hub see a teammate's change without reloading.
do $$
declare t text;
begin
  foreach t in array array['settings','people','teams','goals','milestones','tasks','deals','contacts','activity'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
