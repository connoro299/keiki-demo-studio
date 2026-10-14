import type { DemoChannel } from "@/contracts";
import { completeJson as defaultCompleteJson, type CompleteOptions } from "./llm";
import { rankContacts, type ContactCandidate } from "./contacts";
import { discoverPages, extractPage, parseRobots, type PageExtract, type SocialKey } from "./extract";
import { normalizeUrl } from "./store";
import type { SiteFacts, SiteProfile } from "./types";

export const USER_AGENT = "KeikiDemoBot/1.0 (+https://onkeiki.com)";
const MAX_BODY_BYTES = 2_000_000;
const TEXT_SAMPLE_CHARS = 12_000;

export type AnalyzeDeps = {
  fetch?: typeof fetch;
  completeJson?: <T>(options: CompleteOptions) => Promise<T>;
  /** Renders a JS-heavy page in a headless browser and returns its HTML. Default: Playwright Chromium. */
  renderHtml?: (url: string) => Promise<string>;
  now?: () => Date;
  log?: (message: string) => void;
};

export type AnalyzeOptions = {
  /** false → meta-tag heuristics only, no model call. Default true. */
  llm?: boolean;
  /** Extra internal pages to read after the homepage. Default 6. */
  maxPages?: number;
  /** Headless-browser fallback for client-rendered sites. "auto" (default) uses it when the HTML has almost no text. */
  browser?: "auto" | "always" | "never";
  timeoutMs?: number;
  /** Columns from an imported list (an email column becomes the top-ranked contact). */
  inputEmail?: string;
  inputName?: string;
};

export type FetchedPage = { url: string; status: number; html: string; contentType: string };

export async function fetchPage(url: string, deps: AnalyzeDeps = {}, timeoutMs = 10_000): Promise<FetchedPage> {
  const doFetch = deps.fetch ?? fetch;
  const response = await doFetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5,*/*;q=0.1",
      "accept-language": "en-US,en;q=0.8",
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  let html = "";
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    html += decoder.decode();
  } else {
    html = (await response.text()).slice(0, MAX_BODY_BYTES);
  }
  return { url: response.url || url, status: response.status, html, contentType };
}

async function loadRobots(origin: string, deps: AnalyzeDeps, timeoutMs: number): Promise<(path: string) => boolean> {
  try {
    const page = await fetchPage(`${origin}/robots.txt`, deps, Math.min(timeoutMs, 6000));
    if (page.status >= 400 || /<html/i.test(page.html.slice(0, 500))) return () => true;
    return parseRobots(page.html, "KeikiDemoBot");
  } catch {
    return () => true;
  }
}

/** Playwright Chromium (already a dev dependency). Loaded lazily so the module stays optional. */
export async function renderWithBrowser(url: string, timeoutMs = 20_000): Promise<string> {
  const specifier = "@playwright/test";
  const { chromium } = (await import(/* @vite-ignore */ specifier)) as typeof import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
    return await page.content();
  } finally {
    await browser.close();
  }
}

type ExtractedSite = {
  home: PageExtract;
  pages: PageExtract[];
  url: string;
  domain: string;
};

export async function crawlSite(inputUrl: string, deps: AnalyzeDeps = {}, options: AnalyzeOptions = {}): Promise<ExtractedSite> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const log = deps.log ?? (() => undefined);
  const start = normalizeUrl(inputUrl);
  const startUrl = new URL(start);
  const allowed = await loadRobots(startUrl.origin, deps, timeoutMs);
  if (!allowed(startUrl.pathname || "/")) throw new Error(`robots.txt disallows ${startUrl.pathname || "/"} for KeikiDemoBot`);

  let first: FetchedPage;
  try {
    first = await fetchPage(start, deps, timeoutMs);
  } catch (error) {
    const message = (error as Error).name === "TimeoutError" || /timeout|aborted/i.test((error as Error).message)
      ? `timed out after ${Math.round(timeoutMs / 1000)}s`
      : ((error as Error & { cause?: { code?: string } }).cause?.code ?? (error as Error).message);
    throw new Error(`could not fetch ${start}: ${message}`);
  }
  if (first.status >= 400) throw new Error(`homepage returned HTTP ${first.status}`);
  if (first.contentType && !/html|text\/plain|xml/i.test(first.contentType)) throw new Error(`homepage is ${first.contentType}, not HTML`);
  const finalUrl = first.url || start;
  let home = extractPage(first.html, finalUrl);

  const browserMode = options.browser ?? "auto";
  if (browserMode === "always" || (browserMode === "auto" && home.jsShell)) {
    try {
      log(`rendering ${finalUrl} in a headless browser (${browserMode === "always" ? "forced" : "little server-rendered text"})`);
      const rendered = await (deps.renderHtml ?? renderWithBrowser)(finalUrl);
      const renderedExtract = extractPage(rendered, finalUrl);
      if (renderedExtract.text.length > home.text.length) home = renderedExtract;
    } catch (error) {
      log(`browser fallback failed: ${(error as Error).message}`);
    }
  }

  const robotsFinal = sameOrigin(finalUrl, start) ? allowed : await loadRobots(new URL(finalUrl).origin, deps, timeoutMs);
  const candidates = discoverPages(home.links, finalUrl, options.maxPages ?? 6).filter((url) => robotsFinal(new URL(url).pathname));
  const pages: PageExtract[] = [];
  const results = await Promise.allSettled(candidates.map((url) => fetchPage(url, deps, timeoutMs)));
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      log(`skip ${candidates[index]}: ${String(result.reason?.message ?? result.reason)}`);
      return;
    }
    if (result.value.status >= 400 || (result.value.contentType && !/html/i.test(result.value.contentType))) return;
    pages.push(extractPage(result.value.html, result.value.url || candidates[index]));
  });
  return { home, pages, url: finalUrl, domain: new URL(finalUrl).hostname.replace(/^www\./, "") };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Merge extracted pages into one material bundle

export type SiteMaterial = {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  siteName?: string;
  jsonLdName?: string;
  jsonLdTypes: string[];
  headings: string[];
  text: string;
  logo?: string;
  brandColor?: string;
  colorHints: string[];
  socials: Partial<Record<SocialKey, string>>;
  channelsSeen: DemoChannel[];
  candidates: ContactCandidate[];
  facts: Required<SiteFacts>;
  pages: string[];
};

const CHANNEL_ORDER: DemoChannel[] = ["whatsapp", "imessage", "sms", "telegram", "slack"];

export function mergeSite(site: ExtractedSite): SiteMaterial {
  const all = [site.home, ...site.pages];
  const socials: Partial<Record<SocialKey, string>> = {};
  for (const page of all) for (const [key, value] of Object.entries(page.socials) as Array<[SocialKey, string]>) socials[key] ??= value;
  const seen = new Set<DemoChannel>();
  for (const page of all) for (const link of page.channelLinks) seen.add(link.channel);

  const candidates: ContactCandidate[] = [];
  for (const page of all) {
    for (const email of page.emails) candidates.push({ kind: "email", value: email.value, source: page.url, context: email.context });
    for (const form of page.forms) candidates.push({ kind: "form", value: form.pageUrl, label: form.provider ? `Contact form (${form.provider})` : "Contact form", source: page.url });
    for (const phone of page.phones) candidates.push({ kind: "phone", value: phone, source: page.url });
    for (const link of page.channelLinks.filter((item) => item.channel === "whatsapp")) {
      const number = link.url.match(/(?:wa\.me\/|phone=)(\+?\d{7,15})/)?.[1];
      candidates.push({ kind: "whatsapp", value: number ?? link.url, label: "WhatsApp", source: page.url });
    }
  }
  if (socials.x) candidates.push({ kind: "x", value: socials.x, source: site.url });
  if (socials.linkedin) candidates.push({ kind: "linkedin", value: socials.linkedin, source: site.url });
  if (socials.instagram) candidates.push({ kind: "instagram", value: socials.instagram, source: site.url });

  const union = (pick: (page: PageExtract) => string[], cap: number) => [...new Set(all.flatMap(pick))].slice(0, cap);
  const textParts: string[] = [];
  let budget = TEXT_SAMPLE_CHARS;
  for (const page of all) {
    if (budget <= 0) break;
    const chunk = `# ${page.url}\n${page.text}`.slice(0, Math.max(800, Math.floor(budget / Math.max(1, all.length - textParts.length))));
    textParts.push(chunk);
    budget -= chunk.length;
  }

  return {
    url: site.url,
    domain: site.domain,
    title: site.home.title,
    description: site.home.description,
    siteName: site.home.siteName,
    jsonLdName: all.map((page) => page.jsonLd.name).find(Boolean),
    jsonLdTypes: union((page) => page.jsonLd.types, 8),
    headings: union((page) => page.headings, 40),
    text: textParts.join("\n\n").slice(0, TEXT_SAMPLE_CHARS),
    logo: site.home.logo ?? site.pages.map((page) => page.logo).find(Boolean),
    brandColor: site.home.colorHints[0],
    colorHints: site.home.colorHints,
    socials,
    channelsSeen: CHANNEL_ORDER.filter((channel) => seen.has(channel)),
    candidates,
    facts: {
      prices: union((page) => page.prices, 20),
      hours: union((page) => page.hours, 8),
      locations: union((page) => page.locations, 5),
      policies: union((page) => page.policies, 5),
    },
    pages: all.map((page) => page.url),
  };
}

// ---------------------------------------------------------------------------------------------
// Heuristic profile (no model)

const VERTICALS: Array<{ vertical: string; audience: string; tone: string; re: RegExp; types?: RegExp }> = [
  { vertical: "restaurant", audience: "local diners and groups booking tables", tone: "warm, quick and hospitable", re: /\b(restaurant|bistro|trattoria|pizzeria|pizza|brunch|dinner|tasting menu|reservations?|cuisine|chef|eatery|tapas|sushi|ramen|taqueria)\b/gi, types: /Restaurant|FoodEstablishment/ },
  { vertical: "cafe & bakery", audience: "regulars and neighborhood walk-ins", tone: "friendly and casual", re: /\b(cafe|café|coffee|espresso|bakery|pastr(y|ies)|croissant|roaster)\b/gi, types: /Cafe|Bakery/ },
  { vertical: "bar & nightlife", audience: "guests planning nights out and events", tone: "upbeat and easygoing", re: /\b(cocktails?|bar|brewery|taproom|wine bar|happy hour|nightclub)\b/gi, types: /BarOrPub|Brewery|Winery/ },
  { vertical: "hotel & hospitality", audience: "travelers booking stays", tone: "polished and welcoming", re: /\b(hotel|resort|suites?|rooms?|check-in|guesthouse|inn|villa|stay|lodg(e|ing)|hostel)\b/gi, types: /Hotel|Lodging|Resort/ },
  { vertical: "salon & spa", audience: "clients booking appointments", tone: "warm and reassuring", re: /\b(salon|spa|massage|facials?|nails?|lashes|brows|barber(shop)?|haircuts?|blowout|waxing|beauty)\b/gi, types: /Salon|Spa|Beauty|HealthAndBeauty/ },
  { vertical: "fitness studio", audience: "members and first-time class takers", tone: "energetic and encouraging", re: /\b(gym|fitness|yoga|pilates|classes|personal training|crossfit|spin|barre|boxing|membership)\b/gi, types: /ExerciseGym|SportsActivity/ },
  { vertical: "dental & medical clinic", audience: "patients booking and preparing for visits", tone: "calm, clear and professional", re: /\b(dental|dentist|orthodont|clinic|patients?|physio(therapy)?|chiropract|dermatolog|medical|therapy|wellness|optometr)\b/gi, types: /Dentist|Medical|Physician|Clinic/ },
  { vertical: "home services", audience: "homeowners requesting quotes and visits", tone: "straightforward and dependable", re: /\b(plumb(ing|er)|hvac|electric(ian|al)|roofing|cleaning|landscap|contractor|renovation|repairs?|handyman|pest|moving|movers)\b/gi, types: /HomeAndConstruction|Plumber|Electrician|HVAC|Roofing|Locksmith|Moving/ },
  { vertical: "real estate", audience: "buyers, sellers and renters", tone: "professional and responsive", re: /\b(real estate|realtor|listings?|homes for sale|property|properties|leasing|apartments?|brokerage)\b/gi, types: /RealEstate/ },
  { vertical: "legal & professional services", audience: "prospective clients with a question", tone: "measured and professional", re: /\b(law firm|attorney|lawyer|legal|accounting|cpa|bookkeeping|tax|consulting|advisory)\b/gi, types: /Legal|Attorney|Accounting|ProfessionalService/ },
  { vertical: "automotive", audience: "drivers booking service", tone: "practical and friendly", re: /\b(auto repair|mechanic|oil change|tires?|dealership|car wash|detailing|collision)\b/gi, types: /Auto/ },
  { vertical: "ecommerce / DTC brand", audience: "online shoppers", tone: "friendly and on-brand", re: /\b(shop now|add to cart|free shipping|collections?|bestsellers?|checkout|our products|order now|subscribe & save)\b/gi, types: /Store|Product/ },
  { vertical: "B2B software", audience: "teams evaluating and using the product", tone: "clear, concise and helpful", re: /\b(saas|platform|api|integrations?|dashboard|workflow|teams|book a demo|request a demo|start free trial|enterprise|software|automation)\b/gi, types: /SoftwareApplication/ },
  { vertical: "agency", audience: "businesses hiring a creative or marketing partner", tone: "confident and personable", re: /\b(agency|studio|branding|web design|marketing agency|creative|campaigns|clients)\b/gi },
  { vertical: "education & tutoring", audience: "students and parents", tone: "patient and encouraging", re: /\b(tutor(ing)?|courses?|lessons|academy|school|enroll(ment)?|students?|curriculum)\b/gi, types: /Educational|School/ },
  { vertical: "events & venues", audience: "people planning events", tone: "warm and organized", re: /\b(venue|weddings?|private events|event space|catering|banquet|rentals?)\b/gi, types: /EventVenue/ },
];

export function classifyVertical(material: Pick<SiteMaterial, "title" | "description" | "headings" | "text" | "jsonLdTypes">): (typeof VERTICALS)[number] {
  const haystack = [material.title, material.description, ...material.headings, material.text.slice(0, 6000)].filter(Boolean).join("\n");
  const head = [material.title, material.description].filter(Boolean).join(" ");
  let best: { entry: (typeof VERTICALS)[number]; score: number } | undefined;
  for (const entry of VERTICALS) {
    let score = (haystack.match(entry.re) ?? []).length + (head.match(entry.re) ?? []).length * 4;
    if (entry.types && material.jsonLdTypes.some((type) => entry.types!.test(type))) score += 12;
    if (!best || score > best.score) best = { entry, score };
  }
  return best && best.score > 0 ? best.entry : { vertical: "local business", audience: "customers with questions", tone: "friendly and helpful", re: /$^/ };
}

const NAME_SPLIT = /\s+[|–—:·•»]\s+|\s+-\s+/;

export function businessName(material: Pick<SiteMaterial, "siteName" | "jsonLdName" | "title" | "domain">): string {
  const clean = (value?: string) => value?.replace(/\s+/g, " ").trim();
  if (clean(material.jsonLdName) && clean(material.jsonLdName)!.length <= 60) return clean(material.jsonLdName)!;
  if (clean(material.siteName) && clean(material.siteName)!.length <= 60) return clean(material.siteName)!;
  const label = material.domain.replace(/^www\./, "").split(".")[0].toLowerCase();
  const segments = (clean(material.title) ?? "").split(NAME_SPLIT).map((part) => part.trim()).filter(Boolean)
    .filter((part) => !/^(home|homepage|welcome|official site|official website)$/i.test(part));
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matching = segments.find((part) => compact(part).includes(label) || (compact(part).length >= 4 && label.includes(compact(part))));
  if (matching && matching.length <= 60) return matching;
  if (segments[0] && segments[0].length <= 40) return segments[0];
  return label.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function firstSentences(text: string, count: number, maxChars = 320): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?]+[.!?]+/g) ?? [flat];
  return sentences.slice(0, count).join(" ").trim().slice(0, maxChars);
}

function heuristicOfferings(material: SiteMaterial, name: string): string[] {
  const nav = /^(home|about|about us|contact|contact us|menu|book|book now|faq|blog|news|shop|cart|login|sign in|careers|team|our team|locations?|gallery|press|privacy|terms|follow us|subscribe|reservations?)$/i;
  const fromHeadings = material.headings
    .filter((heading) => !nav.test(heading) && heading.toLowerCase() !== name.toLowerCase() && heading.split(" ").length <= 8)
    .slice(0, 6);
  const fromPrices = material.facts.prices.filter((line) => line.length <= 80).slice(0, 4);
  return [...new Set([...fromHeadings, ...fromPrices])].slice(0, 8);
}

export function heuristicProfile(material: SiteMaterial, now: Date, options: Pick<AnalyzeOptions, "inputEmail" | "inputName"> = {}): SiteProfile {
  const name = businessName(material);
  const vertical = classifyVertical(material);
  const firstHeading = material.headings[0];
  const summary = material.description
    ? firstSentences(material.description, 2)
    : firstSentences(material.text.split("\n").filter((line) => line.split(" ").length > 6).slice(0, 4).join(" "), 2) || `${name} (${material.domain}).`;
  return {
    url: material.url,
    domain: material.domain,
    name,
    ...(firstHeading && firstHeading !== name ? { tagline: firstHeading } : material.description ? { tagline: firstSentences(material.description, 1, 120) } : {}),
    summary,
    vertical: vertical.vertical,
    audience: vertical.audience,
    offerings: heuristicOfferings(material, name),
    tone: vertical.tone,
    ...(material.brandColor ? { brandColor: material.brandColor } : {}),
    ...(material.logo ? { logo: material.logo } : {}),
    socials: material.socials,
    contacts: rankContacts(material.candidates, { siteDomain: material.domain, inputEmail: options.inputEmail, inputName: options.inputName }),
    channelsSeen: material.channelsSeen,
    fetchedAt: now.toISOString(),
    facts: material.facts,
    pages: material.pages,
    textSample: material.text,
    analyzedWith: "heuristic",
  };
}

// ---------------------------------------------------------------------------------------------
// Model pass

type LlmAnalysis = {
  name?: string;
  tagline?: string;
  summary?: string;
  vertical?: string;
  audience?: string;
  offerings?: string[];
  tone?: string;
  facts?: SiteFacts;
  contacts?: Array<{ value: string; label?: string; decisionMaker?: boolean }>;
};

export const ANALYZE_SYSTEM = `You analyze a small business's website for Keiki, a platform for AI agents that answer customers for a business over SMS, iMessage, WhatsApp, Slack, Telegram and email (answer questions, book appointments, qualify leads, take payment, send order updates, hand off to a human).
Work only from the supplied site material. Never invent prices, hours, policies, names or contact details. Use "unknown" style omissions rather than guesses.`;

export function analyzePrompt(material: SiteMaterial, heuristic: SiteProfile): string {
  const contacts = material.candidates
    .filter((candidate) => candidate.kind !== "phone")
    .map((candidate) => ({ kind: candidate.kind, value: candidate.value, context: candidate.context?.slice(0, 220) }));
  return `Site material (JSON):
${JSON.stringify({
    url: material.url,
    title: material.title,
    metaDescription: material.description,
    siteName: material.siteName,
    schemaOrg: { name: material.jsonLdName, types: material.jsonLdTypes },
    headings: material.headings.slice(0, 30),
    facts: material.facts,
    channelsSeen: material.channelsSeen,
    contacts,
    heuristicGuess: { name: heuristic.name, vertical: heuristic.vertical },
    pagesRead: material.pages,
    visibleText: material.text,
  }, null, 1)}

Return one JSON object:
{
  "name": "the business name customers use (short, as on their sign)",
  "tagline": "their own tagline if they have one",
  "summary": "two or three plain sentences: what they do, for whom, where",
  "vertical": "short category, e.g. 'neighborhood Italian restaurant', 'dental clinic', 'B2B scheduling software'",
  "audience": "who their customers are",
  "offerings": ["3-8 concrete offerings exactly as named on the site, with prices only if the site states them"],
  "tone": "how an agent speaking for them should sound, from their copy (a few words)",
  "facts": { "prices": ["verbatim price lines from the site"], "hours": ["..."], "locations": ["..."], "policies": ["booking/cancellation/shipping/refund policies stated on the site"] },
  "contacts": [{ "value": "an email/URL copied exactly from the contacts list", "label": "person and role if the page says so, e.g. 'Maya Chen, Owner', else a role like 'Bookings inbox'", "decisionMaker": true }]
}
Only include contacts from the supplied list. decisionMaker is true only when the page ties that address to a founder, owner, CEO, president, GM or similar.`;
}

export function mergeAnalysis(heuristic: SiteProfile, material: SiteMaterial, analysis: LlmAnalysis, options: Pick<AnalyzeOptions, "inputEmail" | "inputName"> = {}): SiteProfile {
  const known = new Map(material.candidates.map((candidate) => [candidate.value.toLowerCase(), candidate]));
  const candidates: ContactCandidate[] = material.candidates.map((candidate) => ({ ...candidate }));
  for (const contact of analysis.contacts ?? []) {
    const match = known.get(contact.value?.toLowerCase?.() ?? "");
    if (!match) continue; // the model may only annotate what was actually found
    const target = candidates.find((candidate) => candidate.value.toLowerCase() === match.value.toLowerCase());
    if (!target) continue;
    if (contact.label) target.label = contact.label;
    if (contact.decisionMaker) target.decisionMaker = true;
  }
  const strings = (value: unknown, cap: number) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, cap) : []);
  const facts: SiteFacts = {
    prices: strings(analysis.facts?.prices, 20).length ? strings(analysis.facts?.prices, 20) : heuristic.facts?.prices,
    hours: strings(analysis.facts?.hours, 8).length ? strings(analysis.facts?.hours, 8) : heuristic.facts?.hours,
    locations: strings(analysis.facts?.locations, 5).length ? strings(analysis.facts?.locations, 5) : heuristic.facts?.locations,
    policies: strings(analysis.facts?.policies, 5).length ? strings(analysis.facts?.policies, 5) : heuristic.facts?.policies,
  };
  const text = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim() : fallback);
  return {
    ...heuristic,
    name: text(analysis.name, heuristic.name),
    ...(analysis.tagline ? { tagline: analysis.tagline.trim() } : {}),
    summary: text(analysis.summary, heuristic.summary),
    vertical: text(analysis.vertical, heuristic.vertical),
    audience: text(analysis.audience, heuristic.audience),
    offerings: strings(analysis.offerings, 8).length ? strings(analysis.offerings, 8) : heuristic.offerings,
    tone: text(analysis.tone, heuristic.tone),
    contacts: rankContacts(candidates, { siteDomain: material.domain, inputEmail: options.inputEmail, inputName: options.inputName }),
    facts,
    analyzedWith: "llm",
  };
}

/**
 * Fetch a site (homepage + up to ~6 high-value internal pages, robots.txt respected), extract
 * contacts/channels/facts, then one Claude call turns the material into a SiteProfile.
 * `options.llm === false` skips the model and uses meta-tag heuristics.
 */
export async function analyzeSite(url: string, deps: AnalyzeDeps = {}, options: AnalyzeOptions = {}): Promise<SiteProfile> {
  const now = (deps.now ?? (() => new Date()))();
  const site = await crawlSite(url, deps, options);
  const material = mergeSite(site);
  const heuristic = heuristicProfile(material, now, options);
  if (options.llm === false) return heuristic;
  const analysis = await (deps.completeJson ?? defaultCompleteJson)<LlmAnalysis>({
    system: ANALYZE_SYSTEM,
    prompt: analyzePrompt(material, heuristic),
    maxTokens: 2500,
  });
  return mergeAnalysis(heuristic, material, analysis ?? {}, options);
}
