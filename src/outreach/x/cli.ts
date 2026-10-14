import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { completeJson as realCompleteJson } from "../llm";
import { listXDrafts, outreachRoot, readXDraft, writeXDraft } from "../store";
import type { XDraft, XDraftStatus } from "../types";
import { seedFixtures } from "../fixtures";
import { checkLlm } from "./llm-check";
import { PRESET_NAMES, type PresetName } from "./presets";
import { candidatesFromFile, candidatesFromUrls, draftCandidates, draftIdFor, scanX, type DraftRun, type QueueDeps } from "./queue";
import type { XCandidate } from "./search";
import { DEFAULT_THRESHOLD } from "./triage";
import { parseTweetUrl, replyIntentUrl, tweetLength, type FetchLike } from "./tweets";

/**
 * X reply draft queue. Finds people describing a pain an agent solves, drafts a reply with Claude,
 * and queues it for a human. NOTHING IS POSTED: the reviewer opens X's reply intent and posts it.
 *
 *   npm run x -- scan [--preset all|dms|receptionist|bookings|support] [--query "<q>"] [--max 50]
 *   npm run x -- add <tweet-url…>
 *   npm run x -- import <file.json>
 *   npm run x -- list [--status pending|approved|posted|skipped|all]
 *   npm run x -- show <id> | skip <id> | approve <id> | intent <id>
 *   npm run x -- seed-fixtures [--dir <path>] [--force]
 *
 * Shared flags: --threshold 0.6, --demo (attach a pipeline demo when a site is found),
 * --concurrency 3, --json.
 */
export const USAGE = `usage: npm run x -- <command> [options]

Find tweets:
  scan [--preset all|${PRESET_NAMES.join("|")}] [--query "<q>"] [--max 50]
                          X API v2 recent search (needs X_BEARER_TOKEN)
  add <tweet-url…>        look up public tweets via oEmbed (no credentials)
  import <file.json>      X API search response, [tweets], or { tweets: [...] }
    --threshold 0.6       drafts scoring below this are saved as skipped
    --demo                attach a demo video when the author's site is found
    --concurrency 3       parallel Claude calls

Review:
  list [--status pending|approved|posted|skipped|all]
  show <id>               id, tweet id, or tweet URL
  approve <id> | skip <id>
  intent <id>             print the X reply link to open and post yourself

Other:
  seed-fixtures [--dir <path>] [--force]   sample data for the dashboard
  --json                  machine-readable output on any command

Nothing is ever posted automatically. Review drafts at /?view=outreach (npm run dev).`;

export type CliIo = { out: (line: string) => void; err: (line: string) => void };

export type CliDeps = Partial<QueueDeps> & {
  env?: NodeJS.ProcessEnv;
  io?: CliIo;
  /** Skip the Claude availability check (tests inject completeJson). */
  skipLlmCheck?: boolean;
};

type Flags = { _: string[]; [key: string]: string | boolean | string[] };

const BOOLEAN_FLAGS = new Set(["json", "demo", "force", "help"]);

export function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") flags.help = true;
    else if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
      if (BOOLEAN_FLAGS.has(key)) flags[key] = inline === undefined ? true : inline !== "false";
      else flags[key] = inline ?? argv[++i] ?? "";
    } else flags._.push(arg);
  }
  return flags;
}

function str(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(flags: Flags, key: string, fallback: number): number {
  const value = str(flags, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new UsageError(`--${key} must be a number`);
  return parsed;
}

class UsageError extends Error {}

/** Resolve "x-123", "123" or a tweet URL to a stored draft. */
export function findDraft(ref: string, root: string): XDraft | undefined {
  const fromUrl = parseTweetUrl(ref)?.id;
  const id = fromUrl ? draftIdFor(fromUrl) : /^\d+$/.test(ref) ? draftIdFor(ref) : ref;
  return readXDraft(id, root);
}

export async function runXCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io: CliIo = deps.io ?? { out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`) };
  const env = deps.env ?? process.env;
  let flags: Flags;
  try {
    flags = parseArgs(argv);
  } catch (error) {
    io.err((error as Error).message);
    return 1;
  }
  const json = Boolean(flags.json);
  const [command, ...rest] = flags._;
  const root = deps.root ?? outreachRoot();
  const emit = (value: unknown, human: () => void) => (json ? io.out(JSON.stringify(value, null, 2)) : human());
  const fail = (code: number, message: string) => {
    if (json) io.out(JSON.stringify({ ok: false, error: message }));
    else io.err(message);
    return code;
  };

  if (!command || flags.help || command === "help") {
    io.out(USAGE);
    return command || flags.help ? 0 : 1;
  }

  try {
    switch (command) {
      case "scan":
      case "add":
      case "import": {
        const threshold = num(flags, "threshold", DEFAULT_THRESHOLD);
        const concurrency = num(flags, "concurrency", 3);
        const max = num(flags, "max", 50);
        const fetchImpl: FetchLike | undefined = deps.fetchImpl;
        const log = json ? undefined : io.out;

        // Validate source inputs before spending anything.
        let token: string | undefined;
        if (command === "scan") {
          token = env.X_BEARER_TOKEN;
          if (!token) return fail(3, "scan needs X_BEARER_TOKEN (X API v2, recent search) in .env.local. Without it, use `add <tweet-url…>` or `import <file.json>`.");
          const preset = (str(flags, "preset") ?? "all") as PresetName | "all";
          if (preset !== "all" && !PRESET_NAMES.includes(preset)) throw new UsageError(`unknown preset "${preset}"; choose all, ${PRESET_NAMES.join(", ")}`);
        }
        if (command === "add" && rest.length === 0) throw new UsageError("add needs at least one tweet URL");
        if (command === "add") {
          const bad = rest.filter((url) => !parseTweetUrl(url));
          if (bad.length) throw new UsageError(`not tweet URLs: ${bad.join(", ")}`);
        }
        if (command === "import" && !rest[0]) throw new UsageError("import needs a JSON file");

        if (!deps.completeJson && !deps.skipLlmCheck) {
          const llm = checkLlm(env);
          if (!llm.ok) return fail(3, llm.message);
        }

        let candidates: XCandidate[] = [];
        const sourceFailures: Array<{ url: string; error: string }> = [];
        let sourceError: string | undefined;
        if (command === "scan") {
          const result = await scanX({ token: token!, query: str(flags, "query"), preset: (str(flags, "preset") ?? "all") as PresetName | "all", max }, { fetchImpl, log });
          candidates = result.candidates;
          sourceError = result.error;
          if (sourceError) io.err(sourceError);
        } else if (command === "add") {
          const result = await candidatesFromUrls(rest, { fetchImpl });
          candidates = result.candidates;
          sourceFailures.push(...result.failed);
        } else {
          const result = await candidatesFromFile(path.resolve(rest[0]), { fetchImpl });
          candidates = result.candidates;
          sourceFailures.push(...result.failed);
        }
        for (const failure of sourceFailures) io.err(`could not read ${failure.url}: ${failure.error}`);
        log?.(`${candidates.length} tweet(s) to triage`);

        const run: DraftRun = await draftCandidates(
          candidates,
          { completeJson: deps.completeJson ?? realCompleteJson, fetchImpl, root, loadPipeline: deps.loadPipeline, log },
          { threshold, demo: Boolean(flags.demo), concurrency },
        );
        run.sourceError = sourceError;
        for (const failure of run.demoErrors) io.err(`demo for ${failure.tweetId}: ${failure.error}`);
        emit(
          { ok: true, found: candidates.length, drafted: run.drafted, belowThreshold: run.belowThreshold.map((d) => d.id), duplicates: run.duplicates, failed: [...run.failed, ...sourceFailures], demoErrors: run.demoErrors, sourceError },
          () => {
            io.out("");
            io.out(`${run.drafted.length} drafted · ${run.belowThreshold.length} below ${threshold} · ${run.duplicates.length} already queued · ${run.failed.length + sourceFailures.length} failed`);
            for (const draft of run.drafted) io.out(summaryLine(draft));
            if (run.drafted.length) io.out("\nReview them at /?view=outreach (npm run dev), or `npm run x -- show <id>`.");
          },
        );
        return run.failed.length && !run.drafted.length ? 2 : 0;
      }

      case "list": {
        const status = str(flags, "status") ?? "pending";
        const all = listXDrafts(root);
        const drafts = status === "all" ? all : all.filter((draft) => draft.status === status);
        emit(drafts, () => {
          if (!drafts.length) {
            io.out(all.length ? `no ${status} drafts (${all.length} total; try --status all)` : "the X queue is empty. Try: npm run x -- add <tweet-url>");
            return;
          }
          for (const draft of drafts) io.out(summaryLine(draft));
        });
        return 0;
      }

      case "show":
      case "intent": {
        if (!rest[0]) throw new UsageError(`${command} needs a draft id`);
        const draft = findDraft(rest[0], root);
        if (!draft) return fail(2, `no draft ${rest[0]}`);
        const intent = replyIntentUrl(draft.tweet.id, draft.reply);
        if (command === "intent") {
          emit({ id: draft.id, intent }, () => io.out(intent));
          return 0;
        }
        emit({ ...draft, intent }, () => io.out(detail(draft, intent)));
        return 0;
      }

      case "skip":
      case "approve": {
        if (!rest[0]) throw new UsageError(`${command} needs a draft id`);
        const draft = findDraft(rest[0], root);
        if (!draft) return fail(2, `no draft ${rest[0]}`);
        const status: XDraftStatus = command === "skip" ? "skipped" : "approved";
        const next = writeXDraft({ ...draft, status }, root);
        emit(next, () => io.out(`${next.id} → ${status}`));
        return 0;
      }

      case "seed-fixtures": {
        const dir = path.resolve(str(flags, "dir") ?? env.OUTREACH_DIR ?? path.join(os.tmpdir(), "keiki-outreach-fixtures"));
        const result = seedFixtures(dir, { force: Boolean(flags.force) });
        emit({ ok: true, ...result }, () => {
          io.out(`seeded ${result.leads} leads and ${result.drafts} X drafts into ${result.root}`);
          io.out(`view them: OUTREACH_DIR=${result.root} npm run dev  →  /?view=outreach`);
        });
        return 0;
      }

      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      if (!json) io.err(`\n${USAGE}`);
      return 1;
    }
    return fail(error instanceof Error && error.name === "LlmUnavailableError" ? 3 : 2, (error as Error).message);
  }
}

function summaryLine(draft: XDraft): string {
  const text = draft.tweet.text.replace(/\s+/g, " ");
  const marker = draft.demo ? " [demo]" : "";
  return `${draft.id.padEnd(24)} ${draft.score.toFixed(2)}  ${draft.status.padEnd(8)} @${draft.tweet.authorHandle}${marker}  ${text.length > 70 ? `${text.slice(0, 69)}…` : text}`;
}

function detail(draft: XDraft, intent: string): string {
  const lines = [
    `${draft.id}  ·  ${draft.status}  ·  score ${draft.score.toFixed(2)}`,
    `@${draft.tweet.authorHandle}${draft.tweet.authorName ? ` (${draft.tweet.authorName})` : ""}  ${draft.tweet.url}`,
    "",
    indent(draft.tweet.text),
    "",
    `why: ${draft.reason}`,
    draft.site ? `site: ${draft.site}` : undefined,
    draft.demo?.mp4 ? `demo: ${draft.demo.mp4}  (attach it to the reply)` : undefined,
    "",
    `reply (${tweetLength(draft.reply)}/280):`,
    indent(draft.reply),
    ...(draft.alternatives ?? []).flatMap((alt, i) => ["", `alternative ${i + 1}:`, indent(alt)]),
    "",
    `post it yourself: ${intent}`,
  ];
  return lines.filter((line): line is string => line !== undefined).join("\n");
}

function indent(text: string): string {
  return text.split("\n").map((line) => `  ${line}`).join("\n");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runXCli(process.argv.slice(2)).then((code) => process.exit(code));
}
