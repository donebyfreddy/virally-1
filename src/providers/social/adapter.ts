import type { Platform } from "@/types/database";
import type { ValidationResult } from "@/lib/publishing/capabilities";

/**
 * Normalised social platform adapter.
 *
 * COMPLIANCE BOUNDARY — read before adding a method.
 *
 * This interface deliberately has no surface for: creating consumer accounts,
 * solving CAPTCHAs, bypassing phone or email verification, rotating proxies,
 * spoofing devices, buying followers or engagement, sending unsolicited messages, or
 * driving a headless browser where an official API exists. Those are not omissions to
 * be filled in later; the product publishes to accounts a user has authorised and
 * does nothing else.
 *
 * Every method is expressed in terms of an OAuth-authorised connection. There is no
 * password parameter anywhere, and migration 0014 fails the build if a
 * password-shaped column ever appears in the schema.
 */

export type AdapterAvailability =
  /** Credentials present, adapter implemented, ready to use. */
  | { state: "available" }
  /** No platform app credentials on this deployment. */
  | { state: "configuration_required"; missingEnv: readonly string[] }
  /** Credentials present but the platform must approve the app first. */
  | { state: "awaiting_platform_approval"; detail: string }
  /** Credentials present, adapter not written yet. Distinct from the above. */
  | { state: "adapter_not_implemented"; detail: string };

export type OAuthStartResult = {
  authorizationUrl: string;
  /** Opaque state persisted server-side and verified on callback (CSRF defence). */
  state: string;
  /** PKCE verifier, stored httpOnly. Never reaches client JavaScript. */
  codeVerifier: string | null;
};

export type ConnectedAccountDraft = {
  platform: Platform;
  externalId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  accountKind: string | null;
  followerCount: number | null;
  /** Scopes the user actually consented to, not the ones we asked for. */
  grantedScopes: readonly string[];
  /** Capabilities resolved from those scopes plus the account kind. */
  grantedCapabilities: readonly string[];
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

export type ExternalMediaReference = { mediaId: string; uploadUrl?: string };
export type ExternalPostReference = {
  externalPostId: string;
  permalink: string | null;
};

export type PublishStatus =
  | { state: "pending" | "processing" }
  | { state: "published"; permalink: string | null }
  | { state: "failed"; code: string; message: string; retryable: boolean };

export type MetricSnapshot = {
  capturedAt: Date;
  /**
   * Null means the platform did not report the metric. It never means zero — the
   * distinction is what stops an analytics chart from inventing a flat line.
   */
  views: number | null;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  followersGained: number | null;
  averageWatchMs: number | null;
  completionRateBp: number | null;
  retentionCurve: readonly { positionBp: number; retainedBp: number }[] | null;
};

export type PublishPayload = {
  caption: string | null;
  firstComment: string | null;
  mediaUrl: string;
  mimeType: string;
  durationSeconds: number | null;
  /** Platform-specific fields, validated by the adapter before use. */
  options: Readonly<Record<string, unknown>>;
};

export interface SocialPlatformAdapter {
  readonly platform: Platform;

  /** Reports honestly whether this adapter can do anything on this deployment. */
  availability(): AdapterAvailability;

  getAuthorizationUrl(options: { redirectUri: string; scopes: readonly string[] }): Promise<OAuthStartResult>;

  /**
   * Exchanges the callback for one or more accounts.
   *
   * Returns an array because a single Meta authorisation can yield several Pages and
   * Instagram accounts, and forcing that into one return value would silently drop
   * the rest.
   */
  handleCallback(options: {
    code: string;
    state: string;
    codeVerifier: string | null;
    redirectUri: string;
  }): Promise<ConnectedAccountDraft[]>;

  refreshConnection(options: { refreshToken: string }): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  }>;

  /** Capabilities for a specific connected account, not a platform-wide guess. */
  getCapabilities(options: { accountKind: string; grantedScopes: readonly string[] }): Promise<
    readonly string[]
  >;

  validateContent(options: { payload: PublishPayload; accountKind: string }): Promise<ValidationResult>;

  uploadMedia(options: { accessToken: string; payload: PublishPayload }): Promise<ExternalMediaReference>;

  /** Where the platform supports drafts, so a human can review in-platform. */
  createDraft(options: {
    accessToken: string;
    media: ExternalMediaReference;
    payload: PublishPayload;
  }): Promise<ExternalPostReference>;

  publish(options: {
    accessToken: string;
    media: ExternalMediaReference;
    payload: PublishPayload;
    /** Passed through to the platform's own dedupe where one exists. */
    idempotencyKey: string;
  }): Promise<ExternalPostReference>;

  getPublishStatus(options: { accessToken: string; externalPostId: string }): Promise<PublishStatus>;

  fetchMetrics(options: {
    accessToken: string;
    externalPostId: string;
  }): Promise<readonly MetricSnapshot[]>;

  /** Revokes the token with the platform, not just locally. */
  disconnect(options: { accessToken: string }): Promise<void>;
}

/**
 * Base class for an unimplemented adapter.
 *
 * Every method throws a named error rather than returning a plausible empty value.
 * A stub that returned `[]` from `fetchMetrics` would look like "this account has no
 * data" — indistinguishable from a real empty result, and exactly the kind of quiet
 * fiction the brief forbids.
 */
export class UnimplementedAdapter implements SocialPlatformAdapter {
  constructor(
    readonly platform: Platform,
    private readonly requiredEnv: readonly string[],
    private readonly approvalNote: string,
  ) {}

  availability(): AdapterAvailability {
    const missing = this.requiredEnv.filter((name) => {
      const value = typeof process !== "undefined" ? process.env[name] : undefined;
      return !value || value.trim() === "";
    });

    if (missing.length > 0) {
      return { state: "configuration_required", missingEnv: missing };
    }
    // Credentials exist but no adapter consumes them. Reported separately from
    // "configuration required" because the fix is ours, not the user's.
    return {
      state: "adapter_not_implemented",
      detail: `${this.platform} credentials are configured, but the adapter is not implemented yet. ${this.approvalNote}`,
    };
  }

  private fail(operation: string): never {
    throw new AdapterNotImplementedError(this.platform, operation);
  }

  async getAuthorizationUrl(): Promise<OAuthStartResult> {
    this.fail("getAuthorizationUrl");
  }
  async handleCallback(): Promise<ConnectedAccountDraft[]> {
    this.fail("handleCallback");
  }
  async refreshConnection(): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null }> {
    this.fail("refreshConnection");
  }
  async getCapabilities(): Promise<readonly string[]> {
    this.fail("getCapabilities");
  }
  async validateContent(): Promise<ValidationResult> {
    this.fail("validateContent");
  }
  async uploadMedia(): Promise<ExternalMediaReference> {
    this.fail("uploadMedia");
  }
  async createDraft(): Promise<ExternalPostReference> {
    this.fail("createDraft");
  }
  async publish(): Promise<ExternalPostReference> {
    this.fail("publish");
  }
  async getPublishStatus(): Promise<PublishStatus> {
    this.fail("getPublishStatus");
  }
  async fetchMetrics(): Promise<readonly MetricSnapshot[]> {
    this.fail("fetchMetrics");
  }
  async disconnect(): Promise<void> {
    this.fail("disconnect");
  }
}

export class AdapterNotImplementedError extends Error {
  constructor(
    readonly platform: Platform,
    readonly operation: string,
  ) {
    super(
      `The ${platform} adapter does not implement ${operation}. This is a build gap, not a configuration problem — the operation was not attempted and nothing was changed.`,
    );
    this.name = "AdapterNotImplementedError";
  }
}

/**
 * Required environment and approval notes per platform.
 *
 * The approval notes are the honest part: three of the four platforms gate production
 * publishing behind a review process that can take weeks, and a product that hides
 * that until the first failed publish has misled its user.
 */
export const PLATFORM_REQUIREMENTS: Readonly<
  Record<Platform, { env: readonly string[]; approval: string }>
> = {
  instagram: {
    env: ["META_APP_ID", "META_APP_SECRET"],
    approval:
      "Instagram publishing requires a professional account, a linked Facebook Page, and Meta app review for instagram_content_publish.",
  },
  facebook: {
    env: ["META_APP_ID", "META_APP_SECRET"],
    approval: "Facebook Page publishing requires Meta app review for pages_manage_posts.",
  },
  tiktok: {
    env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    approval:
      "TikTok Direct Post requires an audited app. Unaudited apps can only create private, self-visible posts.",
  },
  youtube: {
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    approval:
      "YouTube uploads need OAuth consent-screen verification for the youtube.upload scope, and consume a large share of the daily quota.",
  },
};

const ADAPTERS: Readonly<Record<Platform, SocialPlatformAdapter>> = {
  instagram: new UnimplementedAdapter("instagram", PLATFORM_REQUIREMENTS.instagram.env, PLATFORM_REQUIREMENTS.instagram.approval),
  facebook: new UnimplementedAdapter("facebook", PLATFORM_REQUIREMENTS.facebook.env, PLATFORM_REQUIREMENTS.facebook.approval),
  tiktok: new UnimplementedAdapter("tiktok", PLATFORM_REQUIREMENTS.tiktok.env, PLATFORM_REQUIREMENTS.tiktok.approval),
  youtube: new UnimplementedAdapter("youtube", PLATFORM_REQUIREMENTS.youtube.env, PLATFORM_REQUIREMENTS.youtube.approval),
};

export function getAdapter(platform: Platform): SocialPlatformAdapter {
  return ADAPTERS[platform];
}

export function allAdapterAvailability(): Readonly<Record<Platform, AdapterAvailability>> {
  return {
    instagram: ADAPTERS.instagram.availability(),
    facebook: ADAPTERS.facebook.availability(),
    tiktok: ADAPTERS.tiktok.availability(),
    youtube: ADAPTERS.youtube.availability(),
  };
}

/** Maps an availability state to the UI label the brief specifies. */
export function availabilityLabel(availability: AdapterAvailability): string {
  switch (availability.state) {
    case "available":
      return "Available";
    case "configuration_required":
      return "Configuration required";
    case "awaiting_platform_approval":
      return "Awaiting platform approval";
    case "adapter_not_implemented":
      return "Not implemented yet";
  }
}
