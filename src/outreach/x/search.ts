import type { XTweet } from "../types";
import { canonicalTweetUrl, type FetchLike } from "./tweets";

/** A tweet plus the author details triage uses (bio links, profile URL). */
export type XCandidate = {
  tweet: XTweet;
  /** Expanded URLs from the author's profile url and bio, in that order. */
  authorLinks: string[];
  source: string;
};

export const SEARCH_ENDPOINT = "https://api.x.com/2/tweets/search/recent";

export class XApiError extends Error {
  constructor(message: string, readonly status: number, readonly resetAt?: Date) {
    super(message);
    this.name = "XApiError";
  }
  get rateLimited(): boolean {
    return this.status === 429;
  }
}

type ApiUrlEntity = { url?: string; expanded_url?: string; display_url?: string };

export type SearchUser = {
  id: string;
  name?: string;
  username: string;
  url?: string;
  description?: string;
  entities?: { url?: { urls?: ApiUrlEntity[] }; description?: { urls?: ApiUrlEntity[] } };
  public_metrics?: { followers_count?: number };
};

export type SearchTweet = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  conversation_id?: string;
  public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number; impression_count?: number };
  entities?: { urls?: ApiUrlEntity[] };
};

export type SearchResponse = {
  data?: SearchTweet[];
  includes?: { users?: SearchUser[] };
  meta?: { result_count?: number; next_token?: string };
  errors?: Array<{ message?: string; detail?: string; title?: string }>;
};

export function buildSearchUrl(query: string, maxResults: number, nextToken?: string): string {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(100, Math.max(10, Math.round(maxResults)))),
    expansions: "author_id",
    "tweet.fields": "created_at,public_metrics,lang,conversation_id,entities",
    "user.fields": "name,username,url,description,entities,public_metrics",
  });
  if (nextToken) params.set("next_token", nextToken);
  return `${SEARCH_ENDPOINT}?${params}`;
}

/** Map one recent-search page into candidates. t.co links in the text are expanded where X says how. */
export function mapSearchResponse(body: SearchResponse, source: string): XCandidate[] {
  const users = new Map((body.includes?.users ?? []).map((user) => [user.id, user]));
  return (body.data ?? []).map((raw) => {
    const user = raw.author_id ? users.get(raw.author_id) : undefined;
    const handle = user?.username ?? "i";
    const metrics = raw.public_metrics;
    const tweet: XTweet = {
      id: raw.id,
      url: canonicalTweetUrl(handle, raw.id),
      authorHandle: handle,
      authorName: user?.name,
      text: expandLinks(raw.text, raw.entities?.urls),
      createdAt: raw.created_at,
      lang: raw.lang,
      conversationId: raw.conversation_id,
      metrics: metrics
        ? { likes: metrics.like_count, replies: metrics.reply_count, reposts: metrics.retweet_count, views: metrics.impression_count }
        : undefined,
      authorBio: user?.description ? expandLinks(user.description, user.entities?.description?.urls) : undefined,
      authorFollowers: user?.public_metrics?.followers_count,
      authorUrl: user ? `https://x.com/${user.username}` : undefined,
    };
    return { tweet, authorLinks: authorLinks(user), source };
  });
}

function expandLinks(text: string, urls: ApiUrlEntity[] | undefined): string {
  let out = text;
  for (const entity of urls ?? []) {
    if (entity.url && entity.expanded_url) out = out.split(entity.url).join(entity.expanded_url);
  }
  return out;
}

function authorLinks(user: SearchUser | undefined): string[] {
  if (!user) return [];
  const links = [
    ...(user.entities?.url?.urls ?? []).map((entity) => entity.expanded_url ?? entity.url),
    user.url,
    ...(user.entities?.description?.urls ?? []).map((entity) => entity.expanded_url ?? entity.url),
  ].filter((link): link is string => Boolean(link) && !/^https?:\/\/t\.co\//.test(link!));
  return [...new Set(links)];
}

export type SearchOptions = {
  query: string;
  /** Cap on tweets returned for this query (pages of up to 100). */
  max: number;
  token: string;
  fetchImpl?: FetchLike;
  source?: string;
};

/** Run one recent-search query, following next_token until `max` tweets or no more pages. */
export async function searchRecent(options: SearchOptions): Promise<XCandidate[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const results: XCandidate[] = [];
  let nextToken: string | undefined;
  do {
    const remaining = options.max - results.length;
    const response = await fetchImpl(buildSearchUrl(options.query, remaining, nextToken), {
      headers: { authorization: `Bearer ${options.token}` },
    });
    if (!response.ok) throw await apiError(response);
    const body = (await response.json()) as SearchResponse;
    if (!body.data && body.errors?.length) {
      throw new XApiError(`X search error: ${body.errors.map((e) => e.detail ?? e.message ?? e.title).join("; ")}`, 400);
    }
    results.push(...mapSearchResponse(body, options.source ?? options.query));
    nextToken = body.meta?.next_token;
  } while (nextToken && results.length < options.max);
  return results.slice(0, options.max);
}

async function apiError(response: Response): Promise<XApiError> {
  const resetHeader = response.headers.get("x-rate-limit-reset");
  const resetAt = resetHeader ? new Date(Number(resetHeader) * 1000) : undefined;
  if (response.status === 429) {
    const when = resetAt ? ` It resets at ${resetAt.toLocaleTimeString()} (in ${Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 60000))} min).` : "";
    return new XApiError(`X API rate limit reached (429).${when} Drafts saved so far are kept; run scan again after the reset.`, 429, resetAt);
  }
  let detail = "";
  try {
    const body = (await response.json()) as { detail?: string; title?: string; reason?: string };
    detail = body.detail ?? body.title ?? body.reason ?? "";
  } catch {
    // body was not JSON
  }
  if (response.status === 401) return new XApiError(`X rejected X_BEARER_TOKEN (401). Check the token in .env.local. ${detail}`.trim(), 401);
  if (response.status === 403) {
    return new XApiError(`X refused recent search (403): your X API plan or app may not include it. ${detail}`.trim(), 403);
  }
  return new XApiError(`X API ${response.status}: ${detail || response.statusText}`, response.status);
}
