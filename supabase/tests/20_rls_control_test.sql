-- =============================================================================
-- NEGATIVE CONTROL
--
-- A passing isolation suite is only meaningful if it would fail when isolation
-- breaks. Two things can make 10_tenant_isolation_test.sql pass for the wrong
-- reason:
--
--   1. The `authenticated` role has no privileges at all, so every query returns
--      nothing and every write is refused — regardless of any policy.
--   2. The assertion helpers swallow errors, so a write refused for an unrelated
--      reason reads as an authorization denial.
--
-- This file rules both out by toggling RLS off and proving the same query then
-- leaks across tenants. If this test ever fails, the isolation suite above has
-- stopped proving anything and must not be trusted.
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_alice uuid := '11111111-1111-1111-1111-111111111111';
  v_bob   uuid := '22222222-2222-2222-2222-222222222222';
  v_with_rls integer;
  v_without_rls integer;
  v_total integer;
begin
  -- Fixtures come from 10_tenant_isolation_test.sql, which runs first.
  select count(*) into v_total from public.campaigns;
  if v_total < 2 then
    raise exception
      'CONTROL FAIL: expected campaigns in at least two tenants, found %. Fixtures did not load, so the isolation suite proved nothing.',
      v_total;
  end if;

  -- --- with RLS enabled: one tenant's row only ------------------------------
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select count(*) into v_with_rls from public.campaigns;
  reset role;

  if v_with_rls <> 1 then
    raise exception 'CONTROL FAIL: with RLS enabled Alice saw % campaigns, expected 1', v_with_rls;
  end if;

  -- --- with RLS disabled: everything ---------------------------------------
  -- Proves the filtering above came from the policy and not from a missing grant.
  alter table public.campaigns disable row level security;

  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select count(*) into v_without_rls from public.campaigns;
  reset role;

  alter table public.campaigns enable row level security;

  if v_without_rls <= v_with_rls then
    raise exception
      'CONTROL FAIL: disabling RLS did not widen visibility (% with, % without). The `authenticated` role is probably missing SELECT privilege, so the isolation suite is passing vacuously.',
      v_with_rls, v_without_rls;
  end if;

  raise notice 'control: RLS on = % row(s), RLS off = % row(s) — policies are doing the filtering',
    v_with_rls, v_without_rls;
end;
$$;

-- --- the denial helper must itself be able to fail --------------------------
--
-- Redefined here rather than reused from 10_tenant_isolation_test.sql: run.sh
-- executes each test file in its own psql session, and `pg_temp` objects do not
-- survive one. The body must stay identical to the version under test — if that
-- one changes, change this one.
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
    raise exception 'FAIL: % — expected 42501 but got % (%)', p_what, sqlstate, sqlerrm;
end;
$$;

do $$
declare
  v_raised boolean := false;
begin
  begin
    -- `select 1` always succeeds, so a correct assert_denied must reject it.
    perform pg_temp.assert_denied('select 1', 'control: statement that always succeeds');
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        v_raised := true;
      else
        raise;
      end if;
  end;

  if not v_raised then
    raise exception
      'CONTROL FAIL: assert_denied did not flag a successful statement. It is swallowing outcomes, so every "cannot write" assertion in the suite is meaningless.';
  end if;
end;
$$;

-- RLS was toggled above; confirm it is back on before anything else runs.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.campaigns'::regclass) then
    raise exception 'CONTROL FAIL: RLS was left disabled on public.campaigns.';
  end if;
end;
$$;

select '  ✓ negative control: the isolation suite can detect a breach' as result;
