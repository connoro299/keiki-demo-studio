import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DemoChannel } from "@/contracts";
import { analyzeSite } from "@/outreach/analyze";
import { chooseChannels, generateDemo, slug } from "@/outreach/generate";
import { draftEmail } from "@/outreach/email";
import { complete, parseJsonReply, type CompleteOptions } from "@/outreach/llm";
import { leadIdFor, normalizeUrl } from "@/outreach/store";
import type { Lead, SiteProfile } from "@/outreach/types";

/**
 * POST /api/make — the studio's one endpoint. Streams NDJSON events so the UI can tick through steps:
 *   {type:"step", step:"read"|"write"|"email"}  {type:"profile", profile}  {type:"demo", channel, story, flow}
 *   {type:"email", draft}  {type:"error", code, message}  {type:"done"}
 * Body: { url, channel?, profile?, previousStories? }. Passing `profile` skips the site read (used by "Try another story").
 */
export type MakeRequest = { url?: string; channel?: DemoChannel; profile?: SiteProfile; previousStories?: string[] };
export type MakeEvent =
  | { type: "step"; step: "read" | "write" | "email" }
  | { type: "profile"; profile: SiteProfile }
  | { type: "demo"; channel: DemoChannel; story: string; flow: Record<string, unknown> }
  | { type: "email"; draft: Lead["draft"] }
  | { type: "error"; code: "missing_key" | "access" | "bad_url" | "blocked" | "failed"; message: string }
  | { type: "done" };

const CHANNELS = new Set<DemoChannel>(["imessage", "sms", "whatsapp", "telegram", "slack"]);
const MODEL = () => process.env.STUDIO_MODEL ?? process.env.OUTREACH_MODEL ?? "claude-sonnet-5-5";

async function completeJson<T>(options: CompleteOptions): Promise<T> {
  const text = await complete({ ...options, model: options.model ?? MODEL(), system: `${options.system}\n\nReply with JSON only. No prose, no markdown fences.` });
  return parseJsonReply<T>(text);
}

/** Rejects loopback, private, link-local and metadata addresses so the site reader can't be pointed inward. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80")) return true;
    const mapped = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedError("only http and https sites can be read");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new BlockedError("that address isn't a public website");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new BlockedError("that address isn't a public website");
}

class BlockedError extends Error {}

/** fetch that re-checks every redirect hop against assertPublicHost. */
export const safeFetch: typeof fetch = async (input, init) => {
  let url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  for (let hop = 0; hop < 5; hop += 1) {
    await assertPublicHost(url);
    const response = await fetch(url, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new BlockedError("too many redirects");
};

function authorized(request: Request): boolean {
  const code = process.env.STUDIO_ACCESS_CODE;
  return !code || request.headers.get("x-studio-code") === code;
}

export async function handleMake(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });
  const encoder = new TextEncoder();
  let body: MakeRequest;
  try {
    body = (await request.json()) as MakeRequest;
  } catch {
    body = {};
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: MakeEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await run(request, body, send);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send({ type: "error", code: error instanceof BlockedError ? "blocked" : "failed", message: friendly(message) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

async function run(request: Request, body: MakeRequest, send: (event: MakeEvent) => void): Promise<void> {
  if (!authorized(request)) return send({ type: "error", code: "access", message: "Enter the studio access code." });
  if (!process.env.ANTHROPIC_API_KEY) return send({ type: "error", code: "missing_key", message: "Add ANTHROPIC_API_KEY to this deployment's environment variables, then redeploy." });
  let url: string;
  try {
    url = normalizeUrl(body.url ?? body.profile?.url ?? "");
  } catch {
    return send({ type: "error", code: "bad_url", message: "That doesn't look like a website. Try something like sproutdental.com." });
  }

  let profile = body.profile;
  if (!profile) {
    send({ type: "step", step: "read" });
    profile = await analyzeSite(url, { fetch: safeFetch, completeJson }, { browser: "never", maxPages: 5, timeoutMs: 9000 });
  }
  send({ type: "profile", profile });

  send({ type: "step", step: "write" });
  const channel = body.channel && CHANNELS.has(body.channel) ? body.channel : chooseChannels(profile, 1)[0] ?? "imessage";
  const flowId = `${slug(profile.name, 24)}-${channel}-${Date.now().toString(36)}`;
  const demo = await generateDemo(profile, channel, { flowId, previousStories: body.previousStories ?? [], maxRepairs: 2 }, { completeJson });
  send({ type: "demo", channel, story: demo.story, flow: demo.flow });

  send({ type: "step", step: "email" });
  const now = new Date().toISOString();
  const lead: Lead = {
    id: leadIdFor(url), url, status: "drafted", createdAt: now, updatedAt: now, profile,
    demos: [{ channel, flowId, flowPath: "", story: demo.story, durationMs: demo.durationMs }],
  };
  const draft = await draftEmail(lead, { completeJson });
  send({ type: "email", draft });
  send({ type: "done" });
}

function friendly(message: string): string {
  if (/\b403\b|cloudflare|challenge/i.test(message)) return "That site blocks automated readers, so we couldn't read it. Try another site.";
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return "We couldn't find that website. Check the address.";
  if (/abort|timeout/i.test(message)) return "That site took too long to respond. Try again or try another site.";
  if (/Anthropic API 401/.test(message)) return "The Anthropic API key on this deployment was rejected.";
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}
