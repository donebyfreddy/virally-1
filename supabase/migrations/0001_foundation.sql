-- =============================================================================
-- 0001 — FOUNDATION
--
-- Extensions, the private `app` schema, shared enums, and the timestamp trigger.
--
-- Everything in `app` is deliberately excluded from the exposed API schemas in
-- config.toml. It holds the authorization helpers and the role→permission table:
-- data the client must be able to *benefit* from but never read or modify.
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

create schema if not exists app;

revoke all on schema app from public;
revoke all on schema app from anon, authenticated;
-- `usage` only: it lets RLS policies call the helper functions without granting
-- the ability to enumerate or read anything the schema contains.
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- TIMESTAMPS
--
-- `updated_at` is maintained by trigger, never by the application. A client that
-- sets it itself will eventually forget to, and "when did this last change" is
-- load-bearing for autosave conflict detection and analytics freshness.
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function app.touch_updated_at is
  'BEFORE UPDATE trigger. Sets updated_at to now() regardless of what the client sent.';

-- Attaches the trigger to any table that has an `updated_at` column.
create or replace function app.attach_touch_trigger(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := format('touch_%s', split_part(p_table::text, '.', 2));
begin
  execute format(
    'create trigger %I before update on %s for each row execute function app.touch_updated_at()',
    v_name, p_table
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- SHARED ENUMS
--
-- Enums rather than text+CHECK where the set is genuinely closed and shared
-- across tables: it gives one authoritative list, and adding a value becomes a
-- deliberate migration instead of a typo that silently creates a new status.
-- -----------------------------------------------------------------------------

-- Organisation-level roles. Ordered least→most privileged for readability only;
-- privilege is resolved through app.role_permissions, not enum ordering.
create type app.member_role as enum (
  'viewer',
  'analyst',
  'reviewer',
  'publisher',
  'editor',
  'strategist',
  'admin',
  'owner'
);

-- Discrete capabilities. Deliberately finer-grained than roles so that
-- "who may publish" is separable from "who may create", which is the whole
-- point of an approval workflow.
create type app.permission as enum (
  'content.create',
  'content.approve',
  'content.publish',
  'content.delete',
  'campaign.manage',
  'accounts.connect',
  'accounts.disconnect',
  'analytics.view',
  'billing.view',
  'billing.manage',
  'team.manage',
  'workspace.manage',
  'assets.delete'
);

create type app.platform as enum (
  'instagram',
  'facebook',
  'tiktok',
  'youtube'
);

create type app.aspect_ratio as enum (
  '9:16',
  '4:5',
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  'custom'
);

-- Lifecycle shared by campaigns, content and variants.
create type app.review_status as enum (
  'draft',
  'awaiting_review',
  'approved',
  'rejected',
  'archived'
);

create type app.job_status as enum (
  'pending',
  'queued',
  'running',
  'waiting_external',
  'completed',
  'failed',
  'cancelled',
  'dead_letter'
);

create type app.publish_status as enum (
  'draft',
  'awaiting_review',
  'approved',
  'scheduled',
  'queued',
  'uploading',
  'publishing',
  'published',
  'failed',
  'cancelled'
);

create type app.connection_health as enum (
  'healthy',
  'expired',
  'limited',
  'rate_limited',
  'failing',
  'disconnected'
);

create type app.asset_kind as enum (
  'source_video',
  'generated_video',
  'image',
  'generated_image',
  'audio',
  'voiceover',
  'music',
  'thumbnail',
  'document',
  'brand_asset',
  'export'
);

-- Distinguishes real provider output from mock output. Every surface that
-- displays a generated asset reads this to decide whether to show the "Demo
-- data" label, which is why it lives in the schema and not in application code.
create type app.output_origin as enum (
  'provider',
  'mock',
  'user_upload',
  'seeded_demo'
);

-- -----------------------------------------------------------------------------
-- ROLE → PERMISSION MAP
--
-- A table rather than a CASE expression so the team screen can render the real
-- matrix instead of a hardcoded copy of it that drifts.
-- -----------------------------------------------------------------------------
create table app.role_permissions (
  role app.member_role not null,
  permission app.permission not null,
  primary key (role, permission)
);

insert into app.role_permissions (role, permission)
select r.role, p.permission
from (values
  -- Owner and admin hold everything; the difference is enforced separately —
  -- an admin cannot remove the owner or delete the organisation.
  ('owner'::app.member_role, 'all'),
  ('admin'::app.member_role, 'all')
) as r(role, marker)
cross join (select unnest(enum_range(null::app.permission)) as permission) p
where r.marker = 'all';

insert into app.role_permissions (role, permission) values
  -- Strategist: shapes and runs campaigns end to end, but does not touch
  -- billing, team membership or account connections.
  ('strategist', 'content.create'),
  ('strategist', 'content.approve'),
  ('strategist', 'campaign.manage'),
  ('strategist', 'analytics.view'),

  -- Editor: makes things. Explicitly cannot approve their own work or publish.
  ('editor', 'content.create'),
  ('editor', 'analytics.view'),

  -- Reviewer: approves or rejects, but cannot author or publish. Separating
  -- these three is what makes the approval step meaningful.
  ('reviewer', 'content.approve'),
  ('reviewer', 'analytics.view'),

  -- Publisher: pushes approved content to authorised accounts. Cannot approve.
  ('publisher', 'content.publish'),
  ('publisher', 'analytics.view'),

  ('analyst', 'analytics.view'),
  ('viewer', 'analytics.view');

comment on table app.role_permissions is
  'Authoritative role→permission matrix. Read by app.has_permission() and by the team UI. Never expose over the API.';
