import type { CompleteOptions } from "../llm";
import type { XCandidate } from "./search";
import { findAuthorSite, isBusinessSite, siteMentioned, siteOrigin } from "./site";
import { tweetLength } from "./tweets";

export const MAX_REPLY_CHARS = 260;
export const DEFAULT_THRESHOLD = 0.6;

export type CompleteJson = <T>(options: CompleteOptions) => Promise<T>;

export type TriageResult = {
  score: number;
  reason: string;
  /** What the author does, when the tweet or bio says ("runs a two-chair barbershop"). */
  business?: string;
  site?: string;
  reply: string;
  alternatives: string[];
  /** Variant that mentions an attached demo video. Present only when a demo was asked for. */
  demoReply?: string;
};

type RawTriage = {
  score?: number;
  reason?: string;
  business?: string | null;
  site?: string | null;
  reply?: string;
  alternatives?: string[];
  demoReply?: string | null;
};

export const TRIAGE_SYSTEM = `You help the founder of Keiki (onkeiki.com) find people on X who would genuinely benefit from an AI agent that answers their customers over SMS, iMessage, WhatsApp, Instagram DMs, Slack, Telegram or email: it replies instantly, answers repeat questions, books and reschedules appointments, takes orders, and hands the hard ones to the owner.

For one tweet you will (1) judge fit and (2) draft a reply the founder will review, edit and post himself. Nothing is posted automatically.

Scoring, 0 to 1:
- 0.85-1: an owner/operator of a real business describing this pain right now (drowning in customer DMs or texts, missing calls or bookings, wishing for a receptionist or assistant, answering the same questions all day, asking for a tool to handle customer messages).
- 0.6-0.85: likely a fit but vaguer, or a solo pro/creator with clients.
- below 0.6: anything else. Score low for: AI hype or thought-leadership, people selling chatbots/agents/automation, job posts, crypto, jokes or memes without a real business, complaints about a company's support (they are the customer, not the business), personal texting, and big companies.

Reply rules (reply and both alternatives):
- At most ${MAX_REPLY_CHARS} characters. Shorter is better; one or two sentences.
- Sound like a helpful founder who read their tweet, not a bot or an ad. Plain, warm, specific. Lowercase is fine.
- Refer to the specific thing they said, then give one concrete way an agent would handle it for their kind of business (e.g. "it can answer the 'are you open sunday' texts and book the slot straight into your calendar").
- No hashtags. No emojis. No "DM me", "check out", "link in bio", "game-changer", "revolutionize", or sales language. Do not name Keiki unless it reads naturally.
- No links.
- Each alternative must take a different angle (a question back to them, a tiny tip, a different concrete use).
- If a demo is requested, also write demoReply: same rules, but it says you made them a quick demo of what that would look like for their business, ending with a downward arrow "↓" (the founder attaches the video). Example tone: "made you a quick demo of what that'd look like for a two-chair shop ↓".

Return JSON: {"score": number, "reason": "one line, why this is or is not a fit", "business": "what they do, or null", "site": "their business website if the tweet or bio names one, else null", "reply": "…", "alternatives": ["…", "…"], "demoReply": "… or null"}`;

export function triagePrompt(candidate: XCandidate, options: { wantDemoReply: boolean; site?: string }): string {
  const { tweet } = candidate;
  return JSON.stringify(
    {
      tweet: { text: tweet.text, url: tweet.url, createdAt: tweet.createdAt },
      author: {
        handle: `@${tweet.authorHandle}`,
        name: tweet.authorName,
        bio: tweet.authorBio,
        followers: tweet.authorFollowers,
        links: candidate.authorLinks,
        knownSite: options.site ?? null,
      },
      foundBy: candidate.source,
      demoRequested: options.wantDemoReply,
    },
    null,
    2,
  );
}

/** Score, explain and draft for one candidate. `completeJson` is injected so tests run without Claude. */
export async function triageCandidate(
  candidate: XCandidate,
  deps: { completeJson: CompleteJson },
  options: { wantDemo?: boolean } = {},
): Promise<TriageResult> {
  const detectedSite = findAuthorSite(candidate.authorLinks, candidate.tweet.authorBio);
  const wantDemoReply = Boolean(options.wantDemo);
  const raw = await deps.completeJson<RawTriage>({
    system: TRIAGE_SYSTEM,
    prompt: triagePrompt(candidate, { wantDemoReply, site: detectedSite }),
    maxTokens: 1200,
  });

  // Accept a model-suggested site only if its domain is literally in the tweet, bio or links.
  let site = detectedSite;
  if (!site && raw.site && isBusinessSite(raw.site) && siteMentioned(raw.site, [candidate.tweet.text, candidate.tweet.authorBio, ...candidate.authorLinks])) {
    site = siteOrigin(raw.site);
  }

  const reply = cleanReply(raw.reply ?? "");
  const alternatives = (raw.alternatives ?? [])
    .map((text) => cleanReply(text))
    .filter((text) => text && text !== reply)
    .slice(0, 2);
  const demoReply = wantDemoReply && raw.demoReply ? cleanReply(raw.demoReply, { allowArrow: true }) : undefined;
  return {
    score: clamp01(Number(raw.score)),
    reason: (raw.reason ?? "").replace(/\s+/g, " ").trim() || "no reason given",
    business: raw.business ?? undefined,
    site,
    reply,
    alternatives,
    demoReply: demoReply || undefined,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

const BANNED_SENTENCE = /\b(dm me|dm us|send me a dm|link in (my )?bio|check out|hit me up|book a call|sign up|free trial)\b/i;

/**
 * Enforce the reply rules on whatever the model wrote: no hashtags, no emojis, no links, no
 * "DM me"-style sentences, and at most MAX_REPLY_CHARS (cut at a sentence or word boundary).
 */
export function cleanReply(text: string, options: { allowArrow?: boolean } = {}): string {
  let out = text
    .replace(/https?:\/\/\S*[^\s.,!?;:)]/g, "")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu, "");
  if (!options.allowArrow) out = out.replace(/\s*[↓⬇]\s*$/u, "");
  out = splitSentences(out).filter((sentence) => !BANNED_SENTENCE.test(sentence)).join(" ");
  out = out.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
  return truncateReply(out, MAX_REPLY_CHARS);
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

export function truncateReply(text: string, max = MAX_REPLY_CHARS): string {
  if (tweetLength(text) <= max) return text;
  const sentences = splitSentences(text);
  let kept = "";
  for (const sentence of sentences) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (tweetLength(next) > max) break;
    kept = next;
  }
  if (kept) return kept;
  const chars = Array.from(text).slice(0, max - 1).join("");
  return `${chars.replace(/\s+\S*$/, "")}…`;
}
