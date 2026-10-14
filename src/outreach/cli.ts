import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { channelSchema, type DemoChannel } from "@/contracts";
import { analyzeSite } from "./analyze";
import { bestOutreachContact } from "./contacts";
import { csvToLeads } from "./csv";
import { LLM_UNAVAILABLE_MESSAGE, llmStatus, type LlmStatus } from "./llm";
import { addLeads, nextStep, processLead, runQueue, STEPS, type PipelineDeps } from "./pipeline";
import { listLeads, outreachRoot, readLead } from "./store";
import type { Lead, PipelineStep } from "./types";

export const HELP = `Keiki outreach: website → analysis → tailored demo flows → video → email DRAFT.
Nothing is ever sent. Drafts land in outreach/leads/<id>/lead.json for a person to review and send.

Usage: npm run outreach -- <command> [options]

  add <url…>                      Queue one or more websites (bare domains are fine)
  import <file.csv>               Queue every row; other columns are kept on the lead
      --url-column <name>         Column holding the website (default: website/url/domain/…)
  run                             Process queued (and failed, resumable) leads
      --concurrency <n>           Parallel leads (default 3)
      --limit <n>                 At most n leads this run
      --channels a,b              Force channels: imessage, sms, whatsapp, telegram, slack
      --count <n>                 Demos per lead (default: one per chosen channel)
      --id <leadId>               Only this lead (repeatable)
  list [--status <s>]             Table of leads: id, domain, status, best contact, demos
  show <id>                       Full lead JSON
  redo <id> [--from <step>]       Re-run from analyze | generate | render | draft (default: analyze)
  analyze <url>                   Analyze one site and print the profile (does not queue)

Common options:
  --json                          Machine-readable output
  --no-llm                        No Claude calls: heuristic analysis, template email; stops before generation
  --browser auto|always|never     Headless Chromium for JS-heavy sites (default auto)

Claude access: ANTHROPIC_API_KEY in .env.local, or a signed-in \`claude\` CLI.`;

export type Io = { stdout: { write(chunk: string): void }; stderr: { write(chunk: string): void } };

export type CliDeps = PipelineDeps & {
  io?: Io;
  llmStatus?: () => Promise<LlmStatus>;
};

type Parsed = { command?: string; positionals: string[]; flags: Map<string, string[]>; bools: Set<string> };

const BOOL_FLAGS = new Set(["json", "no-llm", "help", "force"]);
const VALUE_FLAGS = new Set(["url-column", "concurrency", "limit", "channels", "id", "from", "status", "count", "browser"]);

export class UsageError extends Error {}

export function parseCliArgs(argv: string[]): Parsed {
  const parsed: Parsed = { positionals: [], flags: new Map(), bools: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h") {
      parsed.bools.add("help");
      continue;
    }
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
      if (BOOL_FLAGS.has(name)) {
        parsed.bools.add(name);
        continue;
      }
      if (!VALUE_FLAGS.has(name)) throw new UsageError(`unknown option --${name}`);
      const value = inline ?? argv[i + 1];
      if (value === undefined || (inline === undefined && value.startsWith("--"))) throw new UsageError(`--${name} needs a value`);
      if (inline === undefined) i += 1;
      parsed.flags.set(name, [...(parsed.flags.get(name) ?? []), value]);
      continue;
    }
    if (!parsed.command) parsed.command = arg;
    else parsed.positionals.push(arg);
  }
  return parsed;
}

function flag(parsed: Parsed, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1);
}

function intFlag(parsed: Parsed, name: string): number | undefined {
  const value = flag(parsed, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new UsageError(`--${name} must be a positive integer`);
  return number;
}

function channelsFlag(parsed: Parsed): DemoChannel[] | undefined {
  const value = flag(parsed, "channels");
  if (!value) return undefined;
  const channels = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const channel of channels) {
    if (!channelSchema.safeParse(channel).success) throw new UsageError(`unknown channel "${channel}" (use imessage, sms, whatsapp, telegram, slack)`);
  }
  return channels as DemoChannel[];
}

function browserFlag(parsed: Parsed): "auto" | "always" | "never" | undefined {
  const value = flag(parsed, "browser");
  if (value === undefined) return undefined;
  if (!["auto", "always", "never"].includes(value)) throw new UsageError("--browser must be auto, always or never");
  return value as "auto" | "always" | "never";
}

function stepFlag(parsed: Parsed): PipelineStep {
  const value = flag(parsed, "from") ?? "analyze";
  if (!STEPS.includes(value as PipelineStep)) throw new UsageError(`--from must be one of ${STEPS.join(", ")}`);
  return value as PipelineStep;
}

function pad(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

export function leadRow(lead: Lead): { id: string; domain: string; status: string; contact: string; demos: string } {
  const contact = lead.profile ? bestOutreachContact(lead.profile.contacts) : undefined;
  const media = lead.demos.filter((demo) => demo.mp4 || demo.gif).length;
  return {
    id: lead.id,
    domain: lead.profile?.domain ?? new URL(lead.url).hostname.replace(/^www\./, ""),
    status: lead.status === "failed" && lead.failedStep ? `failed@${lead.failedStep}` : lead.status,
    contact: contact ? `${contact.kind === "email" ? "" : `${contact.kind}: `}${contact.value}` : "-",
    demos: lead.demos.length ? `${lead.demos.length} (${lead.demos.map((demo) => demo.channel).join(",")})${media ? ` ${media} rendered` : ""}` : "-",
  };
}

export function formatTable(leads: Lead[]): string {
  if (!leads.length) return "No leads yet. Add some with: npm run outreach -- add <url>";
  const rows = leads.map(leadRow);
  const head = `${pad("ID", 34)} ${pad("DOMAIN", 26)} ${pad("STATUS", 18)} ${pad("BEST CONTACT", 34)} DEMOS`;
  return [head, ...rows.map((row) => `${pad(row.id, 34)} ${pad(row.domain, 26)} ${pad(row.status, 18)} ${pad(row.contact, 34)} ${row.demos}`)].join("\n");
}

function summarize(lead: Lead): Record<string, unknown> {
  return { ...leadRow(lead), ...(lead.error ? { error: lead.error } : {}), ...(lead.notes ? { notes: lead.notes } : {}) };
}

export async function runOutreachCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io = deps.io ?? { stdout: process.stdout, stderr: process.stderr };
  const out = (line: string) => io.stdout.write(`${line}\n`);
  const err = (line: string) => io.stderr.write(`${line}\n`);
  let json = argv.includes("--json");
  const root = deps.root ?? outreachRoot(deps.repoRoot);
  const pipelineDeps: PipelineDeps = { ...deps, root, log: deps.log ?? ((message) => { if (!json) err(message); }) };

  const requireLlm = async (useLlm: boolean): Promise<boolean> => {
    if (!useLlm) return true;
    const status = await (deps.llmStatus ?? llmStatus)();
    if (status.ok) return true;
    if (json) out(JSON.stringify({ ok: false, error: LLM_UNAVAILABLE_MESSAGE, reason: status.reason }));
    else err(`${LLM_UNAVAILABLE_MESSAGE} (${status.reason})`);
    return false;
  };

  try {
    const parsed = parseCliArgs(argv);
    json = parsed.bools.has("json");
    const useLlm = !parsed.bools.has("no-llm");
    if (parsed.bools.has("help") || !parsed.command || parsed.command === "help") {
      out(HELP);
      return parsed.command || parsed.bools.has("help") ? 0 : 1;
    }

    switch (parsed.command) {
      case "add": {
        if (!parsed.positionals.length) throw new UsageError("add needs at least one URL: npm run outreach -- add example.com");
        const result = addLeads(parsed.positionals, { root });
        if (json) out(JSON.stringify({ ok: true, added: result.added.map((lead) => lead.id), existing: result.existing.map((lead) => lead.id), invalid: result.invalid }));
        else {
          for (const lead of result.added) out(`added    ${lead.id}  ${lead.url}`);
          for (const lead of result.existing) out(`exists   ${lead.id}  ${lead.url} (${lead.status})`);
          for (const bad of result.invalid) err(`skipped  ${bad.input}: ${bad.reason}`);
        }
        return result.invalid.length && !result.added.length && !result.existing.length ? 1 : 0;
      }

      case "import": {
        const file = parsed.positionals[0];
        if (!file) throw new UsageError("import needs a CSV file: npm run outreach -- import leads.csv");
        const resolved = path.resolve(file);
        if (!existsSync(resolved)) throw new UsageError(`file not found: ${resolved}`);
        const csv = csvToLeads(readFileSync(resolved, "utf8"), { urlColumn: flag(parsed, "url-column") });
        const result = addLeads(csv.inputs, { root });
        if (json) {
          out(JSON.stringify({ ok: true, urlColumn: csv.urlColumn, added: result.added.length, existing: result.existing.length, invalid: [...result.invalid, ...csv.skipped], ids: [...result.added, ...result.existing].map((lead) => lead.id) }));
        } else {
          out(`imported ${result.added.length} new, ${result.existing.length} already queued${csv.urlColumn ? ` (url column: ${csv.urlColumn})` : ""}`);
          for (const skip of csv.skipped) err(`row ${skip.row}: ${skip.reason}`);
          for (const bad of result.invalid) err(`skipped ${bad.input}: ${bad.reason}`);
        }
        return 0;
      }

      case "run": {
        const runOptions = {
          concurrency: intFlag(parsed, "concurrency") ?? 3,
          limit: intFlag(parsed, "limit"),
          channels: channelsFlag(parsed),
          count: intFlag(parsed, "count"),
          llm: useLlm,
          browser: browserFlag(parsed),
          force: parsed.bools.has("force"),
        };
        const ids = parsed.flags.get("id");
        const pending = ids?.length ? ids : listLeads(root).filter((lead) => ["queued", "failed", "analyzing", "generating", "rendering"].includes(lead.status)).map((lead) => lead.id);
        if (ids) for (const id of ids) if (!readLead(id, root)) throw new UsageError(`no lead ${id} (see: npm run outreach -- list)`);
        if (!pending.length) {
          if (json) out(JSON.stringify({ ok: true, processed: [], drafted: 0, failed: 0, waiting: 0 }));
          else out("Nothing to run. Add leads with: npm run outreach -- add <url>");
          return 0;
        }
        if (!(await requireLlm(useLlm))) return 3;
        const result = await runQueue({ ...runOptions, ids }, pipelineDeps);
        if (json) out(JSON.stringify({ ok: result.failed === 0, ...result, processed: result.processed.map((item) => ({ ...summarize(item.lead), ran: item.ran })) }));
        else {
          for (const item of result.processed) {
            const row = leadRow(item.lead);
            out(`${pad(row.id, 34)} ${pad(row.status, 18)} ${item.lead.error ?? item.lead.notes ?? row.contact}`);
          }
          out(`\n${result.drafted} drafted, ${result.failed} failed, ${result.waiting} waiting. Review drafts with: npm run outreach -- show <id>`);
        }
        return result.failed ? 2 : 0;
      }

      case "list": {
        const status = flag(parsed, "status");
        const leads = listLeads(root).filter((lead) => !status || lead.status === status);
        if (json) out(JSON.stringify({ ok: true, leads: leads.map(summarize) }));
        else out(formatTable(leads));
        return 0;
      }

      case "show": {
        const id = parsed.positionals[0];
        if (!id) throw new UsageError("show needs a lead id (see: npm run outreach -- list)");
        const lead = readLead(id, root);
        if (!lead) throw new UsageError(`no lead ${id} (see: npm run outreach -- list)`);
        out(JSON.stringify(lead, null, json ? 0 : 2));
        return 0;
      }

      case "redo": {
        const id = parsed.positionals[0];
        if (!id) throw new UsageError("redo needs a lead id: npm run outreach -- redo <id> --from generate");
        const lead = readLead(id, root);
        if (!lead) throw new UsageError(`no lead ${id} (see: npm run outreach -- list)`);
        const from = stepFlag(parsed);
        if (!(await requireLlm(useLlm && from !== "render"))) return 3;
        const result = await processLead(id, { from, channels: channelsFlag(parsed), count: intFlag(parsed, "count"), llm: useLlm, browser: browserFlag(parsed), force: true }, pipelineDeps);
        if (json) out(JSON.stringify({ ok: result.lead.status !== "failed", ...summarize(result.lead), ran: result.ran, next: nextStep(result.lead) ?? null }));
        else out(`${result.lead.id}: ${result.lead.status}${result.lead.error ? ` (${result.lead.error})` : ""} — ran ${result.ran.join(" → ") || "nothing"}`);
        return result.lead.status === "failed" ? 2 : 0;
      }

      case "analyze": {
        const url = parsed.positionals[0];
        if (!url) throw new UsageError("analyze needs a URL: npm run outreach -- analyze example.com --no-llm");
        if (!(await requireLlm(useLlm))) return 3;
        const profile = await analyzeSite(url, pipelineDeps, { llm: useLlm, browser: browserFlag(parsed) });
        if (json) out(JSON.stringify({ ok: true, profile }));
        else {
          const { textSample: _text, ...rest } = profile;
          out(JSON.stringify(rest, null, 2));
        }
        return 0;
      }

      default:
        throw new UsageError(`unknown command "${parsed.command}"\n\n${HELP}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) out(JSON.stringify({ ok: false, error: message }));
    else err(message);
    return error instanceof UsageError ? 1 : 2;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  runOutreachCli(process.argv.slice(2)).then((code) => process.exit(code));
}
