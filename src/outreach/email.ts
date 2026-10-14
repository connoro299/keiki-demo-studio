import { completeJson as defaultCompleteJson, type CompleteOptions } from "./llm";
import { bestOutreachContact, draftChannelFor } from "./contacts";
import { channelLabel } from "./generate";
import type { ContactPoint, DemoAsset, Lead, OutreachDraft } from "./types";

/**
 * Drafts only. Nothing here sends: a person reviews `lead.draft` and sends it themselves.
 * Plain copy by design: no hype, no emojis, short subject, one specific observation, one ask.
 */

export const SIGN_OFF = "{{sender_name}}, Keiki";
export const OPT_OUT = "Not relevant? Reply 'no' and I won't follow up.";

export type EmailDeps = {
  completeJson?: <T>(options: CompleteOptions) => Promise<T>;
};

type ModelDraft = { subject?: string; body?: string; form?: string; xDm?: string };

export const EMAIL_SYSTEM = `You write cold outreach drafts for Keiki (onkeiki.com), which builds AI agents that answer a business's customers over text, WhatsApp, Slack and email (answer questions, book, take payment, send updates, hand off to a human).
A person will review and send what you write. Write like a thoughtful founder writing one email by hand:
- Plain, specific, human. No hype words (revolutionize, game-changer, supercharge, seamless, unlock, cutting-edge), no exclamation marks, no emojis, no flattery.
- Never claim to be a customer, never invent facts about the business, never promise results or numbers.`;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ");
}

export function demoSummary(demos: DemoAsset[]): { channels: string; story?: string; media?: "GIF" | "video"; attachments: string[] } {
  const channels = [...new Set(demos.map((demo) => channelLabel(demo.channel)))].join(" and ") || "text";
  const attachments = demos.flatMap((demo) => [demo.gif, demo.mp4].filter((item): item is string => Boolean(item)));
  const media = demos.some((demo) => demo.gif) ? "GIF" : demos.some((demo) => demo.mp4) ? "video" : undefined;
  return { channels, story: demos[0]?.story, media, attachments };
}

/** Enforces the house rules on whatever the model (or template) produced. */
export function finalizeEmail(body: string, subject: string): { subject: string; body: string } {
  let cleanSubject = stripEmoji(subject).replace(/[!]+/g, "").replace(/\s+/g, " ").trim();
  const words = cleanSubject.split(" ").filter(Boolean);
  if (words.length > 6) cleanSubject = words.slice(0, 6).join(" ");
  let clean = stripEmoji(body).replace(/!+/g, ".").replace(/\.\.+/g, ".").trim();
  if (!clean.includes("{{sender_name}}")) clean = `${clean.replace(/\n+(best|thanks|cheers|regards)[^\n]*\n[^\n]*$/i, "")}\n\n${SIGN_OFF}`;
  if (!/reply ['"‘’]?no['"‘’]?/i.test(clean)) clean = `${clean}\n\n${OPT_OUT}`;
  return { subject: cleanSubject, body: clean };
}

export function emailIssues(draft: { subject: string; body: string }): string[] {
  const issues: string[] = [];
  const subjectWords = wordCount(draft.subject);
  if (subjectWords === 0 || subjectWords > 6) issues.push(`subject must be 1-6 words (has ${subjectWords})`);
  const core = draft.body.replace(OPT_OUT, "").replace(SIGN_OFF, "");
  const words = wordCount(core);
  if (words < 55 || words > 125) issues.push(`body should be ~70-110 words before the sign-off (has ${words})`);
  if (new RegExp(EMOJI_RE.source, "u").test(draft.body)) issues.push("remove emojis");
  if (!/demo/i.test(draft.body)) issues.push("mention the demo");
  const hype = draft.body.match(/\b(revolutioni[sz]e|game[- ]changer|supercharge|seamless(ly)?|unlock|cutting[- ]edge|skyrocket|10x|synerg\w*)\b/i);
  if (hype) issues.push(`drop hype words like "${hype[0]}"`);
  return issues;
}

function firstName(contact?: ContactPoint): string | undefined {
  const label = contact?.label;
  if (!label || /inbox|form|imported|domain|decision/i.test(label)) return undefined;
  const name = label.split(/[,(]/)[0].trim().split(/\s+/)[0];
  return name && /^[A-Z][a-z'’-]+$/.test(name) ? name : undefined;
}

export function emailPrompt(lead: Lead, contact: ContactPoint | undefined): string {
  const profile = lead.profile!;
  const demos = demoSummary(lead.demos);
  return `Business: ${JSON.stringify({
    name: profile.name,
    url: profile.url,
    summary: profile.summary,
    vertical: profile.vertical,
    offerings: profile.offerings.slice(0, 6),
    facts: profile.facts,
    channelsSeen: profile.channelsSeen,
  }, null, 1)}
Recipient: ${contact ? `${contact.kind} ${contact.value}${contact.label ? ` (${contact.label})` : ""}` : "unknown"}${firstName(contact) ? `, first name ${firstName(contact)}` : ""}
Demo we made: ${demos.story ?? "a short conversation with their agent"} — on ${demos.channels}. ${demos.media ? `Attached as a ${demos.media}.` : "Not rendered yet, so offer to send the 20-second clip instead of saying it is attached."}

Write:
1. "subject": at most 6 words, lowercase-casual is fine, no clickbait.
2. "body": 70-110 words. Open with ${firstName(contact) ? `"Hi ${firstName(contact)},"` : `"Hi there,"`} then one specific observation about ${profile.name} taken from the material (something real on their site). Then: we made a quick demo of what an agent could do for ${profile.name} on ${demos.channels}, and in one line what it does in the demo. ${demos.media ? `Point to the attached ${demos.media}.` : "Offer to send the 20-second clip."} Low-friction ask: reply "yes" and we'll set up the live version. Sign off exactly "${SIGN_OFF}" on its own line, then this line exactly: "${OPT_OUT}"
3. "form": a 45-70 word version for their website contact form (no subject, no attachment mention; say we can send the demo over), same sign-off and opt-out line.
4. "xDm": one message under 260 characters for an X DM or LinkedIn note, no links.
Return {"subject","body","form","xDm"}.`;
}

/** Deterministic fallback when no model is available (and the shape the model is asked to match). */
export function templateEmail(lead: Lead, contact?: ContactPoint): ModelDraft {
  const profile = lead.profile!;
  const demos = demoSummary(lead.demos);
  const greeting = firstName(contact) ? `Hi ${firstName(contact)},` : "Hi there,";
  const offering = profile.offerings.find((item) => !/^(welcome|home|about|our story)\b/i.test(item));
  const observation = offering
    ? `I was looking at ${profile.name}'s site and noticed ${offering.length < 70 ? `"${offering}"` : "what you offer"} front and center.`
    : `I was looking at ${profile.name}'s site and liked how clearly you explain what you do.`;
  const story = demos.story ? demos.story.replace(/\.$/, "") : `a customer gets an answer and books without waiting`;
  const body = `${greeting}

${observation} A lot of your customers probably reach out with the same few questions, often after hours.

We made a quick demo of what an agent could do for ${profile.name} on ${demos.channels}: ${story.charAt(0).toLowerCase()}${story.slice(1)}. ${demos.media ? `The ${demos.media} is attached, it runs about 20 seconds.` : "It runs about 20 seconds and I'm happy to send it over."}

If you'd like the live version set up on your own number and info, just reply "yes".

${SIGN_OFF}

${OPT_OUT}`;
  const form = `Hi, we made a short demo of an agent answering ${profile.name}'s customers on ${demos.channels}: ${story.charAt(0).toLowerCase()}${story.slice(1)}. Happy to send it over, or set up the live version if you reply "yes".

${SIGN_OFF}

${OPT_OUT}`;
  return {
    subject: `${profile.name} demo on ${demos.channels.split(" and ")[0]}`,
    body,
    form,
    xDm: `Hi, we made a 20-second demo of an agent answering ${profile.name}'s customers on ${demos.channels}. Want me to send it? No worries if not.`.slice(0, 280),
  };
}

export async function draftEmail(lead: Lead, deps: EmailDeps & { llm?: boolean } = {}): Promise<OutreachDraft> {
  if (!lead.profile) throw new Error(`lead ${lead.id} has no profile; analyze it first`);
  const contact = bestOutreachContact(lead.profile.contacts);
  const channel = draftChannelFor(contact) ?? "email";
  let reply: ModelDraft;
  if (deps.llm === false) {
    reply = templateEmail(lead, contact);
  } else {
    const ask = deps.completeJson ?? defaultCompleteJson;
    reply = await ask<ModelDraft>({ system: EMAIL_SYSTEM, prompt: emailPrompt(lead, contact), maxTokens: 1500 });
    const first = finalizeEmail(reply.body ?? "", reply.subject ?? "");
    // Judge the subject as written (finalize would silently truncate it) and the body as cleaned.
    const issues = emailIssues({ subject: (reply.subject ?? "").trim(), body: first.body });
    if (issues.length) {
      reply = await ask<ModelDraft>({
        system: EMAIL_SYSTEM,
        prompt: `${emailPrompt(lead, contact)}\n\nYour previous draft had these problems: ${issues.join("; ")}.\nPrevious draft: ${JSON.stringify(reply)}\nFix them and return the same JSON shape.`,
        maxTokens: 1500,
      });
    }
  }
  const email = finalizeEmail(reply.body ?? "", reply.subject ?? `${lead.profile.name} demo`);
  const form = reply.form ? finalizeEmail(reply.form, "x").body : undefined;
  const xDm = reply.xDm ? stripEmoji(reply.xDm).replace(/\s+/g, " ").trim().slice(0, 280) : undefined;
  const attachments = demoSummary(lead.demos).attachments;
  const variants = { ...(form ? { form } : {}), ...(xDm ? { xDm } : {}) };
  const base = {
    channel,
    ...(contact ? { to: contact } : {}),
    ...(Object.keys(variants).length ? { variants } : {}),
    ...(attachments.length ? { attachments } : {}),
    createdAt: new Date().toISOString(),
  };
  if (channel === "form" && form) return { ...base, subject: "", body: form };
  if ((channel === "x-dm" || channel === "linkedin") && xDm) return { ...base, subject: "", body: xDm };
  return { ...base, subject: email.subject, body: email.body };
}
