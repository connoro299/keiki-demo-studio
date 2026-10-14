import { spawn } from "node:child_process";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { defaultRepoRoot } from "@/cli/deps";
import { PIPELINE_UNAVAILABLE, loadPipeline, pipelineCliInstalled, pipelineInstalled, type PipelineModule } from "./optional-pipeline";
import { leadIdFor, listLeads, listXDrafts, normalizeUrl, outreachRoot, readLead, readXDraft, writeLead, writeXDraft } from "./store";
import type { ContactPoint, Lead, LeadStatus, XDraft, XDraftStatus } from "./types";

/**
 * JSON API for the review dashboard, mounted at /api/outreach/ by the Vite dev and preview servers
 * (see vite-plugin.ts). It reads and edits the local outreach store, queues sites for the pipeline,
 * and streams demo media. It never sends email or posts to X: the reviewer does that.
 *
 *   GET   leads              { leads, pipeline }
 *   POST  leads              { urls: string[] } → queued leads
 *   GET   lead/:id
 *   PATCH lead/:id           { draft?: { subject?, body?, to? }, status?, notes? }
 *   POST  run                { concurrency? } → starts `npm run outreach -- run` detached (501 without the pipeline CLI)
 *   GET   x                  { drafts }
 *   PATCH x/:id              { reply?, status?, notes? }
 *   GET   file?path=…        media from inside the outreach dir, with Range support
 */
export const API_PREFIX = "/api/outreach/";

export type RunSpawner = (args: { cwd: string; env: NodeJS.ProcessEnv; concurrency?: number }) => { pid?: number };

export type ApiOptions = {
  /** Outreach root, resolved per request so OUTREACH_DIR changes are picked up. */
  root?: () => string;
  repoRoot?: string;
  loadPipeline?: () => Promise<PipelineModule | null>;
  pipelineCliInstalled?: () => boolean;
  spawnRun?: RunSpawner;
};

const LEAD_STATUSES_SETTABLE: LeadStatus[] = ["approved", "sent", "skipped", "drafted"];
const X_STATUSES_SETTABLE: XDraftStatus[] = ["approved", "posted", "skipped", "pending"];

const MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const defaultSpawnRun: RunSpawner = ({ cwd, env, concurrency }) => {
  const args = ["run", "outreach", "--", "run"];
  if (concurrency) args.push("--concurrency", String(concurrency));
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd, env, detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  return { pid: child.pid };
};

/** Connect-style handler. Resolves true when it handled the request, false to pass it on. */
export function createOutreachApi(options: ApiOptions = {}) {
  const getRoot = options.root ?? (() => outreachRoot());
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const getPipeline = options.loadPipeline ?? loadPipeline;
  const hasCli = options.pipelineCliInstalled ?? pipelineCliInstalled;
  const spawnRun = options.spawnRun ?? defaultSpawnRun;

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(API_PREFIX)) return false;
    const route = url.pathname.slice(API_PREFIX.length).replace(/\/$/, "");
    const [resource, rawId] = route.split("/", 2);
    const id = rawId ? decodeURIComponent(rawId) : undefined;
    const method = (req.method ?? "GET").toUpperCase();
    const root = getRoot();

    try {
      if (resource === "leads" && !id && method === "GET") {
        return json(res, 200, { leads: listLeads(root), pipeline: { installed: pipelineInstalled(), cli: hasCli() }, root });
      }
      if (resource === "leads" && !id && method === "POST") {
        const body = await readBody<{ urls?: unknown }>(req);
        return json(res, 201, await addLeads(body.urls, root, getPipeline));
      }
      if (resource === "lead" && id && method === "GET") {
        const lead = readLead(safeId(id), root);
        if (!lead) throw new HttpError(404, `no lead ${id}`);
        return json(res, 200, lead);
      }
      if (resource === "lead" && id && method === "PATCH") {
        const lead = readLead(safeId(id), root);
        if (!lead) throw new HttpError(404, `no lead ${id}`);
        return json(res, 200, writeLead(patchLead(lead, await readBody(req)), root));
      }
      if (resource === "run" && !id && method === "POST") {
        if (!hasCli()) throw new HttpError(501, `${PIPELINE_UNAVAILABLE}. Add sites now; run them once the pipeline branch is merged.`);
        const body = await readBody<{ concurrency?: unknown }>(req);
        const concurrency = body.concurrency === undefined ? undefined : Math.max(1, Math.min(8, Math.round(Number(body.concurrency)) || 1));
        const child = spawnRun({ cwd: repoRoot, env: { ...process.env, OUTREACH_DIR: root }, concurrency });
        return json(res, 202, { started: true, pid: child.pid, command: `npm run outreach -- run${concurrency ? ` --concurrency ${concurrency}` : ""}` });
      }
      if (resource === "x" && !id && method === "GET") {
        return json(res, 200, { drafts: listXDrafts(root), root });
      }
      if (resource === "x" && id && method === "GET") {
        const draft = readXDraft(safeId(id), root);
        if (!draft) throw new HttpError(404, `no X draft ${id}`);
        return json(res, 200, draft);
      }
      if (resource === "x" && id && method === "PATCH") {
        const draft = readXDraft(safeId(id), root);
        if (!draft) throw new HttpError(404, `no X draft ${id}`);
        return json(res, 200, writeXDraft(patchXDraft(draft, await readBody(req)), root));
      }
      if (resource === "file" && !id && (method === "GET" || method === "HEAD")) {
        serveFile(req, res, url.searchParams.get("path") ?? "", root, repoRoot, url.searchParams.has("download"));
        return true;
      }
      throw new HttpError(["leads", "lead", "x", "run", "file"].includes(resource) ? 405 : 404, `no route ${method} ${url.pathname}`);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return json(res, status, { error: (error as Error).message });
    }
  };
}

function json(res: ServerResponse, status: number, body: unknown): true {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
  return true;
}

async function readBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {} as T;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as T;
  } catch {
    throw new HttpError(400, "body must be a JSON object");
  }
}

/** Ids are file names in the store; refuse anything that could walk out of it. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || id.includes("..")) throw new HttpError(400, `bad id ${id}`);
  return id;
}

async function addLeads(urls: unknown, root: string, getPipeline: () => Promise<PipelineModule | null>): Promise<{ leads: Lead[]; via: "pipeline" | "store"; invalid: string[] }> {
  if (!Array.isArray(urls) || !urls.length) throw new HttpError(400, "send { urls: string[] }");
  const invalid: string[] = [];
  const normalized: string[] = [];
  for (const raw of urls.slice(0, 500)) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    try {
      const url = normalizeUrl(raw);
      if (!new URL(url).hostname.includes(".")) throw new Error("no host");
      if (!normalized.includes(url)) normalized.push(url);
    } catch {
      invalid.push(String(raw));
    }
  }
  if (!normalized.length) throw new HttpError(400, `no valid URLs${invalid.length ? `: ${invalid.join(", ")}` : ""}`);

  let pipeline: PipelineModule | null = null;
  try {
    pipeline = await getPipeline();
  } catch {
    pipeline = null;
  }
  if (pipeline) {
    // The pipeline owns lead creation; existing sites come back unchanged (adding is idempotent).
    const result = pipeline.addLeads(normalized, { root });
    return { leads: [...result.added, ...result.existing], via: "pipeline", invalid: [...invalid, ...result.invalid.map((entry) => entry.input)] };
  }

  const now = new Date().toISOString();
  const leads = normalized.map((url) => {
    const id = leadIdFor(url);
    return readLead(id, root) ?? writeLead({ id, url, status: "queued", demos: [], createdAt: now, updatedAt: now }, root);
  });
  return { leads, via: "store", invalid };
}

function isContact(value: unknown): value is ContactPoint {
  const contact = value as ContactPoint;
  return Boolean(contact) && typeof contact === "object" && typeof contact.value === "string" && typeof contact.kind === "string";
}

export function patchLead(lead: Lead, body: Record<string, unknown>): Lead {
  const next: Lead = { ...lead };
  if (body.status !== undefined) {
    if (!LEAD_STATUSES_SETTABLE.includes(body.status as LeadStatus)) throw new HttpError(400, `status must be one of ${LEAD_STATUSES_SETTABLE.join(", ")}`);
    next.status = body.status as LeadStatus;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") throw new HttpError(400, "notes must be a string");
    next.notes = body.notes;
  }
  if (body.draft !== undefined) {
    const patch = body.draft as Record<string, unknown>;
    if (!patch || typeof patch !== "object") throw new HttpError(400, "draft must be an object");
    const draft = { channel: "email" as const, subject: "", body: "", ...lead.draft };
    if (patch.subject !== undefined) {
      if (typeof patch.subject !== "string") throw new HttpError(400, "draft.subject must be a string");
      draft.subject = patch.subject;
    }
    if (patch.body !== undefined) {
      if (typeof patch.body !== "string") throw new HttpError(400, "draft.body must be a string");
      draft.body = patch.body;
    }
    if (patch.to !== undefined) {
      if (patch.to === null) delete (draft as { to?: ContactPoint }).to;
      else if (typeof patch.to === "string") draft.to = { kind: "email", value: patch.to, source: "manual", confidence: 1 };
      else if (isContact(patch.to)) draft.to = patch.to;
      else throw new HttpError(400, "draft.to must be an email string or a contact");
    }
    next.draft = draft;
  }
  return next;
}

export function patchXDraft(draft: XDraft, body: Record<string, unknown>): XDraft {
  const next: XDraft = { ...draft };
  if (body.reply !== undefined) {
    if (typeof body.reply !== "string") throw new HttpError(400, "reply must be a string");
    next.reply = body.reply;
  }
  if (body.status !== undefined) {
    if (!X_STATUSES_SETTABLE.includes(body.status as XDraftStatus)) throw new HttpError(400, `status must be one of ${X_STATUSES_SETTABLE.join(", ")}`);
    next.status = body.status as XDraftStatus;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") throw new HttpError(400, "notes must be a string");
    next.notes = body.notes;
  }
  return next;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" ? false : !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Resolve a media path from a lead or draft to a real file inside the outreach root. Accepts
 * repo-relative ("outreach/leads/…"), root-relative ("leads/…") and absolute paths. Anything that
 * lands outside the root, lexically or through a symlink, is refused.
 */
export function resolveMediaPath(requested: string, root: string, repoRoot: string): { file: string } | { status: 400 | 403 | 404; error: string } {
  if (!requested || requested.includes("\0")) return { status: 400, error: "path is required" };
  const absRoot = path.resolve(root);
  const candidates = path.isAbsolute(requested)
    ? [path.resolve(requested)]
    : [path.resolve(repoRoot, requested), path.resolve(absRoot, requested), path.resolve(absRoot, requested.replace(/^outreach[\\/]/, ""))];
  const inside = candidates.filter((candidate) => isInside(candidate, absRoot));
  if (!inside.length) return { status: 403, error: "path is outside the outreach dir" };
  const realRoot = existsSync(absRoot) ? realpathSync(absRoot) : absRoot;
  for (const candidate of inside) {
    if (!existsSync(candidate)) continue;
    const real = realpathSync(candidate);
    if (!isInside(real, realRoot)) return { status: 403, error: "path is outside the outreach dir" };
    if (!statSync(real).isFile()) continue;
    if (!MEDIA_TYPES[path.extname(real).toLowerCase()]) return { status: 403, error: "only media files are served" };
    return { file: real };
  }
  return { status: 404, error: "file not found" };
}

/** Parse a single-range "bytes=" header. Returns null for no/ignored range, "invalid" when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null; // multi-range or junk: serve the whole file
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";
  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

function serveFile(req: IncomingMessage, res: ServerResponse, requested: string, root: string, repoRoot: string, download: boolean): void {
  const resolved = resolveMediaPath(requested, root, repoRoot);
  if ("error" in resolved) {
    json(res, resolved.status, { error: resolved.error });
    return;
  }
  const { file } = resolved;
  const size = statSync(file).size;
  const type = MEDIA_TYPES[path.extname(file).toLowerCase()];
  res.setHeader("content-type", type);
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "no-cache");
  if (download) res.setHeader("content-disposition", `attachment; filename="${path.basename(file).replace(/"/g, "")}"`);

  const range = parseRange(req.headers.range, size);
  if (range === "invalid") {
    res.statusCode = 416;
    res.setHeader("content-range", `bytes */${size}`);
    res.end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  res.statusCode = range ? 206 : 200;
  if (range) res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
  res.setHeader("content-length", String(size === 0 ? 0 : end - start + 1));
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
}
