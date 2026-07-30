-- =============================================================================
-- 0004 — BRANDS, ONBOARDING, AND THE TEAMMATE VIEW
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BRANDS
-- The identity content is produced for. A workspace may hold several — a media
-- network runs many brands inside one client workspace.
-- -----------------------------------------------------------------------------
create table public.brands (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  website_url text check (website_url is null or website_url ~ '^https?://'),
  description text,
  industry text,
  primary_language text not null default 'en',
  -- Onboarding creates a placeholder brand so the dashboard is never empty of
  -- context. This flag is what lets the UI prompt the user to complete it
  -- instead of presenting an unnamed brand as configured.
  is_placeholder boolean not null default false,
  is_default boolean not null default false,
  deleted_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.brands');
select app.apply_workspace_rls('public.brands', 'campaign.manage', 'assets.delete');

create unique index brands_one_default_per_workspace
  on public.brands (workspace_id)
  where is_default and deleted_at is null;

-- -----------------------------------------------------------------------------
-- BRAND PROFILES
-- Voice and audience, split from `brands` because it is large, optional, and
-- rewritten by the AI brief step independently of the brand's identity.
-- -----------------------------------------------------------------------------
create table public.brand_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  brand_id uuid not null unique references public.brands (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_audience text,
  tone text,
  primary_objective text,
  value_propositions text[] not null default '{}',
  content_pillars text[] not null default '{}',
  banned_topics text[] not null default '{}',
  -- Words the brand must never use. Enforced at generation time, which is why it
  -- is a first-class column rather than buried in a settings blob.
  banned_phrases text[] not null default '{}',
  visual_style text,
  colour_tokens jsonb not null default '{}'::jsonb,
  logo_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.brand_profiles');
select app.apply_workspace_rls('public.brand_profiles', 'campaign.manage', 'assets.delete');

-- -----------------------------------------------------------------------------
-- ONBOARDING PROGRESS
-- One row per user per organisation. Step data is kept so a user who abandons
-- onboarding halfway resumes rather than restarting.
-- -----------------------------------------------------------------------------
create table public.onboarding_progress (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  current_step smallint not null default 1 check (current_step between 1 and 7),
  completed_steps smallint[] not null default '{}',
  account_type text check (account_type in ('personal', 'agency', 'company', 'network')),
  content_goals text[] not null default '{}',
  preferred_formats text[] not null default '{}',
  first_campaign_prompt text,
  completed_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

select app.attach_touch_trigger('public.onboarding_progress');

alter table public.onboarding_progress enable row level security;
alter table public.onboarding_progress force row level security;

-- Onboarding is personal: a teammate's answers are not the caller's business,
-- so this is scoped to the user, not the organisation.
create policy onboarding_progress_own on public.onboarding_progress
  for all to authenticated
  using (user_id = auth.uid() and app.is_org_member(organization_id))
  with check (user_id = auth.uid() and app.is_org_member(organization_id));

create index onboarding_progress_user_idx on public.onboarding_progress (user_id);

-- -----------------------------------------------------------------------------
-- TEAMMATE VIEW
--
-- `profiles` is readable only by its owner. The team screen and every "created
-- by" byline still need a name and an avatar for colleagues.
--
-- This view is deliberately NOT `security_invoker`. With invoker rights the
-- `profiles` policy (`id = auth.uid()`) would restrict it to the caller's own
-- row, which is useless for a roster. It therefore runs with the view owner's
-- rights and does its own authorisation in the WHERE clause.
--
-- That places the whole burden on the predicate below, so it is deliberately
-- narrow on both axes:
--   - columns: name, avatar and role only. Never email, locale, timezone or
--     notification preferences.
--   - rows: `app.is_org_member` restricts to organisations the caller belongs
--     to. Because owner rights also bypass RLS on organization_members, this
--     predicate is the only thing standing between the caller and every user in
--     the database — it must never be removed or widened.
-- -----------------------------------------------------------------------------
create view public.organization_teammates as
select
  m.organization_id,
  m.user_id,
  m.role,
  m.accepted_at,
  p.full_name,
  p.avatar_url
from public.organization_members m
join public.profiles p on p.id = m.user_id
where app.is_org_member(m.organization_id);

comment on view public.organization_teammates is
  'Name, avatar and role of co-members only. Runs with owner rights and authorises via app.is_org_member in its WHERE clause — see 0004 before editing.';

grant select on public.organization_teammates to authenticated;
