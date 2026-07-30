-- =============================================================================
-- 0003 — RLS POLICY GENERATOR
--
-- WHY A GENERATOR RATHER THAN EXPLICIT POLICIES
--
-- The schema has ~45 tenant-owned tables. Written out, that is ~180 policies
-- that are textually near-identical. The failure mode of doing it by hand is not
-- verbosity — it is that policy number 137 gets `organization_id` where it
-- needed `workspace_id`, and nothing fails loudly. A silent cross-tenant read is
-- the worst bug this system can have.
--
-- These functions make the standard patterns declarative and identical by
-- construction. The special cases — OAuth tokens, membership tables, the usage
-- ledger, audit logs — still get hand-written policies, because they are the
-- ones where the standard pattern is wrong.
--
-- Every generated policy is inspectable after the fact:
--     select tablename, policyname, cmd, qual from pg_policies
--     where schemaname = 'public' order by tablename;
--
-- and 0017 asserts that no exposed tenant table escaped without RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Workspace-scoped tables: the common case.
--
-- Requires a `workspace_id` column. Read access follows workspace membership;
-- writes require a named permission, so an editor can create content while a
-- reviewer cannot, from the same generated policy set.
-- -----------------------------------------------------------------------------
create or replace function app.apply_workspace_rls(
  p_table regclass,
  p_write_permission app.permission default 'content.create',
  p_delete_permission app.permission default 'assets.delete'
)
returns void
language plpgsql
as $$
declare
  v_table text := p_table::text;
  -- Read the bare table name from the catalogue, NOT from `regclass::text`.
  -- `regclass::text` omits the schema when it is on the search_path, so
  -- `'public.campaigns'::regclass::text` is `campaigns` and a split on '.' yields
  -- an empty string — which silently named every generated index `_workspace_idx`
  -- and collapsed thirty-odd indexes into one. Verified by assertion 4 in 0014.
  v_name  text := (select c.relname from pg_class c where c.oid = p_table);
begin
  -- `format` with %I/%L throughout: these identifiers come from migration code
  -- rather than user input, but a generator that concatenates SQL strings is a
  -- pattern that gets copied to somewhere it does matter.
  execute format('alter table %s enable row level security', v_table);
  execute format('alter table %s force row level security', v_table);

  execute format($f$
    create policy %I on %s
      for select to authenticated
      using (app.is_workspace_member(workspace_id))
  $f$, v_name || '_select', v_table);

  execute format($f$
    create policy %I on %s
      for insert to authenticated
      with check (app.has_workspace_permission(workspace_id, %L))
  $f$, v_name || '_insert', v_table, p_write_permission);

  execute format($f$
    create policy %I on %s
      for update to authenticated
      using (app.has_workspace_permission(workspace_id, %L))
      with check (app.has_workspace_permission(workspace_id, %L))
  $f$, v_name || '_update', v_table, p_write_permission, p_write_permission);

  execute format($f$
    create policy %I on %s
      for delete to authenticated
      using (app.has_workspace_permission(workspace_id, %L))
  $f$, v_name || '_delete', v_table, p_delete_permission);

  -- The index that keeps the SELECT policy off a sequential scan.
  execute format(
    'create index if not exists %I on %s (workspace_id)',
    v_name || '_workspace_idx', v_table
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Organisation-scoped tables: things that are not per-workspace, such as
-- subscriptions and account groups shared across a client's workspaces.
-- -----------------------------------------------------------------------------
create or replace function app.apply_org_rls(
  p_table regclass,
  p_write_permission app.permission default 'campaign.manage',
  p_delete_permission app.permission default 'assets.delete'
)
returns void
language plpgsql
as $$
declare
  v_table text := p_table::text;
  -- Read the bare table name from the catalogue, NOT from `regclass::text`.
  -- `regclass::text` omits the schema when it is on the search_path, so
  -- `'public.campaigns'::regclass::text` is `campaigns` and a split on '.' yields
  -- an empty string — which silently named every generated index `_workspace_idx`
  -- and collapsed thirty-odd indexes into one. Verified by assertion 4 in 0014.
  v_name  text := (select c.relname from pg_class c where c.oid = p_table);
begin
  execute format('alter table %s enable row level security', v_table);
  execute format('alter table %s force row level security', v_table);

  execute format($f$
    create policy %I on %s
      for select to authenticated
      using (app.is_org_member(organization_id))
  $f$, v_name || '_select', v_table);

  execute format($f$
    create policy %I on %s
      for insert to authenticated
      with check (app.has_org_permission(organization_id, %L))
  $f$, v_name || '_insert', v_table, p_write_permission);

  execute format($f$
    create policy %I on %s
      for update to authenticated
      using (app.has_org_permission(organization_id, %L))
      with check (app.has_org_permission(organization_id, %L))
  $f$, v_name || '_update', v_table, p_write_permission, p_write_permission);

  execute format($f$
    create policy %I on %s
      for delete to authenticated
      using (app.has_org_permission(organization_id, %L))
  $f$, v_name || '_delete', v_table, p_delete_permission);

  execute format(
    'create index if not exists %I on %s (organization_id)',
    v_name || '_organization_idx', v_table
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Read-only tenant tables: rows the *system* produces and a user may only read.
--
-- Metrics, job events, provider runs, audit entries. Writes come exclusively
-- from workers holding the service-role key, which bypasses RLS. Granting a
-- client INSERT here would let a user fabricate their own analytics.
-- -----------------------------------------------------------------------------
create or replace function app.apply_workspace_readonly_rls(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_table text := p_table::text;
  -- Read the bare table name from the catalogue, NOT from `regclass::text`.
  -- `regclass::text` omits the schema when it is on the search_path, so
  -- `'public.campaigns'::regclass::text` is `campaigns` and a split on '.' yields
  -- an empty string — which silently named every generated index `_workspace_idx`
  -- and collapsed thirty-odd indexes into one. Verified by assertion 4 in 0014.
  v_name  text := (select c.relname from pg_class c where c.oid = p_table);
begin
  execute format('alter table %s enable row level security', v_table);
  execute format('alter table %s force row level security', v_table);

  execute format($f$
    create policy %I on %s
      for select to authenticated
      using (app.is_workspace_member(workspace_id))
  $f$, v_name || '_select', v_table);

  execute format(
    'create index if not exists %I on %s (workspace_id)',
    v_name || '_workspace_idx', v_table
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Child tables reached through a parent.
--
-- Script segments, storyboard shots, composition tracks and experiment variants
-- carry no tenant column of their own — denormalising one onto every child row
-- creates a second source of truth that can disagree with the parent. Instead
-- the policy joins to the parent and reuses its check.
-- -----------------------------------------------------------------------------
create or replace function app.apply_child_rls(
  p_table regclass,
  p_parent_table text,
  p_fk_column text,
  p_write_permission app.permission default 'content.create'
)
returns void
language plpgsql
as $$
declare
  v_table text := p_table::text;
  -- See the note in app.apply_workspace_rls: never derive this from regclass::text.
  v_name  text := (select c.relname from pg_class c where c.oid = p_table);
  v_visible text;
  v_writable text;
begin
  execute format('alter table %s enable row level security', v_table);
  execute format('alter table %s force row level security', v_table);

  v_visible := format(
    'exists (select 1 from public.%I p where p.id = %I and app.is_workspace_member(p.workspace_id))',
    p_parent_table, p_fk_column
  );
  v_writable := format(
    'exists (select 1 from public.%I p where p.id = %I and app.has_workspace_permission(p.workspace_id, %L))',
    p_parent_table, p_fk_column, p_write_permission
  );

  execute format('create policy %I on %s for select to authenticated using (%s)',
    v_name || '_select', v_table, v_visible);
  execute format('create policy %I on %s for insert to authenticated with check (%s)',
    v_name || '_insert', v_table, v_writable);
  execute format('create policy %I on %s for update to authenticated using (%s) with check (%s)',
    v_name || '_update', v_table, v_writable, v_writable);
  execute format('create policy %I on %s for delete to authenticated using (%s)',
    v_name || '_delete', v_table, v_writable);

  -- The join in every one of those policies runs on this column.
  execute format('create index if not exists %I on %s (%I)',
    v_name || '_' || p_fk_column || '_idx', v_table, p_fk_column);
end;
$$;

comment on function app.apply_workspace_rls is
  'Standard workspace-scoped tenant policies + workspace_id index. See 0003 for why this is generated.';
comment on function app.apply_child_rls is
  'Policies for a child table with no tenant column; authorises via its parent.';
