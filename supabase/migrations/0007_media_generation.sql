-- =============================================================================
-- 0007 — MEDIA, COMPOSITIONS, GENERATION
--
-- The rule this file exists to enforce: never store only a final MP4. A
-- composition — tracks, clips, captions, timings — is what makes a 4:5 variant
-- derivable from a 9:16 one. Without it, "adapt this to another format" degrades
-- into a centre crop, which is the thing the product is supposed to be better
-- than.
-- =============================================================================

create table public.media_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  content_item_id uuid references public.content_items (id) on delete set null,

  kind app.asset_kind not null,

  -- Storage location. `storage_path` is the object key inside the bucket; access
  -- is always via a short-lived signed URL, never a public URL. A permanent
  -- public URL on private user media leaks it to anyone who has ever seen it.
  bucket text not null check (bucket in ('source-media', 'generated-media', 'brand-assets', 'avatars', 'exports')),
  storage_path text not null,

  filename text,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  aspect_ratio app.aspect_ratio,
  codec text,
  -- Poster image for video, so a library grid never attaches a <video> element
  -- per tile just to show a still frame.
  poster_asset_id uuid references public.media_assets (id) on delete set null,

  origin app.output_origin not null default 'user_upload',
  provider text,
  provider_model text,
  generation_cost_cents integer not null default 0 check (generation_cost_cents >= 0),

  -- Deduplication and the duplicate-content warning.
  checksum text,

  -- Upload lifecycle. A row exists before the bytes land, so an interrupted
  -- upload is visible and cleanable rather than an orphaned object.
  upload_state text not null default 'pending'
    check (upload_state in ('pending', 'uploaded', 'processing', 'ready', 'failed')),
  scan_state text not null default 'pending'
    check (scan_state in ('pending', 'clean', 'rejected', 'skipped')),

  deleted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One row per object. Makes a retried upload idempotent.
  unique (bucket, storage_path)
);

select app.attach_touch_trigger('public.media_assets');
select app.apply_workspace_rls('public.media_assets', 'content.create', 'assets.delete');

create index media_assets_workspace_kind_idx
  on public.media_assets (workspace_id, kind, created_at desc)
  where deleted_at is null;
create index media_assets_campaign_idx on public.media_assets (campaign_id) where deleted_at is null;
create index media_assets_checksum_idx on public.media_assets (workspace_id, checksum)
  where checksum is not null;

-- Deferred FKs for the columns that pointed at media_assets before it existed.
alter table public.brand_profiles
  add constraint brand_profiles_logo_fk
  foreign key (logo_asset_id) references public.media_assets (id) on delete set null;

alter table public.campaign_briefs
  add constraint campaign_briefs_source_asset_fk
  foreign key (source_asset_id) references public.media_assets (id) on delete set null;

alter table public.content_variants
  add constraint content_variants_rendered_fk
  foreign key (rendered_asset_id) references public.media_assets (id) on delete set null;

alter table public.content_variants
  add constraint content_variants_thumbnail_fk
  foreign key (thumbnail_asset_id) references public.media_assets (id) on delete set null;

alter table public.shots
  add constraint shots_asset_fk
  foreign key (asset_id) references public.media_assets (id) on delete set null;

-- -----------------------------------------------------------------------------
-- ASSET VERSIONS
-- Regeneration produces a new version rather than overwriting. Overwriting makes
-- "undo" impossible and breaks any published post already pointing at the object.
-- -----------------------------------------------------------------------------
create table public.media_asset_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null check (version >= 1),
  storage_path text not null,
  byte_size bigint,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (asset_id, version)
);

select app.apply_workspace_rls('public.media_asset_versions', 'content.create', 'assets.delete');

-- -----------------------------------------------------------------------------
-- COMPOSITIONS
-- The canonical timeline. Renderer-agnostic by design so the same document can
-- drive Remotion, raw FFmpeg or an external render worker.
-- -----------------------------------------------------------------------------
create table public.compositions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_item_id uuid references public.content_items (id) on delete cascade,
  content_variant_id uuid references public.content_variants (id) on delete cascade,

  width integer not null check (width > 0),
  height integer not null check (height > 0),
  fps integer not null default 30 check (fps between 1 and 120),
  -- Frames, not seconds. The renderer works in frames, and storing seconds
  -- reintroduces rounding at every conversion.
  duration_frames integer not null check (duration_frames > 0),
  background_colour text,

  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Belongs to an item or a variant, never both and never neither: an orphan
  -- composition is unreachable, and one attached to both has no clear owner.
  constraint compositions_single_owner check (
    (content_item_id is not null and content_variant_id is null)
    or (content_item_id is null and content_variant_id is not null)
  )
);

select app.attach_touch_trigger('public.compositions');
select app.apply_workspace_rls('public.compositions', 'content.create', 'content.delete');

create table public.composition_tracks (
  id uuid primary key default extensions.gen_random_uuid(),
  composition_id uuid not null references public.compositions (id) on delete cascade,
  kind text not null check (kind in ('video', 'audio', 'voice', 'music', 'text', 'caption', 'overlay')),
  position integer not null,
  is_muted boolean not null default false,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (composition_id, position)
);

alter table public.composition_tracks enable row level security;
alter table public.composition_tracks force row level security;

-- Two levels down from a workspace, so the check joins through compositions.
create policy composition_tracks_select on public.composition_tracks
  for select to authenticated
  using (exists (
    select 1 from public.compositions c
    where c.id = composition_id and app.is_workspace_member(c.workspace_id)
  ));

create policy composition_tracks_write on public.composition_tracks
  for all to authenticated
  using (exists (
    select 1 from public.compositions c
    where c.id = composition_id
      and app.has_workspace_permission(c.workspace_id, 'content.create')
  ))
  with check (exists (
    select 1 from public.compositions c
    where c.id = composition_id
      and app.has_workspace_permission(c.workspace_id, 'content.create')
  ));

create index composition_tracks_composition_idx on public.composition_tracks (composition_id);

create table public.composition_clips (
  id uuid primary key default extensions.gen_random_uuid(),
  track_id uuid not null references public.composition_tracks (id) on delete cascade,
  asset_id uuid references public.media_assets (id) on delete set null,
  position integer not null,
  -- All timings in frames, consistent with the composition.
  start_frame integer not null check (start_frame >= 0),
  duration_frames integer not null check (duration_frames > 0),
  -- Trim points within the source asset.
  source_in_frame integer check (source_in_frame is null or source_in_frame >= 0),
  source_out_frame integer,
  text_content text,
  style jsonb not null default '{}'::jsonb,
  transform jsonb not null default '{}'::jsonb,
  transition_in text,
  transition_out text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_id, position),
  constraint composition_clips_source_range
    check (source_out_frame is null or source_in_frame is null or source_out_frame > source_in_frame)
);

select app.attach_touch_trigger('public.composition_clips');

alter table public.composition_clips enable row level security;
alter table public.composition_clips force row level security;

-- Three levels from a workspace: clip → track → composition. `app.apply_child_rls`
-- cannot be used here — it assumes the parent carries `workspace_id`, and
-- `composition_tracks` does not, so the generated policy would reference a column
-- that does not exist. Denormalising `workspace_id` onto clips was the
-- alternative and was rejected: it creates a second source of truth that a
-- re-parented clip can silently contradict.
create policy composition_clips_select on public.composition_clips
  for select to authenticated
  using (exists (
    select 1
    from public.composition_tracks t
    join public.compositions c on c.id = t.composition_id
    where t.id = track_id and app.is_workspace_member(c.workspace_id)
  ));

create policy composition_clips_write on public.composition_clips
  for all to authenticated
  using (exists (
    select 1
    from public.composition_tracks t
    join public.compositions c on c.id = t.composition_id
    where t.id = track_id
      and app.has_workspace_permission(c.workspace_id, 'content.create')
  ))
  with check (exists (
    select 1
    from public.composition_tracks t
    join public.compositions c on c.id = t.composition_id
    where t.id = track_id
      and app.has_workspace_permission(c.workspace_id, 'content.create')
  ));

-- The join column in every policy above.
create index composition_clips_track_idx on public.composition_clips (track_id);

-- -----------------------------------------------------------------------------
-- GENERATION RUNS
--
-- One row per provider call. The brief requires provider, model, prompt version,
-- status, duration, cost and retry count recorded for every generation — this is
-- that record, and it is what makes "were credits charged for this failure?"
-- answerable instead of a guess.
-- -----------------------------------------------------------------------------
create table public.generation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  content_item_id uuid references public.content_items (id) on delete set null,
  content_variant_id uuid references public.content_variants (id) on delete set null,
  shot_id uuid references public.shots (id) on delete set null,

  stage text not null check (stage in (
    'brief', 'strategy', 'concepts', 'hooks', 'script', 'storyboard',
    'image', 'video', 'voice', 'composition', 'adaptation', 'moderation', 'thumbnail'
  )),

  provider text not null,
  provider_model text,
  -- Which prompt template produced this. Without it, a quality regression after a
  -- prompt change is untraceable.
  prompt_version text,
  capability text,

  status app.job_status not null default 'pending',
  attempt integer not null default 1 check (attempt >= 1),

  -- Whether this run was real or the deterministic mock. Anything derived from a
  -- mock run must never be presented as a real generation.
  origin app.output_origin not null default 'mock',

  input_digest text,
  output_summary jsonb,

  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),

  cost_cents integer not null default 0 check (cost_cents >= 0),
  -- Distinguishes "failed and you were charged" from "failed for free", which
  -- the error UI is required to state.
  cost_incurred boolean not null default false,

  failure_code text,
  failure_message text,

  -- Support identifier surfaced in the error UI so a user can quote something
  -- short instead of a UUID.
  reference text not null default upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),

  external_job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select app.attach_touch_trigger('public.generation_runs');
-- System-written: workers create these with the service-role key. A client that
-- could insert here could fabricate cost and provenance records.
select app.apply_workspace_readonly_rls('public.generation_runs');

create index generation_runs_workspace_created_idx
  on public.generation_runs (workspace_id, created_at desc);
create index generation_runs_status_idx on public.generation_runs (status)
  where status in ('pending', 'queued', 'running', 'waiting_external');
create index generation_runs_item_idx on public.generation_runs (content_item_id);
create unique index generation_runs_reference_idx on public.generation_runs (reference);
