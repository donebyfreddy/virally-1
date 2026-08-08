import type { AssetKind } from "@/types/database";
import type { GenerationKind } from "./types";

/**
 * Pure helpers for `ingest.ts`, split out so they can be unit-tested without
 * pulling in `@/lib/db` — `ingest.ts` builds a Pool at module scope, which
 * throws in the hermetic `npm test` run unless `DATABASE_URL` is set (see
 * `vitest.config.ts`), and neither function here touches the database.
 */

/**
 * Maps a generation kind onto the schema's `asset_kind` enum.
 *
 * `capability` (the fine-grained routing dimension, e.g. "audio" for a
 * voiceover or "music") is what tells a voiceover apart from a music track —
 * `kind` alone collapses both to "audio", which is also all a sound-effect
 * capability gets, `asset_kind` having no dedicated member for it.
 */
export function assetKindFor(kind: GenerationKind, capability?: string | null): AssetKind {
  if (kind === "image") return "generated_image";
  if (kind === "video") return "generated_video";
  if (capability === "audio") return "voiceover";
  if (capability === "music") return "music";
  return "audio";
}

/**
 * File extension for a stored object.
 *
 * Derived from the MIME type the server actually sent, falling back to the
 * generation kind. Never taken from the source URL — a provider URL's path can
 * be arbitrary and an attacker-influenced extension on a stored object is how a
 * storage bucket starts serving executable content.
 */
export function extensionFor(mimeType: string, kind: GenerationKind): string {
  const known: Readonly<Record<string, string>> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/mp4": ".m4a",
  };
  if (known[mimeType]) return known[mimeType];
  if (kind === "image") return ".png";
  if (kind === "video") return ".mp4";
  return ".mp3";
}
