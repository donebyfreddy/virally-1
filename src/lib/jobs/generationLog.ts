type GenerationLogEntry = {
  contentId: string | null;
  generationJobId: string;
  workspaceId: string;
  provider: string | null;
  model: string | null;
  stage: string;
  durationMs?: number;
  status: string;
  errorCode?: string | null;
};

/** Structured production telemetry. Deliberately accepts no prompt or credential fields. */
export function logGenerationStage(entry: GenerationLogEntry): void {
  console.info(JSON.stringify({ event: "content_generation_stage", ...entry }));
}
