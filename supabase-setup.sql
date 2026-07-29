-- Track It — Supabase table setup (v3: single annotator, no team/lead roles)
--
-- IMPORTANT: this project has a LIVE database with real data in it. Do NOT
-- run the "fresh install" block below against it — the `drop table cascade`
-- statements would delete your actual profile (rate, songs, everything).
-- Scroll down to "MIGRATE AN EXISTING DATABASE" instead and run that block
-- in the Supabase SQL Editor. The fresh-install block is kept only as a
-- reference for what a brand-new project's schema should look like.

-- ============================================================
-- FRESH INSTALL ONLY — a brand-new Supabase project with no data yet
-- ============================================================
-- drop table if exists profiles cascade;
-- drop table if exists rosters cascade;
-- drop table if exists invites cascade;
--
-- create table profiles (
--   id       uuid primary key references auth.users(id) on delete cascade,
--   name     text,
--   email    text,
--   blob     text,      -- full app state JSON (rate, goal, php, songs)
--   updated  bigint
-- );
--
-- alter table profiles enable row level security;
-- create policy "select own profile" on profiles for select using (auth.uid() = id);
-- create policy "update own profile" on profiles for update using (auth.uid() = id);
-- create policy "insert own profile" on profiles for insert with check (auth.uid() = id);

-- ============================================================
-- MIGRATE AN EXISTING DATABASE — run this in the SQL Editor
-- ============================================================
-- Drops the now-unused team/lead columns and tables without touching any
-- existing profiles.blob data (your rate, songs, goal, etc. are untouched).

-- drop this policy before the column it depends on
drop policy if exists "lead can read team profiles" on profiles;

alter table profiles drop column if exists role;
alter table profiles drop column if exists lead_id;

-- dropping these tables automatically removes their own policies (e.g.
-- "lead reads own roster"), so nothing further to clean up here
drop table if exists rosters cascade;
drop table if exists invites cascade;
