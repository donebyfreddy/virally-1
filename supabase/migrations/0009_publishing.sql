-- =============================================================================
-- 0009 — PUBLISHING
--
-- The requirement driving every constraint here: "never duplicate a post because
-- of a retry."
--
-- Retries are not optional — platform APIs time out, return 502s, and sometimes
-- succeed while failing to tell us. So duplicate prevention cannot live in
-- application logic that a crash can interrupt between "posted" and "recorded
-- that we posted". It has to be a database constraint.
--
-- Three mechanisms, in layers:
--   1. `scheduled_posts` is unique on (content_variant_id, connected_account_id,
--      scheduled_for) — the same content cannot be double-booked to the same
--      account at the same time.
--   2. `publishing_jobs` is unique on `idempotency_key`, derived from the
--      scheduled post. A replayed enqueue collides instead of creating a job.
--   3. `publishing_attempts` records every attempt separately from the job, so a
--      retry is an INSERT into attempts, never a mutation that loses history —
--      and `external_post_id` unique per account proves at the database level
--      that one post was created, not three.
-- =============================================================================

create table public.publishing_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,

  name text,
  -- Confirmed counts, computed and shown to the user *before* anything is
  -- created. Stored so the audit trail records what was approved, not just what
  -- happened.
  planned_post_count integer not null default 0 check (planned_post_count >= 0),
  planned_account_count integer not null default 0 check (planned_account_count >= 0),
  estimated_usage_credits integer not null default 0 check (estimated_usage_credits >= 0),

  cadence text check (cadence in ('asap', 'daily', 'weekdays', 'custom', 'even_spread')),
  posts_per_day integer check (posts_per_day is null or posts_per_day > 0),
  time_windows jsonb not null default '[]'::jsonb,
  timezone text not null default 'UTC',

  starts_on date,
  ends_on date,
  constraint publishing_plans_range check (ends_on is null or starts_on is null or ends_on >= starts_on),

  -- Warnings surfaced at plan time: duplicate assets, repeated hooks, frequency
  -- limits, capability mismatches. Retained so the record shows the user was told.
  warnings jsonb not null default '[]'::jsonb,

  status text not null default 'draft'
    check (status in ('draft', 'previewed', 'confirmed', 'executing', 'completed', 'cancelled')),
  -- Explicit confirmation of an expensive batch. Nothing executes without it.
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint publishing_plans_confirmation_complete
    check ((confirmed_at is null) = (confirmed_by is null))
);

select app.attach_touch_trigger('public.publishing_plans');
select app.apply_workspace_rls('public.publishing_plans', 'content.publish', 'content.publish');

-- -----------------------------------------------------------------------------
-- SCHEDULED POSTS
-- The intent: this variant, to this account, at this time.
-- -----------------------------------------------------------------------------
create table public.scheduled_posts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  publishing_plan_id uuid references public.publishing_plans (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  content_variant_id uuid not null references public.content_variants (id) on delete cascade,
  connected_account_id uuid not null references public.connected_accounts (id) on delete cascade,

  platform app.platform not null,
  scheduled_for timestamptz not null,
  timezone text not null default 'UTC',

  status app.publish_status not null default 'draft',

  caption text,
  first_comment text,
  -- Platform-specific fields: YouTube title/category, TikTok privacy level,
  -- Instagram collaborator tags. Genuinely heterogeneous per platform, which is
  -- the one case where JSONB beats columns.
  platform_options jsonb not null default '{}'::jsonb,

  requires_approval boolean not null default true,
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,

  published_at timestamptz,
  -- The platform's own post id. Unique per account: the database itself refuses
  -- to record the same remote post twice, so a retry that already succeeded
  -- cannot be logged as a second post.
  external_post_id text,
  external_permalink text,

  cancelled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Layer 1 of duplicate prevention.
  unique (content_variant_id, connected_account_id, scheduled_for),

  constraint scheduled_posts_approval_complete
    check ((approved_at is null) = (approved_by is null)),
  -- A published post must know where it went. Without this, a partially-written
  -- success is indistinguishable from a pending one and gets retried.
  constraint scheduled_posts_published_has_id
    check (status <> 'published' or external_post_id is not null)
);

select app.attach_touch_trigger('public.scheduled_posts');
select app.apply_workspace_rls('public.scheduled_posts', 'content.publish', 'content.publish');

-- Layer 3: one remote post per account, enforced by the database.
create unique index scheduled_posts_external_unique
  on public.scheduled_posts (connected_account_id, external_post_id)
  where external_post_id is not null;

-- The calendar's primary query.
create index scheduled_posts_calendar_idx
  on public.scheduled_posts (workspace_id, scheduled_for)
  where cancelled_at is null;
create index scheduled_posts_status_idx on public.scheduled_posts (status, scheduled_for)
  where status in ('scheduled', 'queued', 'uploading', 'publishing');
create index scheduled_posts_account_idx on public.scheduled_posts (connected_account_id, scheduled_for desc);
create index scheduled_posts_awaiting_approval_idx
  on public.scheduled_posts (workspace_id, scheduled_for)
  where status = 'awaiting_review';

-- -----------------------------------------------------------------------------
-- PUBLISHING JOBS
-- The unit of work. Separate from the scheduled post so a job can be retried,
-- cancelled and audited without mutating the user's intent.
-- -----------------------------------------------------------------------------
create table public.publishing_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  scheduled_post_id uuid not null references public.scheduled_posts (id) on delete cascade,

  status app.job_status not null default 'pending',
  priority smallint not null default 5 check (priority between 1 and 9),

  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),

  run_after timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,

  -- Held by a worker while processing, with a lease so a crashed worker's job
  -- becomes reclaimable instead of stuck in `running` forever.
  locked_by text,
  locked_until timestamptz,

  failure_code text,
  failure_message text,
  -- Whether re-running is safe. A timeout after the upload began is NOT safely
  -- retryable without first checking the platform for an existing post, and the
  -- failure UI must say so rather than offering a retry button.
  retry_safe boolean not null default true,

  -- Layer 2 of duplicate prevention.
  idempotency_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (idempotency_key),
  constraint publishing_jobs_attempts_bound check (attempts <= max_attempts + 1)
);

select app.attach_touch_trigger('public.publishing_jobs');
-- Read-only to clients: a client that could set `status = 'completed'` could mark
-- a post published without it ever being published. Cancellation goes through a
-- server action, not a direct update.
select app.apply_workspace_readonly_rls('public.publishing_jobs');

-- The worker's claim query.
create index publishing_jobs_claimable_idx
  on public.publishing_jobs (status, priority, run_after)
  where status in ('pending', 'queued');
create index publishing_jobs_lease_idx on public.publishing_jobs (locked_until)
  where locked_until is not null;
create index publishing_jobs_post_idx on public.publishing_jobs (scheduled_post_id);

-- -----------------------------------------------------------------------------
-- PUBLISHING ATTEMPTS
-- Append-only. One row per real call to a platform, which is what makes the
-- audit trail complete and what a support investigation reads.
-- -----------------------------------------------------------------------------
create table public.publishing_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  publishing_job_id uuid not null references public.publishing_jobs (id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running'
    check (outcome in ('running', 'succeeded', 'failed', 'aborted', 'skipped_duplicate')),

  http_status integer,
  platform_error_code text,
  platform_error_message text,
  external_post_id text,

  created_at timestamptz not null default now(),
  unique (publishing_job_id, attempt_number)
);

select app.apply_workspace_readonly_rls('public.publishing_attempts');

create index publishing_attempts_job_idx on public.publishing_attempts (publishing_job_id, attempt_number);
