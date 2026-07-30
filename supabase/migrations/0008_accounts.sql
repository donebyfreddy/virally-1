-- =============================================================================
-- 0008 — CONNECTED ACCOUNTS
--
-- The security-critical file. Two rules shape it:
--
-- 1. OAuth tokens live in a SEPARATE table with NO select policy for
--    authenticated users. Not "a restrictive policy" — none at all. A token for
--    an Instagram professional account is the ability to post as that brand; a
--    read of it through the REST API by a compromised browser session would be
--    an account takeover, not a data leak. Only the service role touches it.
--
-- 2. No password column exists anywhere, and none may be added. Virally connects
--    accounts through official authorisation flows and never asks for social
--    credentials. Enforced by 0014's assertion, so a future migration adding one
--    fails the migration run.
-- =============================================================================

create table public.connected_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,

  platform app.platform not null,
  -- The platform's own identifier. Unique per platform per workspace so
  -- reconnecting the same account updates rather than duplicating it.
  external_id text not null,
  username text,
  display_name text,
  avatar_url text,
  profile_url text,

  -- Instagram distinguishes personal from professional accounts, and only
  -- professional accounts can be published to via the official API. Storing the
  -- type is what lets the UI explain *why* publishing is unavailable.
  account_kind text check (account_kind in ('personal', 'creator', 'business', 'page', 'channel')),

  health app.connection_health not null default 'healthy',
  health_detail text,

  -- Capabilities actually granted by this connection, resolved at connect time
  -- from the scopes the user consented to. Data-driven, never assumed: the same
  -- platform grants different capabilities to different account types.
  granted_capabilities text[] not null default '{}',
  granted_scopes text[] not null default '{}',

  follower_count integer check (follower_count is null or follower_count >= 0),
  last_synced_at timestamptz,
  last_published_at timestamptz,

  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, platform, external_id)
);

select app.attach_touch_trigger('public.connected_accounts');

alter table public.connected_accounts enable row level security;
alter table public.connected_accounts force row level security;

-- Readable by workspace members: the accounts screen needs it, and it holds no
-- secrets — those are in oauth_connections.
create policy connected_accounts_select on public.connected_accounts
  for select to authenticated
  using (app.is_workspace_member(workspace_id));

-- No INSERT policy. Accounts are created only by the OAuth callback running as
-- the service role, because creating one requires storing a token the client must
-- never handle.

-- A user may rename or reassign an account, and may disconnect it, but the
-- identity columns are set by the platform.
create policy connected_accounts_update on public.connected_accounts
  for update to authenticated
  using (app.has_workspace_permission(workspace_id, 'accounts.connect'))
  with check (app.has_workspace_permission(workspace_id, 'accounts.connect'));

create policy connected_accounts_delete on public.connected_accounts
  for delete to authenticated
  using (app.has_workspace_permission(workspace_id, 'accounts.disconnect'));

create index connected_accounts_workspace_idx on public.connected_accounts (workspace_id)
  where disconnected_at is null;
create index connected_accounts_health_idx on public.connected_accounts (workspace_id, health)
  where disconnected_at is null;
create index connected_accounts_brand_idx on public.connected_accounts (brand_id);

-- -----------------------------------------------------------------------------
-- OAUTH CONNECTIONS — SECRETS. NO CLIENT ACCESS.
-- -----------------------------------------------------------------------------
create table public.oauth_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connected_account_id uuid not null unique
    references public.connected_accounts (id) on delete cascade,

  platform app.platform not null,

  -- Encrypted at the application layer before insert, with a key held only in
  -- the server environment (TOKEN_ENCRYPTION_KEY). Column-level encryption on top
  -- of RLS means a database backup leak is not immediately a token leak.
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  -- Identifies which key version encrypted this row, so keys can be rotated
  -- without decrypting everything at once.
  encryption_key_id text not null default 'v1',

  token_type text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  last_refreshed_at timestamptz,
  refresh_failure_count integer not null default 0 check (refresh_failure_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.oauth_connections');

alter table public.oauth_connections enable row level security;
alter table public.oauth_connections force row level security;

-- DELIBERATELY NO POLICIES.
--
-- RLS enabled with zero policies denies every operation to `authenticated` and
-- `anon`. The service role bypasses RLS, so workers and the OAuth callback still
-- work. Do not add a select policy here: there is no legitimate reason for a
-- browser to read a platform access token, and the accounts UI reads
-- `connected_account_token_status` below instead.

revoke all on public.oauth_connections from anon, authenticated;

create index oauth_connections_expiry_idx on public.oauth_connections (expires_at)
  where expires_at is not null;

-- -----------------------------------------------------------------------------
-- TOKEN STATUS VIEW
--
-- The UI needs to show "reconnection required" without reading the token. This
-- exposes expiry state and nothing else — no ciphertext, no scopes-as-secrets,
-- no key id. Owner rights with an explicit membership predicate, same pattern and
-- same caveat as the teammate view in 0004.
-- -----------------------------------------------------------------------------
create view public.connected_account_token_status as
select
  c.id as connected_account_id,
  c.workspace_id,
  c.platform,
  o.expires_at,
  o.last_refreshed_at,
  o.refresh_failure_count,
  (o.refresh_token_encrypted is not null) as can_refresh,
  case
    when o.expires_at is null then 'unknown'
    when o.expires_at <= now() then 'expired'
    when o.expires_at <= now() + interval '7 days' then 'expiring_soon'
    else 'valid'
  end as token_state
from public.connected_accounts c
join public.oauth_connections o on o.connected_account_id = c.id
where app.is_workspace_member(c.workspace_id);

comment on view public.connected_account_token_status is
  'Token expiry state for the accounts UI. Never exposes token material. See 0008.';

grant select on public.connected_account_token_status to authenticated;

-- -----------------------------------------------------------------------------
-- ACCOUNT GROUPS
-- Publishing to "all Spanish accounts" as one action, with the membership shown
-- explicitly before anything is scheduled.
-- -----------------------------------------------------------------------------
create table public.account_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  grouping_kind text check (grouping_kind in
    ('brand', 'language', 'country', 'niche', 'client', 'campaign', 'strategy')),
  description text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

select app.attach_touch_trigger('public.account_groups');
select app.apply_workspace_rls('public.account_groups', 'accounts.connect', 'accounts.disconnect');

create table public.account_group_members (
  id uuid primary key default extensions.gen_random_uuid(),
  account_group_id uuid not null references public.account_groups (id) on delete cascade,
  connected_account_id uuid not null references public.connected_accounts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (account_group_id, connected_account_id)
);

select app.apply_workspace_rls('public.account_group_members', 'accounts.connect', 'accounts.disconnect');

-- -----------------------------------------------------------------------------
-- PLATFORM CAPABILITIES
--
-- Reference data, not tenant data: what each platform permits, per account kind.
-- Readable by every authenticated user, writable by nobody through the API.
--
-- A table rather than a constant in code because these change when a platform
-- changes its API, and the honest UI states ("requires app review", "max 60s")
-- must be updatable without a deploy.
-- -----------------------------------------------------------------------------
create table public.platform_capabilities (
  id uuid primary key default extensions.gen_random_uuid(),
  platform app.platform not null,
  account_kind text not null,
  capability text not null,
  is_supported boolean not null default false,
  requires_app_review boolean not null default false,
  max_duration_seconds integer,
  max_file_size_mb integer,
  supported_ratios app.aspect_ratio[] not null default '{}',
  notes text,
  updated_at timestamptz not null default now(),
  unique (platform, account_kind, capability)
);

select app.attach_touch_trigger('public.platform_capabilities');

alter table public.platform_capabilities enable row level security;

create policy platform_capabilities_read on public.platform_capabilities
  for select to authenticated using (true);

-- No write policies: seeded by migration, updated by migration.

-- -----------------------------------------------------------------------------
-- ACCOUNT LAUNCH KITS
--
-- Generated launch material for an account the user will create *themselves* on
-- the platform. The `manual_checklist` column is the point: this product prepares
-- material, and a human performs the account creation through the platform's own
-- signup. Nothing here automates that, and nothing may be added that does.
-- -----------------------------------------------------------------------------
create table public.account_launch_kits (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,

  target_platform app.platform not null,
  concept text,
  suggested_names text[] not null default '{}',
  suggested_usernames text[] not null default '{}',
  bio text,
  profile_description text,
  profile_image_asset_id uuid references public.media_assets (id) on delete set null,
  cover_image_asset_id uuid references public.media_assets (id) on delete set null,
  brand_voice text,
  audience text,
  content_pillars text[] not null default '{}',
  initial_hooks text[] not null default '{}',
  -- The 30-post plan and the human setup checklist.
  first_posts jsonb not null default '[]'::jsonb,
  manual_checklist jsonb not null default '[]'::jsonb,

  origin app.output_origin not null default 'mock',
  -- Set once the user confirms they created the account themselves and connected
  -- it. Never set by the system on the user's behalf.
  linked_account_id uuid references public.connected_accounts (id) on delete set null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.account_launch_kits');
select app.apply_workspace_rls('public.account_launch_kits', 'content.create', 'content.delete');
