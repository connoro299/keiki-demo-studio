import { LLM_UNAVAILABLE_MESSAGE, llmStatus, type LlmStatus } from "../llm";

/** The shared "no Claude access" message, minus the pipeline-only --no-llm hint. */
export const LLM_UNAVAILABLE = `${LLM_UNAVAILABLE_MESSAGE.replace(/\s*Use --no-llm[\s\S]*$/, "")} Nothing was drafted.`;

export class LlmUnavailableError extends Error {
  constructor(message = LLM_UNAVAILABLE) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

/**
 * Preflight via llm.ts's llmStatus(): an API key, or a signed-in `claude` CLI. Costs nothing.
 * `status` is injectable for tests.
 */
export async function checkLlm(status: () => Promise<LlmStatus> = llmStatus): Promise<{ ok: true; via: "api" | "cli" } | { ok: false; message: string }> {
  const result = await status();
  return result.ok ? result : { ok: false, message: LLM_UNAVAILABLE };
}

/** Errors from llm.ts that mean no call can succeed, so the whole run should stop. */
export function isLlmUnavailable(error: unknown): boolean {
  if (error instanceof LlmUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not logged in|please run \/login|could not run .*claude|no claude access|Anthropic API 401|invalid x-api-key|authentication_error/i.test(message);
}
