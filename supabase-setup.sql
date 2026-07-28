-- Track It — Supabase table setup (v2: real accounts via Supabase Auth)
-- Paste this whole block into Supabase → SQL Editor → Run.
--
-- This replaces the old name+team-code+PIN schema entirely (clean cutover,
-- no data migration). If the old `profiles`/`rosters` tables exist, they
-- have an incompatible `id text` primary key — drop them first.

drop table if exists profiles cascade;
drop table if exists rosters cascade;
drop table if exists invites cascade;

-- One row per Supabase Auth user. Leads have lead_id = null; team members
-- have lead_id pointing at the lead who invited them.
create table profiles (
  id       uuid primary key references auth.users(id) on delete cascade,
  role     text not null default 'member' check (role in ('lead','member')),
  name     text,
  email    text,                                    -- denormalized at signup/invite time
  lead_id  uuid references auth.users(id) on delete set null,
  blob     text,                                     -- full app state JSON (rate, songs, etc.)
  updated  bigint
);
create index on profiles(lead_id);

-- Team roster: a lead's aggregated per-member daily counts.
create table rosters (
  lead_id  uuid primary key references auth.users(id) on delete cascade,
  reports  jsonb,
  updated  bigint
);

-- Audit/display log of invites sent — not consulted for correctness
-- (lead_id is attached to the invitee's profile row at invite time), just
-- useful for a future "pending invites" list in the UI.
create table invites (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  lead_id    uuid not null references auth.users(id) on delete cascade,
  created_at bigint,
  accepted   boolean default false
);

alter table profiles enable row level security;
alter table rosters  enable row level security;
alter table invites  enable row level security; -- only the server (service_role) touches this table;
                                                  -- RLS stays on as defense-in-depth regardless

create policy "select own profile"          on profiles for select using (auth.uid() = id);
create policy "update own profile"          on profiles for update using (auth.uid() = id);
create policy "insert own profile"          on profiles for insert with check (auth.uid() = id);
create policy "lead can read team profiles" on profiles for select using (auth.uid() = lead_id);
create policy "lead reads own roster"       on rosters for select using (auth.uid() = lead_id);
