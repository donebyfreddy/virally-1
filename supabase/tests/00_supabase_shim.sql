-- =============================================================================
-- SUPABASE COMPATIBILITY SHIM — TEST HARNESS ONLY
--
-- Recreates the parts of a Supabase database that the migrations depend on, so
-- the real migration files can be applied unmodified to a plain PostgreSQL
-- instance. This is how the schema and its RLS policies are verified without
-- Docker or a cloud project.
--
-- THIS FILE IS NEVER APPLIED TO A REAL PROJECT. It lives in supabase/tests/,
-- not supabase/migrations/, so `supabase db push` does not pick it up. On a real
-- project every object below already exists and is provided by Supabase.
--
-- What is faithful, and what is not:
--   - `auth.uid()` reads a session GUC, exactly as Supabase's does. Switching
--     users in a test is therefore a `set local` — the same mechanism the real
--     platform uses, which is what makes the RLS results meaningful.
--   - `authenticated`, `anon` and `service_role` are real roles with the same
--     grants and the same BYPASSRLS on service_role.
--   - `storage.foldername()` mirrors the real implementation's semantics.
--   - Not faithful: no PostgREST, no GoTrue. These tests exercise the database's
--     authorisation, not the API layer above it.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

-- -----------------------------------------------------------------------------
-- ROLES
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS is the whole point of the service role, and several tests assert
    -- that a client cannot do what it can.
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants table privileges to these roles by default; RLS is what
-- actually restricts them.
--
-- `anon` is included deliberately. Without the grant, an anonymous query fails
-- with "permission denied for table" — which looks like a pass but proves nothing
-- about the policies. Granting it means the anonymous tests fail closed because no
-- policy matches `anon`, which is the property actually worth asserting.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, anon, service_role;

-- -----------------------------------------------------------------------------
-- auth SCHEMA
-- -----------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase: reads the JWT claim from a session GUC. `set local
-- request.jwt.claim.sub = '<uuid>'` inside a transaction is exactly how a test
-- becomes "this user".
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
$$;

grant usage on schema auth to authenticated, service_role, anon;
grant select on auth.users to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- storage SCHEMA
-- -----------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Splits an object key into path segments. Supabase's version discards the final
-- element (the filename), so `a/b/file.mp4` yields {a,b} — the policies index
-- [1] for the workspace id, so this behaviour must match or every storage policy
-- would be tested against the wrong segment.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  if name is null then
    return '{}'::text[];
  end if;
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

grant usage on schema storage to authenticated, service_role, anon;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
