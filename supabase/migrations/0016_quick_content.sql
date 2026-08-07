-- =============================================================================
-- 0016 — QUICK CONTENT
--
-- Adds the columns a standalone content item needs that a campaign-authored one
-- gets for free from `campaign_briefs` / `production_modes`: a standalone item
-- has no campaign brief to hold its tone, and no batch-level mode selection to
-- read its production mode and cost from.
--
-- `campaign_id` on `content_items` (0006) is already nullable — this migration
-- does not touch it and does not create any campaign row for standalone
-- content. A `content_items` row with `campaign_id is null` was already a valid
-- state; the columns below just give it somewhere to keep the choices that a
-- campaign-linked item keeps on other tables.
--
-- `production_mode` is `text` with a check, matching `content_items.content_type`
-- immediately above it in 0006, rather than a new pg enum — the value set
-- (fast | hybrid | cinematic) already exists as `ProductionMode` in
-- src/lib/creative/types.ts and is validated there before it ever reaches SQL.
-- =============================================================================

alter table public.content_items
  add column tone text,
  add column production_mode text
    check (production_mode is null or production_mode in ('fast', 'hybrid', 'cinematic')),
  -- The plan a user reviewed and confirmed before paid generation started:
  -- structure, hook, per-asset counts. Kept as a snapshot rather than
  -- recomputed on every read, so the credits actually reserved always match
  -- the plan the user actually saw and approved.
  add column generation_plan jsonb,
  add column estimated_credits integer not null default 0,
  add column actual_credits integer not null default 0;

alter table public.content_items
  add constraint content_items_estimated_credits_check check (estimated_credits >= 0),
  add constraint content_items_actual_credits_check check (actual_credits >= 0);
