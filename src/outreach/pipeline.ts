import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DemoChannel } from "@/contracts";
import { defaultRepoRoot } from "@/cli/deps";
import type { ExportFormat, ExportOptions, ExportResult } from "@/export";
import { analyzeSite, type AnalyzeDeps, type AnalyzeOptions } from "./analyze";
import { inputContact, rankContacts } from "./contacts";
import { draftEmail, type EmailDeps } from "./email";
import { generateDemos, GenerationError, repoPath, type GenerateDeps } from "./generate";
import { leadDir, leadIdFor, listLeads, normalizeUrl, outreachRoot, readLead, writeLead } from "./store";
import type { Lead, LeadStatus, PipelineStep } from "./types";

export { analyzeSite } from "./analyze";
export { generateDemos, chooseChannels } from "./generate";
export { draftEmail } from "./email";

/**
 * Resumable lead pipeline: queued → analyzing → generating → rendering → drafted.
 * A failure records `failedStep` and `error`; the next run resumes from that step. Nothing is ever
 * sent — `drafted` means a person can now review lead.draft and send it themselves.
 */

export type ExportVideoFn = (flowPath: string, options: ExportOptions) => Promise<ExportResult>;

export type PipelineDeps = AnalyzeDeps & GenerateDeps & EmailDeps & {
  /** Outreach root (default <repo>/outreach or OUTREACH_DIR). */
  root?: string;
  repoRoot?: string;
  /** Video export. Default: dynamic import of src/export/video.ts; null forces "unavailable". */
  exportVideo?: ExportVideoFn | null;
};

export type ProcessOptions = {
  /** Restart from this step, discarding that step's output and everything after it. */
  from?: PipelineStep;
  channels?: DemoChannel[];
  count?: number;
  /** false: heuristic analysis, template email, and stop before generation (which needs Claude). */
  llm?: boolean;
  browser?: AnalyzeOptions["browser"];
  formats?: ExportFormat[];
  /** Also process leads a person already approved, sent or skipped. */
  force?: boolean;
};

export const STEPS: PipelineStep[] = ["analyze", "generate", "render", "draft"];
const STEP_STATUS: Record<PipelineStep, LeadStatus> = { analyze: "analyzing", generate: "generating", render: "rendering", draft: "rendering" };
const FINAL: ReadonlySet<LeadStatus> = new Set(["approved", "sent", "skipped"]);

function rootOf(deps: PipelineDeps): string {
  return deps.root ?? outreachRoot(deps.repoRoot ?? defaultRepoRoot());
}

/** Where a lead picks up: its failed step, else the first step whose output is missing. */
export function nextStep(lead: Lead): PipelineStep | undefined {
  if (lead.failedStep) return lead.failedStep;
  if (!lead.profile) return "analyze";
  if (!lead.demos.length) return "generate";
  if (lead.demos.some((demo) => !demo.mp4 && !demo.gif && !demo.poster && !demo.renderError)) return "render";
  if (!lead.draft) return "draft";
  return undefined;
}

/** Drops the output of `from` and every later step. */
export function resetFrom(lead: Lead, from: PipelineStep): Lead {
  const next: Lead = { ...lead, demos: [...lead.demos] };
  delete next.error;
  delete next.failedStep;
  const index = STEPS.indexOf(from);
  if (index <= 0) delete next.profile;
  if (index <= 1) next.demos = [];
  if (index <= 2) next.demos = next.demos.map(({ mp4: _mp4, gif: _gif, poster: _poster, renderError: _error, ...demo }) => demo);
  if (index <= 3) delete next.draft;
  next.status = "queued";
  return next;
}

// ---------------------------------------------------------------------------------------------
// Rendering

const VIDEO_MODULE = "../export/video.ts";

/** Loads exportVideo() if src/export/video.ts exists on this branch; undefined otherwise. */
export async function loadExportVideo(): Promise<ExportVideoFn | undefined> {
  const url = new URL(VIDEO_MODULE, import.meta.url);
  if (url.protocol === "file:" && !existsSync(fileURLToPath(url))) return undefined;
  try {
    const mod = (await import(/* @vite-ignore */ url.href)) as { exportVideo?: ExportVideoFn };
    return typeof mod.exportVideo === "function" ? mod.exportVideo : undefined;
  } catch (error) {
    if (/Cannot find module|ERR_MODULE_NOT_FOUND|Failed to load url/i.test(String((error as Error).message))) return undefined;
    throw error;
  }
}

function repoRelative(repoRoot: string, file: string | undefined): string | undefined {
  if (!file) return undefined;
  return path.isAbsolute(file) ? repoPath(repoRoot, file) : file;
}

async function renderDemos(lead: Lead, opts: ProcessOptions, deps: PipelineDeps): Promise<Lead> {
  const repoRoot = deps.repoRoot ?? defaultRepoRoot();
  const exportVideo = deps.exportVideo === null ? undefined : deps.exportVideo ?? (await loadExportVideo());
  const demos = [];
  for (const demo of lead.demos) {
    if (!exportVideo) {
      demos.push({ ...demo, renderError: "export unavailable: src/export/video.ts is not on this branch yet" });
      continue;
    }
    const outDir = path.join(leadDir(lead.id, rootOf(deps)), "media", demo.flowId);
    try {
      const result = await exportVideo(path.resolve(repoRoot, demo.flowPath), { outDir, formats: opts.formats ?? ["mp4", "gif", "poster"] });
      const { renderError: _old, ...rest } = demo;
      demos.push({
        ...rest,
        ...(result.mp4 ? { mp4: repoRelative(repoRoot, result.mp4) } : {}),
        ...(result.gif ? { gif: repoRelative(repoRoot, result.gif) } : {}),
        ...(result.poster ? { poster: repoRelative(repoRoot, result.poster) } : {}),
        durationMs: result.durationMs,
      });
    } catch (error) {
      throw new Error(`export failed for ${demo.flowId}: ${(error as Error).message}`);
    }
  }
  return { ...lead, demos };
}

// ---------------------------------------------------------------------------------------------
// Steps

async function runStep(step: PipelineStep, lead: Lead, opts: ProcessOptions, deps: PipelineDeps): Promise<Lead> {
  switch (step) {
    case "analyze": {
      const fromInput = inputContact(lead.input);
      const profile = await analyzeSite(lead.url, deps, {
        llm: opts.llm !== false,
        browser: opts.browser,
        inputEmail: fromInput.email,
        inputName: fromInput.name,
      });
      return { ...lead, profile };
    }
    case "generate": {
      const demos = await generateDemos(lead.profile!, { channels: opts.channels, count: opts.count, leadId: lead.id }, { ...deps, root: rootOf(deps) });
      return { ...lead, demos };
    }
    case "render":
      return renderDemos(lead, opts, deps);
    case "draft": {
      const profile = lead.profile!;
      // Re-rank in case the imported row changed since analysis.
      const fromInput = inputContact(lead.input);
      const contacts = fromInput.email ? rankContacts(profile.contacts.map((contact) => ({ ...contact })), { siteDomain: profile.domain, inputEmail: fromInput.email, inputName: fromInput.name }) : profile.contacts;
      const draft = await draftEmail({ ...lead, profile: { ...profile, contacts } }, { ...deps, llm: opts.llm });
      return { ...lead, draft };
    }
  }
}

export type ProcessResult = { lead: Lead; ran: PipelineStep[]; stoppedAt?: PipelineStep };

export async function processLead(id: string, opts: ProcessOptions = {}, deps: PipelineDeps = {}): Promise<ProcessResult> {
  const root = rootOf(deps);
  let lead = readLead(id, root);
  if (!lead) throw new Error(`no lead ${id}`);
  if (FINAL.has(lead.status) && !opts.force) return { lead, ran: [] };
  if (opts.from) lead = writeLead(resetFrom(lead, opts.from), root);
  const ran: PipelineStep[] = [];
  for (;;) {
    const step = nextStep(lead);
    if (!step) break;
    if (ran.includes(step)) {
      lead = writeLead({ ...lead, status: "failed", error: `${step} finished without producing its output`, failedStep: step }, root);
      return { lead, ran, stoppedAt: step };
    }
    if (step === "generate" && opts.llm === false) {
      lead = writeLead({ ...lead, status: "queued", notes: "analysis done; demo generation needs Claude (run without --no-llm)" }, root);
      return { lead, ran, stoppedAt: step };
    }
    lead = writeLead({ ...lead, status: STEP_STATUS[step] }, root);
    deps.log?.(`${id}: ${step}`);
    try {
      const updated = await runStep(step, lead, opts, deps);
      const { error: _error, failedStep: _failed, ...clean } = updated;
      lead = writeLead({ ...clean, status: STEP_STATUS[step] }, root);
      ran.push(step);
    } catch (error) {
      const message = error instanceof GenerationError
        ? `${error.message}: ${error.issues.slice(0, 5).map((issue) => `${issue.path} ${issue.message}`).join("; ")}`
        : (error as Error).message;
      lead = writeLead({ ...lead, status: "failed", error: message, failedStep: step }, root);
      return { lead, ran, stoppedAt: step };
    }
  }
  if (lead.draft && lead.status !== "drafted") {
    const { notes: _notes, ...rest } = lead;
    lead = writeLead({ ...rest, status: "drafted" }, root);
  }
  return { lead, ran };
}

// ---------------------------------------------------------------------------------------------
// Queue

export type AddInput = string | { url: string; input?: Record<string, string> };
export type AddResult = { added: Lead[]; existing: Lead[]; invalid: Array<{ input: string; reason: string }> };

export function addLeads(inputs: AddInput[], deps: Pick<PipelineDeps, "root" | "repoRoot"> = {}): AddResult {
  const root = rootOf(deps);
  const result: AddResult = { added: [], existing: [], invalid: [] };
  const seen = new Set<string>();
  for (const item of inputs) {
    const raw = typeof item === "string" ? item : item.url;
    const columns = typeof item === "string" ? undefined : item.input;
    let url: string;
    try {
      url = normalizeUrl(raw);
      const host = new URL(url).hostname;
      if (!host.includes(".") || /\s/.test(raw.trim())) throw new Error("not a domain");
    } catch {
      result.invalid.push({ input: raw, reason: "not a website URL or domain" });
      continue;
    }
    const id = leadIdFor(url);
    if (seen.has(id)) continue;
    seen.add(id);
    const existing = readLead(id, root);
    if (existing) {
      if (columns && Object.keys(columns).length) {
        result.existing.push(writeLead({ ...existing, input: { ...columns, ...existing.input } }, root));
      } else {
        result.existing.push(existing);
      }
      continue;
    }
    const now = new Date().toISOString();
    const lead: Lead = { id, url, status: "queued", createdAt: now, updatedAt: now, demos: [], ...(columns && Object.keys(columns).length ? { input: columns } : {}) };
    result.added.push(writeLead(lead, root));
  }
  return result;
}

const RUNNABLE: ReadonlySet<LeadStatus> = new Set(["queued", "failed", "analyzing", "generating", "rendering"]);

export type RunQueueOptions = ProcessOptions & {
  concurrency?: number;
  limit?: number;
  /** Only these leads (any status except approved/sent/skipped unless force). */
  ids?: string[];
};

export type RunQueueResult = { processed: ProcessResult[]; drafted: number; failed: number; waiting: number };

export async function runQueue(options: RunQueueOptions = {}, deps: PipelineDeps = {}): Promise<RunQueueResult> {
  const root = rootOf(deps);
  const { concurrency = 3, limit, ids, ...processOptions } = options;
  let leads = ids?.length
    ? ids.map((id) => readLead(id, root)).filter((lead): lead is Lead => Boolean(lead))
    : listLeads(root).filter((lead) => RUNNABLE.has(lead.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (limit !== undefined) leads = leads.slice(0, limit);
  const queue = [...leads];
  const processed: ProcessResult[] = [];
  const worker = async () => {
    for (;;) {
      const lead = queue.shift();
      if (!lead) return;
      try {
        processed.push(await processLead(lead.id, processOptions, deps));
      } catch (error) {
        const current = readLead(lead.id, root) ?? lead;
        processed.push({ lead: writeLead({ ...current, status: "failed", error: (error as Error).message }, root), ran: [] });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, worker));
  return {
    processed,
    drafted: processed.filter((result) => result.lead.status === "drafted").length,
    failed: processed.filter((result) => result.lead.status === "failed").length,
    waiting: processed.filter((result) => result.lead.status === "queued").length,
  };
}
