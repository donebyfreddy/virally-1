-- =============================================================================
-- 0012 — STORAGE
--
-- All buckets are PRIVATE. Access is exclusively through short-lived signed URLs
-- minted server-side after an authorisation check.
--
-- Why not a public bucket for generated media: a public URL is permanent and
-- unguessable-only-by-obscurity. Once it appears in a browser history, a proxy
-- log, or a shared screenshot it is public forever, including after the user
-- deletes the asset. A user's unpublished campaign video is not public content.
--
-- OBJECT PATH CONVENTION — load-bearing, not cosmetic:
--
--     <workspace_id>/<asset_kind>/<asset_id>[.<ext>]
--
-- The policies below authorise on the FIRST path segment. `storage.foldername()`
-- returns the path segments, so `(storage.foldername(name))[1]` is the workspace
-- id, and membership in that workspace is the entire access check. Any code that
-- uploads outside this convention creates an object nobody can read.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- User uploads: the source material a campaign is built from.
  ('source-media', 'source-media', false, 524288000,
   array['video/mp4','video/quicktime','video/webm','audio/mpeg','audio/mp4','audio/wav',
         'image/jpeg','image/png','image/webp','image/avif','application/pdf']),

  -- Provider and renderer output.
  ('generated-media', 'generated-media', false, 524288000,
   array['video/mp4','video/webm','audio/mpeg','audio/wav','image/jpeg','image/png','image/webp']),

  ('brand-assets', 'brand-assets', false, 26214400,
   array['image/jpeg','image/png','image/webp','image/svg+xml','application/pdf']),

  ('avatars', 'avatars', false, 5242880,
   array['image/jpeg','image/png','image/webp']),

  ('exports', 'exports', false, 524288000,
   array['video/mp4','image/jpeg','image/png','application/zip','text/csv','application/pdf'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Helper: is the caller a member of the workspace named by the object path?
--
-- SECURITY DEFINER for the same reason as the helpers in 0002 — it reads
-- membership tables that are themselves behind RLS.
--
-- Returns false on a malformed path rather than raising: a bad path must be
-- unreadable, not a 500.
-- -----------------------------------------------------------------------------
create or replace function app.storage_path_workspace_member(p_object_name text)
returns boolean
language plpgsql
security definer
set search_path = app, public, pg_catalog
stable
as $$
declare
  v_first text;
  v_workspace_id uuid;
begin
  v_first := (storage.foldername(p_object_name))[1];
  if v_first is null or v_first = '' then
    return false;
  end if;

  begin
    v_workspace_id := v_first::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return app.is_workspace_member(v_workspace_id);
end;
$$;

create or replace function app.storage_path_workspace_permission(
  p_object_name text,
  p_permission app.permission
)
returns boolean
language plpgsql
security definer
set search_path = app, public, pg_catalog
stable
as $$
declare
  v_first text;
  v_workspace_id uuid;
begin
  v_first := (storage.foldername(p_object_name))[1];
  if v_first is null or v_first = '' then
    return false;
  end if;

  begin
    v_workspace_id := v_first::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return app.has_workspace_permission(v_workspace_id, p_permission);
end;
$$;

grant execute on function
  app.storage_path_workspace_member(text),
  app.storage_path_workspace_permission(text, app.permission)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- POLICIES
--
-- Tenant-scoped buckets share one pattern: read on membership, write on a
-- permission. Applied per bucket rather than generated, because there are only
-- four and the differences between them matter.
-- -----------------------------------------------------------------------------

-- --- source-media -----------------------------------------------------------
create policy "source_media_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'source-media'
    and app.storage_path_workspace_member(name)
  );

create policy "source_media_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'source-media'
    and app.storage_path_workspace_permission(name, 'content.create')
  );

create policy "source_media_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'source-media'
    and app.storage_path_workspace_permission(name, 'content.create')
  );

create policy "source_media_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'source-media'
    and app.storage_path_workspace_permission(name, 'assets.delete')
  );

-- --- generated-media --------------------------------------------------------
-- Readable by members; NOT writable by clients. Provider and renderer output is
-- written by workers with the service-role key. A client that could write here
-- could substitute its own file for a "generated" asset, which would also
-- corrupt the provenance record in generation_runs.
create policy "generated_media_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'generated-media'
    and app.storage_path_workspace_member(name)
  );

create policy "generated_media_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'generated-media'
    and app.storage_path_workspace_permission(name, 'assets.delete')
  );

-- --- brand-assets -----------------------------------------------------------
create policy "brand_assets_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'brand-assets'
    and app.storage_path_workspace_member(name)
  );

create policy "brand_assets_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand-assets'
    and app.storage_path_workspace_permission(name, 'campaign.manage')
  );

create policy "brand_assets_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brand-assets'
    and app.storage_path_workspace_permission(name, 'campaign.manage')
  );

create policy "brand_assets_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'brand-assets'
    and app.storage_path_workspace_permission(name, 'assets.delete')
  );

-- --- exports ----------------------------------------------------------------
create policy "exports_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and app.storage_path_workspace_member(name)
  );

create policy "exports_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'exports'
    and app.storage_path_workspace_permission(name, 'assets.delete')
  );

-- --- avatars ----------------------------------------------------------------
-- The one bucket keyed by user id rather than workspace id: an avatar belongs to
-- a person, not a tenant. Path convention is `<user_id>/<filename>`.
create policy "avatars_read_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_write_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
