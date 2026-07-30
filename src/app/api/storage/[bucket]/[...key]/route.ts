import { NextResponse, type NextRequest } from "next/server";
import { readLocalObject, verifyLocalStorageToken } from "@/lib/storage/local";
import type { StorageBucket } from "@/lib/storage/types";

const VALID_BUCKETS = new Set<StorageBucket>([
  "source-media",
  "generated-media",
  "brand-assets",
  "avatars",
  "exports",
]);

/**
 * Serves objects written by the local storage adapter (src/lib/storage/local.ts).
 * Development only — `getStorageAdapter()` never selects the local adapter
 * once a real provider is configured, and this route has no reason to exist
 * against a real provider's own signed URLs.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string; key: string[] }> },
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 404 });
  }

  const { bucket, key } = await params;
  if (!VALID_BUCKETS.has(bucket as StorageBucket)) {
    return NextResponse.json({ error: "Unknown bucket." }, { status: 404 });
  }

  const objectKey = key.join("/");
  const expires = Number(request.nextUrl.searchParams.get("expires") ?? "0");
  const token = request.nextUrl.searchParams.get("token") ?? "";

  if (!verifyLocalStorageToken(bucket, objectKey, expires, token)) {
    return NextResponse.json({ error: "Expired or invalid token." }, { status: 403 });
  }

  try {
    const data = await readLocalObject(bucket as StorageBucket, objectKey);
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": "application/octet-stream" },
    });
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}
