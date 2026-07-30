import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveSiteOrigin } from "@/lib/env";
import type { PutObjectInput, StorageAdapter, StorageBucket } from "./types";

/**
 * Local-disk storage adapter for development.
 *
 * Never used in production — see src/lib/storage/index.ts, which selects
 * this only when no real provider is configured, and only outside
 * `NODE_ENV=production`. Objects live under `.data/storage/`, gitignored,
 * outside Postgres entirely.
 *
 * "Signed URL" here means an HMAC-signed, time-limited token verified by
 * src/app/api/storage/[bucket]/[...key]/route.ts — the same shape a real
 * provider's signed URL has, so swapping in Vercel Blob/S3 later changes only
 * this file, not any caller.
 */

const ROOT = join(process.cwd(), ".data", "storage");
const SECRET = process.env.BETTER_AUTH_SECRET ?? "dev-only-local-storage-secret";

function objectPath(bucket: StorageBucket, key: string): string {
  // Reject path traversal — a bucket/key pair ultimately becomes a filesystem
  // path, and this is local-dev-only code that still must not let a caller
  // escape the storage root.
  if (key.includes("..") || key.startsWith("/")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return join(ROOT, bucket, key);
}

function sign(bucket: StorageBucket, key: string, expiresAt: number): string {
  return createHmac("sha256", SECRET).update(`${bucket}:${key}:${expiresAt}`).digest("hex");
}

export function verifyLocalStorageToken(
  bucket: string,
  key: string,
  expiresAt: number,
  token: string,
): boolean {
  if (Date.now() > expiresAt) return false;
  const expected = sign(bucket as StorageBucket, key, expiresAt);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(token, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function localStorageRoot(): string {
  return ROOT;
}

async function toBuffer(body: PutObjectInput["body"]): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const localStorageAdapter: StorageAdapter = {
  async putObject({ bucket, key, body }) {
    const path = objectPath(bucket, key);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, await toBuffer(body));
    return { path: `${bucket}/${key}` };
  },

  async deleteObject(bucket, key) {
    await rm(objectPath(bucket, key), { force: true });
  },

  async getSignedUrl(bucket, key, expiresInSeconds = 300) {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const token = sign(bucket, key, expiresAt);
    const origin = resolveSiteOrigin();
    return `${origin}/api/storage/${bucket}/${key}?expires=${expiresAt}&token=${token}`;
  },
};

/** Used only by the local dev route handler that serves objects back out. */
export async function readLocalObject(bucket: StorageBucket, key: string): Promise<Buffer> {
  return readFile(objectPath(bucket, key));
}
