-- =============================================================================
-- 0005 — CAMPAIGNS
--
-- A campaign is the parent object for generation, publishing and analytics. The
-- ten pipeline stages are modelled as a status column plus a per-stage progress
-- table, not as a single "stage" integer: stages can be blocked independently
-- and a blocked stage needs a reason attached to it.
-- =============================================================================

create type app.campaign_stage as enum (
  'brief',
  'concepts',
  'scripts',
  'storyboards',
  'assets',
  'editing',
  'approval',
  'schedule',
  'publish',
  'learn'
);

create type app.stage_state as enum (
  'pending',
  'active',
  'complete',
  'blocked',
  'skipped'
);

create type app.generation_mode as enum (
  'quick',
  'campaign',
  'repurpose',
  'product',
  'account_launch',
  'batch_studio'
);

create table public.campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,

  name text not null check (length(trim(name)) between 1 and 200),
  objective text,
  mode app.generation_mode not null default 'campaign',
  status app.review_status not null default 'draft',

  -- Scheduling window. Checked rather than trusted: an inverted range silently
  -- produces a publish plan with no slots in it.
  starts_on date,
  ends_on date,
  constraint campaigns_date_range check (ends_on is null or starts_on is null or ends_on >= starts_on),

  languages text[] not null default '{en}',
  platforms app.platform[] not null default '{}',

  -- Denormalised counters, maintained by the job workers. Present so the campaign
  -- list can render progress without an aggregate over content_items per row —
  -- with 100 campaigns that is 100 subqueries per page load.
  concepts_count integer not null default 0 check (concepts_count >= 0),
  content_count integer not null default 0 check (content_count >= 0),
  published_count integer not null default 0 check (published_count >= 0),

  -- Cost accounting in integer minor units. Never floats: repeated float
  -- addition across thousands of generation runs accumulates visible error, and
  -- this figure is shown to users as money.
  estimated_cost_cents integer not null default 0 check (estimated_cost_cents >= 0),
  actual_cost_cents integer not null default 0 check (actual_cost_cents >= 0),

  archived_at timestamptz,
  deleted_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.campaigns');
select app.apply_workspace_rls('public.campaigns', 'campaign.manage', 'assets.delete');

create index campaigns_workspace_status_idx
  on public.campaigns (workspace_id, status, created_at desc)
  where deleted_at is null;
create index campaigns_brand_idx on public.campaigns (brand_id) where deleted_at is null;
-- Trigram index for the command palette's campaign search.
create index campaigns_name_trgm_idx on public.campaigns using gin (name extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- CAMPAIGN BRIEFS
--
-- The structured brief derived from the user's prompt. Versioned rather than
-- updated in place: regenerating from an edited brief must not destroy the
-- record of what produced the content that already exists.
-- -----------------------------------------------------------------------------
create table public.campaign_briefs (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null default 1 check (version >= 1),

  raw_prompt text,
  -- Where the input came from: a URL, an upload, a library asset.
  source_kind text check (source_kind in ('prompt', 'website', 'product', 'document', 'video', 'audio', 'image', 'library')),
  source_url text,
  source_asset_id uuid,

  -- Structured output of the brief stage.
  audience text,
  tone text,
  key_messages text[] not null default '{}',
  content_pillars text[] not null default '{}',
  call_to_action text,

  -- Imported website and document text is untrusted input that will be placed in
  -- an LLM prompt. This flag records that the sanitiser ran, so a later
  -- generation step can refuse to proceed on unsanitised text rather than
  -- assuming it was handled upstream.
  external_text_sanitised boolean not null default false,

  is_current boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, version)
);

select app.attach_touch_trigger('public.campaign_briefs');
select app.apply_workspace_rls('public.campaign_briefs', 'campaign.manage', 'assets.delete');

create unique index campaign_briefs_one_current
  on public.campaign_briefs (campaign_id)
  where is_current;

-- -----------------------------------------------------------------------------
-- CAMPAIGN STAGE PROGRESS
-- One row per stage per campaign, so the pipeline visual reads real state and a
-- blocked stage carries its reason.
-- -----------------------------------------------------------------------------
create table public.campaign_stages (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  stage app.campaign_stage not null,
  state app.stage_state not null default 'pending',
  blocked_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, stage),
  -- A blocked stage without a reason produces the "Something went wrong" screen
  -- the brief forbids, so the database refuses to store one.
  constraint campaign_stages_blocked_needs_reason
    check (state <> 'blocked' or blocked_reason is not null)
);

select app.attach_touch_trigger('public.campaign_stages');
select app.apply_workspace_rls('public.campaign_stages', 'campaign.manage', 'assets.delete');

-- -----------------------------------------------------------------------------
-- CAMPAIGN TARGETS
-- Which platforms and which authorised accounts a campaign publishes to.
-- -----------------------------------------------------------------------------
create table public.campaign_platforms (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform app.platform not null,
  aspect_ratios app.aspect_ratio[] not null default '{9:16}',
  created_at timestamptz not null default now(),
  unique (campaign_id, platform)
);

select app.apply_workspace_rls('public.campaign_platforms', 'campaign.manage', 'assets.delete');
