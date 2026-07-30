/**
 * Storage adapter contract.
 *
 * Replaces Supabase Storage. Nothing in the app calls this yet — the five
 * buckets from supabase/migrations/0012_storage.sql (source_media,
 * generated_media, brand_assets, exports, avatars) had policies but no
 * upload/download call sites anywhere in src/ (confirmed by audit before this
 * migration). This is scaffolding for when a real upload path is built, not a
 * port of working code.
 *
 * Binary media is never stored in Postgres — `mediaAssets.storagePath` (see
 * src/lib/db/schema.fragment.ts) holds only the object key, and every read
 * goes through `getUrl`/`getSignedUrl` rather than a column containing bytes.
 */

export type StorageBucket =
  | "source-media"
  | "generated-media"
  | "brand-assets"
  | "avatars"
  | "exports";

export type PutObjectInput = {
  bucket: StorageBucket;
  key: string;
  body: Uint8Array | Buffer | ReadableStream;
  contentType?: string;
};

export type StorageAdapter = {
  /** Uploads an object, returning the path it was stored under. */
  putObject(input: PutObjectInput): Promise<{ path: string }>;
  /** Deletes an object. No-ops if it does not exist. */
  deleteObject(bucket: StorageBucket, key: string): Promise<void>;
  /**
   * A short-lived URL for reading the object. Access to buckets other than
   * `avatars` must always go through a signed URL, never a public one — see
   * 0012_storage.sql's per-bucket policy intent, which this preserves even
   * though RLS itself is gone.
   */
  getSignedUrl(bucket: StorageBucket, key: string, expiresInSeconds?: number): Promise<string>;
};
