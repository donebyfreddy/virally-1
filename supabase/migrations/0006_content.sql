-- =============================================================================
-- 0006 — CONTENT
--
-- concepts → hooks → content items → variants, plus scripts, storyboards and
-- shots.
--
-- The shape that matters: a *variant* is the unit that gets published, and it
-- carries its own platform, ratio, language and account. That is what makes
-- "100 videos across 4 platforms in 3 languages" a row count rather than a
-- special case, and what lets the duplicate-content check compare real records.
-- =============================================================================

create table public.content_concepts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,

  position integer not null default 0,
  title text not null,
  angle text,
  summary text,
  status app.review_status not null default 'draft',

  -- Records whether a real provider or the mock produced this. Read by every
  -- surface that must decide whether to show the "Demo data" label.
  origin app.output_origin not null default 'mock',

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.content_concepts');
select app.apply_workspace_rls('public.content_concepts', 'content.create', 'content.delete');

create index content_concepts_campaign_idx
  on public.content_concepts (campaign_id, position);

-- -----------------------------------------------------------------------------
-- HOOKS
-- The first 1–3 seconds. Separated from the concept because hook performance is
-- compared across variants in the experiments module — it needs its own identity
-- and its own metrics, not a string on a parent row.
-- -----------------------------------------------------------------------------
create table public.content_hooks (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  concept_id uuid not null references public.content_concepts (id) on delete cascade,
  label text not null,
  text text not null,
  position integer not null default 0,
  origin app.output_origin not null default 'mock',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.content_hooks');
select app.apply_workspace_rls('public.content_hooks', 'content.create', 'content.delete');

create index content_hooks_concept_idx on public.content_hooks (concept_id, position);

-- -----------------------------------------------------------------------------
-- CONTENT ITEMS
-- One creative idea in one language: the thing an editor opens in the studio.
-- Platform-specific renditions of it are `content_variants`.
-- -----------------------------------------------------------------------------
create table public.content_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  concept_id uuid references public.content_concepts (id) on delete set null,
  hook_id uuid references public.content_hooks (id) on delete set null,
  brand_id uuid references public.brands (id) on delete set null,

  title text not null default 'Untitled',
  content_type text not null default 'short_video'
    check (content_type in ('short_video', 'long_video', 'image', 'carousel', 'text')),
  language text not null default 'en',
  status app.review_status not null default 'draft',

  -- Canonical duration in milliseconds. Integer, because seconds-as-float turns
  -- frame-accurate trim points into off-by-one rendering bugs.
  duration_ms integer check (duration_ms is null or duration_ms > 0),

  caption text,
  call_to_action text,

  origin app.output_origin not null default 'mock',

  -- Optimistic-concurrency token for the studio's autosave. Incremented by the
  -- application on each save; a mismatch means another editor saved first and the
  -- client must reconcile rather than silently overwrite.
  revision integer not null default 1 check (revision >= 1),

  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.content_items');
select app.apply_workspace_rls('public.content_items', 'content.create', 'content.delete');

create index content_items_workspace_status_idx
  on public.content_items (workspace_id, status, updated_at desc)
  where deleted_at is null;
create index content_items_campaign_idx on public.content_items (campaign_id) where deleted_at is null;
create index content_items_concept_idx on public.content_items (concept_id);

-- -----------------------------------------------------------------------------
-- CONTENT VARIANTS
-- The publishable unit: this item, recomposed for one platform at one ratio for
-- one account.
-- -----------------------------------------------------------------------------
create table public.content_variants (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_item_id uuid not null references public.content_items (id) on delete cascade,

  platform app.platform not null,
  aspect_ratio app.aspect_ratio not null default '9:16',
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  language text not null default 'en',

  -- Per-platform overrides. Null means "inherit from the content item", so a
  -- caption edited for TikTok does not silently change the Instagram post.
  caption_override text,
  title_override text,
  call_to_action_override text,

  -- Format adaptation is never a blind centre crop. These carry the per-ratio
  -- layout decisions: subject focus, safe-area insets, text and CTA placement.
  layout_overrides jsonb not null default '{}'::jsonb,

  rendered_asset_id uuid,
  thumbnail_asset_id uuid,

  status app.review_status not null default 'draft',
  origin app.output_origin not null default 'mock',

  -- Content fingerprint over the rendered media, used by the duplicate-content
  -- warning before a batch publish. Nullable because it only exists post-render.
  content_hash text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One variant per item per platform/ratio/language. This is what makes a
  -- retried batch-generation job idempotent instead of producing duplicates.
  unique (content_item_id, platform, aspect_ratio, language)
);

select app.attach_touch_trigger('public.content_variants');
select app.apply_workspace_rls('public.content_variants', 'content.create', 'content.delete');

create index content_variants_item_idx on public.content_variants (content_item_id);
create index content_variants_platform_idx on public.content_variants (workspace_id, platform, status);
-- Powers the duplicate-asset warning.
create index content_variants_hash_idx on public.content_variants (workspace_id, content_hash)
  where content_hash is not null;

-- -----------------------------------------------------------------------------
-- SCRIPTS AND SEGMENTS
-- Segmented so a single shot can be regenerated without touching the rest — the
-- brief's requirement that changing one shot must not regenerate the campaign.
-- -----------------------------------------------------------------------------
create table public.scripts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  is_current boolean not null default true,
  full_text text,
  word_count integer,
  origin app.output_origin not null default 'mock',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, version)
);

select app.attach_touch_trigger('public.scripts');
select app.apply_workspace_rls('public.scripts', 'content.create', 'content.delete');

create unique index scripts_one_current on public.scripts (content_item_id) where is_current;

create table public.script_segments (
  id uuid primary key default extensions.gen_random_uuid(),
  script_id uuid not null references public.scripts (id) on delete cascade,
  position integer not null,
  role text not null default 'body' check (role in ('hook', 'body', 'cta', 'outro')),
  text text not null,
  start_ms integer check (start_ms is null or start_ms >= 0),
  end_ms integer check (end_ms is null or end_ms >= 0),
  constraint script_segments_time_order check (end_ms is null or start_ms is null or end_ms > start_ms),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (script_id, position)
);

select app.attach_touch_trigger('public.script_segments');
-- No tenant column: authorised through the parent script. See 0003.
select app.apply_child_rls('public.script_segments', 'scripts', 'script_id', 'content.create');

-- -----------------------------------------------------------------------------
-- STORYBOARDS AND SHOTS
-- -----------------------------------------------------------------------------
create table public.storyboards (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  is_current boolean not null default true,
  origin app.output_origin not null default 'mock',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, version)
);

select app.attach_touch_trigger('public.storyboards');
select app.apply_workspace_rls('public.storyboards', 'content.create', 'content.delete');

create unique index storyboards_one_current on public.storyboards (content_item_id) where is_current;

create table public.shots (
  id uuid primary key default extensions.gen_random_uuid(),
  storyboard_id uuid not null references public.storyboards (id) on delete cascade,
  script_segment_id uuid references public.script_segments (id) on delete set null,
  position integer not null,
  description text,
  visual_prompt text,
  camera text,
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  -- Per-shot media, so regenerating one shot replaces one asset.
  asset_id uuid,
  status app.job_status not null default 'pending',
  origin app.output_origin not null default 'mock',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storyboard_id, position)
);

select app.attach_touch_trigger('public.shots');
select app.apply_child_rls('public.shots', 'storyboards', 'storyboard_id', 'content.create');
