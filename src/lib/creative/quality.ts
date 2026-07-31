import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobePath from "ffprobe-static";
import type { AspectRatio } from "@/types/database";

const run = promisify(execFile);

/**
 * Media inspection and quality checks, via ffprobe.
 *
 * Everything here MEASURES. Nothing infers a property from a filename, a MIME
 * type or what the pipeline believes it produced — those are the values that
 * are wrong precisely when a file is broken, which is the only time these
 * checks matter.
 *
 * `ffprobe-static` ships a platform binary, so there is no system dependency
 * and no PATH assumption. If it is missing, every function reports
 * `unavailable` rather than passing: a quality gate that silently approves
 * everything when its tool is absent is worse than no gate, because it produces
 * a green checkmark nobody re-examines.
 */

const FFPROBE = resolveFfprobe();

function resolveFfprobe(): string | null {
  // ffprobe-static's default export differs between CJS and ESM interop
  // ({ path } vs a bare string), so both shapes are handled rather than
  // assuming one and crashing at runtime on the other.
  const candidate = ffprobePath as unknown;
  if (typeof candidate === "string") return candidate;
  if (candidate && typeof candidate === "object" && "path" in candidate) {
    const path = (candidate as { path: unknown }).path;
    if (typeof path === "string") return path;
  }
  return null;
}

export function isProbeAvailable(): boolean {
  return FFPROBE !== null;
}

export type MediaProbe = {
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  /** True when the file carries at least one audio stream with a duration. */
  hasAudio: boolean;
  bitrateBps: number | null;
  frameRate: number | null;
};

export class ProbeUnavailableError extends Error {
  constructor() {
    super(
      "ffprobe is not available, so media could not be inspected. Quality checks report `unavailable` rather than passing.",
    );
    this.name = "ProbeUnavailableError";
  }
}

/**
 * Reads a file's real properties.
 *
 * `-v error` keeps ffprobe's banner out of stdout so the JSON parses, and
 * `-show_streams` is needed because container-level metadata routinely omits
 * the duration that the stream carries.
 */
export async function probeMedia(filePath: string): Promise<MediaProbe> {
  if (!FFPROBE) throw new ProbeUnavailableError();

  const { stdout } = await run(FFPROBE, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
      avg_frame_rate?: string;
    }[];
  };

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");

  const durationSeconds = Number(parsed.format?.duration ?? video?.duration ?? audio?.duration ?? "");

  return {
    durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null,
    widthPx: video?.width ?? null,
    heightPx: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: audio !== undefined,
    bitrateBps: Number.isFinite(Number(parsed.format?.bit_rate))
      ? Number(parsed.format?.bit_rate)
      : null,
    frameRate: parseFrameRate(video?.avg_frame_rate),
  };
}

/** ffprobe reports frame rate as a rational string like "30000/1001". */
function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !denominator) return null;
  return Math.round((numerator / denominator) * 100) / 100;
}

// --- Checks -----------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "warn" | "unavailable";

export type QualityCheck = {
  id: string;
  status: CheckStatus;
  /** Shown to the user. States what is wrong and what it means for publishing. */
  detail: string;
};

export type QualityReport = {
  checks: readonly QualityCheck[];
  /** False when any check failed. Warnings do not block. */
  passed: boolean;
  probe: MediaProbe | null;
};

export type QualityExpectation = {
  ratio: AspectRatio;
  expectedDurationMs: number;
  /** Whether a voice track was composed, so its absence is a real fault. */
  expectsAudio: boolean;
  minHeightPx: number;
};

/** Codecs a social platform will accept without re-encoding on upload. */
const ACCEPTED_VIDEO_CODECS = new Set(["h264", "hevc", "vp9", "av1"]);
const ACCEPTED_AUDIO_CODECS = new Set(["aac", "mp3", "opus"]);

/** How far the measured duration may drift from the composition's. */
const DURATION_TOLERANCE_MS = 500;

/**
 * Validates a rendered export against what the composition promised.
 *
 * Returns `unavailable` for everything when ffprobe is missing, so the caller
 * can distinguish "checked and fine" from "could not check" — a distinction the
 * review UI must surface rather than collapse into a tick.
 */
export async function checkExport(
  filePath: string,
  expectation: QualityExpectation,
): Promise<QualityReport> {
  if (!isProbeAvailable()) {
    return {
      checks: [
        {
          id: "probe",
          status: "unavailable",
          detail:
            "ffprobe is not available in this environment, so the export could not be inspected. It has NOT been verified.",
        },
      ],
      passed: false,
      probe: null,
    };
  }

  let probe: MediaProbe;
  try {
    probe = await probeMedia(filePath);
  } catch {
    return {
      checks: [
        {
          id: "decodable",
          status: "fail",
          detail: "The exported file could not be decoded. It is corrupt and must be re-rendered.",
        },
      ],
      passed: false,
      probe: null,
    };
  }

  const checks: QualityCheck[] = [{ id: "decodable", status: "pass", detail: "The file decodes." }];

  // --- Duration ---
  if (probe.durationMs === null) {
    checks.push({
      id: "duration",
      status: "fail",
      detail: "The file reports no duration, which means the container is malformed.",
    });
  } else if (probe.durationMs === 0) {
    checks.push({ id: "duration", status: "fail", detail: "The file is zero-length." });
  } else {
    const drift = Math.abs(probe.durationMs - expectation.expectedDurationMs);
    checks.push({
      id: "duration",
      status: drift <= DURATION_TOLERANCE_MS ? "pass" : "fail",
      detail:
        drift <= DURATION_TOLERANCE_MS
          ? `Duration is ${probe.durationMs}ms, within tolerance of the composition.`
          : `Duration is ${probe.durationMs}ms but the composition is ${expectation.expectedDurationMs}ms. A render that disagrees with its own timeline has dropped or repeated frames.`,
    });
  }

  // --- Aspect ratio ---
  if (probe.widthPx === null || probe.heightPx === null) {
    checks.push({
      id: "aspect_ratio",
      status: "fail",
      detail: "The file carries no video stream dimensions.",
    });
  } else {
    const actual = probe.widthPx / probe.heightPx;
    const expected = expectedAspect(expectation.ratio);
    // 1% tolerance absorbs even-dimension rounding without accepting a genuinely
    // wrong shape.
    const matches = expected === null || Math.abs(actual - expected) / expected < 0.01;
    checks.push({
      id: "aspect_ratio",
      status: matches ? "pass" : "fail",
      detail: matches
        ? `Frame is ${probe.widthPx}×${probe.heightPx}, matching ${expectation.ratio}.`
        : `Frame is ${probe.widthPx}×${probe.heightPx}, which is not ${expectation.ratio}. Publishing this would letterbox or crop it.`,
    });

    checks.push({
      id: "resolution",
      status: probe.heightPx >= expectation.minHeightPx ? "pass" : "warn",
      detail:
        probe.heightPx >= expectation.minHeightPx
          ? `Height is ${probe.heightPx}px.`
          : `Height is ${probe.heightPx}px, below the ${expectation.minHeightPx}px target. It will publish, but will look soft.`,
    });
  }

  // --- Codecs ---
  checks.push({
    id: "video_codec",
    status: probe.videoCodec && ACCEPTED_VIDEO_CODECS.has(probe.videoCodec) ? "pass" : "fail",
    detail: probe.videoCodec
      ? ACCEPTED_VIDEO_CODECS.has(probe.videoCodec)
        ? `Video codec is ${probe.videoCodec}.`
        : `Video codec is ${probe.videoCodec}, which platforms will re-encode or reject.`
      : "The file has no video stream.",
  });

  // --- Audio ---
  if (expectation.expectsAudio) {
    if (!probe.hasAudio) {
      checks.push({
        id: "audio_present",
        status: "fail",
        // The specific failure this catches: a voiceover that generated fine but
        // was never mixed in. The video looks correct and is silent.
        detail:
          "The composition includes a voice track but the export has no audio stream. The voiceover was not mixed in.",
      });
    } else {
      checks.push({
        id: "audio_present",
        status: "pass",
        detail: `Audio stream present (${probe.audioCodec ?? "unknown codec"}).`,
      });
      checks.push({
        id: "audio_codec",
        status: probe.audioCodec && ACCEPTED_AUDIO_CODECS.has(probe.audioCodec) ? "pass" : "warn",
        detail:
          probe.audioCodec && ACCEPTED_AUDIO_CODECS.has(probe.audioCodec)
            ? `Audio codec is ${probe.audioCodec}.`
            : `Audio codec is ${probe.audioCodec ?? "unknown"}, which some platforms re-encode.`,
      });
    }
  }

  // --- Bitrate ---
  if (probe.bitrateBps !== null && probe.bitrateBps < 500_000) {
    checks.push({
      id: "bitrate",
      status: "warn",
      detail: `Bitrate is ${Math.round(probe.bitrateBps / 1000)}kbps, low enough to show visible compression artefacts.`,
    });
  }

  return {
    checks,
    // Warnings do not block: a soft-looking export is still publishable, and
    // blocking on it would make the gate something users learn to override.
    passed: checks.every((check) => check.status === "pass" || check.status === "warn"),
    probe,
  };
}

function expectedAspect(ratio: AspectRatio): number | null {
  const map: Readonly<Record<string, number>> = {
    "9:16": 9 / 16,
    "4:5": 4 / 5,
    "1:1": 1,
    "16:9": 16 / 9,
    "4:3": 4 / 3,
    "3:2": 3 / 2,
  };
  // `custom` has no expected ratio, so the check cannot fail on it.
  return map[ratio] ?? null;
}

/**
 * Detects leading black frames.
 *
 * Uses ffmpeg's `blackdetect` filter rather than sampling frames ourselves. A
 * reel that opens on black loses the first second of attention, which for
 * short-form content is most of it.
 *
 * Returns null when ffmpeg is unavailable — again distinct from "no black
 * frames found".
 */
export async function detectLeadingBlack(
  filePath: string,
  ffmpegPath: string | null,
): Promise<{ leadingBlackMs: number } | null> {
  if (!ffmpegPath) return null;

  try {
    // blackdetect writes to stderr; a non-zero exit is normal when the filter
    // graph ends, so stderr is read from the thrown error too.
    const result = await run(ffmpegPath, [
      "-i",
      filePath,
      "-vf",
      "blackdetect=d=0.1:pix_th=0.10",
      "-an",
      "-f",
      "null",
      "-",
    ]).catch((error: unknown) => error as { stderr?: string });

    const stderr = "stderr" in result ? (result.stderr ?? "") : "";
    const match = /black_start:(\d+(?:\.\d+)?) black_end:(\d+(?:\.\d+)?)/.exec(stderr);
    if (!match) return { leadingBlackMs: 0 };

    const start = Number(match[1]);
    const end = Number(match[2]);
    // Only a run that begins at the very start of the file counts as leading.
    if (start > 0.05) return { leadingBlackMs: 0 };
    return { leadingBlackMs: Math.round(end * 1000) };
  } catch {
    return null;
  }
}
