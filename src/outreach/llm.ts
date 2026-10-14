import { spawn } from "node:child_process";

/**
 * One Claude call. Uses the Messages API when ANTHROPIC_API_KEY is set, otherwise the local
 * `claude` CLI in print mode (the signed-in Claude Code subscription). OUTREACH_MODEL overrides
 * the model for both paths.
 */
export type CompleteOptions = {
  system: string;
  prompt: string;
  maxTokens?: number;
  model?: string;
};

export const DEFAULT_MODEL = "claude-opus-5-5";

export async function complete(options: CompleteOptions): Promise<string> {
  const model = options.model ?? process.env.OUTREACH_MODEL ?? DEFAULT_MODEL;
  if (process.env.ANTHROPIC_API_KEY) return viaApi({ ...options, model });
  return viaCli({ ...options, model });
}

/** complete() and parse the first JSON object or array in the reply. */
export async function completeJson<T>(options: CompleteOptions): Promise<T> {
  const text = await complete({
    ...options,
    system: `${options.system}\n\nReply with JSON only. No prose, no markdown fences.`,
  });
  return parseJsonReply<T>(text);
}

export function parseJsonReply<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error(`model reply had no JSON: ${body.slice(0, 200)}`);
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  return JSON.parse(body.slice(start, end + 1)) as T;
}

async function viaApi(options: Required<Pick<CompleteOptions, "model">> & CompleteOptions): Promise<string> {
  const base = process.env.ANTHROPIC_API_URL ?? "https://api.anthropic.com";
  const response = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens ?? 8000,
      system: options.system,
      messages: [{ role: "user", content: options.prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}

function viaCli(options: Required<Pick<CompleteOptions, "model">> & CompleteOptions): Promise<string> {
  const bin = process.env.CLAUDE_BIN ?? "claude";
  const args = [
    "-p", "--output-format", "json", "--no-session-persistence",
    "--model", options.model,
    "--tools", "",
    "--append-system-prompt", options.system,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => reject(new Error(`could not run ${bin}: ${error.message}. Set ANTHROPIC_API_KEY or install Claude Code.`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${bin} exited ${code}: ${err.slice(0, 400) || out.slice(0, 400)}`));
      try {
        const parsed = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (parsed.is_error) return reject(new Error(`claude CLI error: ${parsed.result ?? out.slice(0, 400)}`));
        resolve(parsed.result ?? "");
      } catch {
        resolve(out);
      }
    });
    child.stdin.end(options.prompt);
  });
}

/** The two calls every outreach step takes through `deps`, so tests can inject fakes. */
export type LlmDeps = {
  complete?: (options: CompleteOptions) => Promise<string>;
  completeJson?: <T>(options: CompleteOptions) => Promise<T>;
};

export type LlmStatus = { ok: true; via: "api" | "cli" } | { ok: false; reason: string };

export const LLM_UNAVAILABLE_MESSAGE =
  "No Claude access: set ANTHROPIC_API_KEY in .env.local, or sign in to Claude Code (claude auth login). " +
  "Use --no-llm to analyze sites heuristically without a model.";

/**
 * Cheap preflight so a batch fails fast instead of failing every lead. An API key wins; otherwise asks
 * the local `claude` CLI whether it is signed in (`claude auth status` prints JSON with `loggedIn`).
 */
export function llmStatus(): Promise<LlmStatus> {
  if (process.env.ANTHROPIC_API_KEY) return Promise.resolve({ ok: true, via: "api" });
  const bin = process.env.CLAUDE_BIN ?? "claude";
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (value: LlmStatus) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const child = spawn(bin, ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, reason: `${bin} auth status timed out` });
    }, 15000);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ ok: false, reason: `could not run ${bin}: ${error.message}` });
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out) as { loggedIn?: boolean };
        done(parsed.loggedIn ? { ok: true, via: "cli" } : { ok: false, reason: `${bin} is not signed in` });
      } catch {
        done({ ok: false, reason: `could not read ${bin} auth status` });
      }
    });
  });
}
