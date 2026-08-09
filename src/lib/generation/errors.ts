export type GenerationErrorCode =
  | "INVALID_API_KEY"
  | "INSUFFICIENT_PROVIDER_BALANCE"
  | "MODEL_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "CONTENT_REJECTED"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "DOWNLOAD_FAILED"
  | "ASSET_VALIDATION_FAILED"
  | "VOICE_GENERATION_FAILED"
  | "REMOTION_FAILED"
  | "STORAGE_FAILED"
  | "UNKNOWN_ERROR";

/** Maps provider/transport vocabulary onto the stable codes the product UI understands. */
export function classifyGenerationError(
  code: string | null | undefined,
  message: string | null | undefined,
): GenerationErrorCode {
  const value = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (/\b401\b|unauthori[sz]ed|invalid.{0,12}(api.)?key|authentication/.test(value)) return "INVALID_API_KEY";
  if (/\b402\b|insufficient.{0,18}(balance|fund|credit)|payment required|out of credits/.test(value)) return "INSUFFICIENT_PROVIDER_BALANCE";
  if (/model.{0,18}(not found|does not exist)|\b404\b/.test(value)) return "MODEL_NOT_FOUND";
  if (/model.{0,18}unavailable|temporarily unavailable/.test(value)) return "MODEL_UNAVAILABLE";
  if (/content.{0,18}(reject|moderation)|safety policy|blocked prompt/.test(value)) return "CONTENT_REJECTED";
  if (/\b400\b|invalid input|validation/.test(value)) return "INVALID_INPUT";
  if (/\b429\b|rate.?limit|too many requests/.test(value)) return "RATE_LIMITED";
  if (/timeout|timed out|\b408\b|\b504\b/.test(value)) return "PROVIDER_TIMEOUT";
  if (/download|ingest/.test(value)) return "DOWNLOAD_FAILED";
  if (/storage|upload/.test(value)) return "STORAGE_FAILED";
  if (/asset.{0,18}invalid|invalid.{0,18}asset/.test(value)) return "ASSET_VALIDATION_FAILED";
  if (/voice/.test(value)) return "VOICE_GENERATION_FAILED";
  if (/remotion|render/.test(value)) return "REMOTION_FAILED";
  if (value.trim()) return "PROVIDER_ERROR";
  return "UNKNOWN_ERROR";
}

export function userMessageForGenerationError(
  code: GenerationErrorCode,
  provider: string,
  fallback: string,
): string {
  if (code === "INSUFFICIENT_PROVIDER_BALANCE") {
    return `${provider} does not have enough balance to complete this generation.`;
  }
  if (code === "RATE_LIMITED") {
    return "The generation provider is temporarily rate limited. You can retry this step.";
  }
  if (code === "CONTENT_REJECTED") {
    return "The provider rejected this request. Edit the prompt or choose another model.";
  }
  if (code === "INVALID_API_KEY") {
    return `${provider} authentication failed. An administrator needs to verify the provider configuration.`;
  }
  return fallback;
}
