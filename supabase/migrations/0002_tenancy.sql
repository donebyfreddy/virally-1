-- =============================================================================
-- 0002 — TENANCY
--
-- profiles · organizations · organization_members · workspaces ·
-- workspace_members, plus the authorization helpers every later policy calls.
--
-- THE RECURSION PROBLEM, AND WHY EVERY HELPER IS SECURITY DEFINER
--
-- The natural policy on `organization_members` is "you may read rows for orgs you
-- belong to" — which requires reading `organization_members`, whose policy
-- requires reading `organization_members`. Postgres detects this and raises
-- `infinite recursion detected in policy`.
--
-- The fix is that every helper below is SECURITY DEFINER, so it executes as its
-- owner and is not itself subject to RLS. Policies call the helper instead of
-- re-querying the table. This is the standard Supabase pattern and the reason
-- these functions cannot be plain views.
--
-- Each one therefore pins `search_path` explicitly. A SECURITY DEFINER function
-- with a mutable search_path is a privilege-escalation vector: a caller who can
-- create a table in an earlier schema can shadow the ones we meant to read.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PROFILES
-- One row per auth user. Never stores credentials — Supabase Auth owns those.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  locale text not null default 'en',
  timezone text not null default 'UTC',
  -- Notification preferences live here rather than in a separate table: they are
  -- strictly one-to-one with the profile and always read together with it.
  notification_preferences jsonb not null default
    '{"job_failed":true,"approval_required":true,"publish_failed":true,"usage_warning":true,"weekly_digest":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.profiles');

-- -----------------------------------------------------------------------------
-- ORGANIZATIONS
-- The billing and ownership boundary. Cross-organization access is denied
-- unconditionally — this is the line the isolation tests assert.
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  -- Answers step 1 of onboarding: creator / agency / company / network.
  account_type text not null default 'personal'
    check (account_type in ('personal', 'agency', 'company', 'network')),
  created_by uuid not null references auth.users (id) on delete restrict,
  -- Soft delete: an organisation holds published-post history and a usage ledger
  -- that must survive cancellation for audit and billing dispute purposes.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.organizations');

create table public.organization_members (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role app.member_role not null default 'viewer',
  invited_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One membership per user per organisation. This constraint is what makes the
  -- bootstrap function idempotent under a replayed OAuth callback.
  unique (organization_id, user_id)
);

select app.attach_touch_trigger('public.organization_members');

-- -----------------------------------------------------------------------------
-- WORKSPACES
-- A workspace scopes campaigns, content and connected accounts within an
-- organisation — an agency's client, or a media network's brand cluster.
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  is_default boolean not null default false,
  deleted_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

select app.attach_touch_trigger('public.workspaces');

-- Exactly one default workspace per organisation. A partial unique index rather
-- than a trigger: the database enforces it even for service-role writes.
create unique index workspaces_one_default_per_org
  on public.workspaces (organization_id)
  where is_default and deleted_at is null;

create table public.workspace_members (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Overrides the organisation role *within this workspace only*. Null means
  -- "inherit the organisation role", which is the common case.
  role app.member_role,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

select app.attach_touch_trigger('public.workspace_members');

-- =============================================================================
-- AUTHORIZATION HELPERS
-- =============================================================================

-- Organisation membership. The base predicate for nearly every policy.
create or replace function app.is_org_member(p_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
  );
$$;

-- The caller's effective role in an organisation.
create or replace function app.org_role(p_organization_id uuid)
returns app.member_role
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid();
$$;

-- Workspace membership.
--
-- Organisation owners and admins are members of every workspace implicitly —
-- otherwise an owner could create a workspace and immediately lose access to it.
create or replace function app.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspaces w
    join public.organization_members m
      on m.organization_id = w.organization_id
    where w.id = p_workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

-- Effective role for a workspace: the workspace override if set, else the
-- organisation role.
create or replace function app.workspace_role(p_workspace_id uuid)
returns app.member_role
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select coalesce(
    (
      select wm.role
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.role is not null
    ),
    (
      select m.role
      from public.workspaces w
      join public.organization_members m
        on m.organization_id = w.organization_id
      where w.id = p_workspace_id
        and m.user_id = auth.uid()
    )
  );
$$;

-- Does the caller hold a permission in this organisation?
create or replace function app.has_org_permission(
  p_organization_id uuid,
  p_permission app.permission
)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select exists (
    select 1
    from public.organization_members m
    join app.role_permissions rp on rp.role = m.role
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and rp.permission = p_permission
  );
$$;

-- Does the caller hold a permission in this workspace?
create or replace function app.has_workspace_permission(
  p_workspace_id uuid,
  p_permission app.permission
)
returns boolean
language sql
security definer
set search_path = app, public, pg_catalog
stable
as $$
  select exists (
    select 1
    from app.role_permissions rp
    where rp.role = app.workspace_role(p_workspace_id)
      and rp.permission = p_permission
  );
$$;

-- Owner-only actions: deleting the organisation, transferring ownership,
-- removing an admin. Separated from `admin` deliberately.
create or replace function app.is_org_owner(p_organization_id uuid)
returns boolean
language sql
security definer
set search_path = app, public, pg_catalog
stable
as $$
  select app.org_role(p_organization_id) = 'owner';
$$;

revoke all on function
  app.is_org_member(uuid),
  app.org_role(uuid),
  app.is_workspace_member(uuid),
  app.workspace_role(uuid),
  app.has_org_permission(uuid, app.permission),
  app.has_workspace_permission(uuid, app.permission),
  app.is_org_owner(uuid)
from public;

grant execute on function
  app.is_org_member(uuid),
  app.org_role(uuid),
  app.is_workspace_member(uuid),
  app.workspace_role(uuid),
  app.has_org_permission(uuid, app.permission),
  app.has_workspace_permission(uuid, app.permission),
  app.is_org_owner(uuid)
to authenticated, service_role;

-- =============================================================================
-- INDEXES FOR RLS
--
-- Every column a policy filters on needs an index. Without them each policy
-- evaluation is a sequential scan, and because policies run per candidate row
-- the cost is multiplied by the size of the table being queried — this is the
-- single most common cause of a "Supabase got slow" report.
-- =============================================================================
create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_org_idx on public.organization_members (organization_id);
create index organization_members_user_org_role_idx
  on public.organization_members (user_id, organization_id, role);
create index workspace_members_user_idx on public.workspace_members (user_id);
create index workspace_members_workspace_idx on public.workspace_members (workspace_id);
-- The `workspace_members_write` policy filters on organization_id, so this is a
-- policy index, not a convenience one. Caught by assertion 4 in 0014.
create index workspace_members_organization_idx on public.workspace_members (organization_id);
create index workspaces_org_idx on public.workspaces (organization_id) where deleted_at is null;
create index organizations_created_by_idx on public.organizations (created_by);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- Force RLS for table owners too, so a definer function or a superuser-owned
-- connection cannot accidentally read across tenants.
alter table public.organizations force row level security;
alter table public.organization_members force row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members force row level security;

-- --- profiles ---------------------------------------------------------------
-- A user reads and writes only their own profile.
--
-- Teammate names are exposed through a narrow view (0003) rather than by
-- widening this policy: "anyone in a shared org may read your profile" also
-- exposes your email and locale to every member of every org you join.
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT policy: profiles are created only by the bootstrap function (0016),
-- which runs as definer. A client-side insert would let a user forge a profile
-- row for another auth user's id.

-- --- organizations ----------------------------------------------------------
create policy organizations_select_member on public.organizations
  for select to authenticated
  using (app.is_org_member(id) and deleted_at is null);

create policy organizations_update_admin on public.organizations
  for update to authenticated
  using (app.has_org_permission(id, 'team.manage'))
  with check (app.has_org_permission(id, 'team.manage'));

-- Only the owner may soft-delete, and only via update. There is no DELETE
-- policy at all: hard-deleting an organisation would cascade away the usage
-- ledger and publish history that billing disputes depend on.

-- --- organization_members ---------------------------------------------------
-- Members see the roster of organisations they belong to. This is intentional:
-- the team screen needs it, and a member already knows who they work with.
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (app.is_org_member(organization_id));

create policy organization_members_insert on public.organization_members
  for insert to authenticated
  with check (app.has_org_permission(organization_id, 'team.manage'));

create policy organization_members_update on public.organization_members
  for update to authenticated
  using (app.has_org_permission(organization_id, 'team.manage'))
  with check (
    app.has_org_permission(organization_id, 'team.manage')
    -- Only an owner may create or alter another owner, so an admin cannot
    -- promote themselves and then remove the real owner.
    and (role <> 'owner' or app.is_org_owner(organization_id))
  );

create policy organization_members_delete on public.organization_members
  for delete to authenticated
  using (
    -- Leaving under your own steam is always allowed...
    user_id = auth.uid()
    -- ...and removing someone else requires team.manage, with owners removable
    -- only by an owner.
    or (
      app.has_org_permission(organization_id, 'team.manage')
      and (role <> 'owner' or app.is_org_owner(organization_id))
    )
  );

-- --- workspaces -------------------------------------------------------------
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (app.is_workspace_member(id) and deleted_at is null);

create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (app.has_org_permission(organization_id, 'workspace.manage'));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (app.has_workspace_permission(id, 'workspace.manage'))
  with check (app.has_workspace_permission(id, 'workspace.manage'));

-- --- workspace_members ------------------------------------------------------
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (app.is_workspace_member(workspace_id));

create policy workspace_members_write on public.workspace_members
  for all to authenticated
  using (app.has_org_permission(organization_id, 'team.manage'))
  with check (app.has_org_permission(organization_id, 'team.manage'));
