-- =============================================================================
-- 0014 — PLATFORM CAPABILITY SEED + SCHEMA ASSERTIONS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PLATFORM CAPABILITIES
--
-- Seeded conservatively: `is_supported` is only true where the official API
-- genuinely offers the capability, and `requires_app_review` is true wherever a
-- platform gates production access behind review. These values drive the honest
-- connector states ("Configuration required", "Awaiting platform approval"), so
-- an optimistic value here becomes a lie in the UI.
--
-- Limits change. Verify against current platform documentation before relying on
-- a number in a user-facing statement; that is why this is data and not code.
-- -----------------------------------------------------------------------------
insert into public.platform_capabilities
  (platform, account_kind, capability, is_supported, requires_app_review,
   max_duration_seconds, max_file_size_mb, supported_ratios, notes)
values
  -- Instagram: publishing requires a professional account linked to a Facebook
  -- Page, and the Content Publishing API requires app review.
  ('instagram', 'business', 'publish_video', true, true, 900, 1024, '{9:16,1:1,4:5}',
   'Reels via Content Publishing API. Requires a professional account and app review.'),
  ('instagram', 'business', 'publish_image', true, true, null, 8, '{1:1,4:5,9:16}', null),
  ('instagram', 'business', 'publish_carousel', true, true, null, 8, '{1:1,4:5}',
   'Up to 10 items per carousel.'),
  ('instagram', 'business', 'schedule_native', false, false, null, null, '{}',
   'No native scheduling in the API. Virally holds the schedule and publishes at the target time.'),
  ('instagram', 'business', 'read_insights', true, true, null, null, '{}', null),
  ('instagram', 'personal', 'publish_video', false, false, null, null, '{}',
   'Personal accounts cannot be published to via the official API. Convert to a professional account.'),

  -- Facebook Pages.
  ('facebook', 'page', 'publish_video', true, true, 14400, 10240, '{9:16,16:9,1:1}', null),
  ('facebook', 'page', 'publish_image', true, true, null, 30, '{1:1,4:5,16:9}', null),
  ('facebook', 'page', 'schedule_native', true, true, null, null, '{}',
   'Pages support native scheduled publishing.'),
  ('facebook', 'page', 'read_insights', true, true, null, null, '{}', null),

  -- TikTok: unaudited apps can only post to the creator's own private drafts.
  ('tiktok', 'creator', 'publish_video', true, true, 600, 4096, '{9:16}',
   'Direct Post requires audited access. Unaudited apps are limited to private/self-only posts.'),
  ('tiktok', 'creator', 'publish_image', true, true, null, 20, '{9:16,1:1}', null),
  ('tiktok', 'creator', 'draft_upload', true, false, 600, 4096, '{9:16}',
   'Upload to drafts is available before full audit.'),
  ('tiktok', 'creator', 'schedule_native', false, false, null, null, '{}', null),
  ('tiktok', 'creator', 'read_insights', true, true, null, null, '{}', null),

  -- YouTube: quota-limited rather than review-gated for upload.
  ('youtube', 'channel', 'publish_video', true, false, 43200, 262144, '{9:16,16:9}',
   'Shorts are inferred from vertical ratio and duration under 3 minutes. Uploads consume significant daily quota.'),
  ('youtube', 'channel', 'publish_image', false, false, null, null, '{}',
   'No standalone image posts via the Data API.'),
  ('youtube', 'channel', 'schedule_native', true, false, null, null, '{}',
   'Native scheduling via privacyStatus and publishAt.'),
  ('youtube', 'channel', 'set_thumbnail', true, false, null, 2, '{16:9}',
   'Custom thumbnails require a verified channel.'),
  ('youtube', 'channel', 'read_insights', true, false, null, null, '{}',
   'YouTube Analytics API; some metrics have a reporting delay.')
on conflict (platform, account_kind, capability) do nothing;

-- =============================================================================
-- SCHEMA ASSERTIONS
--
-- These run as part of the migration, so a future change that breaks one of the
-- product's hard rules fails `db push` rather than shipping. They are cheap
-- catalogue queries, not tests — the point is that they cannot be skipped.
-- =============================================================================

do $$
declare
  v_missing text[];
begin
  -- ASSERTION 1 — every table in the exposed `public` schema has RLS enabled.
  --
  -- This is the one that matters most. A new tenant table added without RLS is
  -- readable by every authenticated user in every organisation, and nothing in
  -- normal use would reveal it.
  select array_agg(c.relname order by c.relname) into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_missing is not null then
    raise exception
      'RLS is not enabled on public table(s): %. Every exposed tenant table must enable row level security.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

do $$
declare
  v_offenders text[];
begin
  -- ASSERTION 2 — no table stores a social platform password.
  --
  -- Virally connects accounts through official authorisation flows and never asks
  -- for social credentials. This makes that a property of the schema rather than a
  -- promise in a document.
  --
  -- `access_token_encrypted` and `refresh_token_encrypted` are OAuth material, not
  -- passwords, and are excluded by name.
  select array_agg(format('%s.%s', c.relname, a.attname) order by c.relname, a.attname)
    into v_offenders
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attnum > 0
    and not a.attisdropped
    and (a.attname ~* 'password' or a.attname ~* 'passwd' or a.attname ~* '(^|_)secret($|_)')
    and a.attname not in ('access_token_encrypted', 'refresh_token_encrypted');

  if v_offenders is not null then
    raise exception
      'Password-like column(s) found: %. Virally never stores social credentials — use the OAuth flow.',
      array_to_string(v_offenders, ', ');
  end if;
end;
$$;

do $$
declare
  v_policy_count integer;
begin
  -- ASSERTION 3 — the OAuth token table has no policies for client roles.
  --
  -- RLS enabled with zero policies denies all client access while the service role
  -- still bypasses it. A well-meaning future "let users see their own tokens"
  -- policy would turn a compromised browser session into an account takeover.
  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'oauth_connections';

  if v_policy_count > 0 then
    raise exception
      'oauth_connections has % policy/policies. It must have none: platform tokens are service-role only. See 0008.',
      v_policy_count;
  end if;
end;
$$;

do $$
declare
  v_missing text[];
begin
  -- ASSERTION 4 — every tenant column a POLICY ACTUALLY FILTERS ON is indexed.
  --
  -- Policy predicates are evaluated per candidate row, so an unindexed column in a
  -- policy turns every query on that table into a sequential scan. This is the
  -- most common cause of a "Supabase suddenly got slow" report.
  --
  -- Scoped to columns genuinely referenced in a policy expression, rather than to
  -- every column merely *named* workspace_id or organization_id. The broader check
  -- was tried first and demanded ~30 indexes on `organization_id` columns of
  -- workspace-scoped tables, whose policies filter on `workspace_id` alone. Those
  -- indexes would be written on every insert and read by nothing — a real cost
  -- for no benefit. An index that no query plan uses is not free.
  --
  -- Child tables (script_segments, shots, composition_clips) reference no tenant
  -- column at all; they authorise by joining to a parent, and the index that
  -- matters there is on the foreign key, which the generator creates.
  select array_agg(format('%s.%s', t.relname, t.col) order by t.relname, t.col)
    into v_missing
  from (
    select distinct c.oid, c.relname, a.attname as col, a.attnum
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_policy pol on pol.polrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attnum > 0
      and not a.attisdropped
      and a.attname in ('workspace_id', 'organization_id', 'user_id')
      -- Does this policy's USING or WITH CHECK expression mention the column?
      and (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') like '%' || a.attname || '%'
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') like '%' || a.attname || '%'
      )
  ) t
  where not exists (
    select 1
    from pg_index i
    where i.indrelid = t.oid
      -- Leading column only: an index on (status, workspace_id) does not help a
      -- predicate on workspace_id alone.
      and i.indkey[0] = t.attnum
  );

  if v_missing is not null then
    raise exception
      'Tenant column(s) used in an RLS policy but not indexed: %. Add a leading index.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;
