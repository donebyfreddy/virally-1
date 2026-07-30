-- =============================================================================
-- 0010 — ANALYTICS
--
-- Every metric table is read-only to clients. A user who could insert their own
-- analytics could fabricate the performance data the product's recommendations
-- are derived from.
--
-- Metrics are stored as SNAPSHOTS, not as mutable running totals. Platform APIs
-- return cumulative counters that can go down (a deleted comment, a retracted
-- view), arrive late, and be revised days later. Overwriting a single row loses
-- the ability to compute a delta for a period, which is exactly what every chart
-- needs. `metric_snapshots` is therefore append-only and time-series shaped.
--
-- Cross-platform normalisation is deliberately NOT done in the schema. A TikTok
-- "view" and a YouTube "view" are different events with different thresholds;
-- summing them into one number produces a figure that looks authoritative and
-- means nothing. Platform-level rows are stored as reported, and any comparison
-- surface must state its methodology.
-- =============================================================================

create table public.content_metrics (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  scheduled_post_id uuid not null references public.scheduled_posts (id) on delete cascade,
  connected_account_id uuid not null references public.connected_accounts (id) on delete cascade,
  content_variant_id uuid references public.content_variants (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  platform app.platform not null,

  -- The moment the platform's figures describe, truncated to the hour.
  captured_at timestamptz not null,

  -- Nullable throughout, and that is the point: platforms expose different
  -- subsets, and 0 would be a lie about a metric that was never reported. Every
  -- chart must distinguish "zero" from "not available".
  views bigint check (views is null or views >= 0),
  reach bigint check (reach is null or reach >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  likes bigint check (likes is null or likes >= 0),
  comments bigint check (comments is null or comments >= 0),
  shares bigint check (shares is null or shares >= 0),
  saves bigint check (saves is null or saves >= 0),
  clicks bigint check (clicks is null or clicks >= 0),
  followers_gained integer,
  -- Basis points (1/100th of a percent) as an integer, not a float percentage.
  -- Keeps aggregation exact and avoids 0.30000000000000004 in a UI.
  engagement_rate_bp integer check (engagement_rate_bp is null or engagement_rate_bp >= 0),
  completion_rate_bp integer check (completion_rate_bp is null or completion_rate_bp between 0 and 10000),
  average_watch_ms integer check (average_watch_ms is null or average_watch_ms >= 0),
  three_second_views bigint check (three_second_views is null or three_second_views >= 0),

  -- Retention curve as reported, when the platform provides one.
  retention_curve jsonb,

  -- Distinguishes real platform data from seeded demo rows. Every analytics
  -- surface reads this to decide whether the "Demo data" label is required, and
  -- demo rows are never mixed into a real total.
  origin app.output_origin not null default 'provider',

  created_at timestamptz not null default now(),

  -- One snapshot per post per hour. Makes a re-run of the metrics sync idempotent
  -- rather than inflating the series with duplicates.
  unique (scheduled_post_id, captured_at)
);

select app.apply_workspace_readonly_rls('public.content_metrics');

create index content_metrics_post_time_idx on public.content_metrics (scheduled_post_id, captured_at desc);
create index content_metrics_workspace_time_idx on public.content_metrics (workspace_id, captured_at desc);
create index content_metrics_campaign_idx on public.content_metrics (campaign_id, captured_at desc);
create index content_metrics_platform_idx on public.content_metrics (workspace_id, platform, captured_at desc);

-- -----------------------------------------------------------------------------
-- ACCOUNT METRICS
-- -----------------------------------------------------------------------------
create table public.account_metrics (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connected_account_id uuid not null references public.connected_accounts (id) on delete cascade,
  platform app.platform not null,

  captured_on date not null,

  follower_count bigint check (follower_count is null or follower_count >= 0),
  followers_gained integer,
  followers_lost integer,
  profile_views bigint,
  reach bigint,
  impressions bigint,
  total_views bigint,
  posts_published integer check (posts_published is null or posts_published >= 0),

  origin app.output_origin not null default 'provider',
  created_at timestamptz not null default now(),

  unique (connected_account_id, captured_on)
);

select app.apply_workspace_readonly_rls('public.account_metrics');

create index account_metrics_account_date_idx on public.account_metrics (connected_account_id, captured_on desc);
create index account_metrics_workspace_date_idx on public.account_metrics (workspace_id, captured_on desc);

-- -----------------------------------------------------------------------------
-- DAILY ROLLUP
--
-- Pre-aggregated per workspace/day/platform. The dashboard's KPI row and
-- timeline read this instead of scanning raw snapshots: with thousands of
-- snapshots the raw aggregate is too slow for a page load, and the brief forbids
-- pulling raw events into the browser to aggregate client-side.
--
-- Maintained by the metrics sync worker, and derivable from the tables above —
-- so a corrupted rollup can be rebuilt rather than being a second source of truth.
-- -----------------------------------------------------------------------------
create table public.analytics_daily (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day date not null,
  platform app.platform,
  brand_id uuid references public.brands (id) on delete set null,

  views bigint not null default 0,
  reach bigint not null default 0,
  engagements bigint not null default 0,
  followers_gained integer not null default 0,
  posts_published integer not null default 0,
  -- Averages stored as basis points, weighted by the worker at write time.
  avg_completion_bp integer,
  avg_engagement_bp integer,

  -- Demo rows are rolled up separately so they can never contaminate a real total.
  origin app.output_origin not null default 'provider',
  computed_at timestamptz not null default now(),

  unique (workspace_id, day, platform, brand_id, origin)
);

select app.apply_workspace_readonly_rls('public.analytics_daily');

create index analytics_daily_workspace_day_idx on public.analytics_daily (workspace_id, day desc);

-- -----------------------------------------------------------------------------
-- EXPERIMENTS
--
-- Note what is absent: no `p_value`, no `is_significant`. The brief forbids
-- claiming statistical significance without implementing a correct method, and a
-- boolean column named `is_significant` is the fastest way to end up asserting
-- one. `confidence_state` holds the honest vocabulary instead.
-- -----------------------------------------------------------------------------
create type app.experiment_confidence as enum (
  'no_data',
  'early_signal',
  'inconclusive',
  'promising',
  'enough_observations'
);

create table public.experiments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,

  name text not null,
  hypothesis text,
  variable text not null check (variable in
    ('hook', 'first_frame', 'duration', 'caption', 'cta', 'thumbnail', 'voice', 'music', 'platform', 'account', 'posting_time')),
  primary_metric text not null,
  secondary_metric text,

  status text not null default 'draft'
    check (status in ('draft', 'running', 'paused', 'concluded', 'abandoned')),
  confidence_state app.experiment_confidence not null default 'no_data',
  -- Prose, deliberately. A number here would be read as a guarantee.
  confidence_notes text,
  outcome_summary text,

  started_at timestamptz,
  ends_at timestamptz,
  min_observations integer check (min_observations is null or min_observations > 0),
  concluded_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.experiments');
select app.apply_workspace_rls('public.experiments', 'campaign.manage', 'content.delete');

create table public.experiment_variants (
  id uuid primary key default extensions.gen_random_uuid(),
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_variant_id uuid references public.content_variants (id) on delete set null,
  label text not null,
  is_control boolean not null default false,
  created_at timestamptz not null default now(),
  unique (experiment_id, label)
);

select app.apply_workspace_rls('public.experiment_variants', 'campaign.manage', 'content.delete');

-- Exactly one control per experiment: a comparison without a baseline is not one.
create unique index experiment_variants_one_control
  on public.experiment_variants (experiment_id)
  where is_control;

-- -----------------------------------------------------------------------------
-- LEARNING INSIGHTS
--
-- `evidence` is not decoration. The post-analytics screen must say "not enough
-- data to make a reliable recommendation" rather than inventing an explanation,
-- so an insight row that cannot cite the observations behind it is rejected by
-- the constraint below.
-- -----------------------------------------------------------------------------
create table public.learning_insights (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  content_variant_id uuid references public.content_variants (id) on delete set null,

  kind text not null check (kind in ('what_worked', 'what_lost_attention', 'what_to_test')),
  statement text not null,
  -- The observations this claim rests on: sample size, metric, comparison basis.
  evidence jsonb not null,
  observation_count integer not null check (observation_count >= 0),
  confidence_state app.experiment_confidence not null default 'early_signal',

  origin app.output_origin not null default 'mock',
  created_at timestamptz not null default now(),

  -- An insight with no observations behind it is a fabrication. The database
  -- refuses to store one.
  constraint learning_insights_needs_evidence
    check (observation_count > 0 and evidence <> '{}'::jsonb)
);

select app.apply_workspace_readonly_rls('public.learning_insights');

create index learning_insights_variant_idx on public.learning_insights (content_variant_id);
create index learning_insights_campaign_idx on public.learning_insights (campaign_id);
