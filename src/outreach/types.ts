import type { DemoChannel } from "@/contracts";

/**
 * Outreach data model. Everything is local JSON under `outreach/` (gitignored):
 *   outreach/leads/<leadId>/lead.json      one Lead, plus its flows/ and media/
 *   outreach/x/<draftId>.json              one XDraft
 * Nothing in this module sends anything. Drafts are reviewed and sent by a person.
 */

export type ContactKind = "email" | "form" | "phone" | "x" | "instagram" | "linkedin" | "whatsapp" | "other";

export type ContactPoint = {
  kind: ContactKind;
  /** Email address, form URL, phone number, handle, or profile URL. */
  value: string;
  /** Person or role behind it when known: "Maya Chen, Founder" or "General inbox". */
  label?: string;
  /** Page the contact was found on. */
  source: string;
  /** 0–1. Named decision-maker email > role inbox > form > social. */
  confidence: number;
};

export type SiteProfile = {
  url: string;
  domain: string;
  name: string;
  tagline?: string;
  /** Two or three sentences: what the business does and for whom. */
  summary: string;
  vertical: string;
  audience: string;
  offerings: string[];
  /** Voice the agent should speak in, inferred from the site copy. */
  tone: string;
  brandColor?: string;
  logo?: string;
  socials: Partial<Record<"x" | "instagram" | "linkedin" | "facebook" | "tiktok" | "youtube", string>>;
  contacts: ContactPoint[];
  /** Channels the business visibly uses already (a WhatsApp button, a Slack community…). */
  channelsSeen: DemoChannel[];
  fetchedAt: string;
};

export type DemoAsset = {
  channel: DemoChannel;
  flowId: string;
  /** Repo-relative path of the validated flow JSON. */
  flowPath: string;
  /** One line: what the customer asks and what the agent does. */
  story: string;
  /** Repo-relative media paths, present once exported. */
  mp4?: string;
  gif?: string;
  poster?: string;
  durationMs?: number;
};

export type DraftChannel = "email" | "form" | "x-dm" | "linkedin";

export type OutreachDraft = {
  channel: DraftChannel;
  to?: ContactPoint;
  subject: string;
  /** Plain text. A person edits and sends it. */
  body: string;
};

export type LeadStatus = "queued" | "analyzing" | "generating" | "rendering" | "drafted" | "approved" | "sent" | "skipped" | "failed";

export type Lead = {
  id: string;
  url: string;
  status: LeadStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  /** Optional columns from an imported list (name, email, company…), kept verbatim. */
  input?: Record<string, string>;
  profile?: SiteProfile;
  demos: DemoAsset[];
  draft?: OutreachDraft;
  notes?: string;
};

export type XDraftStatus = "pending" | "approved" | "posted" | "skipped";

export type XTweet = {
  id: string;
  url: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  createdAt?: string;
  metrics?: { likes?: number; replies?: number; reposts?: number; views?: number };
  /** Additive (X queue): the author's bio, follower count and profile link when the source provides them. */
  authorBio?: string;
  authorFollowers?: number;
  authorUrl?: string;
  /** Additive (X queue): conversation id and language from the X API. */
  conversationId?: string;
  lang?: string;
};

export type XDraft = {
  id: string;
  tweet: XTweet;
  /** Why this tweet is a fit, in one line. */
  reason: string;
  /** 0–1 relevance. */
  score: number;
  /** Website found for the author or their company, if any. */
  site?: string;
  demo?: DemoAsset;
  reply: string;
  /** Additive (X queue): two alternative replies the reviewer can swap in for `reply`. */
  alternatives?: string[];
  /** Additive (X queue): free-form reviewer notes. */
  notes?: string;
  status: XDraftStatus;
  /** The search query or source that surfaced it. */
  source: string;
  createdAt: string;
  updatedAt: string;
};
