import { describe, expect, it } from "vitest";
import { PRESETS, PRESET_NAMES, queriesFor, withOperators } from "@/outreach/x/presets";
import { scanX } from "@/outreach/x/queue";
import { XApiError, buildSearchUrl, mapSearchResponse, searchRecent, type SearchResponse } from "@/outreach/x/search";

const PAGE: SearchResponse = {
  data: [
    {
      id: "1846000000000000001",
      text: "40 unread texts asking if we have saturday slots. our site https://t.co/x1",
      author_id: "u1",
      created_at: "2026-10-14T13:00:00.000Z",
      lang: "en",
      conversation_id: "1846000000000000001",
      public_metrics: { like_count: 12, reply_count: 3, retweet_count: 1, quote_count: 0, impression_count: 900 },
      entities: { urls: [{ url: "https://t.co/x1", expanded_url: "https://harborbarbers.co/book" }] },
    },
    { id: "1846000000000000002", text: "no author in includes", author_id: "missing" },
  ],
  includes: {
    users: [
      {
        id: "u1",
        name: "Marco Reyes",
        username: "marco_cuts",
        url: "https://t.co/u1",
        description: "Barber. Owner @ Harbor. https://t.co/d1",
        entities: {
          url: { urls: [{ url: "https://t.co/u1", expanded_url: "https://harborbarbers.co" }] },
          description: { urls: [{ url: "https://t.co/d1", expanded_url: "https://instagram.com/harbor" }] },
        },
        public_metrics: { followers_count: 1840 },
      },
    ],
  },
  meta: { result_count: 2 },
};

describe("search response mapping", () => {
  it("joins authors, expands t.co links and keeps metrics", () => {
    const [first, second] = mapSearchResponse(PAGE, "search: test");
    expect(first.tweet).toMatchObject({
      id: "1846000000000000001",
      url: "https://x.com/marco_cuts/status/1846000000000000001",
      authorHandle: "marco_cuts",
      authorName: "Marco Reyes",
      authorFollowers: 1840,
      authorBio: "Barber. Owner @ Harbor. https://instagram.com/harbor",
      text: "40 unread texts asking if we have saturday slots. our site https://harborbarbers.co/book",
      metrics: { likes: 12, replies: 3, reposts: 1, views: 900 },
      conversationId: "1846000000000000001",
      lang: "en",
    });
    expect(first.authorLinks).toEqual(["https://harborbarbers.co", "https://instagram.com/harbor"]);
    expect(first.source).toBe("search: test");
    expect(second.tweet.authorHandle).toBe("i");
    expect(second.authorLinks).toEqual([]);
  });

  it("builds the recent-search URL with the required fields", () => {
    const url = new URL(buildSearchUrl("receptionist lang:en", 5, "tok"));
    expect(url.origin + url.pathname).toBe("https://api.x.com/2/tweets/search/recent");
    expect(url.searchParams.get("max_results")).toBe("10"); // API minimum
    expect(url.searchParams.get("expansions")).toBe("author_id");
    expect(url.searchParams.get("tweet.fields")).toContain("created_at,public_metrics,lang,conversation_id");
    expect(url.searchParams.get("user.fields")).toBe("name,username,url,description,entities,public_metrics");
    expect(url.searchParams.get("next_token")).toBe("tok");
    expect(new URL(buildSearchUrl("q", 500)).searchParams.get("max_results")).toBe("100");
  });
});

function page(ids: string[], next?: string): SearchResponse {
  return { data: ids.map((id) => ({ id, text: `tweet ${id}`, author_id: "u" })), includes: { users: [{ id: "u", username: "owner" }] }, meta: { next_token: next } };
}

describe("searchRecent", () => {
  it("follows next_token until the cap and sends the bearer token", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const pages = [page(["1", "2", "3"], "n1"), page(["4", "5", "6"], "n2"), page(["7"])];
    const results = await searchRecent({
      query: "q",
      max: 5,
      token: "secret",
      fetchImpl: async (url, init) => {
        seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify(pages.shift()), { status: 200 });
      },
    });
    expect(results.map((r) => r.tweet.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(seen).toHaveLength(2);
    expect(seen[0].auth).toBe("Bearer secret");
    expect(new URL(seen[1].url).searchParams.get("next_token")).toBe("n1");
  });

  it("turns 429 into a clear rate-limit error with the reset time", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const error = await searchRecent({
      query: "q",
      max: 10,
      token: "t",
      fetchImpl: async () => new Response(JSON.stringify({ title: "Too Many Requests" }), { status: 429, headers: { "x-rate-limit-reset": String(reset) } }),
    }).catch((e) => e);
    expect(error).toBeInstanceOf(XApiError);
    expect(error.rateLimited).toBe(true);
    expect(error.message).toMatch(/rate limit reached \(429\).*in 10 min/);
    expect(error.resetAt?.getTime()).toBe(reset * 1000);
  });

  it("explains a rejected token", async () => {
    await expect(searchRecent({ query: "q", max: 10, token: "bad", fetchImpl: async () => new Response("{}", { status: 401 }) })).rejects.toThrow(/X_BEARER_TOKEN/);
  });
});

describe("scanX", () => {
  it("dedupes across preset queries and caps the total", async () => {
    let call = 0;
    const result = await scanX({ token: "t", preset: "support", max: 3 }, {
      fetchImpl: async () => new Response(JSON.stringify(call++ === 0 ? page(["1", "2"]) : page(["2", "3", "4"])), { status: 200 }),
    });
    expect(result.candidates.map((c) => c.tweet.id)).toEqual(["1", "2", "3"]);
    expect(result.error).toBeUndefined();
  });

  it("keeps what it collected when a later query is rate limited", async () => {
    let call = 0;
    const result = await scanX({ token: "t", preset: "dms", max: 50 }, {
      fetchImpl: async () => (call++ === 0 ? new Response(JSON.stringify(page(["9"])), { status: 200 }) : new Response("{}", { status: 429 })),
    });
    expect(result.candidates.map((c) => c.tweet.id)).toEqual(["9"]);
    expect(result.error).toMatch(/rate limit/);
  });
});

describe("presets", () => {
  it("has 5–8 queries, each within the 512-char recent-search limit once operators are added", () => {
    const all = queriesFor("all");
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.length).toBeLessThanOrEqual(8);
    for (const entry of all) {
      expect(entry.query.length, entry.label).toBeLessThanOrEqual(512);
      expect(entry.query).toContain("-is:retweet");
      expect(entry.query).toContain("-is:reply");
      expect(entry.query).toContain("lang:en");
      expect(entry.query).toContain("-hiring");
    }
    expect(PRESET_NAMES).toEqual(["dms", "receptionist", "bookings", "support"]);
    expect(queriesFor("bookings")).toHaveLength(PRESETS.bookings.length);
  });

  it("does not double-append operators a custom query already has", () => {
    expect(withOperators("foo lang:es is:reply")).toBe('foo lang:es is:reply -is:retweet -hiring -"job opening" -crypto -nft -airdrop -giveaway -webinar -is:nullcast');
  });
});
