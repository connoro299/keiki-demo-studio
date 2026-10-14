import { readFileSync } from "node:fs";
import { listXDrafts, outreachRoot, writeXDraft } from "../store";
import type { DemoAsset, XDraft, XTweet } from "../types";
import { PIPELINE_UNAVAILABLE, bestDemo, loadPipeline, type PipelineModule } from "../optional-pipeline";
import { LlmUnavailableError, isLlmUnavailable } from "./llm-check";
import { queriesFor, withOperators, type PresetName } from "./presets";
import { XApiError, mapSearchResponse, searchRecent, type SearchResponse, type XCandidate } from "./search";
import { DEFAULT_THRESHOLD, triageCandidate, type CompleteJson } from "./triage";
import { canonicalTweetUrl, fetchTweetByUrl, parseTweetUrl, type FetchLike } from "./tweets";

export type QueueDeps = {
  completeJson: CompleteJson;
  fetchImpl?: FetchLike;
  root?: string;
  /** Loads "@/outreach/pipeline"; injectable for tests. Returns null when not installed. */
  loadPipeline?: () => Promise<PipelineModule | null>;
  log?: (line: string) => void;
};

export type DraftOptions = {
  threshold?: number;
  demo?: boolean;
  concurrency?: number;
};

export type DraftRun = {
  drafted: XDraft[];
  belowThreshold: XDraft[];
  duplicates: string[];
  failed: Array<{ tweetId: string; error: string }>;
  demoErrors: Array<{ tweetId: string; error: string }>;
  /** Set when the source stopped early (rate limit, auth), with what was collected still drafted. */
  sourceError?: string;
};

export const draftIdFor = (tweetId: string) => `x-${tweetId}`;

/** Split candidates into new ones and ones already in the queue (or repeated within the batch). */
export function dedupeCandidates(candidates: XCandidate[], existing: XDraft[]): { fresh: XCandidate[]; duplicates: string[] } {
  const seen = new Set(existing.map((draft) => draft.tweet.id));
  const fresh: XCandidate[] = [];
  const duplicates: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.tweet.id)) {
      duplicates.push(candidate.tweet.id);
      continue;
    }
    seen.add(candidate.tweet.id);
    fresh.push(candidate);
  }
  return { fresh, duplicates };
}

/** Triage and draft each new candidate; write every result (low scores as auto-skipped, for dedupe). */
export async function draftCandidates(candidates: XCandidate[], deps: QueueDeps, options: DraftOptions = {}): Promise<DraftRun> {
  const root = deps.root ?? outreachRoot();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const log = deps.log ?? (() => {});
  const { fresh, duplicates } = dedupeCandidates(candidates, listXDrafts(root));
  const run: DraftRun = { drafted: [], belowThreshold: [], duplicates, failed: [], demoErrors: [] };
  if (duplicates.length) log(`skipping ${duplicates.length} tweet(s) already in the queue`);

  let aborted: Error | undefined;
  await mapLimit(fresh, options.concurrency ?? 3, async (candidate) => {
    if (aborted) return;
    const tweetId = candidate.tweet.id;
    try {
      const triage = await triageCandidate(candidate, deps, { wantDemo: options.demo });
      const now = new Date().toISOString();
      let draft: XDraft = {
        id: draftIdFor(tweetId),
        tweet: candidate.tweet,
        reason: triage.reason,
        score: triage.score,
        site: triage.site,
        reply: triage.reply,
        alternatives: triage.alternatives,
        status: triage.score >= threshold ? "pending" : "skipped",
        source: candidate.source,
        createdAt: now,
        updatedAt: now,
      };
      if (draft.status === "skipped") {
        draft.notes = `auto-skipped: score ${triage.score} below threshold ${threshold}`;
        run.belowThreshold.push(writeXDraft(draft, root));
        log(`  ${tweetId}  ${triage.score.toFixed(2)}  below threshold  ${triage.reason}`);
        return;
      }
      if (options.demo && draft.site) {
        try {
          const demo = await demoForSite(draft.site, deps);
          draft = attachDemo(draft, demo, triage.demoReply);
        } catch (error) {
          run.demoErrors.push({ tweetId, error: (error as Error).message });
        }
      }
      run.drafted.push(writeXDraft(draft, root));
      log(`  ${tweetId}  ${triage.score.toFixed(2)}  drafted${draft.demo ? " + demo" : ""}  ${triage.reason}`);
    } catch (error) {
      if (isLlmUnavailable(error)) {
        aborted = new LlmUnavailableError();
        return;
      }
      run.failed.push({ tweetId, error: (error as Error).message });
      log(`  ${tweetId}  failed: ${(error as Error).message}`);
    }
  });
  if (aborted) throw aborted;
  return run;
}

/** Put a demo on a draft. The demo-aware reply becomes the main reply; the plain one stays as an alternative. */
export function attachDemo(draft: XDraft, demo: DemoAsset, demoReply?: string): XDraft {
  if (!demoReply) return { ...draft, demo };
  const alternatives = [draft.reply, ...(draft.alternatives ?? [])].filter((text) => text !== demoReply).slice(0, 2);
  return { ...draft, demo, reply: demoReply, alternatives };
}

/** Analyze + generate + export a demo for a site through the outreach pipeline (same lead store). */
export async function demoForSite(site: string, deps: QueueDeps): Promise<DemoAsset> {
  const pipeline = await (deps.loadPipeline ?? loadPipeline)();
  if (!pipeline) throw new Error(PIPELINE_UNAVAILABLE);
  const root = deps.root ?? outreachRoot();
  const added = pipeline.addLeads([site], { root });
  const lead = added.added[0] ?? added.existing[0];
  if (!lead) throw new Error(`pipeline rejected ${site}: ${added.invalid[0]?.reason ?? "invalid URL"}`);
  const result = await pipeline.processLead(lead.id, {}, { root, completeJson: deps.completeJson });
  const demo = bestDemo(result.lead.demos);
  if (!demo) throw new Error(`pipeline produced no demo for ${site}${result.lead.error ? `: ${result.lead.error}` : ""}`);
  return demo;
}

// ── Sources ──────────────────────────────────────────────────────────────────────────────────

export type ScanOptions = { query?: string; preset?: PresetName | "all"; max?: number; token: string };

/** Recent search across the preset (or one custom query), deduped by id, capped at `max`. */
export async function scanX(options: ScanOptions, deps: Pick<QueueDeps, "fetchImpl" | "log">): Promise<{ candidates: XCandidate[]; error?: string }> {
  const max = Math.max(1, Math.min(500, options.max ?? 50));
  const queries = options.query
    ? [{ label: "custom", query: withOperators(options.query) }]
    : queriesFor(options.preset ?? "all");
  const perQuery = Math.max(10, Math.ceil(max / queries.length));
  const byId = new Map<string, XCandidate>();
  for (const entry of queries) {
    if (byId.size >= max) break;
    deps.log?.(`searching: ${entry.label}`);
    try {
      const results = await searchRecent({ query: entry.query, max: perQuery, token: options.token, fetchImpl: deps.fetchImpl, source: `search: ${entry.label}` });
      for (const candidate of results) {
        if (byId.size >= max) break;
        if (!byId.has(candidate.tweet.id)) byId.set(candidate.tweet.id, candidate);
      }
    } catch (error) {
      if (error instanceof XApiError) return { candidates: [...byId.values()], error: error.message };
      throw error;
    }
  }
  return { candidates: [...byId.values()] };
}

/** Candidates from pasted tweet URLs, via public oEmbed (no credentials). */
export async function candidatesFromUrls(urls: string[], deps: Pick<QueueDeps, "fetchImpl">): Promise<{ candidates: XCandidate[]; failed: Array<{ url: string; error: string }> }> {
  const candidates: XCandidate[] = [];
  const failed: Array<{ url: string; error: string }> = [];
  for (const url of urls) {
    try {
      const tweet = await fetchTweetByUrl(url, deps.fetchImpl);
      candidates.push({ tweet, authorLinks: [], source: "manual: add" });
    } catch (error) {
      failed.push({ url, error: (error as Error).message });
    }
  }
  return { candidates, failed };
}

type ImportedTweet = Partial<XTweet> & {
  username?: string;
  author?: string | { username?: string; handle?: string; name?: string; description?: string; url?: string };
  authorLinks?: string[];
  site?: string;
};

/**
 * Tweets from a JSON file. Accepts an X API search response ({ data, includes }), an array of
 * tweets, or { tweets: [...] }. A tweet needs an id or status URL; one with a URL but no text is
 * looked up via oEmbed.
 */
export async function candidatesFromFile(file: string, deps: Pick<QueueDeps, "fetchImpl">): Promise<{ candidates: XCandidate[]; failed: Array<{ url: string; error: string }> }> {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return candidatesFromJson(parsed, `import: ${file.split("/").at(-1)}`, deps);
}

export async function candidatesFromJson(parsed: unknown, source: string, deps: Pick<QueueDeps, "fetchImpl">): Promise<{ candidates: XCandidate[]; failed: Array<{ url: string; error: string }> }> {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "data" in parsed) {
    return { candidates: mapSearchResponse(parsed as SearchResponse, source), failed: [] };
  }
  const list = (Array.isArray(parsed) ? parsed : (parsed as { tweets?: unknown[] })?.tweets) as ImportedTweet[] | undefined;
  if (!Array.isArray(list)) throw new Error("import expects an X API search response, an array of tweets, or { tweets: [...] }");
  const candidates: XCandidate[] = [];
  const failed: Array<{ url: string; error: string }> = [];
  for (const item of list) {
    const author = typeof item.author === "object" ? item.author : undefined;
    const ref = item.url ? parseTweetUrl(item.url) : undefined;
    const handle = item.authorHandle ?? item.username ?? (typeof item.author === "string" ? item.author : author?.username ?? author?.handle) ?? ref?.handle;
    const id = item.id ?? ref?.id;
    if (!id) {
      failed.push({ url: item.url ?? JSON.stringify(item).slice(0, 80), error: "no tweet id or status URL" });
      continue;
    }
    if (!item.text) {
      try {
        const tweet = await fetchTweetByUrl(item.url ?? canonicalTweetUrl(handle ?? "i", id), deps.fetchImpl);
        candidates.push({ tweet, authorLinks: item.authorLinks ?? [], source });
      } catch (error) {
        failed.push({ url: item.url ?? id, error: (error as Error).message });
      }
      continue;
    }
    const cleanHandle = (handle ?? "i").replace(/^@/, "");
    candidates.push({
      tweet: {
        ...item,
        id,
        url: item.url ?? canonicalTweetUrl(cleanHandle, id),
        authorHandle: cleanHandle,
        authorName: item.authorName ?? author?.name,
        authorBio: item.authorBio ?? author?.description,
        text: item.text,
      } as XTweet,
      authorLinks: [...(item.authorLinks ?? []), ...(item.site ? [item.site] : []), ...(author?.url ? [author.url] : [])],
      source,
    });
  }
  return { candidates, failed };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}
