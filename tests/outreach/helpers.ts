import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CompleteOptions } from "@/outreach/llm";
import type { SiteProfile } from "@/outreach/types";

export const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

/** fetch() double serving a URL → body map. Unknown URLs 404. Records every requested URL. */
export function fakeFetch(pages: Record<string, string | { status?: number; body: string; type?: string }>) {
  const requested: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requested.push(url);
    const entry = pages[url] ?? pages[url.replace(/\/$/, "")];
    if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    const page = typeof entry === "string" ? { body: entry } : entry;
    const response = new Response(page.body, { status: page.status ?? 200, headers: { "content-type": page.type ?? (url.endsWith("robots.txt") ? "text/plain" : "text/html; charset=utf-8") } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as typeof fetch;
  return { fetch: impl, requested };
}

/** completeJson() double that returns queued replies in order and records each prompt. */
export function fakeLlm(replies: unknown[]) {
  const calls: CompleteOptions[] = [];
  const completeJson = (async <T,>(options: CompleteOptions): Promise<T> => {
    calls.push(options);
    if (!replies.length) throw new Error("fake LLM ran out of replies");
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next as T;
  }) as <T>(options: CompleteOptions) => Promise<T>;
  return { completeJson, calls };
}

export function tempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "outreach-test-"));
}

export function sampleProfile(overrides: Partial<SiteProfile> = {}): SiteProfile {
  return {
    url: "https://luciastrattoria.com",
    domain: "luciastrattoria.com",
    name: "Lucia's Trattoria",
    summary: "Family-run Italian restaurant in Park Slope, Brooklyn, serving handmade pasta and wood-fired pizza.",
    vertical: "restaurant",
    audience: "local diners and groups booking tables",
    offerings: ["Cacio e Pepe — $19", "Wild Mushroom Tagliatelle — $24", "Private dining room for up to 24"],
    tone: "warm, quick and hospitable",
    socials: { instagram: "https://www.instagram.com/luciastrattoria" },
    contacts: [
      { kind: "email", value: "marco@luciastrattoria.com", label: "Marco Rossi, Owner", source: "https://luciastrattoria.com", confidence: 0.9 },
      { kind: "email", value: "info@luciastrattoria.com", label: "General inbox", source: "https://luciastrattoria.com", confidence: 0.65 },
      { kind: "phone", value: "+17185550142", source: "https://luciastrattoria.com", confidence: 0.1 },
    ],
    channelsSeen: [],
    fetchedAt: "2026-10-14T00:00:00.000Z",
    facts: { prices: ["Cacio e Pepe — $19", "Margherita (wood-fired) — $18"], hours: ["Tuesday – Thursday 5pm – 10pm"], locations: ["412 7th Avenue, Brooklyn, NY 11215"], policies: ["A $200 deposit holds the room"] },
    textSample: "Cacio e Pepe — $19\nWild Mushroom Tagliatelle — $24\nMargherita (wood-fired) — $18\nA $200 deposit holds the room",
    analyzedWith: "llm",
    ...overrides,
  };
}

const T0 = 1790008800000;

/** A valid model-style reply (no typing/draft events; the pipeline adds them). */
export function validFlowReply(flowId = "x", contactName = "Lucia's Trattoria") {
  return {
    story: "A guest books the private room for a birthday and gets the deposit link.",
    flow: {
      id: flowId,
      title: "Lucia's private dining",
      platform: "ios",
      channel: "imessage",
      theme: "light",
      contact: { name: contactName, initials: "LT" },
      nowMs: 1790008860000,
      draft: "",
      typing: false,
      screen: "conversation",
      messages: [
        { id: "ask", direction: "outgoing", text: "Hi! Is the back room free Saturday the 24th for 14 people?", atMs: T0 },
        { id: "answer", direction: "incoming", text: "Yes, Saturday the 24th is open. It seats up to 24, so 14 fits comfortably. What time were you thinking?", atMs: T0 + 2800 },
        { id: "time", direction: "outgoing", text: "7pm. It's my mom's 60th", atMs: T0 + 6200 },
        { id: "hold", direction: "incoming", text: "Happy early birthday to her. I've penciled in 7pm. A $200 deposit holds the room.", atMs: T0 + 9000 },
        { id: "link", direction: "incoming", kind: "link", text: "Deposit for Saturday", link: { url: "https://luciastrattoria.com/deposit", title: "Private room deposit", host: "luciastrattoria.com" }, atMs: T0 + 10600 },
        { id: "paid", direction: "outgoing", text: "Paid, thank you!", atMs: T0 + 14000 },
        { id: "confirmed", direction: "incoming", text: "Got it. You're confirmed for Saturday at 7pm, back room, 14 guests. See you then.", atMs: T0 + 16400 },
      ],
      events: [
        { type: "reaction", atMs: T0 + 15000, messageId: "paid", reactionId: "like-paid", reaction: { type: "like", byMe: false } },
      ],
    },
  };
}
