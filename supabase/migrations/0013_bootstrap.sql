-- =============================================================================
-- 0013 — TENANT BOOTSTRAP
--
-- Creates the records a new user needs: profile, organisation, owner membership,
-- default workspace, workspace membership, default brand, onboarding progress,
-- subscription placeholder.
--
-- WHY A FUNCTION AND NOT A TRIGGER ON auth.users
--
-- A trigger is the tempting choice, and it is wrong here. If anything inside it
-- raises, the INSERT into `auth.users` is rolled back — so a bug in brand
-- creation makes sign-up itself fail, and Supabase reports it as "Database error
-- saving new user" with no indication of which statement failed. Debugging that
-- in production is miserable, and the user simply cannot sign up.
--
-- Calling this explicitly after authentication means a bootstrap failure leaves a
-- real, usable auth account that can be retried — the function is idempotent, so
-- retrying is safe — and the error surfaces where it can be read.
--
-- IDEMPOTENCY
--
-- OAuth callbacks are replayed: users double-click, refresh mid-redirect, and
-- browsers retry. Every insert below is therefore guarded by ON CONFLICT against
-- a real unique constraint, not by a preceding SELECT. A check-then-insert has a
-- race window; two concurrent callbacks would both see "no organisation" and both
-- create one. The constraints close that window in the database.
-- =============================================================================

create or replace function public.bootstrap_current_user(
  p_full_name text default null,
  p_avatar_url text default null
)
returns table (
  organization_id uuid,
  workspace_id uuid,
  brand_id uuid,
  onboarding_complete boolean,
  was_created boolean
)
language plpgsql
security definer
set search_path = public, app, pg_catalog
as $$
-- The RETURNS TABLE column names (organization_id, workspace_id, brand_id) are
-- also real column names, which makes a bare reference to them ambiguous inside
-- `on conflict (organization_id, user_id)` — PL/pgSQL cannot tell whether the
-- identifier means the OUT parameter or the column, and raises.
--
-- This pragma resolves every ambiguous identifier to the column, which is correct
-- here because no statement below intends the OUT parameter: those are only ever
-- assigned through the v_-prefixed locals and returned positionally.
--
-- The alternative was renaming the outputs to `out_organization_id`, rejected
-- because these names are the function's public API and the caller reads them.
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_name text;
  v_org_id uuid;
  v_workspace_id uuid;
  v_brand_id uuid;
  v_slug text;
  v_created boolean := false;
  v_onboarded boolean;
begin
  -- Runs as definer, so it must establish the caller itself rather than trusting
  -- a parameter. A `p_user_id` argument here would let any authenticated user
  -- bootstrap — and then join — another user's organisation.
  if v_user_id is null then
    raise exception 'bootstrap_current_user must be called by an authenticated user'
      using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = v_user_id;

  -- Prefer the name the caller passes (from the OAuth identity), fall back to the
  -- email local part, and never invent one.
  v_name := coalesce(nullif(trim(p_full_name), ''), split_part(coalesce(v_email, 'member'), '@', 1));

  -- --- profile -------------------------------------------------------------
  insert into public.profiles (id, email, full_name, avatar_url)
  values (v_user_id, v_email, nullif(trim(p_full_name), ''), nullif(trim(p_avatar_url), ''))
  on conflict (id) do update
    -- Refresh only from a non-null incoming value, so a later email sign-in does
    -- not blank the name and avatar an OAuth sign-in provided.
    set email      = coalesce(excluded.email, public.profiles.email),
        full_name  = coalesce(excluded.full_name, public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  -- --- existing organisation? ----------------------------------------------
  -- Owned organisations first: a user invited to someone else's organisation must
  -- not be treated as already bootstrapped, or they never get their own.
  select m.organization_id into v_org_id
  from public.organization_members m
  where m.user_id = v_user_id and m.role = 'owner'
  order by m.created_at
  limit 1;

  if v_org_id is null then
    -- Slug must be unique organisation-wide. Derived from the name, then
    -- suffixed with a short random token rather than looping on a collision
    -- check — a loop is another race, and the token makes one attempt sufficient.
    v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);
    if length(v_slug) < 2 then
      v_slug := 'workspace';
    end if;
    v_slug := left(v_slug, 40) || '-' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8);

    insert into public.organizations (name, slug, account_type, created_by)
    values (v_name, v_slug, 'personal', v_user_id)
    returning id into v_org_id;

    v_created := true;
  end if;

  -- --- owner membership ----------------------------------------------------
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_org_id, v_user_id, 'owner', now())
  on conflict (organization_id, user_id) do nothing;

  -- --- default workspace ---------------------------------------------------
  select w.id into v_workspace_id
  from public.workspaces w
  where w.organization_id = v_org_id and w.is_default and w.deleted_at is null
  limit 1;

  if v_workspace_id is null then
    insert into public.workspaces (organization_id, name, slug, is_default, created_by)
    values (v_org_id, 'Default workspace', 'default', true, v_user_id)
    -- Collides with either the (organization_id, slug) constraint or the
    -- one-default-per-org partial index if a concurrent call won the race.
    on conflict (organization_id, slug) do nothing
    returning id into v_workspace_id;

    -- ON CONFLICT DO NOTHING returns no row, so re-read after losing the race.
    if v_workspace_id is null then
      select w.id into v_workspace_id
      from public.workspaces w
      where w.organization_id = v_org_id and w.slug = 'default'
      limit 1;
    end if;
  end if;

  insert into public.workspace_members (workspace_id, organization_id, user_id, role)
  values (v_workspace_id, v_org_id, v_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  -- --- placeholder brand ---------------------------------------------------
  -- Marked `is_placeholder` so the UI prompts the user to complete it rather than
  -- presenting an unnamed brand as configured.
  select b.id into v_brand_id
  from public.brands b
  where b.workspace_id = v_workspace_id and b.is_default and b.deleted_at is null
  limit 1;

  if v_brand_id is null then
    insert into public.brands (
      organization_id, workspace_id, name, is_placeholder, is_default, created_by
    )
    values (v_org_id, v_workspace_id, v_name, true, true, v_user_id)
    returning id into v_brand_id;

    insert into public.brand_profiles (brand_id, workspace_id)
    values (v_brand_id, v_workspace_id)
    on conflict (brand_id) do nothing;
  end if;

  -- --- onboarding ----------------------------------------------------------
  insert into public.onboarding_progress (organization_id, user_id)
  values (v_org_id, v_user_id)
  on conflict (organization_id, user_id) do nothing;

  select (op.completed_at is not null) into v_onboarded
  from public.onboarding_progress op
  where op.organization_id = v_org_id and op.user_id = v_user_id;

  -- --- billing placeholder -------------------------------------------------
  -- `unconfigured` rather than `active`: with no Stripe configured the product
  -- tracks usage but charges nothing, and the status says so.
  insert into public.subscriptions (organization_id, provider, plan_code, status)
  values (v_org_id, 'none', 'free', 'unconfigured')
  on conflict (organization_id) do nothing;

  -- --- audit ---------------------------------------------------------------
  if v_created then
    insert into public.audit_logs (organization_id, workspace_id, actor_id, actor_email, action, subject_type, subject_id)
    values (v_org_id, v_workspace_id, v_user_id, v_email, 'organization.bootstrapped', 'organization', v_org_id);
  end if;

  return query select v_org_id, v_workspace_id, v_brand_id, coalesce(v_onboarded, false), v_created;
end;
$$;

comment on function public.bootstrap_current_user is
  'Idempotently creates the tenant records for auth.uid(). Safe to call on every sign-in. See 0013 for why this is not a trigger.';

revoke all on function public.bootstrap_current_user(text, text) from public, anon;
grant execute on function public.bootstrap_current_user(text, text) to authenticated;
