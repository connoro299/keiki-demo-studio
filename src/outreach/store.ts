import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { defaultRepoRoot } from "@/cli/deps";
import type { Lead, XDraft } from "./types";

/** Local JSON store under <repo>/outreach. Override the root with OUTREACH_DIR. */
export function outreachRoot(repoRoot = defaultRepoRoot()): string {
  return process.env.OUTREACH_DIR ? path.resolve(process.env.OUTREACH_DIR) : path.join(repoRoot, "outreach");
}

export function leadDir(id: string, root = outreachRoot()): string {
  return path.join(root, "leads", id);
}

/** Stable lead id from a URL: domain slug + short hash, so re-adding a site is idempotent. */
export function leadIdFor(url: string): string {
  const normalized = normalizeUrl(url);
  const host = new URL(normalized).hostname.replace(/^www\./, "");
  const slug = host.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40);
  return `${slug}-${createHash("sha1").update(normalized).digest("hex").slice(0, 6)}`;
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function readLead(id: string, root = outreachRoot()): Lead | undefined {
  return readJson<Lead>(path.join(leadDir(id, root), "lead.json"));
}

export function writeLead(lead: Lead, root = outreachRoot()): Lead {
  const next = { ...lead, updatedAt: new Date().toISOString() };
  writeJsonAtomic(path.join(leadDir(lead.id, root), "lead.json"), next);
  return next;
}

export function listLeads(root = outreachRoot()): Lead[] {
  const dir = path.join(root, "leads");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((id) => readLead(id, root))
    .filter((lead): lead is Lead => Boolean(lead))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readXDraft(id: string, root = outreachRoot()): XDraft | undefined {
  return readJson<XDraft>(path.join(root, "x", `${id}.json`));
}

export function writeXDraft(draft: XDraft, root = outreachRoot()): XDraft {
  const next = { ...draft, updatedAt: new Date().toISOString() };
  writeJsonAtomic(path.join(root, "x", `${draft.id}.json`), next);
  return next;
}

export function listXDrafts(root = outreachRoot()): XDraft[] {
  const dir = path.join(root, "x");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson<XDraft>(path.join(dir, file)))
    .filter((draft): draft is XDraft => Boolean(draft))
    .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
}
