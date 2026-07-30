-- =============================================================================
-- 0011 — JOBS, ACTIVITY, USAGE, AUDIT
-- =============================================================================

-- -----------------------------------------------------------------------------
-- JOBS
--
-- The generic queue. Persisted in Postgres so the product works with no Redis
-- configured; when REDIS_URL is set the same rows are the durable record behind
-- a BullMQ queue. Either way the database, not the queue, is the source of truth
-- for "did this run" — an in-memory queue that loses a job leaves no evidence.
-- -----------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,

  type text not null check (type in (
    'campaign.plan',
    'content.script',
    'content.storyboard',
    'asset.image.generate',
    'asset.video.generate',
    'asset.voice.generate',
    'content.render',
    'content.transcode',
    'content.quality_check',
    'content.publish',
    'content.metrics.sync',
    'account.sync'
  )),

  status app.job_status not null default 'pending',
  priority smallint not null default 5 check (priority between 1 and 9),
  progress smallint not null default 0 check (progress between 0 and 100),

  payload jsonb not null default '{}'::jsonb,
  result jsonb,

  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),

  run_after timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,

  locked_by text,
  locked_until timestamptz,

  provider text,
  external_job_id text,
  cost_cents integer not null default 0 check (cost_cents >= 0),

  failure_code text,
  failure_message text,

  -- Every enqueue supplies one. Uniqueness makes "enqueue this batch again"
  -- safe: the second call collides on existing rows instead of doubling the work.
  idempotency_key text not null,

  -- Parent/child so a batch of 100 renders has one row to report progress on.
  parent_job_id uuid references public.jobs (id) on delete cascade,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (idempotency_key)
);

select app.attach_touch_trigger('public.jobs');
-- Read-only to clients. Cancelling goes through a server action that verifies
-- permission; a direct UPDATE would let a viewer cancel a colleague's render.
select app.apply_workspace_readonly_rls('public.jobs');

create index jobs_claimable_idx on public.jobs (status, priority, run_after)
  where status in ('pending', 'queued');
create index jobs_workspace_status_idx on public.jobs (workspace_id, status, created_at desc);
create index jobs_lease_idx on public.jobs (locked_until) where locked_until is not null;
create index jobs_parent_idx on public.jobs (parent_job_id) where parent_job_id is not null;
create index jobs_external_idx on public.jobs (provider, external_job_id)
  where external_job_id is not null;

-- Append-only state transitions. Separate from `jobs` because the job row holds
-- current state while this holds history, and a debugging session needs both.
create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  from_status app.job_status,
  to_status app.job_status not null,
  detail text,
  created_at timestamptz not null default now()
);

select app.apply_workspace_readonly_rls('public.job_events');
create index job_events_job_idx on public.job_events (job_id, created_at);

-- -----------------------------------------------------------------------------
-- ACTIVITY AND NOTIFICATIONS
-- -----------------------------------------------------------------------------
create table public.activity_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  -- Null actor means the system did it, which the activity feed renders
  -- differently from a teammate action.
  kind text not null,
  subject_type text,
  subject_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

select app.apply_workspace_readonly_rls('public.activity_events');
create index activity_events_workspace_time_idx on public.activity_events (workspace_id, created_at desc);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  kind text not null check (kind in (
    'job_completed', 'job_failed', 'account_disconnected', 'approval_required',
    'publishing_completed', 'publishing_failed', 'usage_warning',
    'team_invitation', 'analytics_insight'
  )),
  title text not null,
  body text,
  link_path text,
  metadata jsonb not null default '{}'::jsonb,

  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Strictly personal, and the only mutation a user may make is marking one read.
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Two indexes, deliberately. The partial one serves the unread badge, which is
-- the hot query. The full one serves the RLS policy itself (`user_id =
-- auth.uid()`), which applies to read notifications too — a partial index cannot
-- satisfy a scan of the whole notification centre.
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc)
  where read_at is null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- COMMENTS AND APPROVALS
-- -----------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_item_id uuid references public.content_items (id) on delete cascade,
  content_variant_id uuid references public.content_variants (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  -- Frame-anchored review notes: "the cut at 0:04 is early".
  anchor_frame integer check (anchor_frame is null or anchor_frame >= 0),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.comments');

alter table public.comments enable row level security;
alter table public.comments force row level security;

create policy comments_select on public.comments
  for select to authenticated using (app.is_workspace_member(workspace_id));

-- Any workspace member may comment — reviewing does not require write access to
-- the content itself.
create policy comments_insert on public.comments
  for insert to authenticated
  with check (app.is_workspace_member(workspace_id) and author_id = auth.uid());

-- Editing and deleting are limited to the author. A teammate silently rewriting
-- your review note would make the approval trail worthless.
create policy comments_modify_own on public.comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy comments_delete_own on public.comments
  for delete to authenticated using (author_id = auth.uid());

create index comments_item_idx on public.comments (content_item_id, created_at);
create index comments_workspace_open_idx on public.comments (workspace_id) where resolved_at is null;

create table public.approval_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_item_id uuid references public.content_items (id) on delete cascade,
  scheduled_post_id uuid references public.scheduled_posts (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  assigned_to uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_decision_complete
    check ((decided_at is null) = (decided_by is null))
);

select app.attach_touch_trigger('public.approval_requests');

alter table public.approval_requests enable row level security;
alter table public.approval_requests force row level security;

create policy approval_requests_select on public.approval_requests
  for select to authenticated using (app.is_workspace_member(workspace_id));

create policy approval_requests_insert on public.approval_requests
  for insert to authenticated
  with check (app.has_workspace_permission(workspace_id, 'content.create') and requested_by = auth.uid());

-- Deciding requires the approval permission specifically. This is the constraint
-- that makes the editor/reviewer split real rather than cosmetic.
create policy approval_requests_decide on public.approval_requests
  for update to authenticated
  using (app.has_workspace_permission(workspace_id, 'content.approve'))
  with check (app.has_workspace_permission(workspace_id, 'content.approve'));

create index approval_requests_pending_idx on public.approval_requests (workspace_id, created_at)
  where status = 'pending';

-- -----------------------------------------------------------------------------
-- USAGE LEDGER
--
-- Append-only, and the balance is a SUM over it rather than a mutable counter.
-- The brief requires this explicitly, and the reason is that a counter cannot be
-- audited: when a user disputes a charge there is no way to show what produced
-- the number. There is deliberately no UPDATE or DELETE policy, for anyone.
-- -----------------------------------------------------------------------------
create table public.usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,

  kind text not null check (kind in (
    'video_generated', 'image_generated', 'voice_generated', 'render_minutes',
    'storage_bytes', 'post_published', 'account_connected', 'transcription_minutes'
  )),
  -- Integer quantity in the unit's smallest sensible increment (one video, one
  -- second, one byte). Never a float.
  quantity bigint not null check (quantity >= 0),
  unit text not null,

  credits_delta integer not null default 0,
  provider_cost_cents integer not null default 0 check (provider_cost_cents >= 0),

  generation_run_id uuid references public.generation_runs (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,

  -- Same key as the job that caused it, so a retried job cannot bill twice.
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  unique (idempotency_key, kind)
);

alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;

-- Read requires the billing permission: an editor should not be able to see the
-- organisation's cost profile.
create policy usage_events_select on public.usage_events
  for select to authenticated
  using (app.has_org_permission(organization_id, 'billing.view'));

-- No insert/update/delete policies at all. Writes are service-role only, which is
-- what makes this a ledger rather than a table of suggestions.

create index usage_events_org_time_idx on public.usage_events (organization_id, occurred_at desc);
create index usage_events_kind_idx on public.usage_events (organization_id, kind, occurred_at desc);

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Positive for grants and top-ups, negative for consumption. The balance is
  -- the sum; there is no stored balance to drift.
  delta integer not null,
  reason text not null check (reason in
    ('plan_grant', 'top_up', 'consumption', 'refund', 'adjustment', 'expiry')),
  usage_event_id bigint references public.usage_events (id) on delete set null,
  note text,
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;
alter table public.credit_ledger force row level security;

create policy credit_ledger_select on public.credit_ledger
  for select to authenticated
  using (app.has_org_permission(organization_id, 'billing.view'));

create index credit_ledger_org_idx on public.credit_ledger (organization_id, occurred_at desc);

create table public.subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  -- Feature-flagged: with no Stripe configured the product still tracks usage,
  -- it simply does not charge for it.
  provider text not null default 'none' check (provider in ('none', 'stripe')),
  external_customer_id text,
  external_subscription_id text,
  plan_code text not null default 'free',
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'cancelled', 'paused', 'unconfigured')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  included_credits integer not null default 0 check (included_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.subscriptions');

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (app.has_org_permission(organization_id, 'billing.view'));

-- -----------------------------------------------------------------------------
-- AUDIT LOG
--
-- Append-only and never deleted. Records the actions the threat model cares
-- about: who connected or disconnected an account, who approved and who
-- published, who changed a role.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  actor_email text,

  action text not null,
  subject_type text,
  subject_id uuid,

  -- Truncated at the application layer before insert. A full IP and user agent
  -- are more personal data than an audit trail needs.
  ip_prefix text,
  user_agent_family text,

  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

-- Visible to those who manage the team; writes are service-role only.
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (app.has_org_permission(organization_id, 'team.manage'));

create index audit_logs_org_time_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_subject_idx on public.audit_logs (subject_type, subject_id);

-- -----------------------------------------------------------------------------
-- WEBHOOK EVENTS
--
-- Inbound platform and provider callbacks. Stored before processing so a replayed
-- delivery is detected by the unique constraint rather than processed twice — the
-- webhook equivalent of the publishing idempotency key.
-- -----------------------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default extensions.gen_random_uuid(),
  source text not null,
  external_event_id text,
  event_type text,
  signature_verified boolean not null default false,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default now(),
  -- Replay protection.
  unique (source, external_event_id)
);

alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;

-- No policies: service-role only. Webhook payloads can contain material from
-- other tenants and must never be client-readable.

create index webhook_events_unprocessed_idx on public.webhook_events (received_at)
  where processed_at is null;
