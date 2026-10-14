import type { ContactKind, ContactPoint, DraftChannel } from "./types";

/**
 * Contact ranking. Order of preference:
 *   imported email column > named decision-maker email (founder/owner/CEO/GM) > person on the site's
 *   domain > role inbox (hello@, info@, bookings@…) > other email > contact form > social handles > phone.
 * Phones and WhatsApp numbers are recorded for context but are never an outbound channel: cold
 * SMS/WhatsApp/iMessage to scraped numbers is not something this pipeline drafts.
 */

export type ContactCandidate = {
  kind: ContactKind;
  value: string;
  label?: string;
  source: string;
  /** Text around the contact on the page; used to spot names and titles. */
  context?: string;
  /** Set by the model when the page names this person as a founder/owner/CEO/GM. */
  decisionMaker?: boolean;
  /** Came from the imported list's own email column. */
  fromInput?: boolean;
};

export const DECISION_TITLE_RE = /\b(?:co-?founder|founder|co-?owner|owner|proprietor|ceo|chief executive(?: officer)?|president|managing (?:director|partner)|general manager|gm|principal|chef[- ]owner|chef\/owner|executive director)\b/i;

const PRIMARY_ROLE = /^(?:hello|hi|hey|howdy|info|information|contact|contactus|contact-us|sales|book|bookings?|booking|reservations?|reserve|rsvp|events|catering|orders?|team|office|admin|enquiries|inquiries|enquiry|inquiry|general|studio|shop|store|appointments?|frontdesk|front\.desk|reception|welcome|mail|email|business|partners|partnerships?|hola|contacto|reservas|reservaciones|ventas|bonjour|kontakt|ciao|prenotazioni)$/i;
const SECONDARY_ROLE = /^(?:support|help|care|customercare|customerservice|customer\.service|service|services|feedback|concierge|guestservices|guest\.services|guestrelations|weddings?|groups|meetings|spa|dining|restaurant|private\.?events|wholesale|grupos|eventos|bodas)$/i;
const WRONG_ROLE = /^(?:press|media|pr|marketing|jobs|careers|hr|recruiting|hiring|billing|accounts|accounting|invoices|finance|legal|privacy|security|abuse|webmaster|dev|developers|it|tech|returns|unsubscribe|newsletter|news)$/i;
const FREEMAIL = /^(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|zoho|fastmail|hey|mail|yandex|comcast|sbcglobal|att|verizon|bellsouth|shaw|rogers|sympatico|btinternet|orange|free|web|t-online)\./i;

export type EmailClass = "decision-maker" | "person" | "role" | "location-inbox" | "inbox" | "support-role" | "wrong-role" | "freemail" | "other-domain";

export function registrableDomain(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

function domainMatches(emailDomain: string, siteDomain?: string): boolean {
  if (!siteDomain) return true;
  const site = registrableDomain(siteDomain);
  const email = emailDomain.toLowerCase();
  if (email === site || email.endsWith(`.${site}`) || site.endsWith(`.${email}`)) return true;
  // brand.com vs brand.co / brandnyc.com: share the leading label.
  const siteLabel = site.split(".")[0];
  const emailLabel = email.split(".").slice(-2, -1)[0] ?? email.split(".")[0];
  return siteLabel.length >= 4 && emailLabel.length >= 4 && (siteLabel.includes(emailLabel) || emailLabel.includes(siteLabel));
}

export function classifyEmail(email: string, options: { siteDomain?: string; context?: string; decisionMaker?: boolean } = {}): { cls: EmailClass; label?: string } {
  const [local, domain = ""] = email.toLowerCase().split("@");
  const localBase = local.replace(/\+.*$/, "");
  const title = options.context?.match(DECISION_TITLE_RE)?.[0];
  // An address on another domain (the web designer, a parent company) is a weak lead whatever its shape.
  if (!FREEMAIL.test(domain) && !domainMatches(domain, options.siteDomain)) return { cls: "other-domain", label: "Other domain" };
  if (WRONG_ROLE.test(localBase)) return { cls: "wrong-role", label: `${localBase}@ inbox` };
  if (PRIMARY_ROLE.test(localBase)) return { cls: "role", label: "General inbox" };
  if (SECONDARY_ROLE.test(localBase)) return { cls: "support-role", label: "Support inbox" };
  if (FREEMAIL.test(domain)) {
    if (options.decisionMaker || title) return { cls: "decision-maker", label: title ? capitalize(title) : "Owner" };
    return { cls: "freemail", label: "Business inbox" };
  }
  const siteLabel = registrableDomain(options.siteDomain ?? domain).split(".")[0].replace(/[^a-z0-9]/g, "");
  const compactLocal = localBase.replace(/[^a-z0-9]/g, "");
  // joespizza@joespizza.com is the business inbox, not a person.
  if (siteLabel.length >= 3 && (compactLocal.includes(siteLabel) || (compactLocal.length >= 5 && siteLabel.includes(compactLocal)))) {
    return { cls: "role", label: "General inbox" };
  }
  // info.sf@, hello-brooklyn@: a location's role inbox.
  const roleHead = localBase.split(/[._-]/)[0];
  if (roleHead !== localBase && PRIMARY_ROLE.test(roleHead)) return { cls: "location-inbox", label: "Location inbox" };
  const name = nameFromContext(options.context, localBase);
  const looksPersonal = /^[a-z]{2,}(?:[._-][a-z]{1,})?$/.test(localBase) && localBase.length <= 24;
  if (options.decisionMaker || (title && looksPersonal)) {
    return { cls: "decision-maker", label: [name, title ? capitalize(title) : undefined].filter(Boolean).join(", ") || "Decision-maker" };
  }
  // A single word (pasadena@, beans@) is usually a team or location inbox unless the page names that person.
  if (name || /^[a-z]{2,}[._-][a-z]{2,}$/.test(localBase)) return { cls: "person", label: name };
  return { cls: "inbox", label: "Inbox" };
}

function capitalize(value: string): string {
  return value.replace(/\b([a-z])/g, (char) => char.toUpperCase()).replace(/\bCeo\b/, "CEO").replace(/\bGm\b/, "GM");
}

/** Words that make "Calma Spa" or "Front Desk" look like a First Last pair. */
const NOT_NAMES = /^(?:spa|bar|cafe|café|kitchen|studio|hotel|restaurant|group|groups|events?|team|shop|store|desk|front|office|house|club|room|lounge|market|bakery|coffee|beach|resort|salon|clinic|center|centre|wellness|dining|reservations?|sales|support|press|media|general|info|contact|private|guest|services?|the|our|your|email|call|book|visit)$/;

/** "Maya Chen, Founder" style names near the address: First Last where First (or the initial+Last) matches the local part. */
function nameFromContext(context: string | undefined, local: string): string | undefined {
  if (!context) return undefined;
  const parts = local.split(/[._-]/);
  for (const match of context.matchAll(/\b([A-Z][a-z'’-]+)\s+([A-Z][a-z'’-]+)\b/g)) {
    const first = match[1].toLowerCase();
    const last = match[2].toLowerCase();
    if (NOT_NAMES.test(first) || NOT_NAMES.test(last)) continue;
    if (parts[0] === first || local === `${first[0]}${last}` || local === `${first}${last}` || (parts.length > 1 && parts[0] === first[0] && parts[1] === last)) {
      return `${match[1]} ${match[2]}`;
    }
  }
  return undefined;
}

const EMAIL_SCORE: Record<EmailClass, number> = {
  "decision-maker": 0.9,
  person: 0.75,
  role: 0.65,
  "location-inbox": 0.62,
  freemail: 0.6,
  inbox: 0.58,
  "support-role": 0.55,
  "other-domain": 0.3,
  "wrong-role": 0.3,
};

const KIND_SCORE: Record<ContactKind, number> = {
  email: 0.5,
  form: 0.4,
  x: 0.3,
  linkedin: 0.28,
  instagram: 0.25,
  other: 0.15,
  whatsapp: 0.12,
  phone: 0.1,
};

/** Outbound draft channels in preference order. Phone/WhatsApp/Instagram are never drafted to. */
export function draftChannelFor(contact: ContactPoint | undefined): DraftChannel | undefined {
  switch (contact?.kind) {
    case "email": return "email";
    case "form": return "form";
    case "x": return "x-dm";
    case "linkedin": return "linkedin";
    default: return undefined;
  }
}

function normalizeValue(kind: ContactKind, value: string): string {
  const trimmed = value.trim();
  if (kind === "email") return trimmed.toLowerCase().replace(/^mailto:/, "");
  if (kind === "phone" || kind === "whatsapp") return trimmed.replace(/[^\d+]/g, "");
  if (kind === "form" || kind === "linkedin" || kind === "x" || kind === "instagram" || kind === "other") {
    return trimmed.replace(/\/+$/, "").replace(/^http:\/\//, "https://").replace(/^https:\/\/www\./, "https://").toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function scoreContact(candidate: ContactCandidate, siteDomain?: string): ContactPoint {
  if (candidate.kind === "email") {
    if (candidate.fromInput) {
      return { kind: "email", value: candidate.value.trim().toLowerCase(), label: candidate.label ?? "From imported list", source: candidate.source, confidence: 1 };
    }
    const { cls, label } = classifyEmail(candidate.value, { siteDomain, context: candidate.context, decisionMaker: candidate.decisionMaker });
    return {
      kind: "email",
      value: candidate.value.trim().toLowerCase(),
      label: candidate.label ?? label,
      source: candidate.source,
      confidence: EMAIL_SCORE[cls],
    };
  }
  return {
    kind: candidate.kind,
    value: candidate.value.trim(),
    ...(candidate.label ? { label: candidate.label } : {}),
    source: candidate.source,
    confidence: KIND_SCORE[candidate.kind],
  };
}

/** Score, dedupe (keeping the strongest label/confidence) and sort best-first. */
export function rankContacts(candidates: ContactCandidate[], options: { siteDomain?: string; inputEmail?: string; inputName?: string } = {}): ContactPoint[] {
  const all = [...candidates];
  if (options.inputEmail && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(options.inputEmail.trim())) {
    all.unshift({ kind: "email", value: options.inputEmail, label: options.inputName ? `${options.inputName} (imported list)` : undefined, source: "import", fromInput: true });
  }
  const byKey = new Map<string, ContactPoint>();
  for (const candidate of all) {
    if (!candidate.value?.trim()) continue;
    const point = scoreContact(candidate, options.siteDomain);
    const key = `${point.kind}:${normalizeValue(point.kind, point.value)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, point);
      continue;
    }
    if (point.confidence > existing.confidence) byKey.set(key, { ...point, label: point.label ?? existing.label });
    else if (!existing.label && point.label) existing.label = point.label;
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence || a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

/** Best contact a person could actually write to (email, form, X, LinkedIn). */
export function bestOutreachContact(contacts: ContactPoint[]): ContactPoint | undefined {
  return [...contacts].sort((a, b) => b.confidence - a.confidence).find((contact) => draftChannelFor(contact) !== undefined);
}

/** Pulls an email / contact name out of an imported row's own columns. */
export function inputContact(input: Record<string, string> | undefined): { email?: string; name?: string } {
  if (!input) return {};
  const entries = Object.entries(input).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]+/g, ""), value?.trim() ?? ""] as const);
  const email = entries.find(([key, value]) => /^(?:email|emailaddress|e?mail|contactemail|owneremail|founderemail|workemail)$/.test(key) && /@/.test(value))?.[1]
    ?? entries.find(([key, value]) => key.includes("email") && /@/.test(value))?.[1];
  const first = entries.find(([key]) => key === "firstname")?.[1];
  const last = entries.find(([key]) => key === "lastname")?.[1];
  const name = entries.find(([key]) => /^(?:name|contactname|fullname|owner|ownername|founder)$/.test(key))?.[1]
    ?? ([first, last].filter(Boolean).join(" ") || undefined);
  return { ...(email ? { email } : {}), ...(name ? { name } : {}) };
}
