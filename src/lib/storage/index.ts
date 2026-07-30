import { localStorageAdapter } from "./local";
import type { StorageAdapter } from "./types";

export type { PutObjectInput, StorageAdapter, StorageBucket } from "./types";

/**
 * Resolves the storage adapter for this deployment.
 *
 * Feature-detected like every other not-yet-required provider in this app
 * (see src/lib/env.ts): no real provider is wired in yet, so this always
 * returns the local-disk mock. When a real provider (Vercel Blob, S3, R2) is
 * added, branch on its env var here — every call site already goes through
 * this function, so that becomes a one-file change.
 */
export function getStorageAdapter(): StorageAdapter {
  return localStorageAdapter;
}
