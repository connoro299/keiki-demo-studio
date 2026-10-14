import type { XTweet } from "../types";

/** Matches x.com / twitter.com / mobile / fxtwitter-style status URLs and pulls out handle + id. */
const STATUS_URL = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i;

export type TweetRef = { id: string; handle: string; url: string };

/** Parse a tweet URL. Returns undefined for anything that is not a status link. */
export function parseTweetUrl(input: string): TweetRef | undefined {
  const match = input.trim().match(STATUS_URL);
  if (!match) return undefined;
  const [, handle, id] = match;
  return { id, handle, url: canonicalTweetUrl(handle, id) };
}

export function canonicalTweetUrl(handle: string, id: string): string {
  return `https://x.com/${handle}/status/${id}`;
}

/**
 * The human posts every reply. This builds X's web intent, which opens a prefilled reply composer
 * in the reviewer's own logged-in browser. No API write access, nothing is sent automatically.
 */
export function replyIntentUrl(tweetId: string, text: string): string {
  const params = new URLSearchParams({ in_reply_to: tweetId, text });
  // URLSearchParams encodes spaces as "+", which X renders literally in some clients. Use %20.
  return `https://x.com/intent/post?${params.toString().replace(/\+/g, "%20")}`;
}

/** X counts every URL as 23 characters; everything else by code point (close enough for review). */
export function tweetLength(text: string): number {
  const urlPattern = /https?:\/\/\S+/g;
  const withoutUrls = text.replace(urlPattern, "");
  const urls = text.match(urlPattern)?.length ?? 0;
  return Array.from(withoutUrls).length + urls * 23;
}

// ── oEmbed ────────────────────────────────────────────────────────────────────────────────────

export type OEmbedResponse = {
  url?: string;
  author_name?: string;
  author_url?: string;
  html?: string;
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Parse the blockquote X returns from oEmbed:
 *   <blockquote class="twitter-tweet"><p lang="en" dir="ltr">text<br>more <a href="https://t.co/x">pic.twitter.com/x</a></p>
 *   &mdash; Name (@handle) <a href="https://x.com/handle/status/123?ref_src=…">March 21, 2006</a></blockquote>
 */
export function parseOembedHtml(html: string): { text: string; lang?: string; authorName?: string; authorHandle?: string; createdAt?: string; statusUrl?: string } {
  const paragraph = html.match(/<p\b([^>]*)>([\s\S]*?)<\/p>/i);
  const lang = paragraph?.[1].match(/\blang="([^"]+)"/i)?.[1];
  const inner = paragraph?.[2] ?? "";
  const text = decodeEntities(
    inner
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  const tail = paragraph ? html.slice((paragraph.index ?? 0) + paragraph[0].length) : html;
  const byline = decodeEntities(tail).match(/—\s*(.*?)\s*\(@([A-Za-z0-9_]{1,15})\)/);
  const anchors = [...tail.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const last = anchors.at(-1);
  const statusUrl = last ? decodeEntities(last[1]).replace(/\?.*$/, "") : undefined;
  return {
    text,
    lang: lang && lang !== "und" ? lang : undefined,
    authorName: byline?.[1] || undefined,
    authorHandle: byline?.[2],
    createdAt: last ? parseLongDate(decodeEntities(last[2]).trim()) : undefined,
    statusUrl,
  };
}

/** "March 21, 2006" → "2006-03-21T00:00:00.000Z". */
export function parseLongDate(value: string): string | undefined {
  const match = value.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return undefined;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return undefined;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[2]))).toISOString();
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const OEMBED_HOSTS = ["https://publish.x.com/oembed", "https://publish.twitter.com/oembed"];

/** Look up a public tweet with no credentials via oEmbed. Tries publish.x.com, then publish.twitter.com. */
export async function fetchTweetByUrl(url: string, fetchImpl: FetchLike = fetch): Promise<XTweet> {
  const ref = parseTweetUrl(url);
  if (!ref) throw new Error(`not a tweet URL: ${url}`);
  let lastError = "";
  for (const host of OEMBED_HOSTS) {
    const endpoint = `${host}?${new URLSearchParams({ url: ref.url, omit_script: "1", dnt: "true" })}`;
    let response: Response;
    try {
      response = await fetchImpl(endpoint, { headers: { accept: "application/json" } });
    } catch (error) {
      lastError = `${host}: ${(error as Error).message}`;
      continue;
    }
    if (response.status === 404) throw new Error(`tweet not found or not public: ${ref.url}`);
    if (!response.ok) {
      lastError = `${host} answered ${response.status}`;
      continue;
    }
    const body = (await response.json()) as OEmbedResponse;
    return tweetFromOembed(body, ref);
  }
  throw new Error(`oEmbed lookup failed for ${ref.url}: ${lastError}`);
}

export function tweetFromOembed(body: OEmbedResponse, ref: TweetRef): XTweet {
  const parsed = parseOembedHtml(body.html ?? "");
  const handle = parsed.authorHandle ?? body.author_url?.split("/").filter(Boolean).at(-1) ?? ref.handle;
  return {
    id: ref.id,
    url: canonicalTweetUrl(handle, ref.id),
    authorHandle: handle,
    authorName: parsed.authorName ?? body.author_name,
    text: parsed.text,
    createdAt: parsed.createdAt,
    lang: parsed.lang,
    authorUrl: `https://x.com/${handle}`,
  };
}
