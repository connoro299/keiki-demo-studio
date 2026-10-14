import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DemoChannel, ValidationIssue } from "@/contracts";
import { defaultRepoRoot } from "@/cli/deps";
import { completeJson as defaultCompleteJson, type CompleteOptions } from "./llm";
import { DEFAULT_NOW_MS, lintGeneratedFlow, normalizeFlow, validateFlowDocument, type FlowDocument } from "./flow";
import { leadDir, outreachRoot } from "./store";
import type { DemoAsset, SiteProfile } from "./types";

export type GenerateDeps = {
  completeJson?: <T>(options: CompleteOptions) => Promise<T>;
  repoRoot?: string;
  /** Outreach root (default <repo>/outreach or OUTREACH_DIR). */
  root?: string;
  log?: (message: string) => void;
};

export type GenerateOptions = {
  channels?: DemoChannel[];
  /** Total demos. Default: one per chosen channel. Extra demos cycle channels with different stories. */
  count?: number;
  /** Lead id for the output folder. Default: derived from the profile domain. */
  leadId?: string;
  /** Repair rounds after the first attempt. Default 2. */
  maxRepairs?: number;
};

const CHANNEL_LABEL: Record<DemoChannel, string> = {
  imessage: "iMessage",
  sms: "SMS",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  slack: "Slack",
};

export function channelLabel(channel: DemoChannel): string {
  return CHANNEL_LABEL[channel];
}

// ---------------------------------------------------------------------------------------------
// Channel selection

const HOSPITALITY = /restaurant|cafe|café|coffee|bakery|bar|brewery|hotel|hospitality|resort|travel|tour|lodging|inn|villa|hostel|venue|catering|food|dining|events?/i;
const CONSUMER_SERVICES = /salon|spa|beauty|barber|fitness|gym|yoga|pilates|studio|clinic|dental|medical|wellness|therapy|home services|plumb|hvac|clean|repair|auto|automotive|real estate|tutor|education|pet|vet/i;
const DTC = /ecommerce|e-commerce|dtc|shop|store|brand|retail|apparel|boutique/i;
const B2B = /b2b|saas|software|platform|agency|consult|professional services|legal|accounting|enterprise|developer|api|it services|logistics|wholesale|manufactur/i;
const US_FRIENDLY_TLDS = new Set(["com", "net", "org", "us", "io", "co", "ai", "app", "dev", "biz", "shop", "store", "xyz", "info", "site", "online", "studio", "restaurant", "cafe", "bar", "salon", "health", "law", "realty"]);

export function looksInternational(profile: Pick<SiteProfile, "domain" | "contacts" | "facts">): boolean {
  const tld = profile.domain.split(".").pop()?.toLowerCase() ?? "com";
  if (tld === "ca") return false;
  if (!US_FRIENDLY_TLDS.has(tld)) return true;
  const phones = profile.contacts.filter((contact) => contact.kind === "phone" || contact.kind === "whatsapp").map((contact) => contact.value);
  if (phones.some((phone) => phone.startsWith("+") && !phone.startsWith("+1"))) return true;
  return false;
}

/**
 * 1–2 channels that fit the business: channels already visible on the site first, then the best fit
 * (WhatsApp for hospitality/international/consumer services abroad; iMessage for US local services
 * and DTC; Slack for B2B/internal ops). Telegram only when seen.
 */
export function chooseChannels(profile: Pick<SiteProfile, "vertical" | "summary" | "domain" | "contacts" | "facts" | "channelsSeen">, max = 2): DemoChannel[] {
  const picked: DemoChannel[] = [];
  const add = (channel: DemoChannel) => {
    if (picked.length < max && !picked.includes(channel)) picked.push(channel);
  };
  const seen = profile.channelsSeen.filter((channel) => !(channel === "sms" && profile.channelsSeen.includes("imessage")));
  for (const channel of seen) add(channel);
  const subject = `${profile.vertical} ${profile.summary}`;
  const international = looksInternational(profile);
  const hospitality = HOSPITALITY.test(profile.vertical);
  const consumer = CONSUMER_SERVICES.test(profile.vertical) || DTC.test(profile.vertical);
  const b2b = B2B.test(profile.vertical) || (!hospitality && !consumer && B2B.test(subject));
  const fits: DemoChannel[] = [];
  if (b2b) fits.push("slack");
  else if (international) fits.push("whatsapp");
  else {
    // US/Canada local services, restaurants and DTC: customers text. Travel stays also hear from
    // international guests, so WhatsApp is the second demo there.
    fits.push("imessage");
    if (hospitality && /hotel|resort|travel|tour|lodging|inn|villa|hostel/i.test(subject)) fits.push("whatsapp");
  }
  if (picked.length === 0) fits.forEach(add);
  else if (seen.length < 2 && fits[0] !== "slack") add(fits[0]);
  return picked;
}

// ---------------------------------------------------------------------------------------------
// Prompt

/** Compact authoring guide distilled from the make-imessage-demo and photon-demo-creator skills. */
export const AUTHORING_GUIDE = `DemoFlow authoring guide (the renderer's real contract; unknown fields fail validation):
- Top level: {"id","title","platform":"ios","channel","theme":"light","contact":{"name","initials"},"nowMs":${DEFAULT_NOW_MS},"draft":"","typing":false,"screen":"conversation","targets":["ios"],"messages":[...],"events":[...]}.
- Viewpoint is the CUSTOMER's phone. Customer messages are "direction":"outgoing" (blue/right). The business's Keiki agent is "direction":"incoming". contact.name is the business name exactly; one name, no product suffix.
- Message: {"id":"unique-stable-id","direction","text","atMs"} plus optional "kind":"link" with "link":{"url","title","host"} (a booking/payment/tracking link the agent sends), and "status":"read"|"delivered" on outgoing. Use only kinds "text" and "link". No images, video, polls, app cards, stickers or effects. A link bubble renders as a preview card that shows only the site's host, so say what the link is in the text bubble just before it.
- Optional "replyTo":"<earlier message id>" on a message quotes that message.
- atMs is an absolute clock in milliseconds. Start the first message at nowMs - 60000 and keep increasing. Whole conversation: 12-25 seconds of playback, 4-8 messages.
- Pacing: an agent reply arrives 1.6-3.0s after the customer message it answers (more for longer replies). Before each customer message leave reading time after the previous message plus ~55ms per character, because the customer's text is typed into the composer first.
- Do NOT write typing or draft events: the pipeline adds a company typing on/off pair before every incoming message and progressive composer drafts before every outgoing message.
- Optional events: at most one reaction, by the business: {"type":"reaction","atMs","messageId","reactionId","reaction":{"type":"like"|"love"|"emphasize","byMe":false}} placed after its target message arrives.
- Checkpoints are added for you.`;

export const GENERATE_SYSTEM = `You write short, realistic demo conversations for Keiki (onkeiki.com), a platform for AI agents that act for a business across SMS, iMessage, WhatsApp, Slack, Telegram and email: answer questions, book appointments, qualify leads, take payment, send order updates, hand off to a human.
Each demo shows one customer texting one business, and the business's Keiki agent doing a real job end to end. It is used in cold outreach to that business, so it must feel like *their* agent: their offerings, their voice, their place.
Rules:
- Ground everything in the site material. Never invent specific prices, policies, staff names, addresses or hours that are not in the material. When a detail is unknown keep it plausible and generic ("this Friday", "a table for two", "the 6:30 slot").
- Copy sounds like a real person texting: short bubbles, no marketing language, no emojis except at most one where natural. Never mention AI, Keiki, demos or bots inside the conversation.
- End on a satisfying resolution the business would love: a confirmed booking, a payment or deposit link, a qualified lead handed to the owner with a time, an order update, a question fully answered.
${AUTHORING_GUIDE}`;

function channelNotes(channel: DemoChannel): string {
  switch (channel) {
    case "whatsapp": return "WhatsApp: a customer messaging the business's WhatsApp number. Text/link only; reactions allowed.";
    case "telegram": return "Telegram: a customer messaging the business's Telegram bot/account. Text/link only.";
    case "slack": return "Slack: a direct message with the business's agent inside Slack. Use it for B2B or internal-ops jobs (a client or teammate asking for status, a lead routed to sales, an onboarding question). contact.name stays the business name.";
    case "sms": return "SMS: green-bubble texting with the business number.";
    default: return "iMessage: blue-bubble texting with the business.";
  }
}

export function generatePrompt(profile: SiteProfile, channel: DemoChannel, ctx: { flowId: string; previousStories: string[] }): string {
  const material = {
    name: profile.name,
    url: profile.url,
    tagline: profile.tagline,
    summary: profile.summary,
    vertical: profile.vertical,
    audience: profile.audience,
    offerings: profile.offerings,
    tone: profile.tone,
    facts: profile.facts,
    channelsSeen: profile.channelsSeen,
    siteText: profile.textSample?.slice(0, 7000),
  };
  return `Business material (JSON):
${JSON.stringify(material, null, 1)}

Channel: ${channel}. ${channelNotes(channel)}
Flow id: "${ctx.flowId}".
${ctx.previousStories.length ? `Already made for this business (pick a different job): ${ctx.previousStories.map((story) => `"${story}"`).join("; ")}\n` : ""}
First decide the single most valuable job a Keiki agent would do for ${profile.name} on ${channelLabel(channel)}, grounded in what they actually sell. Then write the conversation.

Return one JSON object:
{"story": "one line: what the customer asks and what the agent does", "flow": { ...DemoFlow as described in the guide... }}`;
}

export function repairPrompt(previous: unknown, issues: ValidationIssue[]): string {
  return `The flow you returned failed validation. Fix every issue and return the same JSON shape ({"story","flow"}). Keep the story and copy unless an issue requires a change.

Issues:
${issues.slice(0, 40).map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}

Previous reply:
${JSON.stringify(previous)}`;
}

// ---------------------------------------------------------------------------------------------
// Generate

type ModelReply = { story?: string; flow?: unknown };

export function slug(value: string, max = 32): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max).replace(/-$/, "") || "demo";
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Repo-relative when inside the repo (the normal case), absolute when OUTREACH_DIR points elsewhere. */
export function repoPath(repoRoot: string, file: string): string {
  const relative = path.relative(repoRoot, file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}

export class GenerationError extends Error {
  constructor(message: string, readonly issues: ValidationIssue[]) {
    super(message);
  }
}

/**
 * One model call per demo writes the conversation; the pipeline shapes the timeline, validates with the
 * repo validator plus outreach lint, and sends issues back for up to `maxRepairs` fixes.
 */
export async function generateDemo(
  profile: SiteProfile,
  channel: DemoChannel,
  ctx: { flowId: string; previousStories?: string[]; maxRepairs?: number },
  deps: GenerateDeps = {},
): Promise<{ flow: FlowDocument; story: string; durationMs: number; attempts: number }> {
  const ask = deps.completeJson ?? defaultCompleteJson;
  const maxRepairs = ctx.maxRepairs ?? 2;
  let reply = await ask<ModelReply>({ system: GENERATE_SYSTEM, prompt: generatePrompt(profile, channel, { flowId: ctx.flowId, previousStories: ctx.previousStories ?? [] }), maxTokens: 6000 });
  let lastIssues: ValidationIssue[] = [];
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    const flow = normalizeFlow(reply?.flow, { flowId: ctx.flowId, channel, businessName: profile.name });
    const check = validateFlowDocument(flow);
    const issues = [...check.issues, ...lintGeneratedFlow(flow, { channel, profile, durationMs: check.durationMs })];
    if (issues.length === 0 && check.durationMs !== undefined) {
      flow.checkpoints = [{ id: "opening", atMs: 0 }, { id: "final", atMs: check.durationMs }];
      const story = typeof reply?.story === "string" && reply.story.trim() ? reply.story.trim() : (flow.title as string);
      return { flow, story, durationMs: check.durationMs, attempts: attempt + 1 };
    }
    lastIssues = issues;
    deps.log?.(`${ctx.flowId}: attempt ${attempt + 1} had ${issues.length} issue(s): ${issues.slice(0, 3).map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    if (attempt === maxRepairs) break;
    reply = await ask<ModelReply>({ system: GENERATE_SYSTEM, prompt: repairPrompt(reply, issues), maxTokens: 6000 });
  }
  throw new GenerationError(`could not produce a valid ${channel} flow for ${profile.name} after ${maxRepairs + 1} attempts`, lastIssues);
}

export async function generateDemos(profile: SiteProfile, opts: GenerateOptions = {}, deps: GenerateDeps = {}): Promise<DemoAsset[]> {
  const repoRoot = deps.repoRoot ?? defaultRepoRoot();
  const root = deps.root ?? outreachRoot(repoRoot);
  const channels = opts.channels?.length ? opts.channels : chooseChannels(profile);
  const count = Math.max(1, opts.count ?? channels.length);
  const leadId = opts.leadId ?? slug(profile.domain, 40);
  const dir = path.join(leadDir(leadId, root), "flows");
  const base = slug(profile.name, 24);
  const used = new Set<string>();
  const stories: string[] = [];
  const assets: DemoAsset[] = [];
  for (let index = 0; index < count; index += 1) {
    const channel = channels[index % channels.length];
    let flowId = `${base}-${channel}`;
    for (let n = 2; used.has(flowId); n += 1) flowId = `${base}-${channel}-${n}`;
    used.add(flowId);
    const result = await generateDemo(profile, channel, { flowId, previousStories: stories, maxRepairs: opts.maxRepairs }, deps);
    stories.push(result.story);
    const file = path.join(dir, `${flowId}.json`);
    writeJsonAtomic(file, result.flow);
    assets.push({ channel, flowId, flowPath: repoPath(repoRoot, file), story: result.story, durationMs: result.durationMs });
  }
  return assets;
}
