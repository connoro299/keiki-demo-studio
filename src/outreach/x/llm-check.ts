import { spawnSync } from "node:child_process";

export const LLM_UNAVAILABLE =
  "Claude is not available: set ANTHROPIC_API_KEY in .env.local, or sign in to Claude Code (run `claude`, then /login). Nothing was drafted.";

export class LlmUnavailableError extends Error {
  constructor(message = LLM_UNAVAILABLE) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

type Runner = (cmd: string, args: string[]) => { status: number | null; stdout: string; error?: Error };

const defaultRunner: Runner = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 15000 });
  return { status: result.status, stdout: result.stdout ?? "", error: result.error };
};

/**
 * Same order as llm.ts: the Messages API when ANTHROPIC_API_KEY is set, else the local `claude`
 * CLI, which must be signed in (`claude auth status` reports loggedIn). Costs nothing to check.
 */
export function checkLlm(env: NodeJS.ProcessEnv = process.env, run: Runner = defaultRunner): { ok: true; via: "api" | "cli" } | { ok: false; message: string } {
  if (env.ANTHROPIC_API_KEY) return { ok: true, via: "api" };
  const bin = env.CLAUDE_BIN ?? "claude";
  const result = run(bin, ["auth", "status"]);
  if (result.error) return { ok: false, message: LLM_UNAVAILABLE };
  try {
    const status = JSON.parse(result.stdout) as { loggedIn?: boolean };
    if (status.loggedIn) return { ok: true, via: "cli" };
  } catch {
    // Older CLIs print text; trust a zero exit.
    if (result.status === 0) return { ok: true, via: "cli" };
  }
  return { ok: false, message: LLM_UNAVAILABLE };
}

/** Errors from llm.ts that mean no call can succeed, so the whole run should stop. */
export function isLlmUnavailable(error: unknown): boolean {
  if (error instanceof LlmUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not logged in|please run \/login|could not run .*claude|Anthropic API 401|invalid x-api-key|authentication_error/i.test(message);
}
