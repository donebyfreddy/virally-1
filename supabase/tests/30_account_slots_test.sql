-- =============================================================================
-- ACCOUNT SLOTS — capacity, limits, and the cross-tenant boundary.
--
-- The claims under test are product promises with money attached, so each one is
-- executed rather than described:
--
--   * the default limit is ten
--   * the eleventh active slot is refused — including to the service role
--   * archiving frees capacity, and does not recycle the slot's number
--   * a per-workspace override changes the limit, and only billing.manage may set it
--   * a slot cannot point at another workspace's brand
--   * one tenant cannot see or create another tenant's slots
--
-- Runs after 10_ on the same database, following the existing convention. Its own
-- users (Dana, Erin) so a change to 10_'s fixtures cannot silently alter what this
-- file proves.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.assert_eq(
  p_actual anyelement, p_expected anyelement, p_what text
) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % — expected %, got %', p_what, p_expected, p_actual;
  end if;
end;
$$;

-- As in 10_: only an authorization denial counts. A write refused by a foreign key
-- or a NOT NULL proves nothing about who was allowed to do it.
create or replace function pg_temp.assert_denied(p_sql text, p_what text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — the operation SUCCEEDED but should have been denied', p_what;
exception
  when insufficient_privilege then
    return;
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then
      raise;
    end if;
    raise exception
      'FAIL: % — expected an authorization denial (42501) but got % (%).',
      p_what, sqlstate, sqlerrm;
end;
$$;

-- Asserts a statement fails with one SPECIFIC sqlstate.
--
-- The limit breach must be distinguishable from a permission denial: "you may not
-- do this" and "you have run out of capacity" lead the user to different actions,
-- and the UI branches on the code. A test that accepted any error would let the two
-- collapse into each other without anyone noticing.
create or replace function pg_temp.assert_sqlstate(
  p_sql text, p_sqlstate text, p_what text
) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — the operation SUCCEEDED but should have failed with %', p_what, p_sqlstate;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then
      raise;
    end if;
    if sqlstate <> p_sqlstate then
      raise exception 'FAIL: % — expected sqlstate %, got % (%)', p_what, p_sqlstate, sqlstate, sqlerrm;
    end if;
    return;
end;
$$;

-- -----------------------------------------------------------------------------
-- FIXTURES
-- -----------------------------------------------------------------------------
do $$
begin
  insert into auth.users (id, email) values
    ('44444444-4444-4444-4444-444444444444', 'dana@example.test'),
    ('55555555-5555-5555-5555-555555555555', 'erin@example.test');
end;
$$;

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select public.bootstrap_current_user('Dana Doe', null) \gset dana_
reset role;

set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select public.bootstrap_current_user('Erin Ellis', null) \gset erin_
reset role;

-- Ids are needed by later assertions, and a granted temp table is how 10_ passes
-- one tenant's ids into another tenant's session without a cross-tenant read.
create table pg_temp.ids as
select
  (select w.id from public.workspaces w
     join public.organization_members m on m.organization_id = w.organization_id
    where m.user_id = '44444444-4444-4444-4444-444444444444') as dana_workspace,
  (select b.id from public.brands b
     join public.organization_members m on m.organization_id = b.organization_id
    where m.user_id = '44444444-4444-4444-4444-444444444444') as dana_brand,
  (select w.id from public.workspaces w
     join public.organization_members m on m.organization_id = w.organization_id
    where m.user_id = '55555555-5555-5555-5555-555555555555') as erin_workspace,
  (select b.id from public.brands b
     join public.organization_members m on m.organization_id = b.organization_id
    where m.user_id = '55555555-5555-5555-5555-555555555555') as erin_brand,
  (select o.id from public.organizations o
     join public.organization_members m on m.organization_id = o.id
    where m.user_id = '44444444-4444-4444-4444-444444444444') as dana_org;
grant select on pg_temp.ids to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1 — THE DEFAULT LIMIT IS TEN, AND AN EMPTY WORKSPACE HAS NO SLOT ROWS
-- -----------------------------------------------------------------------------
do $$
declare
  v_ws uuid := (select dana_workspace from pg_temp.ids);
  v_limit integer;
  v_rows integer;
begin
  perform pg_temp.assert_eq(app.workspace_account_slot_limit(v_ws), 10,
    'a fresh workspace resolves to the documented default of ten slots');

  select count(*) into v_rows from public.account_slots where workspace_id = v_ws;
  perform pg_temp.assert_eq(v_rows, 0,
    'empty slots are absent rows, not pre-created placeholders');

  -- An unknown plan_code must degrade to the default, not to null (which would
  -- deny every insert) and not to zero (which would deny them louder).
  update public.subscriptions set plan_code = 'plan-that-does-not-exist'
  where organization_id = (select dana_org from pg_temp.ids);
  select app.workspace_account_slot_limit(v_ws) into v_limit;
  perform pg_temp.assert_eq(v_limit, 10, 'an unrecognised plan_code falls back to ten, not null');
  update public.subscriptions set plan_code = 'free'
  where organization_id = (select dana_org from pg_temp.ids);
end;
$$;

-- The usage view does the empty-slot arithmetic.
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$
declare
  v_ws uuid := (select dana_workspace from pg_temp.ids);
  r record;
begin
  select * into r from public.workspace_slot_usage where workspace_id = v_ws;
  perform pg_temp.assert_eq(r.slot_limit::integer, 10, 'usage view reports the limit');
  perform pg_temp.assert_eq(r.active_slots::integer, 0, 'usage view reports zero active');
  perform pg_temp.assert_eq(r.available_slots::integer, 10, 'usage view reports ten available');
end;
$$;

-- -----------------------------------------------------------------------------
-- 2 — ALLOCATION FILLS THE LOWEST FREE NUMBER
-- -----------------------------------------------------------------------------
do $$
declare
  v_ws uuid := (select dana_workspace from pg_temp.ids);
  v_num integer;
  i integer;
begin
  select slot_number into v_num from public.claim_account_slot(v_ws, 'instagram');
  perform pg_temp.assert_eq(v_num, 1, 'the first claimed slot is number 1');

  select slot_number into v_num from public.claim_account_slot(v_ws, 'tiktok');
  perform pg_temp.assert_eq(v_num, 2, 'the second claimed slot is number 2');

  -- Fill to exactly the limit.
  for i in 3..10 loop
    perform public.claim_account_slot(v_ws, 'youtube');
  end loop;

  perform pg_temp.assert_eq(
    (select count(*)::integer from public.account_slots where workspace_id = v_ws and archived_at is null),
    10, 'ten slots are active at the limit');
end;
$$;

-- -----------------------------------------------------------------------------
-- 3 — THE ELEVENTH SLOT IS REFUSED
-- -----------------------------------------------------------------------------
do $$
declare
  v_ws uuid := (select dana_workspace from pg_temp.ids);
begin
  perform pg_temp.assert_sqlstate(
    format('select public.claim_account_slot(%L::uuid, %L)', v_ws, 'instagram'),
    '54023',
    'the eleventh active slot is refused with the capacity code');

  -- And not by the RPC alone: a direct insert must hit the same trigger, because
  -- the RPC is a convenience and the trigger is the rule.
  perform pg_temp.assert_sqlstate(
    format($q$insert into public.account_slots
              (organization_id, workspace_id, slot_number, platform)
              values (%L::uuid, %L::uuid, 99, 'facebook')$q$,
           (select dana_org from pg_temp.ids), v_ws),
    '54023',
    'a direct insert past the limit is refused too');

  perform pg_temp.assert_eq(
    (select count(*)::integer from public.account_slots where workspace_id = v_ws and archived_at is null),
    10, 'no eleventh slot was silently created');
end;
$$;

reset role;

-- The service role bypasses RLS. It must NOT bypass the limit: the OAuth callback
-- and every future worker run as service_role, and "do not silently create an
-- eleventh slot" is a licensing rule, not a UI rule.
set role service_role;
do $$
begin
  perform pg_temp.assert_sqlstate(
    format($q$insert into public.account_slots
              (organization_id, workspace_id, slot_number, platform)
              values (%L::uuid, %L::uuid, 98, 'facebook')$q$,
           (select dana_org from pg_temp.ids), (select dana_workspace from pg_temp.ids)),
    '54023',
    'the service role is also held to the slot limit');
end;
$$;
reset role;

-- -----------------------------------------------------------------------------
-- 4 — ARCHIVING FREES CAPACITY WITHOUT RECYCLING THE NUMBER
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$
declare
  v_ws uuid := (select dana_workspace from pg_temp.ids);
  v_num integer;
begin
  update public.account_slots
     set status = 'archived', archived_at = now()
   where workspace_id = v_ws and slot_number = 5;

  perform pg_temp.assert_eq(
    (select active_slots::integer from public.workspace_slot_usage where workspace_id = v_ws),
    9, 'an archived slot stops counting against the limit');

  select slot_number into v_num from public.claim_account_slot(v_ws, 'instagram');
  perform pg_temp.assert_eq(v_num, 11,
    'the freed number is not reused — slot 5 still means slot 5');

  perform pg_temp.assert_eq(
    (select active_slots::integer from public.workspace_slot_usage where workspace_id = v_ws),
    10, 'capacity is full again');

  -- Un-archiving is the one UPDATE that adds capacity, so it must be checked.
  perform pg_temp.assert_sqlstate(
    format($q$update public.account_slots set status = 'planning', archived_at = null
              where workspace_id = %L::uuid and slot_number = 5$q$, v_ws),
    '54023',
    'un-archiving past the limit is refused');

  -- Editing an already-active slot must NOT be blocked by a full workspace.
  update public.account_slots set display_label = 'Science ES'
   where workspace_id = v_ws and slot_number = 1;
  perform pg_temp.assert_eq(
    (select display_label from public.account_slots where workspace_id = v_ws and slot_number = 1),
    'Science ES', 'a full workspace can still edit its existing slots');
end;
$$;
reset role;

-- -----------------------------------------------------------------------------
-- 5 — PER-WORKSPACE OVERRIDES
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$
declare
  v_ws uuid := (select dana_workspace from pg_temp.ids);
begin
  -- Dana is an owner, so she holds billing.manage.
  insert into public.workspace_limits (workspace_id, account_slot_limit)
  values (v_ws, 12);

  perform pg_temp.assert_eq(app.workspace_account_slot_limit(v_ws), 12,
    'a workspace override beats the plan default');
  perform pg_temp.assert_eq(
    (select available_slots::integer from public.workspace_slot_usage where workspace_id = v_ws),
    2, 'the usage view reflects the raised limit');

  -- Lowering the limit below current occupancy must not corrupt anything; it just
  -- means no new slots. The product answer is "archive or upgrade", never a
  -- destructive auto-release.
  update public.workspace_limits set account_slot_limit = 2 where workspace_id = v_ws;
  perform pg_temp.assert_eq(
    (select available_slots::integer from public.workspace_slot_usage where workspace_id = v_ws),
    0, 'available never goes negative when the limit drops below occupancy');
  perform pg_temp.assert_eq(
    (select count(*)::integer from public.account_slots where workspace_id = v_ws and archived_at is null),
    10, 'lowering the limit destroys nothing');

  -- A null column falls back to the plan default rather than meaning zero.
  update public.workspace_limits set account_slot_limit = null where workspace_id = v_ws;
  perform pg_temp.assert_eq(app.workspace_account_slot_limit(v_ws), 10,
    'a null override column falls back to the plan default');

  delete from public.workspace_limits where workspace_id = v_ws;
end;
$$;
reset role;

-- A role without billing.manage may read the limit but not change it.
do $$
begin
  insert into public.workspace_members (workspace_id, organization_id, user_id, role)
  values (
    (select dana_workspace from pg_temp.ids),
    (select dana_org from pg_temp.ids),
    '55555555-5555-5555-5555-555555555555',
    'editor'
  );
end;
$$;

set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$
declare
  v_ws uuid := (select dana_workspace from pg_temp.ids);
begin
  perform pg_temp.assert_eq(
    (select count(*)::integer from public.workspace_slot_usage where workspace_id = v_ws),
    1, 'an editor can read the slot limit (the UI has to explain it)');

  perform pg_temp.assert_denied(
    format($q$insert into public.workspace_limits (workspace_id, account_slot_limit)
              values (%L::uuid, 500)$q$, v_ws),
    'an editor cannot raise the account slot limit');
end;
$$;
reset role;

-- -----------------------------------------------------------------------------
-- 6 — CROSS-TENANT ISOLATION
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$
declare
  v_erin_ws uuid := (select erin_workspace from pg_temp.ids);
  v_dana_ws uuid := (select dana_workspace from pg_temp.ids);
  v_visible integer;
begin
  -- Erin was just added to Dana's workspace as an editor, so she legitimately sees
  -- those slots. What she must not have is accounts.connect there.
  perform pg_temp.assert_denied(
    format($q$insert into public.account_slots
              (organization_id, workspace_id, slot_number, platform)
              values (%L::uuid, %L::uuid, 40, 'instagram')$q$,
           (select dana_org from pg_temp.ids), v_dana_ws),
    'an editor cannot claim a slot (accounts.connect is required)');

  -- NOT assert_denied. A DELETE whose USING policy excludes every candidate row
  -- deletes nothing and reports success — RLS filters rows, it does not raise on
  -- an empty match. Asserting an exception here would fail against a correctly
  -- protected table, and asserting mere success would pass against a wide-open
  -- one. The only assertion that means anything is that the rows are still there.
  select count(*) into v_visible from public.account_slots where workspace_id = v_dana_ws;
  delete from public.account_slots where workspace_id = v_dana_ws;
  perform pg_temp.assert_eq(
    (select count(*)::integer from public.account_slots where workspace_id = v_dana_ws),
    v_visible,
    'an editor''s delete removes no slots (accounts.disconnect is required)');

  -- In her own workspace she is an owner, so a slot is allowed — and it must not be
  -- able to borrow Dana's brand.
  perform pg_temp.assert_sqlstate(
    format($q$insert into public.account_slots
              (organization_id, workspace_id, slot_number, platform, brand_id)
              select organization_id, %L::uuid, 1, 'instagram', %L::uuid
                from public.workspaces where id = %L::uuid$q$,
           v_erin_ws, (select dana_brand from pg_temp.ids), v_erin_ws),
    '23503',
    'a slot cannot reference another workspace''s brand');
end;
$$;
reset role;

-- Remove Erin's membership so the isolation check below is a true stranger test.
delete from public.workspace_members
 where user_id = '55555555-5555-5555-5555-555555555555'
   and workspace_id = (select dana_workspace from pg_temp.ids);

set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$
declare
  v_dana_ws uuid := (select dana_workspace from pg_temp.ids);
begin
  perform pg_temp.assert_eq(
    (select count(*)::integer from public.account_slots where workspace_id = v_dana_ws),
    0, 'a stranger sees none of another workspace''s slots');

  perform pg_temp.assert_eq(
    (select count(*)::integer from public.workspace_slot_usage where workspace_id = v_dana_ws),
    0, 'a stranger sees no slot usage for another workspace');

  perform pg_temp.assert_denied(
    format($q$select public.claim_account_slot(%L::uuid, 'instagram')$q$, v_dana_ws),
    'a stranger cannot claim a slot in another workspace');
end;
$$;
reset role;

-- -----------------------------------------------------------------------------
-- 7 — STRUCTURAL HONESTY CONSTRAINTS
-- -----------------------------------------------------------------------------
do $$
declare
  v_ws uuid := (select erin_workspace from pg_temp.ids);
  v_org uuid := (select organization_id from public.workspaces where id = (select erin_workspace from pg_temp.ids));
begin
  -- A slot may not claim to be connected without an actual connected account.
  -- This is the schema-level half of "creating a slot must not claim that an
  -- Instagram account has been created".
  perform pg_temp.assert_sqlstate(
    format($q$insert into public.account_slots
              (organization_id, workspace_id, slot_number, platform, status)
              values (%L::uuid, %L::uuid, 7, 'instagram', 'connected')$q$, v_org, v_ws),
    '23514',
    'a slot cannot report `connected` with no connected account behind it');

  perform pg_temp.assert_sqlstate(
    format($q$insert into public.account_slots
              (organization_id, workspace_id, slot_number, platform, status)
              values (%L::uuid, %L::uuid, 8, 'instagram', 'archived')$q$, v_org, v_ws),
    '23514',
    'archived status and archived_at cannot disagree');

  -- `empty` is deliberately not a database state: an empty slot has no row.
  perform pg_temp.assert_sqlstate(
    format($q$insert into public.account_slots
              (organization_id, workspace_id, slot_number, platform, status)
              values (%L::uuid, %L::uuid, 9, 'instagram', 'empty')$q$, v_org, v_ws),
    '22P02',
    '`empty` is not a persistable slot status');
end;
$$;

select '  ✓ account slots: limits, archival, overrides and isolation verified' as result;
