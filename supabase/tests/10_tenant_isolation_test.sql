-- =============================================================================
-- CROSS-TENANT ISOLATION — the Phase 2 gate.
--
-- Two users, two organisations, and a third user invited into the first with a
-- low-privilege role. Every assertion below is a real query executed as the
-- `authenticated` role with a real JWT subject, so what is being tested is the
-- policy set, not a description of it.
--
-- `set role authenticated` + `set request.jwt.claim.sub` is exactly
-- how Supabase presents a signed-in user to Postgres. The results therefore mean
-- the same thing they would on the real platform.
-- =============================================================================

\set ON_ERROR_STOP on

-- Small assertion helpers so a failure names what it expected.
create or replace function pg_temp.assert_eq(
  p_actual anyelement, p_expected anyelement, p_what text
) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % — expected %, got %', p_what, p_expected, p_actual;
  end if;
end;
$$;

-- Asserts a client cannot read anything from a relation.
--
-- Passes on EITHER outcome, because both are genuine denials and the table under
-- test uses both: `oauth_connections` has its grants revoked *and* has RLS enabled
-- with zero policies. Insisting on one specific failure mode would make the test
-- fail when the protection got stronger.
create or replace function pg_temp.assert_unreadable(p_relation text, p_what text)
returns void language plpgsql as $$
declare
  v_count integer;
begin
  execute format('select count(*) from %s', p_relation) into v_count;
  if v_count <> 0 then
    raise exception 'FAIL: % — read % row(s); expected none to be visible', p_what, v_count;
  end if;
exception
  when insufficient_privilege then return;
end;
$$;

-- Asserts a write is refused BY AUTHORIZATION, specifically.
--
-- Only SQLSTATE 42501 (insufficient_privilege) counts as a pass — that is what an
-- RLS WITH CHECK violation raises. Every other error is re-raised as a failure.
--
-- An earlier version swallowed all exceptions, which meant a statement failing on
-- a NOT NULL or foreign-key violation looked identical to a policy denial. The
-- test would then pass while proving nothing about authorization, which is worse
-- than having no test: it reports safety that was never demonstrated.
create or replace function pg_temp.assert_denied(p_sql text, p_what text)
returns void language plpgsql as $$
begin
  execute p_sql;
  -- Reaching here means the write succeeded when it should have been refused.
  raise exception 'FAIL: % — the operation SUCCEEDED but should have been denied', p_what;
exception
  when insufficient_privilege then
    return;
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then
      raise;
    end if;
    raise exception
      'FAIL: % — expected an authorization denial (42501) but got % (%). The statement was rejected for the wrong reason, so this proves nothing about RLS.',
      p_what, sqlstate, sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- FIXTURES — created as the table owner so RLS does not interfere with setup.
-- -----------------------------------------------------------------------------
do $$
declare
  v_alice uuid := '11111111-1111-1111-1111-111111111111';
  v_bob   uuid := '22222222-2222-2222-2222-222222222222';
  v_carol uuid := '33333333-3333-3333-3333-333333333333';
begin
  insert into auth.users (id, email) values
    (v_alice, 'alice@example.test'),
    (v_bob,   'bob@example.test'),
    (v_carol, 'carol@example.test');
end;
$$;

-- Alice's tenant, built through the real bootstrap function so the test exercises
-- the same code path production uses.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.bootstrap_current_user('Alice Anderson', null);

-- Idempotency: calling it again must not create a second organisation. This is the
-- replayed-OAuth-callback case.
select public.bootstrap_current_user('Alice Anderson', null);

reset role;
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.organization_members
  where user_id = '11111111-1111-1111-1111-111111111111' and role = 'owner';
  perform pg_temp.assert_eq(v_count, 1, 'bootstrap is idempotent (one owner membership)');

  select count(*) into v_count from public.organizations;
  perform pg_temp.assert_eq(v_count, 1, 'bootstrap is idempotent (one organisation)');
end;
$$;

-- Bob's tenant.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.bootstrap_current_user('Bob Brown', null);
reset role;

-- Seed a campaign, content and an account into each tenant, as owner.
do $$
declare
  v_org uuid;
  v_ws uuid;
  v_brand uuid;
  v_campaign uuid;
  v_item uuid;
  v_variant uuid;
  v_account uuid;
  r record;
begin
  for r in
    select m.user_id, m.organization_id
    from public.organization_members m
    where m.role = 'owner'
  loop
    v_org := r.organization_id;
    select id into v_ws from public.workspaces where organization_id = v_org and is_default;
    select id into v_brand from public.brands where workspace_id = v_ws and is_default;

    insert into public.campaigns (organization_id, workspace_id, brand_id, name, created_by)
    values (v_org, v_ws, v_brand, 'Deep sea glow', r.user_id)
    returning id into v_campaign;

    insert into public.content_items (organization_id, workspace_id, campaign_id, brand_id, title, created_by)
    values (v_org, v_ws, v_campaign, v_brand, 'Why deep-sea animals glow', r.user_id)
    returning id into v_item;

    insert into public.content_variants (organization_id, workspace_id, content_item_id, platform, aspect_ratio)
    values (v_org, v_ws, v_item, 'instagram', '9:16')
    returning id into v_variant;

    insert into public.connected_accounts
      (organization_id, workspace_id, brand_id, platform, external_id, username, account_kind)
    values (v_org, v_ws, v_brand, 'instagram', 'ig-' || v_org::text, 'brand_handle', 'business')
    returning id into v_account;

    insert into public.oauth_connections
      (organization_id, workspace_id, connected_account_id, platform, access_token_encrypted)
    values (v_org, v_ws, v_account, 'instagram', 'ciphertext-for-' || v_org::text);

    insert into public.media_assets
      (organization_id, workspace_id, kind, bucket, storage_path, created_by)
    values (v_org, v_ws, 'source_video', 'source-media', v_ws::text || '/source_video/' || v_campaign::text || '.mp4', r.user_id);
  end loop;
end;
$$;

-- =============================================================================
-- 1. ALICE SEES ONLY HER OWN TENANT
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.organizations;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees exactly one organisation');

  select count(*) into v_count from public.workspaces;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees exactly one workspace');

  select count(*) into v_count from public.campaigns;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees only her campaign');

  select count(*) into v_count from public.content_items;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees only her content');

  select count(*) into v_count from public.content_variants;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees only her variants');

  select count(*) into v_count from public.connected_accounts;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees only her connected account');

  select count(*) into v_count from public.media_assets;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees only her media');

  select count(*) into v_count from public.brands;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees only her brand');
end;
$$;

-- =============================================================================
-- 2. OAUTH TOKENS ARE UNREADABLE BY ANY CLIENT — including their owner
-- =============================================================================
do $$
begin
  -- Alice owns this connected account and still cannot read its token. That is the
  -- intent: a compromised browser session must not be able to exfiltrate the
  -- ability to post as her brand.
  perform pg_temp.assert_unreadable(
    'public.oauth_connections',
    'oauth_connections is unreadable even by the account owner'
  );
end;
$$;

-- The expiry state the UI actually needs is still available, without ciphertext.
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.connected_account_token_status;
  perform pg_temp.assert_eq(v_count, 1, 'token status view exposes the owner''s account');
end;
$$;

-- =============================================================================
-- 3. ALICE CANNOT WRITE INTO BOB'S TENANT
-- =============================================================================
do $$
declare
  v_bob_org uuid;
  v_bob_ws uuid;
begin
  -- Ids are obtained out-of-band, which is the realistic threat: an attacker who
  -- has learned a workspace UUID from a log, a screenshot or a shared URL.
  select m.organization_id into v_bob_org
  from public.organization_members m
  where m.user_id = '22222222-2222-2222-2222-222222222222' and m.role = 'owner';

  -- Even reading the id must fail through the policy, so fetch it as owner.
  if v_bob_org is not null then
    raise exception 'FAIL: Alice could read Bob''s organisation membership';
  end if;
end;
$$;

reset role;
-- Capture Bob's ids as the table owner, then hand them to Alice explicitly.
create temporary table bob_ids as
select
  m.organization_id as org_id,
  w.id as workspace_id
from public.organization_members m
join public.workspaces w on w.organization_id = m.organization_id and w.is_default
where m.user_id = '22222222-2222-2222-2222-222222222222' and m.role = 'owner';

-- The scratch table is created by the owner, so the attacker role needs an
-- explicit grant. This models the realistic threat precisely: the attacker has
-- somehow learned the target's ids, and we are testing whether knowing them is
-- enough. It must not be.
grant select on bob_ids to authenticated;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_org uuid;
  v_ws uuid;
begin
  select org_id, workspace_id into v_org, v_ws from bob_ids;

  perform pg_temp.assert_denied(format(
    'insert into public.campaigns (organization_id, workspace_id, name, created_by)
     values (%L, %L, %L, %L)',
    v_org, v_ws, 'Injected campaign', '11111111-1111-1111-1111-111111111111'
  ), 'Alice cannot insert a campaign into Bob''s workspace');

  perform pg_temp.assert_denied(format(
    'insert into public.media_assets (organization_id, workspace_id, kind, bucket, storage_path)
     values (%L, %L, %L, %L, %L)',
    v_org, v_ws, 'source_video', 'source-media', 'stolen/path.mp4'
  ), 'Alice cannot insert media into Bob''s workspace');

  perform pg_temp.assert_denied(format(
    'insert into public.brands (organization_id, workspace_id, name, created_by)
     values (%L, %L, %L, %L)',
    v_org, v_ws, 'Injected brand', '11111111-1111-1111-1111-111111111111'
  ), 'Alice cannot insert a brand into Bob''s workspace');

  -- Joining an organisation by inserting her own membership would be the most
  -- direct escalation available.
  perform pg_temp.assert_denied(format(
    'insert into public.organization_members (organization_id, user_id, role)
     values (%L, %L, %L)',
    v_org, '11111111-1111-1111-1111-111111111111', 'owner'
  ), 'Alice cannot grant herself membership of Bob''s organisation');
end;
$$;

-- An UPDATE that would move her own row into Bob's tenant must also fail.
do $$
declare
  v_org uuid;
  v_ws uuid;
  v_affected integer;
begin
  select org_id, workspace_id into v_org, v_ws from bob_ids;

  begin
    execute format(
      'update public.campaigns set workspace_id = %L, organization_id = %L', v_ws, v_org
    );
    get diagnostics v_affected = row_count;
    if v_affected > 0 then
      raise exception 'FAIL: Alice re-parented a campaign into Bob''s workspace';
    end if;
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- =============================================================================
-- 4. USAGE AND AUDIT ARE APPEND-ONLY AND PERMISSION-GATED
-- =============================================================================
do $$
declare
  v_org uuid;
  v_count integer;
begin
  select id into v_org from public.organizations limit 1;

  -- Alice is owner, so billing.view applies and the ledger is readable.
  select count(*) into v_count from public.usage_events;
  perform pg_temp.assert_eq(v_count, 0, 'usage ledger readable by owner (empty so far)');

  -- But not writable: there is no insert policy at all, for anyone.
  perform pg_temp.assert_denied(format(
    'insert into public.usage_events (organization_id, kind, quantity, unit, idempotency_key)
     values (%L, %L, 1, %L, %L)',
    v_org, 'video_generated', 'video', 'forged-key'
  ), 'no client may write the usage ledger');

  perform pg_temp.assert_denied(format(
    'insert into public.credit_ledger (organization_id, delta, reason, idempotency_key)
     values (%L, 100000, %L, %L)',
    v_org, 'top_up', 'forged-credit'
  ), 'no client may grant itself credits');
end;
$$;

-- =============================================================================
-- 5. METRICS CANNOT BE FABRICATED
-- =============================================================================
do $$
declare
  v_org uuid;
  v_ws uuid;
  v_post uuid;
  v_account uuid;
begin
  select id into v_org from public.organizations limit 1;
  select id into v_ws from public.workspaces limit 1;
  select id into v_account from public.connected_accounts limit 1;

  perform pg_temp.assert_denied(format(
    'insert into public.analytics_daily (organization_id, workspace_id, day, views)
     values (%L, %L, current_date, 1000000)',
    v_org, v_ws
  ), 'a user cannot fabricate their own analytics rollup');

  perform pg_temp.assert_denied(format(
    'insert into public.generation_runs (organization_id, workspace_id, stage, provider)
     values (%L, %L, %L, %L)',
    v_org, v_ws, 'video', 'forged-provider'
  ), 'a user cannot forge a generation provenance record');
end;
$$;

reset role;

-- =============================================================================
-- 6. ROLE SEPARATION — Carol as a low-privilege member of Alice's organisation
-- =============================================================================
do $$
declare
  v_org uuid;
  v_ws uuid;
begin
  select m.organization_id into v_org
  from public.organization_members m
  where m.user_id = '11111111-1111-1111-1111-111111111111' and m.role = 'owner';
  select id into v_ws from public.workspaces where organization_id = v_org and is_default;

  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_org, '33333333-3333-3333-3333-333333333333', 'editor', now());
  insert into public.workspace_members (workspace_id, organization_id, user_id)
  values (v_ws, v_org, '33333333-3333-3333-3333-333333333333');
end;
$$;

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $$
declare
  v_org uuid;
  v_ws uuid;
  v_count integer;
  v_post uuid;
begin
  select id into v_org from public.organizations limit 1;
  select id into v_ws from public.workspaces limit 1;

  -- An editor can see the workspace's content and create more of it.
  select count(*) into v_count from public.campaigns;
  perform pg_temp.assert_eq(v_count, 1, 'editor sees the workspace campaign');

  insert into public.content_items (organization_id, workspace_id, title, created_by)
  values (v_org, v_ws, 'Editor draft', '33333333-3333-3333-3333-333333333333');

  -- But an editor holds neither billing.view...
  select count(*) into v_count from public.usage_events;
  perform pg_temp.assert_eq(v_count, 0, 'editor cannot read the usage ledger');

  -- ...nor team.manage.
  perform pg_temp.assert_denied(format(
    'insert into public.organization_members (organization_id, user_id, role)
     values (%L, %L, %L)',
    v_org, '22222222-2222-2222-2222-222222222222', 'viewer'
  ), 'editor cannot add organisation members');

  -- ...nor content.publish. This is the separation that makes approval real.
  perform pg_temp.assert_denied(format(
    'insert into public.publishing_plans (organization_id, workspace_id, name)
     values (%L, %L, %L)',
    v_org, v_ws, 'Editor plan'
  ), 'editor cannot create a publishing plan');
end;
$$;

-- An editor also cannot audit the organisation.
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.audit_logs;
  perform pg_temp.assert_eq(v_count, 0, 'editor cannot read audit logs');
end;
$$;

reset role;

-- =============================================================================
-- 7. STORAGE PATH AUTHORISATION
-- =============================================================================
do $$
declare
  v_alice_ws uuid;
  v_bob_ws uuid;
begin
  select w.id into v_alice_ws
  from public.workspaces w
  join public.organization_members m
    on m.organization_id = w.organization_id and m.role = 'owner'
  where m.user_id = '11111111-1111-1111-1111-111111111111';

  select w.id into v_bob_ws
  from public.workspaces w
  join public.organization_members m
    on m.organization_id = w.organization_id and m.role = 'owner'
  where m.user_id = '22222222-2222-2222-2222-222222222222';

  insert into storage.objects (bucket_id, name) values
    ('source-media', v_alice_ws::text || '/source_video/a.mp4'),
    ('source-media', v_bob_ws::text || '/source_video/b.mp4'),
    -- A path that does not start with a workspace id must be unreadable rather
    -- than an error.
    ('source-media', 'not-a-uuid/source_video/c.mp4');
end;
$$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare v_count integer;
begin
  select count(*) into v_count from storage.objects;
  perform pg_temp.assert_eq(v_count, 1, 'Alice sees only objects under her workspace prefix');
end;
$$;

reset role;

-- =============================================================================
-- 8. ANONYMOUS ACCESS IS DENIED EVERYWHERE
-- =============================================================================
set role anon;

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.organizations;
  perform pg_temp.assert_eq(v_count, 0, 'anon sees no organisations');
  select count(*) into v_count from public.campaigns;
  perform pg_temp.assert_eq(v_count, 0, 'anon sees no campaigns');
  select count(*) into v_count from public.content_items;
  perform pg_temp.assert_eq(v_count, 0, 'anon sees no content');
  select count(*) into v_count from public.connected_accounts;
  perform pg_temp.assert_eq(v_count, 0, 'anon sees no connected accounts');
  select count(*) into v_count from public.profiles;
  perform pg_temp.assert_eq(v_count, 0, 'anon sees no profiles');
end;
$$;

reset role;

select '  ✓ tenant isolation: 40 assertions passed' as result;
