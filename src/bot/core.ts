import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import type { DemoChannel } from "@/contracts";
import { analyzeSite } from "@/outreach/analyze";
import { draftEmail } from "@/outreach/email";
import { chooseChannels, generateDemo, slug } from "@/outreach/generate";
import { complete, parseJsonReply, type CompleteOptions } from "@/outreach/llm";
import { leadIdFor, normalizeUrl, outreachRoot, readLead, writeLead } from "@/outreach/store";
import type { Lead, OutreachDraft, SiteProfile } from "@/outreach/types";
import { safeFetch } from "@/studio/server";
import { encodeShare } from "@/studio/share";

/**
 * One demo job, shared by every entry point (Slack, the webhook API, MCP):
 * read the site → write the conversation → render MP4 + GIF → short share link → email draft.
 * Every finished job is also saved as an outreach Lead so the dashboard and CLI see it.
 */
export type DemoJobInput = { url: string; channel?: DemoChannel; video?: boolean; previousStories?: string[] };
/** Injectable model call (tests, alternate providers). Defaults to Claude via src/outreach/llm.ts. */
export type DemoJobDeps = { completeJson?: <T>(options: CompleteOptions) => Promise<T> };
export type DemoJobProgress = "reading" | "writing" | "rendering" | "drafting";
export type DemoJobResult = {
  leadId: string;
  url: string;
  profile: SiteProfile;
  channel: DemoChannel;
  story: string;
  flow: Record<string, unknown>;
  link?: string;
  mp4?: string;
  gif?: string;
  poster?: string;
  /** Public URL of the MP4 (Blob), for webhook/MCP callers that need to forward the video. */
  mp4Url?: string;
  draft: OutreachDraft;
  renderError?: string;
};

export const CHANNEL_WORDS: Record<string, DemoChannel> = { imessage: "imessage", sms: "sms", text: "sms", whatsapp: "whatsapp", telegram: "telegram", slack: "slack" };

const model = () => process.env.STUDIO_MODEL ?? process.env.OUTREACH_MODEL ?? "claude-sonnet-5-5";

async function completeJson<T>(options: CompleteOptions): Promise<T> {
  const text = await complete({ ...options, model: options.model ?? model(), system: `${options.system}\n\nReply with JSON only. No prose, no markdown fences.` });
  return parseJsonReply<T>(text);
}

export function studioUrl(): string {
  return (process.env.STUDIO_URL ?? "https://keiki-demo-studio.vercel.app").replace(/\/$/, "");
}

/** Short /?s= link on the studio (needs BLOB_READ_WRITE_TOKEN for the studio's Blob store), else the long /?d= link. */
export async function makeShareLink(flow: Record<string, unknown>, channel: DemoChannel): Promise<string> {
  const token = await encodeShare(flow as never, channel);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (byte) => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 56]).join("");
    await put(`d/${id}.txt`, token, { access: "public", addRandomSuffix: false, contentType: "text/plain" });
    return `${studioUrl()}/?s=${id}`;
  }
  return `${studioUrl()}/?d=${token}`;
}

export async function runDemoJob(input: DemoJobInput, onProgress: (step: DemoJobProgress) => void = () => undefined, deps: DemoJobDeps = {}): Promise<DemoJobResult> {
  const ask = deps.completeJson ?? completeJson;
  const url = normalizeUrl(input.url);
  const leadId = leadIdFor(url);

  onProgress("reading");
  const profile = await analyzeSite(url, { fetch: safeFetch, completeJson: ask }, { browser: "auto", maxPages: 6 });

  onProgress("writing");
  const channel = input.channel ?? chooseChannels(profile, 1)[0] ?? "imessage";
  const flowId = `${slug(profile.name, 24)}-${channel}-${Date.now().toString(36)}`;
  const demo = await generateDemo(profile, channel, { flowId, previousStories: input.previousStories ?? [], maxRepairs: 2 }, { completeJson: ask });

  const root = outreachRoot();
  const flowDir = path.join(root, "leads", leadId, "flows");
  mkdirSync(flowDir, { recursive: true });
  const flowPath = path.join(flowDir, `${flowId}.json`);
  writeFileSync(flowPath, `${JSON.stringify(demo.flow, null, 2)}\n`);

  const result: Partial<DemoJobResult> = { leadId, url, profile, channel, story: demo.story, flow: demo.flow };
  result.link = await makeShareLink(demo.flow, channel).catch(() => undefined);

  if (input.video !== false) {
    onProgress("rendering");
    try {
      const { exportVideo } = await import("@/export/video");
      const outDir = path.join(root, "leads", leadId, "media", flowId);
      const exported = await exportVideo(flowPath, { outDir, formats: ["mp4", "gif", "poster"] });
      Object.assign(result, { mp4: exported.mp4, gif: exported.gif, poster: exported.poster });
      if (exported.mp4 && process.env.BLOB_READ_WRITE_TOKEN) {
        const { readFileSync } = await import("node:fs");
        const blob = await put(`v/${flowId}.mp4`, readFileSync(exported.mp4), { access: "public", addRandomSuffix: true, contentType: "video/mp4" }).catch(() => undefined);
        if (blob) result.mp4Url = blob.url;
      }
    } catch (error) {
      result.renderError = (error as Error).message;
    }
  }

  onProgress("drafting");
  const now = new Date().toISOString();
  const existing = readLead(leadId, root);
  const lead: Lead = {
    id: leadId, url, status: "drafted", createdAt: existing?.createdAt ?? now, updatedAt: now, profile,
    demos: [{ channel, flowId, flowPath: path.relative(process.cwd(), flowPath), story: demo.story, durationMs: demo.durationMs, ...(result.mp4 ? { mp4: result.mp4, gif: result.gif, poster: result.poster } : {}), ...(result.renderError ? { renderError: result.renderError } : {}) }],
  };
  const draft = await draftEmail(lead, { completeJson: ask });
  if (result.link && !draft.body.includes(result.link)) {
    const signOff = draft.body.search(/\n[^\n]*, Keiki\b/);
    const line = `Here's the 20-second demo: ${result.link}\n`;
    draft.body = signOff >= 0 ? `${draft.body.slice(0, signOff)}\n${line}${draft.body.slice(signOff)}` : `${draft.body}\n\n${line}`;
  }
  writeLead({ ...lead, draft }, root);
  return { ...(result as DemoJobResult), draft };
}

/** Marks a lead approved/skipped from Slack buttons or the API. Nothing is sent from here. */
export function setLeadStatus(leadId: string, status: "approved" | "skipped" | "sent"): Lead | undefined {
  const lead = readLead(leadId);
  if (!lead) return undefined;
  return writeLead({ ...lead, status });
}

/** Pull websites out of free text, Slack's <https://x.com|x.com> links, or CSV rows. */
export function extractSites(text: string): string[] {
  const unwrapped = text.replace(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g, " $1 ").replace(/<mailto:[^>]+>/g, " ");
  const found = unwrapped
    .split(/[\s,;"']+/)
    .map((part) => part.trim().replace(/[).,]+$/, ""))
    .filter((part) => /^(https?:\/\/)?(?!.*@)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(part))
    .filter((part) => !/\.(png|jpe?g|gif|csv|pdf|mp4)$/i.test(part));
  return [...new Set(found.map((site) => { try { return normalizeUrl(site); } catch { return ""; } }).filter(Boolean))];
}

export function channelFrom(text: string): DemoChannel | undefined {
  const match = text.toLowerCase().match(/\b(?:on|via|over|in)\s+(imessage|sms|text|whatsapp|telegram|slack)\b/);
  return match ? CHANNEL_WORDS[match[1]] : undefined;
}

export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Run jobs with a small concurrency limit. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}
