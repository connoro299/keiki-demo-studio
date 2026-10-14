import { MESSAGES_CHANNELS, type CompiledEvent, type DemoChannel, type DemoMessage, type ValidationIssue } from "@/contracts";
import { authoringDocumentSchema } from "@/cli/authoring";
import { findUnsupported } from "@/cli/unsupported";
import { compileDemo, validateDemo } from "@/compiler";
import { currencyAmounts } from "./extract";
import type { SiteProfile } from "./types";

/**
 * Deterministic shaping and checking for generated flows. The model writes messages; this module owns
 * the mechanical parts of the timeline (customer composer drafts, company typing pairs) and checks the
 * result with the same validator the `demo` CLI uses, plus outreach-specific lint.
 */

export type FlowDocument = Record<string, unknown> & {
  id: string;
  messages: DemoMessage[];
  events?: CompiledEvent[];
  startAtMs?: number;
  checkpoints?: Array<{ id: string; atMs: number }>;
};

export const DEFAULT_NOW_MS = 1790008860000;
const OPENING_LEAD_MS = 500;
const CHAR_MS = 55;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : undefined;

export function graphemes(text: string): string[] {
  if (segmenter) return [...segmenter.segment(text)].map((part) => part.segment);
  return Array.from(text);
}

function isTextOutgoing(message: DemoMessage): boolean {
  return message.direction === "outgoing" && (!message.kind || message.kind === "text") && message.text.length > 0;
}

function sortEvents(events: CompiledEvent[]): CompiledEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index)
    .map(({ event }) => event);
}

/**
 * Company typing: one on/off pair before each incoming message, off exactly at arrival. Any typing
 * events the model wrote are replaced so the indicator can never be left on.
 */
export function withTypingPairs(messages: DemoMessage[], events: CompiledEvent[], openingMs: number): CompiledEvent[] {
  const kept: CompiledEvent[] = events.filter((event) => event.type !== "typing");
  let previous = openingMs;
  for (const message of messages) {
    if (message.direction === "incoming") {
      const lead = Math.min(2200, Math.max(900, message.text.length * 22));
      const on = Math.max(previous + 450, message.atMs - lead);
      if (message.atMs - on >= 500) {
        kept.push({ type: "typing", atMs: Math.round(on), typing: true });
        kept.push({ type: "typing", atMs: message.atMs, typing: false });
      }
    }
    previous = message.atMs;
  }
  return sortEvents(kept);
}

/**
 * Customer composer: progressive grapheme-safe `draft` prefixes before each outgoing text message,
 * cleared with "" at the send time. Returns the events plus the `startAtMs` needed for the opening.
 */
export function withComposerDrafts(messages: DemoMessage[], events: CompiledEvent[], startAtMs?: number): { events: CompiledEvent[]; startAtMs?: number } {
  const kept: CompiledEvent[] = events.filter((event) => event.type !== "draft");
  const first = messages[0];
  let opening = startAtMs;
  if (first && isTextOutgoing(first)) {
    const needed = Math.min(2600, Math.max(700, graphemes(first.text).length * CHAR_MS)) + OPENING_LEAD_MS;
    opening = Math.min(opening ?? Number.POSITIVE_INFINITY, first.atMs - needed);
    opening = Math.max(0, opening);
  }
  let previous = opening ?? first?.atMs ?? 0;
  for (const message of messages) {
    if (isTextOutgoing(message)) {
      const parts = graphemes(message.text);
      const windowStart = message === first ? previous + OPENING_LEAD_MS / 2 : previous + 400;
      const available = message.atMs - 120 - windowStart;
      const desired = Math.min(2600, Math.max(600, parts.length * CHAR_MS));
      const duration = Math.min(desired, available);
      if (duration >= 150 && parts.length > 0) {
        const begin = message.atMs - 120 - duration;
        const step = duration / parts.length;
        let prefix = "";
        let lastAt = -1;
        parts.forEach((part, index) => {
          prefix += part;
          const at = Math.round(begin + step * (index + 1));
          if (at === lastAt) {
            // Same millisecond: overwrite the previous prefix instead of emitting two events.
            const last = kept[kept.length - 1];
            if (last && last.type === "draft") last.value = prefix;
            return;
          }
          kept.push({ type: "draft", atMs: Math.min(at, message.atMs - 1), value: prefix });
          lastAt = at;
        });
        kept.push({ type: "draft", atMs: message.atMs, value: "" });
      }
    }
    previous = message.atMs;
  }
  return { events: sortEvents(kept), ...(opening !== undefined ? { startAtMs: opening } : {}) };
}

export type NormalizeContext = {
  flowId: string;
  channel: DemoChannel;
  businessName: string;
  title?: string;
};

function initialsFor(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Force the fixed fields, sort and de-duplicate messages, rebuild typing/drafts, add checkpoints. */
export function normalizeFlow(raw: unknown, ctx: NormalizeContext): FlowDocument {
  const input = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const rawMessages = Array.isArray(input.messages) ? (input.messages as DemoMessage[]) : [];
  const seen = new Set<string>();
  const messages = rawMessages
    .filter((message) => message && typeof message === "object")
    .map((message, index) => {
      const copy: DemoMessage = { ...message };
      let id = typeof copy.id === "string" && copy.id.trim() ? copy.id.trim() : `m${index + 1}`;
      while (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      copy.id = id;
      if (typeof copy.atMs === "number") copy.atMs = Math.round(copy.atMs);
      if (copy.direction === "outgoing" && copy.status === undefined) copy.status = "read";
      return copy;
    })
    .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  if (messages.length) {
    const lastOutgoing = [...messages].reverse().find((message) => message.direction === "outgoing");
    for (const message of messages) if (message.direction === "outgoing" && message !== lastOutgoing && message.status === "delivered") message.status = "read";
  }

  const authored = (Array.isArray(input.events) ? (input.events as CompiledEvent[]) : []).filter(
    (event) => event && typeof event === "object" && event.type !== "typing" && event.type !== "draft",
  );
  const drafts = withComposerDrafts(messages, authored, typeof input.startAtMs === "number" ? input.startAtMs : undefined);
  const opening = drafts.startAtMs ?? messages[0]?.atMs ?? 0;
  const events = withTypingPairs(messages, drafts.events, opening);
  const contactInput = (input.contact && typeof input.contact === "object" ? input.contact : {}) as Record<string, unknown>;

  const flow: FlowDocument = {
    id: ctx.flowId,
    title: ctx.title ?? (typeof input.title === "string" && input.title.trim() ? input.title.trim() : `${ctx.businessName} on ${ctx.channel}`),
    platform: "ios",
    channel: ctx.channel,
    theme: input.theme === "dark" ? "dark" : "light",
    contact: {
      name: ctx.businessName,
      initials: typeof contactInput.initials === "string" && contactInput.initials.trim() ? contactInput.initials.trim().slice(0, 3) : initialsFor(ctx.businessName),
    },
    nowMs: typeof input.nowMs === "number" && Number.isInteger(input.nowMs) ? input.nowMs : DEFAULT_NOW_MS,
    ...(drafts.startAtMs !== undefined ? { startAtMs: drafts.startAtMs } : {}),
    draft: "",
    typing: false,
    screen: "conversation",
    targets: ["ios"],
    messages,
    ...(events.length ? { events } : {}),
  };
  const lastAt = Math.max(messages[messages.length - 1]?.atMs ?? opening, ...events.map((event) => event.atMs));
  flow.checkpoints = [
    { id: "opening", atMs: 0 },
    { id: "final", atMs: Math.max(0, lastAt - opening + 900) },
  ];
  return flow;
}

// ---------------------------------------------------------------------------------------------
// Validation

const NON_MESSAGES_KINDS = new Set(["text", "link", "image", "attachment", "audio", "video"]);
const NON_MESSAGES_EVENTS = new Set(["message", "typing", "draft", "reaction", "status"]);
/** What generated demos may use on any channel: no local assets exist for a scraped business. */
const GENERATED_KINDS = new Set(["text", "link"]);
const GENERATED_EVENTS = new Set(["typing", "draft", "reaction"]);

export type FlowCheck = { ok: boolean; issues: ValidationIssue[]; durationMs?: number };

/**
 * The repo's own validation path, as `npm run demo -- validate` runs it: unsupported-key scan,
 * authoring schema, then `validateDemo` (from @/compiler, the export src/cli/deps.ts loads). The
 * channel field is kept on the flow handed to `validateDemo` so channel rules apply.
 */
export function validateFlowDocument(document: unknown): FlowCheck {
  const unsupported = findUnsupported(document);
  if (unsupported.length) return { ok: false, issues: unsupported };
  const parsed = authoringDocumentSchema.safeParse(document);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.length ? `/${issue.path.join("/")}` : "/", message: issue.message })),
    };
  }
  const { targets: _targets, checkpoints: _checkpoints, ...flow } = parsed.data;
  const result = validateDemo({ ...flow, platform: "ios" });
  if (!result.ok) return { ok: false, issues: result.issues };
  const compiled = compileDemo(result.demo);
  const checkpoints = parsed.data.checkpoints ?? [];
  const late = checkpoints.filter((checkpoint) => checkpoint.atMs > compiled.durationMs + 1500);
  if (late.length) return { ok: false, issues: late.map((checkpoint) => ({ path: "/checkpoints", message: `checkpoint ${checkpoint.id} at ${checkpoint.atMs} is after the compiled duration ${compiled.durationMs}` })), durationMs: compiled.durationMs };
  return { ok: true, issues: [], durationMs: compiled.durationMs };
}

/** Outreach rules on top of the renderer contract. Fed back to the model alongside validator issues. */
export function lintGeneratedFlow(flow: FlowDocument, ctx: { channel: DemoChannel; profile: Pick<SiteProfile, "name" | "textSample" | "facts" | "offerings">; durationMs?: number }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const messages = flow.messages ?? [];
  if (messages.length < 4 || messages.length > 8) issues.push({ path: "/messages", message: `use 4-8 messages (found ${messages.length})` });
  if (!messages.some((message) => message.direction === "outgoing")) issues.push({ path: "/messages", message: "the customer (outgoing) must send at least one message" });
  if (!messages.some((message) => message.direction === "incoming")) issues.push({ path: "/messages", message: "the business agent (incoming) must reply at least once" });
  messages.forEach((message, index) => {
    const kind = message.kind ?? "text";
    if (!GENERATED_KINDS.has(kind)) issues.push({ path: `/messages/${index}/kind`, message: `use only "text" or "link" messages in generated demos (found "${kind}"); there are no local image/video assets` });
    if (!MESSAGES_CHANNELS.has(ctx.channel) && !NON_MESSAGES_KINDS.has(kind)) issues.push({ path: `/messages/${index}/kind`, message: `${ctx.channel} supports text/link/image/attachment/audio/video only` });
    if (message.effect && !MESSAGES_CHANNELS.has(ctx.channel)) issues.push({ path: `/messages/${index}/effect`, message: `${ctx.channel} has no bubble effects` });
    if (message.text && message.text.length > 320) issues.push({ path: `/messages/${index}/text`, message: "keep each bubble under ~300 characters" });
    if (/[\u{1F300}-\u{1FAFF}]/u.test(message.text ?? "") && message.direction === "incoming" && (message.text.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? []).length > 1) {
      issues.push({ path: `/messages/${index}/text`, message: "at most one emoji per agent message" });
    }
  });
  for (const [index, event] of (flow.events ?? []).entries()) {
    if (!GENERATED_EVENTS.has(event.type)) issues.push({ path: `/events/${index}/type`, message: `generated demos use only typing, draft and reaction events (found "${event.type}")` });
    if (!MESSAGES_CHANNELS.has(ctx.channel) && !NON_MESSAGES_EVENTS.has(event.type)) issues.push({ path: `/events/${index}/type`, message: `${ctx.channel} does not support "${event.type}" events` });
    if (event.type === "reaction" && event.reaction?.byMe && MESSAGES_CHANNELS.has(ctx.channel)) {
      issues.push({ path: `/events/${index}/reaction/byMe`, message: "on iMessage/SMS a customer tapback needs the long-press sequence; use byMe:false (the business reacting) or drop the reaction" });
    }
  }
  const contact = flow.contact as { name?: string } | undefined;
  if (contact?.name !== ctx.profile.name) issues.push({ path: "/contact/name", message: `contact name must be exactly "${ctx.profile.name}"` });
  if (ctx.durationMs !== undefined && (ctx.durationMs < 9000 || ctx.durationMs > 32000)) {
    issues.push({ path: "/messages", message: `playback runs ${(ctx.durationMs / 1000).toFixed(1)}s; retime atMs so the whole demo is 12-25s` });
  }
  // Grounding: every currency amount in the conversation must appear on the site.
  const grounded = new Set(currencyAmounts([ctx.profile.textSample ?? "", ...(ctx.profile.facts?.prices ?? []), ...(ctx.profile.offerings ?? [])].join("\n")));
  messages.forEach((message, index) => {
    for (const amount of currencyAmounts(message.text ?? "")) {
      if (!grounded.has(amount)) issues.push({ path: `/messages/${index}/text`, message: `price ${amount} does not appear on the site; remove it or say it generically` });
    }
  });
  return issues;
}
