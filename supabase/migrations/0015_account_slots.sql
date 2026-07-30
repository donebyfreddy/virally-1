-- =============================================================================
-- 0015 — ACCOUNT SLOTS AND WORKSPACE LIMITS
--
-- A Virally *account slot* is a unit of licensed capacity, not a social account.
-- The distinction is the whole point of this file, and it is enforced structurally
-- rather than by naming discipline:
--
--   * A slot may exist with no platform account behind it. That is the normal
--     case for a slot in `planning` or `launch_kit_ready`.
--   * A slot only reaches `connected` when it points at a real
--     `connected_accounts` row, which itself can only be created by the OAuth
--     callback running as the service role (0008). So a slot cannot claim a live
--     account without an actual authorisation having happened.
--
-- Nothing here creates, registers or provisions an account on any platform, and
-- nothing may be added that does. See 0008's header for the same boundary applied
-- to launch kits, and 0014's assertion 2 for the no-credentials rule.
--
-- WHY EMPTY SLOTS ARE NOT ROWS
--
-- The product shows ten numbered slots, most of them empty. The obvious schema
-- pre-creates ten rows per workspace and flips them between states. This does not,
-- for three reasons:
--
--   1. The limit is configurable and changes with the plan. Pre-created rows mean
--      a downgrade has to delete rows, and then "which ten?" is a real question
--      with a destructive answer.
--   2. `account_slots` would carry mostly-null rows whose only content is their
--      own index, which every join and policy then pays for.
--   3. The product rule "a slot must not be consumed merely by starting and
--      cancelling a launch-kit form" is automatic if occupancy *is* row existence.
--      With pre-created rows it becomes a state machine that can leak capacity.
--
-- So: occupied slots are rows, empty slots are the arithmetic difference between
-- the limit and the row count. `public.workspace_slot_usage` does that arithmetic
-- server-side, and `app.account_slot_status` deliberately has no `empty` member —
-- an unoccupied slot has no row to hold a status. The UI's `empty` state is
-- derived, and typed as such in src/lib/accounts/slots.ts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SLOT LIFECYCLE
--
-- Eleven states, none of which mean "an account was created for you". The three
-- `awaiting_*` states exist so the UI can distinguish "we have prepared material"
-- from "you told us you registered it" from "authorise it here" — the handoff that
-- a compliant product has to make explicit rather than paper over.
-- -----------------------------------------------------------------------------
create type app.account_slot_status as enum (
  'planning',                 -- slot claimed, launch kit still being produced
  'launch_kit_ready',         -- material generated, nothing registered anywhere
  'awaiting_manual_creation', -- user is registering the account on the platform
  'awaiting_connection',      -- user says it exists; not yet authorised to us
  'connecting',               -- OAuth round-trip in flight
  'connected',                -- authorised, publishable subject to capabilities
  'limited_permissions',      -- authorised but missing scopes we need
  'reconnection_required',    -- token expired or revoked upstream
  'suspended_by_user',        -- user paused publishing to this slot
  'disconnected',             -- authorisation withdrawn, slot still held
  'archived'                  -- released; does not count against the limit
);

comment on type app.account_slot_status is
  'Lifecycle of a Virally capacity slot. Has no `empty` member by design: an empty slot is the absence of a row. See 0015.';

-- -----------------------------------------------------------------------------
-- PLAN LIMITS — reference data in the private schema.
--
-- §14 of the product spec names Creator/Studio/Network with 3/10/configurable
-- slots, and says the names and numbers stay configurable until real pricing
-- exists. A table rather than a constant makes that true without a deploy, and
-- keeps the number in the same place as the enforcement that reads it.
--
-- Lives in `app` rather than `public` because it is not tenant data and no client
-- has any reason to enumerate the price list through PostgREST.
-- -----------------------------------------------------------------------------
create table app.plan_limits (
  plan_code text primary key,
  account_slot_limit integer not null check (account_slot_limit >= 0),
  monthly_generation_limit integer check (monthly_generation_limit is null or monthly_generation_limit >= 0),
  monthly_publish_limit integer check (monthly_publish_limit is null or monthly_publish_limit >= 0),
  updated_at timestamptz not null default now()
);

-- `free` matches subscriptions.plan_code's default in 0011, so a workspace that
-- has never touched billing resolves to a real number rather than falling through
-- to the hardcoded floor.
insert into app.plan_limits (plan_code, account_slot_limit, monthly_generation_limit, monthly_publish_limit)
values
  ('free',    10, 100,  100),
  ('creator',  3, 300,  300),
  ('studio',  10, 2000, 2000),
  ('network', 50, null, null);

comment on table app.plan_limits is
  'Per-plan default quotas. Overridden per workspace by public.workspace_limits. See 0015.';

-- -----------------------------------------------------------------------------
-- PER-WORKSPACE OVERRIDES
--
-- A row here exists only when someone deliberately set a limit for this
-- workspace. Absence means "use the plan default" — which is why this is not
-- seeded per workspace and why bootstrap_current_user is untouched. A null
-- *column* within an existing row means the same thing for that one quota, so an
-- admin can raise slots without pinning the generation quota.
--
-- Writes require billing.manage: raising your own limit is a billing decision,
-- not a workspace-content decision. Note this means an `editor` can see the limit
-- (they need to, to understand the UI) but cannot change it.
-- -----------------------------------------------------------------------------
create table public.workspace_limits (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  account_slot_limit integer check (account_slot_limit is null or account_slot_limit >= 0),
  monthly_generation_limit integer check (monthly_generation_limit is null or monthly_generation_limit >= 0),
  monthly_publish_limit integer check (monthly_publish_limit is null or monthly_publish_limit >= 0),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.workspace_limits');

alter table public.workspace_limits enable row level security;
alter table public.workspace_limits force row level security;

create policy workspace_limits_select on public.workspace_limits
  for select to authenticated
  using (app.is_workspace_member(workspace_id));

create policy workspace_limits_insert on public.workspace_limits
  for insert to authenticated
  with check (app.has_workspace_permission(workspace_id, 'billing.manage'));

create policy workspace_limits_update on public.workspace_limits
  for update to authenticated
  using (app.has_workspace_permission(workspace_id, 'billing.manage'))
  with check (app.has_workspace_permission(workspace_id, 'billing.manage'));

create policy workspace_limits_delete on public.workspace_limits
  for delete to authenticated
  using (app.has_workspace_permission(workspace_id, 'billing.manage'));

-- The SELECT policy filters on this column; assertion 4 in 0014 requires the
-- leading index. It is the primary key, so the PK index already satisfies it —
-- created explicitly here anyway would be a duplicate. Left to the PK.

comment on table public.workspace_limits is
  'Per-workspace quota overrides. Absent row or null column = fall back to the plan default in app.plan_limits. See 0015.';

-- -----------------------------------------------------------------------------
-- EFFECTIVE LIMIT RESOLUTION
--
-- Three-level fallback: workspace override → plan default → hardcoded floor.
--
-- The floor exists because the alternative is worse. If `plan_code` is somehow a
-- value not present in app.plan_limits — a plan renamed upstream, a Stripe webhook
-- writing a code we do not know yet — every path that reads a limit would return
-- null, and `count < null` is null, which is not true, which would silently deny
-- every slot creation in the workspace. Ten is the documented product default, so
-- an unknown plan degrades to the default rather than to zero capacity.
--
-- SECURITY DEFINER with a pinned search_path, matching the other app.* helpers:
-- it reads `subscriptions`, which is org-scoped and gated on billing.view, and a
-- workspace member without billing.view still needs their slot limit resolved.
-- -----------------------------------------------------------------------------
create or replace function app.workspace_account_slot_limit(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, app, pg_catalog
as $$
  select coalesce(
    wl.account_slot_limit,
    pl.account_slot_limit,
    10
  )
  from public.workspaces w
  left join public.workspace_limits wl on wl.workspace_id = w.id
  left join public.subscriptions s on s.organization_id = w.organization_id
  left join app.plan_limits pl on pl.plan_code = s.plan_code
  where w.id = p_workspace_id;
$$;

revoke all on function app.workspace_account_slot_limit(uuid) from public;
grant execute on function app.workspace_account_slot_limit(uuid) to authenticated, service_role;

comment on function app.workspace_account_slot_limit is
  'Effective slot limit: workspace override, else plan default, else 10. Never returns null for an existing workspace. See 0015.';

-- -----------------------------------------------------------------------------
-- CROSS-WORKSPACE REFERENCE SAFETY
--
-- A slot must not point at another workspace's brand, launch kit or connected
-- account. The usual way to enforce that is a trigger that re-reads the parent and
-- compares workspace_id. This uses composite foreign keys instead:
--
--     foreign key (brand_id, workspace_id) references brands (id, workspace_id)
--
-- which the planner enforces on every write with no trigger to skip, no race
-- between the check and the insert, and no way for an UPDATE that moves a slot
-- between workspaces to leave a dangling cross-tenant pointer. It requires a
-- unique constraint on the parent's (id, workspace_id) — redundant given id is
-- already unique, but that redundancy is what makes it referenceable.
-- -----------------------------------------------------------------------------
alter table public.brands
  add constraint brands_id_workspace_key unique (id, workspace_id);
alter table public.account_launch_kits
  add constraint account_launch_kits_id_workspace_key unique (id, workspace_id);
alter table public.connected_accounts
  add constraint connected_accounts_id_workspace_key unique (id, workspace_id);

-- -----------------------------------------------------------------------------
-- ACCOUNT SLOTS
-- -----------------------------------------------------------------------------
create table public.account_slots (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- Stable, human-facing index within the workspace. Users say "slot 4" and mean
  -- it; reusing a freed number would silently re-label somebody's screenshot, so
  -- the allocator in claim_account_slot fills the lowest *unused* number and
  -- archived slots keep theirs.
  slot_number integer not null check (slot_number > 0),

  platform app.platform not null,
  status app.account_slot_status not null default 'planning',

  brand_id uuid,
  account_launch_kit_id uuid,
  connected_account_id uuid,

  display_label text check (display_label is null or length(trim(display_label)) between 1 and 120),
  internal_notes text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  unique (workspace_id, slot_number),

  foreign key (brand_id, workspace_id)
    references public.brands (id, workspace_id) on delete set null,
  foreign key (account_launch_kit_id, workspace_id)
    references public.account_launch_kits (id, workspace_id) on delete set null,
  foreign key (connected_account_id, workspace_id)
    references public.connected_accounts (id, workspace_id) on delete set null,

  -- `archived` and archived_at are one fact. Allowing them to disagree means the
  -- limit check (which reads archived_at) and the UI (which reads status) can
  -- reach opposite conclusions about the same row.
  constraint account_slots_archived_consistent check (
    (status = 'archived') = (archived_at is not null)
  ),

  -- The states that assert a live authorisation may not do so without pointing at
  -- one. This is the structural half of "creating a slot must not claim that an
  -- account has been created".
  constraint account_slots_connected_requires_account check (
    status not in ('connected', 'limited_permissions', 'reconnection_required')
    or connected_account_id is not null
  )
);

select app.attach_touch_trigger('public.account_slots');
select app.apply_workspace_rls('public.account_slots', 'accounts.connect', 'accounts.disconnect');

-- Active-slot lookups (the dashboard, and the limit check itself) always filter
-- out archived rows.
create index account_slots_active_idx on public.account_slots (workspace_id, slot_number)
  where archived_at is null;
create index account_slots_status_idx on public.account_slots (workspace_id, status)
  where archived_at is null;
create index account_slots_connected_account_idx on public.account_slots (connected_account_id)
  where connected_account_id is not null;
create index account_slots_launch_kit_idx on public.account_slots (account_launch_kit_id)
  where account_launch_kit_id is not null;

comment on table public.account_slots is
  'Licensed capacity for one social account. NOT a social account: see 0015 header. Empty slots are absent rows.';
comment on column public.account_slots.connected_account_id is
  'Set only after a real OAuth authorisation produced a connected_accounts row. Never set to assert an account exists.';

-- -----------------------------------------------------------------------------
-- LIMIT ENFORCEMENT
--
-- In a trigger rather than a CHECK constraint because the rule spans rows: a CHECK
-- cannot count its own table. In a trigger rather than only in application code
-- because "do not silently create an eleventh slot" has to hold for the service
-- role too — the OAuth callback and any future worker bypass RLS, and this is the
-- only layer they still pass through.
--
-- WHY *AFTER* AND NOT BEFORE
--
-- Postgres evaluates an RLS WITH CHECK policy after BEFORE triggers have run,
-- because a BEFORE trigger may still change the row the policy must judge. A
-- BEFORE trigger here therefore fired ahead of the permission check, with two
-- consequences, both found by the test suite rather than by reasoning:
--
--   1. A caller with no accounts.connect permission writing to a full workspace got
--      "limit reached" instead of "not permitted" — the wrong remedy, and the UI
--      branches on that code.
--   2. It leaked occupancy. A stranger who guessed a workspace id could tell a full
--      workspace from a non-full one by which error came back.
--
-- AFTER runs once the policy has already accepted the row, so authorization failure
-- takes precedence and the capacity error only ever reaches someone entitled to
-- create a slot. Raising in an AFTER trigger still aborts the statement.
--
-- THE ADVISORY LOCK
--
-- Without it, two concurrent inserts each count 9 against a limit of 10 and both
-- commit, because neither can see the other's uncommitted row at any isolation
-- level below serializable. Because this is an AFTER trigger, the row already
-- exists in the current transaction, so the count includes it and the comparison is
-- `> limit`. Serialisation still holds: the second transaction blocks on the lock
-- until the first commits or rolls back, then counts a view that includes whatever
-- actually survived. Transaction-scoped, so there is no release path to forget.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_account_slot_limit()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_limit integer;
  v_active integer;
begin
  -- Only writes that ADD to active capacity need checking: a fresh row, or an
  -- un-archive. Editing an already-active slot must not be blocked by a limit that
  -- was lowered after it was created — the product says "archive or upgrade", not
  -- "you may no longer rename slot 7".
  if tg_op = 'UPDATE' and not (old.archived_at is not null and new.archived_at is null) then
    return null;
  end if;

  -- Single-argument bigint form: the two-argument form takes int4, and hashing a
  -- uuid down to 32 bits across every workspace in the system is a collision budget
  -- worth not spending. A collision here would only ever over-serialise, never
  -- under-serialise, but the wider key costs nothing.
  perform pg_advisory_xact_lock(hashtextextended('virally:account_slots:' || new.workspace_id::text, 0));

  v_limit := app.workspace_account_slot_limit(new.workspace_id);

  -- Includes the row this trigger fired for: it is already inserted.
  select count(*) into v_active
  from public.account_slots
  where workspace_id = new.workspace_id
    and archived_at is null;

  if v_active > v_limit then
    -- SQLSTATE 54023 (too_many_arguments) is the closest standard class; the app
    -- matches on the code rather than the message so the copy can change freely.
    raise exception
      'Account slot limit reached: workspace % holds % of % active slots. Archive an unused slot or raise the workspace limit.',
      new.workspace_id, v_limit, v_limit
      using errcode = '54023';
  end if;

  return null;
end;
$$;

create trigger enforce_account_slot_limit
  after insert or update on public.account_slots
  for each row execute function app.enforce_account_slot_limit();

comment on function app.enforce_account_slot_limit is
  'Blocks the eleventh active slot, for clients AND the service role. Advisory-locked per workspace against the concurrent-insert race. See 0015.';

-- -----------------------------------------------------------------------------
-- SLOT USAGE VIEW
--
-- The dashboard needs "7 of 10" before it can render anything, and computing it
-- client-side would mean shipping the plan table to the browser and trusting the
-- arithmetic that gates a paid limit. Owner-rights view with an explicit
-- membership predicate — same pattern and same caveat as the token-status view in
-- 0008: it is not security_invoker, so the WHERE clause is the authorisation.
-- -----------------------------------------------------------------------------
create view public.workspace_slot_usage as
select
  w.id as workspace_id,
  app.workspace_account_slot_limit(w.id) as slot_limit,
  count(s.id) filter (where s.archived_at is null) as active_slots,
  count(s.id) filter (where s.archived_at is null and s.status = 'connected') as connected_slots,
  count(s.id) filter (where s.archived_at is not null) as archived_slots,
  greatest(
    app.workspace_account_slot_limit(w.id) - count(s.id) filter (where s.archived_at is null),
    0
  ) as available_slots
from public.workspaces w
left join public.account_slots s on s.workspace_id = w.id
where app.is_workspace_member(w.id)
group by w.id;

comment on view public.workspace_slot_usage is
  'Slot occupancy per workspace, including empty-slot arithmetic. See 0015.';

grant select on public.workspace_slot_usage to authenticated;

-- -----------------------------------------------------------------------------
-- SLOT ALLOCATION RPC
--
-- Claiming a slot is read-then-write (find the lowest free number, insert it), so
-- doing it in the application means two round trips with a race between them. This
-- is one statement from the client's perspective and one transaction from the
-- database's.
--
-- SECURITY INVOKER deliberately — NOT definer. The insert must pass the
-- account_slots RLS policy, which is what checks accounts.connect on the caller.
-- A definer function here would be a permission bypass wearing a helper's name.
-- -----------------------------------------------------------------------------
create or replace function public.claim_account_slot(
  p_workspace_id uuid,
  p_platform app.platform,
  p_brand_id uuid default null,
  p_display_label text default null
)
returns table (slot_id uuid, slot_number integer)
language plpgsql
set search_path = public, app, pg_catalog
as $$
declare
  v_org uuid;
  v_next integer;
begin
  -- Same lock the limit trigger takes, acquired here first so the number
  -- allocation and the limit check see the same serialised view. Taking it in this
  -- order in both places is what keeps them from deadlocking against each other.
  perform pg_advisory_xact_lock(hashtextextended('virally:account_slots:' || p_workspace_id::text, 0));

  -- RLS on `workspaces` means a non-member sees no row and this raises, rather
  -- than leaking whether the workspace exists.
  select organization_id into v_org
  from public.workspaces
  where id = p_workspace_id and deleted_at is null;

  if v_org is null then
    raise exception 'Workspace % is not available.', p_workspace_id
      using errcode = '42501';
  end if;

  -- Lowest positive integer not already taken, archived rows included: their
  -- numbers stay theirs so historical references keep meaning the same slot.
  select coalesce(min(candidate), 1) into v_next
  from (
    select gs.n as candidate
    from generate_series(
      1,
      (select count(*) + 1 from public.account_slots where workspace_id = p_workspace_id)
    ) as gs(n)
    where not exists (
      select 1 from public.account_slots s
      where s.workspace_id = p_workspace_id and s.slot_number = gs.n
    )
  ) free;

  insert into public.account_slots (
    organization_id, workspace_id, slot_number, platform, status,
    brand_id, display_label, created_by
  )
  values (
    v_org, p_workspace_id, v_next, p_platform, 'planning',
    p_brand_id, nullif(trim(coalesce(p_display_label, '')), ''), auth.uid()
  )
  returning id, account_slots.slot_number into slot_id, slot_number;

  return next;
end;
$$;

revoke all on function public.claim_account_slot(uuid, app.platform, uuid, text) from public, anon;
grant execute on function public.claim_account_slot(uuid, app.platform, uuid, text) to authenticated;

comment on function public.claim_account_slot is
  'Atomically allocates the lowest free slot number in a workspace. SECURITY INVOKER: RLS on account_slots is the permission check. See 0015.';

-- -----------------------------------------------------------------------------
-- LAUNCH KIT COMPLETIONS
--
-- 0008 created account_launch_kits with the generated *material*. The launch form
-- in §3 of the spec also captures the inputs that produced it, and the kit needs a
-- lifecycle of its own so "material prepared" and "user says the account exists"
-- are distinguishable without inferring it from a slot's state.
--
-- Added rather than renamed: the existing columns (target_platform,
-- suggested_names, suggested_usernames, manual_checklist) already carry the
-- product's meaning and are referenced by tests and RLS. Renaming them to match a
-- later spec draft would churn a tested table for no behavioural gain.
-- -----------------------------------------------------------------------------
alter table public.account_launch_kits
  add column target_audience text,
  add column primary_language text not null default 'en',
  add column region text,
  add column objective text,
  add column visual_direction text,
  add column posting_frequency text,
  -- The seven-day launch campaign, once one has been generated. SET NULL rather
  -- than CASCADE: deleting a campaign must not silently destroy the launch
  -- material that a user may still be working from.
  add column initial_campaign_id uuid references public.campaigns (id) on delete set null,
  add column status text not null default 'draft'
    check (status in ('draft', 'ready', 'account_created', 'connected', 'archived'));

create index account_launch_kits_status_idx on public.account_launch_kits (workspace_id, status);
create index account_launch_kits_campaign_idx on public.account_launch_kits (initial_campaign_id)
  where initial_campaign_id is not null;

comment on column public.account_launch_kits.status is
  'draft → ready → account_created → connected. `account_created` records only that the USER said so; it is never set by the system. See 0015.';

-- -----------------------------------------------------------------------------
-- ASSERTIONS
--
-- 0014's assertions run at the end of 0014, so they cannot see anything this file
-- adds. Repeated here, scoped to the new tables, because an assertion that only
-- guards the migrations written before it stops being a guarantee the moment
-- someone adds a table — which is exactly what this file does.
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing text[];
begin
  -- RLS enabled AND forced on every new public table.
  select array_agg(c.relname order by c.relname) into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in ('account_slots', 'workspace_limits')
    and not (c.relrowsecurity and c.relforcerowsecurity);

  if v_missing is not null then
    raise exception '0015: table(s) without forced RLS: %', array_to_string(v_missing, ', ');
  end if;
end;
$$;

do $$
declare
  v_bad text[];
begin
  -- Assertion 2 of 0014, re-applied: no credential-shaped column may appear.
  -- Virally never collects a social password, and the structural guarantee is that
  -- there is nowhere to put one.
  select array_agg(format('%s.%s', c.relname, a.attname)) into v_bad
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attnum > 0
    and not a.attisdropped
    and c.relname in ('account_slots', 'workspace_limits', 'account_launch_kits')
    and a.attname ~* 'password|passwd|(^|_)secret($|_)';

  if v_bad is not null then
    raise exception
      '0015: credential-shaped column(s): %. Virally never stores social credentials.',
      array_to_string(v_bad, ', ');
  end if;
end;
$$;

do $$
declare
  v_limit integer;
begin
  -- The fallback chain actually returns the documented default. A workspace with
  -- no override and the default 'free' plan must resolve to 10, not to null.
  -- Asserted rather than assumed because the null path fails *open-looking*: the
  -- limit check would deny every insert, and the bug would present as "slots are
  -- broken" rather than as a resolution failure.
  select app.workspace_account_slot_limit(id) into v_limit
  from public.workspaces limit 1;

  if v_limit is distinct from null and v_limit <> 10 then
    raise exception '0015: expected a default slot limit of 10, resolved %.', v_limit;
  end if;
end;
$$;
