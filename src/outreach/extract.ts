import type { DemoChannel } from "@/contracts";

/**
 * Pure HTML extraction for outreach analysis. No DOM library: small-business sites are parsed with
 * tolerant regexes, which is enough for meta tags, links, forms, contact details and visible text.
 * Everything here is deterministic and unit-tested against saved fixtures.
 */

export type SocialKey = "x" | "instagram" | "linkedin" | "facebook" | "tiktok" | "youtube";

export type EmailHit = { value: string; context: string; viaMailto: boolean };

export type FormHit = {
  /** Page a person visits to fill the form in. */
  pageUrl: string;
  /** Resolved form action or embed URL. */
  action?: string;
  provider?: string;
  fields: string[];
};

export type JsonLdInfo = {
  types: string[];
  name?: string;
  telephone?: string;
  email?: string;
  address?: string;
  priceRange?: string;
  openingHours: string[];
  logo?: string;
  sameAs: string[];
  description?: string;
};

export type PageExtract = {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  ogImage?: string;
  themeColor?: string;
  colorHints: string[];
  logo?: string;
  text: string;
  headings: string[];
  links: Array<{ href: string; text: string }>;
  emails: EmailHit[];
  phones: string[];
  forms: FormHit[];
  socials: Partial<Record<SocialKey, string>>;
  channelLinks: Array<{ channel: DemoChannel; url: string }>;
  jsonLd: JsonLdInfo;
  prices: string[];
  hours: string[];
  locations: string[];
  policies: string[];
  scriptCount: number;
  /** True when the HTML looks like a client-rendered shell with almost no server text. */
  jsShell: boolean;
};

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTR_RE)) {
    const key = match[1].toLowerCase();
    if (key in attrs) continue;
    attrs[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

export function tags(html: string, name?: string): Array<{ name: string; attrs: Record<string, string>; index: number }> {
  const found: Array<{ name: string; attrs: Record<string, string>; index: number }> = [];
  for (const match of html.matchAll(TAG_RE)) {
    const tag = match[1].toLowerCase();
    if (name && tag !== name) continue;
    found.push({ name: tag, attrs: parseAttrs(match[2] ?? ""), index: match.index ?? 0 });
  }
  return found;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", hellip: "…", middot: "·", copy: "©", reg: "®", trade: "™", bull: "•", eacute: "é",
  egrave: "è", agrave: "à", aacute: "á", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", ccedil: "ç", uuml: "ü",
  ouml: "ö", auml: "ä", commat: "@", period: ".", lpar: "(", rpar: ")", lsqb: "[", rsqb: "]", colon: ":", sol: "/",
  pound: "£", euro: "€", dollar: "$", times: "×", deg: "°", frac12: "½", rarr: "→", larr: "←",
};

export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

export function absolutize(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) return undefined;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return undefined;
  }
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const BLOCK_TAGS = "p|div|section|article|header|footer|main|aside|nav|li|ul|ol|h[1-6]|br|tr|td|th|table|address|blockquote|dd|dt|figcaption|form|label|option";

/** Visible text: scripts/styles/svg removed, block tags become newlines, entities decoded. */
export function visibleText(html: string): string {
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|select)\b[\s\S]*?<\/\1\s*>/gi, " ");
  body = body.replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  body = decodeEntities(body.replace(/<[^>]*>/g, " "));
  return body
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// Emails

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const JUNK_EMAIL_DOMAINS = [
  "sentry.io", "sentry-next.wixpress.com", "sentry.wixpress.com", "wixpress.com", "example.com", "example.org",
  "example.net", "domain.com", "yourdomain.com", "email.com", "test.com", "sentry.zendesk.com", "mysite.com",
  "yoursite.com", "company.com", "website.com", "site.com", "godaddy.com", "squarespace.com", "wix.com",
  "shopify.com", "address.com", "mail.com",
];
const JUNK_LOCALS = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce[s]?|user|username|name|your-?name|yourname|you|email|first\.?last|john\.?doe|jane\.?doe|test)$/i;
const IMAGE_TLDS = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|mjs|json|woff2?|ttf|mp4|webm)$/i;

export function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) return true;
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (IMAGE_TLDS.test(lower)) return true;
  if (/@\d+x\./.test(lower) || /^\d+x$/.test(local)) return true;
  if (JUNK_EMAIL_DOMAINS.some((junk) => domain === junk || domain.endsWith(`.${junk}`))) return true;
  if (JUNK_LOCALS.test(local)) return true;
  if (/^[0-9a-f]{16,}$/.test(local)) return true; // sentry DSN keys and hashes
  if (local.length > 64 || domain.length > 120) return true;
  if (/\.(local|invalid|localhost|test)$/.test(domain)) return true;
  return false;
}

/** Rewrites "name [at] domain [dot] com" style obfuscations into plain addresses. */
export function deobfuscateEmails(text: string): string {
  return text
    .replace(/\s*[[({<]\s*(?:at|@)\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*(?:dot|\.)\s*[\])}>]\s*/gi, ".")
    .replace(/([A-Za-z0-9._%+-]+)\s+(?:at|AT)\s+([A-Za-z0-9-]+(?:\s+(?:dot|DOT)\s+[A-Za-z0-9-]+)+)\b/g, (_whole, local: string, rest: string) =>
      `${local}@${rest.replace(/\s+(?:dot|DOT)\s+/g, ".")}`)
    .replace(/(@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\s+(?:dot|DOT)\s+([A-Za-z]{2,24})\b/g, "$1.$2");
}

/** Cloudflare "email protection" hex: first byte is the XOR key. */
export function decodeCfEmail(hex: string): string | undefined {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return undefined;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out) ? out : undefined;
}

function contextAround(text: string, index: number, length: number, radius = 110): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + length + radius)).replace(/\s+/g, " ").trim();
}

export function extractEmails(html: string, text: string): EmailHit[] {
  const hits = new Map<string, EmailHit>();
  const add = (raw: string, context: string, viaMailto: boolean) => {
    const value = raw.trim().replace(/^mailto:/i, "").replace(/[.,;:]+$/, "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value) || isJunkEmail(value)) return;
    const existing = hits.get(value);
    if (existing) {
      if (viaMailto && !existing.viaMailto) existing.viaMailto = true;
      if (context.length > existing.context.length) existing.context = context;
      return;
    }
    hits.set(value, { value, context, viaMailto });
  };

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttrs(match[1]);
    const href = attrs.href ?? "";
    if (/^mailto:/i.test(href)) {
      const address = decodeURIComponent(href.replace(/^mailto:/i, "").split("?")[0]).split(",")[0];
      const anchorText = stripTags(match[2]);
      const at = text.indexOf(anchorText);
      add(address, at >= 0 && anchorText ? contextAround(text, at, anchorText.length) : anchorText, true);
    }
    const cf = href.match(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i);
    if (cf) {
      const decoded = decodeCfEmail(cf[1]);
      if (decoded) add(decoded, stripTags(match[2]), true);
    }
  }
  for (const match of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) {
    const decoded = decodeCfEmail(match[1]);
    if (decoded) add(decoded, "", false);
  }

  const plain = deobfuscateEmails(text);
  for (const match of plain.matchAll(EMAIL_RE)) add(match[0], contextAround(plain, match.index ?? 0, match[0].length), false);

  // Addresses that only appear in attributes or inline JSON (data-email, JSON-LD, etc.).
  const rawDecoded = decodeEntities(html.replace(/<(script|style)\b(?![^>]*ld\+json)[\s\S]*?<\/\1\s*>/gi, " "));
  for (const match of rawDecoded.matchAll(EMAIL_RE)) add(match[0], "", false);
  return [...hits.values()];
}

// ---------------------------------------------------------------------------------------------
// Socials and channels

const SOCIAL_HOSTS: Array<{ key: SocialKey; hosts: RegExp; reject: RegExp; canonical: (url: URL) => string | undefined }> = [
  {
    key: "x",
    hosts: /^(?:www\.|mobile\.)?(?:twitter|x)\.com$/,
    reject: /^\/(?:intent|share|home|i|search|hashtag|login|signup|explore|settings)(?:\/|$)/i,
    canonical: (url) => {
      const handle = url.pathname.split("/").filter(Boolean)[0];
      return handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}` : undefined;
    },
  },
  {
    key: "instagram",
    hosts: /^(?:www\.)?instagram\.com$/,
    reject: /^\/(?:p|reel|reels|explore|stories|accounts|direct)(?:\/|$)/i,
    canonical: (url) => {
      const handle = url.pathname.split("/").filter(Boolean)[0];
      return handle && /^[A-Za-z0-9_.]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}` : undefined;
    },
  },
  {
    key: "linkedin",
    hosts: /^(?:[a-z]{2,3}\.)?linkedin\.com$/,
    reject: /^\/(?:shareArticle|sharing|feed|login|signup)(?:\/|$)/i,
    canonical: (url) => {
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length >= 2 && ["company", "in", "school", "showcase"].includes(parts[0]) ? `https://www.linkedin.com/${parts[0]}/${parts[1]}` : undefined;
    },
  },
  {
    key: "facebook",
    hosts: /^(?:www\.|m\.|business\.)?(?:facebook|fb)\.com$/,
    reject: /^\/(?:sharer|share|dialog|plugins|tr|login|groups\/?$)(?:\.php)?(?:\/|$)/i,
    canonical: (url) => {
      const parts = url.pathname.split("/").filter(Boolean);
      if (!parts.length) return undefined;
      if (parts[0] === "profile.php") return url.toString();
      return `https://www.facebook.com/${parts[0]}`;
    },
  },
  {
    key: "tiktok",
    hosts: /^(?:www\.)?tiktok\.com$/,
    reject: /^\/(?:share|embed|tag|music)(?:\/|$)/i,
    canonical: (url) => {
      const handle = url.pathname.split("/").filter(Boolean)[0];
      return handle?.startsWith("@") ? `https://www.tiktok.com/${handle}` : undefined;
    },
  },
  {
    key: "youtube",
    hosts: /^(?:www\.|m\.)?youtube\.com$/,
    reject: /^\/(?:watch|embed|shorts|results|playlist|redirect)(?:\/|$)/i,
    canonical: (url) => {
      const parts = url.pathname.split("/").filter(Boolean);
      if (!parts.length) return undefined;
      if (parts[0].startsWith("@")) return `https://www.youtube.com/${parts[0]}`;
      if (["channel", "c", "user"].includes(parts[0]) && parts[1]) return `https://www.youtube.com/${parts[0]}/${parts[1]}`;
      return undefined;
    },
  },
];

export function socialFor(href: string): { key: SocialKey; url: string } | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  for (const social of SOCIAL_HOSTS) {
    if (!social.hosts.test(url.hostname.toLowerCase())) continue;
    if (social.reject.test(url.pathname)) return undefined;
    const canonical = social.canonical(url);
    return canonical ? { key: social.key, url: canonical } : undefined;
  }
  return undefined;
}

export function channelFor(href: string): DemoChannel | undefined {
  const lower = href.trim().toLowerCase();
  if (/^whatsapp:/.test(lower) || /^https?:\/\/(?:www\.)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|web\.whatsapp\.com|wa\.link)\//.test(lower)) return "whatsapp";
  if (/^tg:/.test(lower) || /^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//.test(lower)) return "telegram";
  if (/^https?:\/\/join\.slack\.com\//.test(lower) || /^https?:\/\/[a-z0-9-]+\.slack\.com\/(?:join|shared_invite)/.test(lower)) return "slack";
  if (/^(?:imessage|messages):/.test(lower) || /^https?:\/\/bcrw\.apple\.com\//.test(lower)) return "imessage";
  if (/^sms:/.test(lower)) return "sms";
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Forms

const FORM_PROVIDERS: Array<{ provider: string; re: RegExp }> = [
  { provider: "typeform", re: /https?:\/\/[a-z0-9-]+\.typeform\.com\/to\/[A-Za-z0-9]+/i },
  { provider: "jotform", re: /https?:\/\/(?:form\.|www\.)?jotform\.com\/[A-Za-z0-9/]+/i },
  { provider: "google-forms", re: /https?:\/\/(?:docs\.google\.com\/forms\/[^\s"'<>]+|forms\.gle\/[A-Za-z0-9]+)/i },
  { provider: "tally", re: /https?:\/\/tally\.so\/(?:r|embed)\/[A-Za-z0-9]+/i },
  { provider: "hubspot", re: /hbspt\.forms\.create|https?:\/\/share\.hsforms\.com\/[A-Za-z0-9]+/i },
  { provider: "formstack", re: /https?:\/\/[a-z0-9-]+\.formstack\.com\/forms\/[A-Za-z0-9_-]+/i },
  { provider: "wufoo", re: /https?:\/\/[a-z0-9-]+\.wufoo\.com\/forms\/[A-Za-z0-9_-]+/i },
];

export function extractForms(html: string, pageUrl: string): FormHit[] {
  const forms: FormHit[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = parseAttrs(match[1]);
    const inner = match[2];
    const fields: string[] = [];
    let hasEmail = false;
    let hasMessage = false;
    let hasName = false;
    let isSearch = /search/i.test(`${attrs.role ?? ""} ${attrs.class ?? ""} ${attrs.id ?? ""} ${attrs.action ?? ""}`);
    for (const input of tags(inner)) {
      if (!["input", "textarea", "select"].includes(input.name)) continue;
      const type = (input.attrs.type ?? (input.name === "textarea" ? "textarea" : "text")).toLowerCase();
      if (["hidden", "submit", "button", "checkbox", "radio", "image", "reset"].includes(type)) continue;
      const label = `${input.attrs.name ?? ""} ${input.attrs.id ?? ""} ${input.attrs.placeholder ?? ""} ${input.attrs["aria-label"] ?? ""}`.toLowerCase();
      const field = input.attrs.name ?? input.attrs.id ?? type;
      fields.push(field);
      if (type === "email" || /e-?mail/.test(label)) hasEmail = true;
      if (input.name === "textarea" || /message|comment|inquiry|enquiry|question|details|how can we help|project/.test(label)) hasMessage = true;
      if (/name/.test(label)) hasName = true;
      if (type === "search" || /^(?:q|s|query|search)$/.test(input.attrs.name ?? "")) isSearch = true;
    }
    if (isSearch) continue;
    // A lone email box is a newsletter signup, not a contact form.
    if (!(hasMessage && (hasEmail || hasName))) continue;
    forms.push({ pageUrl, action: absolutize(attrs.action, pageUrl) ?? pageUrl, fields });
  }
  for (const { provider, re } of FORM_PROVIDERS) {
    const match = html.match(re);
    if (match) forms.push({ pageUrl, action: match[0].startsWith("http") ? match[0] : undefined, provider, fields: [] });
  }
  return forms;
}

// ---------------------------------------------------------------------------------------------
// JSON-LD

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function addressText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const parts = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
    .map((key) => record[key])
    .map((part) => (typeof part === "string" ? part : part && typeof part === "object" && typeof (part as Record<string, unknown>).name === "string" ? (part as Record<string, string>).name : undefined))
    .filter((part): part is string => Boolean(part && part.trim()));
  return parts.length ? parts.join(", ") : undefined;
}

export function extractJsonLd(html: string): JsonLdInfo {
  const info: JsonLdInfo = { types: [], openingHours: [], sameAs: [] };
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    nodes.push(record);
    if (record["@graph"]) visit(record["@graph"]);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1].trim()));
    } catch {
      // Malformed JSON-LD is common; skip it.
    }
  }
  const BUSINESS = /Organization|Business|Restaurant|Store|Cafe|CafeOrCoffeeShop|Bakery|BarOrPub|Hotel|LodgingBusiness|Dentist|MedicalClinic|Physician|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|ExerciseGym|SportsActivityLocation|LegalService|Attorney|RealEstateAgent|HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|AutoRepair|ProfessionalService|FoodEstablishment|WebSite|SoftwareApplication|Corporation|Brand/;
  const ranked = nodes
    .map((node) => ({ node, types: asArray(node["@type"] as string | string[]).filter((type): type is string => typeof type === "string") }))
    .filter(({ types }) => types.some((type) => BUSINESS.test(type)))
    .sort((a, b) => Number(b.types.some((type) => type !== "WebSite")) - Number(a.types.some((type) => type !== "WebSite")));
  for (const { node, types } of ranked) {
    info.types.push(...types);
    const str = (key: string) => (typeof node[key] === "string" ? (node[key] as string).trim() : undefined);
    info.name ??= types.includes("WebSite") ? undefined : str("name");
    info.telephone ??= str("telephone");
    info.email ??= str("email")?.replace(/^mailto:/i, "");
    info.address ??= asArray(node.address as unknown).map(addressText).find(Boolean);
    info.priceRange ??= str("priceRange");
    info.description ??= str("description");
    const logo = node.logo;
    info.logo ??= typeof logo === "string" ? logo : logo && typeof logo === "object" ? ((logo as Record<string, unknown>).url as string | undefined) : undefined;
    for (const hours of asArray(node.openingHours as string | string[])) if (typeof hours === "string") info.openingHours.push(hours);
    for (const spec of asArray(node.openingHoursSpecification as Record<string, unknown> | Array<Record<string, unknown>>)) {
      if (!spec || typeof spec !== "object") continue;
      const days = asArray(spec.dayOfWeek as string | string[]).map((day) => String(day).replace(/^https?:\/\/schema\.org\//, "")).join(", ");
      if (spec.opens && spec.closes) info.openingHours.push(`${days} ${spec.opens}–${spec.closes}`.trim());
    }
    for (const same of asArray(node.sameAs as string | string[])) if (typeof same === "string") info.sameAs.push(same);
  }
  if (!info.name) {
    const site = ranked.find(({ types }) => types.includes("WebSite"));
    if (site && typeof site.node.name === "string") info.name = site.node.name.trim();
  }
  info.types = [...new Set(info.types)];
  info.openingHours = [...new Set(info.openingHours)];
  info.sameAs = [...new Set(info.sameAs)];
  return info;
}

// ---------------------------------------------------------------------------------------------
// Facts from visible text

const PRICE_RE = /(?:[$£€]\s?\d{1,5}(?:[.,]\d{2})?(?:\s?[-–]\s?[$£€]?\d{1,5}(?:[.,]\d{2})?)?|\d{1,5}(?:[.,]\d{2})?\s?(?:USD|CAD|EUR|GBP|€))(?:\s?(?:\/|per\s)\s?(?:mo|month|hr|hour|person|night|year|yr|user|seat|session|class|visit))?/gi;
const DAY_RE = /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|s)?\b|\bdaily\b|\bweekdays\b|\bweekends\b|\bevery day\b/i;
const TIME_RE = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b|\bnoon\b|\bmidnight\b|\bclosed\b/i;
const STREET_RE = /\b\d{1,5}\s+(?:[A-Z0-9][\w'.-]*\s+){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pl|Place|Ct|Court|Sq|Square|Pkwy|Parkway|Hwy|Highway|Terrace|Ter)\b\.?(?:[^\n]{0,60})?/;
const POLICY_RE = /\b(?:cancell?ation|refund|deposit|no-show|free shipping|returns? policy|reservation policy|gratuity|minimum order|money-back|free trial|cancel anytime)\b/i;

function linesMatching(text: string, test: (line: string) => boolean, cap: number, maxLength = 140): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > maxLength * 2 || !test(trimmed)) continue;
    const clipped = trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
    if (!out.includes(clipped)) out.push(clipped);
    if (out.length >= cap) break;
  }
  return out;
}

export function extractFacts(text: string): { prices: string[]; hours: string[]; locations: string[]; policies: string[] } {
  const prices = linesMatching(text, (line) => new RegExp(PRICE_RE.source, "i").test(line), 24);
  const hours = linesMatching(text, (line) => DAY_RE.test(line) && TIME_RE.test(line), 10);
  const locations = linesMatching(text, (line) => STREET_RE.test(line), 6);
  const policies = linesMatching(text, (line) => POLICY_RE.test(line), 6, 200);
  return { prices, hours, locations, policies };
}

/** Every currency amount in a string, normalized ("$18", "$18.00" → "18"). */
export function currencyAmounts(text: string): string[] {
  return [...text.matchAll(/[$£€]\s?(\d{1,5}(?:[.,]\d{2})?)/g)].map((match) => match[1].replace(/[.,]00$/, ""));
}

// ---------------------------------------------------------------------------------------------
// Colors and logo

function isNeutral(hex: string): boolean {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.slice(0, 6);
  if (full.length !== 6) return true;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 24 || max < 24 || min > 236;
}

export function extractColors(html: string, metas: Record<string, string>): { themeColor?: string; hints: string[] } {
  const hints: string[] = [];
  const push = (color?: string) => {
    if (!color) return;
    const normalized = color.trim().toLowerCase();
    if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(normalized) && !hints.includes(normalized)) hints.push(normalized);
  };
  const themeColor = metas["theme-color"] ?? metas["msapplication-tilecolor"];
  push(themeColor);
  for (const link of tags(html, "link")) if (/mask-icon/i.test(link.attrs.rel ?? "")) push(link.attrs.color);
  for (const match of html.matchAll(/--(?:[a-z0-9-]*?)(?:primary|brand|accent|main)[a-z0-9-]*\s*:\s*(#[0-9a-f]{3,6})\b/gi)) push(match[1]);
  const counts = new Map<string, number>();
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const match of block[1].matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) {
      const color = match[0].toLowerCase();
      if (!isNeutral(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([color]) => push(color));
  return { themeColor, hints: hints.filter((color) => !isNeutral(color)).concat(hints.filter(isNeutral)).slice(0, 6) };
}

function largestIcon(links: Array<{ attrs: Record<string, string> }>): string | undefined {
  const sized = links.map((link) => {
    const size = parseInt((link.attrs.sizes ?? "").split("x")[0] ?? "", 10);
    return { href: link.attrs.href, size: Number.isFinite(size) ? size : 0 };
  });
  return sized.sort((a, b) => b.size - a.size)[0]?.href;
}

// ---------------------------------------------------------------------------------------------
// Page

export function extractPage(html: string, pageUrl: string): PageExtract {
  const metas: Record<string, string> = {};
  for (const meta of tags(html, "meta")) {
    const key = (meta.attrs.property ?? meta.attrs.name ?? meta.attrs.itemprop ?? "").toLowerCase();
    if (key && meta.attrs.content !== undefined && !(key in metas)) metas[key] = meta.attrs.content.trim();
  }
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) || undefined : metas["og:title"];
  const text = visibleText(html);

  const linkTags = tags(html, "link");
  const appleIcons = linkTags.filter((link) => /apple-touch-icon/i.test(link.attrs.rel ?? "") && link.attrs.href);
  const icons = linkTags.filter((link) => /(^|\s)icon(\s|$)/i.test(link.attrs.rel ?? "") && link.attrs.href);
  const logoImg = tags(html, "img").find((img) => /logo/i.test(`${img.attrs.class ?? ""} ${img.attrs.id ?? ""} ${img.attrs.alt ?? ""} ${img.attrs.src ?? ""}`) && (img.attrs.src || img.attrs["data-src"]));
  const jsonLd = extractJsonLd(html);
  const logo = absolutize(largestIcon(appleIcons), pageUrl)
    ?? absolutize(jsonLd.logo, pageUrl)
    ?? absolutize(logoImg?.attrs.src ?? logoImg?.attrs["data-src"], pageUrl)
    ?? absolutize(metas["og:image"], pageUrl)
    ?? absolutize(largestIcon(icons), pageUrl);

  const links: Array<{ href: string; text: string }> = [];
  const socials: Partial<Record<SocialKey, string>> = {};
  const channelLinks: Array<{ channel: DemoChannel; url: string }> = [];
  const phones: string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttrs(match[1]);
    const rawHref = (attrs.href ?? "").trim();
    if (!rawHref) continue;
    const channel = channelFor(rawHref);
    if (channel) channelLinks.push({ channel, url: rawHref });
    if (/^tel:/i.test(rawHref)) {
      const phone = decodeURIComponent(rawHref.slice(4)).replace(/[^\d+]/g, "");
      if (phone.replace(/\D/g, "").length >= 7 && !phones.includes(phone)) phones.push(phone);
      continue;
    }
    const href = absolutize(rawHref, pageUrl);
    if (!href || !/^https?:/i.test(href)) continue;
    const social = socialFor(href);
    if (social && !socials[social.key]) socials[social.key] = social.url;
    links.push({ href, text: stripTags(match[2]) || attrs["aria-label"] || attrs.title || "" });
  }
  for (const same of jsonLd.sameAs) {
    const social = socialFor(same);
    if (social && !socials[social.key]) socials[social.key] = social.url;
  }
  // Floating chat widgets often build the wa.me link in an inline script.
  for (const match of html.matchAll(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^\s"'<>\\]*/gi)) {
    if (!channelLinks.some((link) => link.url === match[0])) channelLinks.push({ channel: "whatsapp", url: match[0] });
  }
  if (jsonLd.telephone) {
    const phone = jsonLd.telephone.replace(/[^\d+]/g, "");
    if (phone.replace(/\D/g, "").length >= 7 && !phones.includes(phone)) phones.push(phone);
  }

  const headings: string[] = [];
  for (const match of html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const heading = stripTags(match[2]);
    if (heading.length >= 3 && heading.length <= 90 && !headings.includes(heading)) headings.push(heading);
  }

  const emails = extractEmails(html, text);
  if (jsonLd.email && !isJunkEmail(jsonLd.email) && !emails.some((hit) => hit.value === jsonLd.email!.toLowerCase())) {
    emails.push({ value: jsonLd.email.toLowerCase(), context: "", viaMailto: false });
  }
  const facts = extractFacts(text);
  if (jsonLd.address && !facts.locations.includes(jsonLd.address)) facts.locations.unshift(jsonLd.address);
  for (const hours of jsonLd.openingHours) if (!facts.hours.includes(hours)) facts.hours.push(hours);
  if (jsonLd.priceRange) facts.prices.push(`Price range ${jsonLd.priceRange}`);

  const colors = extractColors(html, metas);
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const shellMarker = /<div[^>]+id=["'](?:root|app|__next|__nuxt|svelte|main-app)["'][^>]*>\s*<\/div>|ng-version=|<noscript>[^<]*(?:enable|requires) javascript/i.test(html);
  const jsShell = text.length < 400 && (shellMarker || scriptCount >= 3);

  return {
    url: pageUrl,
    title,
    description: metas.description ?? metas["og:description"] ?? metas["twitter:description"] ?? jsonLd.description,
    siteName: metas["og:site_name"] ?? metas["application-name"] ?? metas["apple-mobile-web-app-title"],
    ogImage: absolutize(metas["og:image"] ?? metas["twitter:image"], pageUrl),
    themeColor: colors.themeColor,
    colorHints: colors.hints,
    logo,
    text,
    headings,
    links,
    emails,
    phones,
    forms: extractForms(html, pageUrl),
    socials,
    channelLinks,
    jsonLd,
    ...facts,
    scriptCount,
    jsShell,
  };
}

// ---------------------------------------------------------------------------------------------
// robots.txt

export function parseRobots(body: string, userAgent = "KeikiDemoBot"): (path: string) => boolean {
  type Group = { agents: string[]; rules: Array<{ allow: boolean; pattern: string }> };
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow" || field === "allow") current.rules.push({ allow: field === "allow", pattern: value });
  }
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && ua.includes(agent)));
  const chosen = specific.length ? specific : groups.filter((group) => group.agents.includes("*"));
  const rules = chosen.flatMap((group) => group.rules).filter((rule) => rule.pattern !== "" || rule.allow);
  const toRegex = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
  return (path: string) => {
    let best: { allow: boolean; length: number } | undefined;
    for (const rule of rules) {
      if (rule.pattern === "") continue;
      if (!toRegex(rule.pattern).test(path)) continue;
      const length = rule.pattern.length;
      if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
    }
    return best ? best.allow : true;
  };
}

// ---------------------------------------------------------------------------------------------
// Page discovery

const PAGE_KEYWORDS: Array<{ group: string; weight: number; re: RegExp }> = [
  { group: "contact", weight: 10, re: /contact|get-in-touch|reach-us|enquir|inquir/ },
  { group: "book", weight: 9, re: /book|reserv|appointment|schedule|order-online|order/ },
  { group: "menu", weight: 8, re: /menu|food|drinks|wine/ },
  { group: "about", weight: 8, re: /about|our-story|story|who-we-are/ },
  { group: "team", weight: 7, re: /team|people|staff|leadership|founder|meet/ },
  { group: "pricing", weight: 7, re: /pricing|prices|plans|rates|packages/ },
  { group: "services", weight: 6, re: /services|treatments|classes|programs|what-we-do|solutions/ },
  { group: "locations", weight: 6, re: /locations?|visit|find-us|hours|directions/ },
  { group: "faq", weight: 6, re: /faq|questions|help/ },
  { group: "support", weight: 4, re: /support|customer-service/ },
];
const SKIP_PATH = /\/(?:privacy|terms|legal|cookie|login|log-in|signin|sign-in|signup|register|cart|checkout|account|wp-admin|wp-login|feed|tag|category|author|search)(?:[/.?-]|$)|\.(?:pdf|jpe?g|png|gif|svg|webp|zip|mp4|mov|xml|txt|ics)$/i;

export function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "").toLowerCase();
    const hb = new URL(b).hostname.replace(/^www\./, "").toLowerCase();
    return ha === hb;
  } catch {
    return false;
  }
}

export function discoverPages(links: Array<{ href: string; text: string }>, homeUrl: string, max = 6): string[] {
  const scored = new Map<string, { url: string; score: number; group: string }>();
  for (const link of links) {
    if (!sameSite(link.href, homeUrl)) continue;
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }
    url.hash = "";
    url.search = "";
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/" || SKIP_PATH.test(pathname)) continue;
    const haystack = `${pathname.toLowerCase()} ${link.text.toLowerCase().replace(/\s+/g, "-")}`;
    let best: { score: number; group: string } | undefined;
    for (const keyword of PAGE_KEYWORDS) {
      if (keyword.re.test(haystack) && (!best || keyword.weight > best.score)) best = { score: keyword.weight, group: keyword.group };
    }
    if (!best) continue;
    const depth = pathname.split("/").filter(Boolean).length;
    const score = best.score - Math.max(0, depth - 1) * 3;
    const key = `${url.origin}${pathname}`;
    const existing = scored.get(key);
    if (!existing || existing.score < score) scored.set(key, { url: key, score, group: best.group });
  }
  const ranked = [...scored.values()].sort((a, b) => b.score - a.score || a.url.length - b.url.length);
  const picked: string[] = [];
  const groups = new Set<string>();
  for (const candidate of ranked) {
    if (picked.length >= max) break;
    if (groups.has(candidate.group)) continue;
    groups.add(candidate.group);
    picked.push(candidate.url);
  }
  for (const candidate of ranked) {
    if (picked.length >= max) break;
    if (!picked.includes(candidate.url)) picked.push(candidate.url);
  }
  return picked;
}
