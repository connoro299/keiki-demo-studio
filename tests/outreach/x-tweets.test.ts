import { describe, expect, it } from "vitest";
import { decodeEntities, fetchTweetByUrl, parseOembedHtml, parseTweetUrl, replyIntentUrl, tweetLength } from "@/outreach/x/tweets";

// Real oEmbed HTML returned by publish.x.com for https://x.com/jack/status/20.
const JACK_HTML =
  '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20?ref_src=twsrc%5Etfw">March 21, 2006</a></blockquote>\n\n';

const RICH_HTML =
  '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">40 texts asking &quot;you open sunday?&quot; &amp; I&#39;m mid-fade.<br><br>Anyone know a tool? <a href="https://t.co/abc">https://t.co/abc</a> <a href="https://t.co/pic">pic.twitter.com/pic</a></p>&mdash; Marco Reyes 💈 (@marco_cuts) <a href="https://twitter.com/marco_cuts/status/1846?ref_src=twsrc%5Etfw">October 14, 2026</a></blockquote>';

describe("parseTweetUrl", () => {
  it("accepts x.com, twitter.com, mobile and query/trailing variants", () => {
    expect(parseTweetUrl("https://x.com/jack/status/20")).toEqual({ id: "20", handle: "jack", url: "https://x.com/jack/status/20" });
    expect(parseTweetUrl("https://twitter.com/Jack/status/20?s=20&t=abc")?.id).toBe("20");
    expect(parseTweetUrl("https://mobile.twitter.com/jack/statuses/20/")?.url).toBe("https://x.com/jack/status/20");
    expect(parseTweetUrl("  https://www.x.com/a_b/status/123456789012345678/photo/1 ")?.id).toBe("123456789012345678");
  });

  it("rejects non-status links", () => {
    expect(parseTweetUrl("https://x.com/jack")).toBeUndefined();
    expect(parseTweetUrl("https://example.com/jack/status/20")).toBeUndefined();
    expect(parseTweetUrl("not a url")).toBeUndefined();
  });
});

describe("oEmbed HTML parsing", () => {
  it("parses the real jack/20 blockquote", () => {
    expect(parseOembedHtml(JACK_HTML)).toEqual({
      text: "just setting up my twttr",
      lang: "en",
      authorName: "jack",
      authorHandle: "jack",
      createdAt: "2006-03-21T00:00:00.000Z",
      statusUrl: "https://x.com/jack/status/20",
    });
  });

  it("keeps line breaks and link text, decodes entities, reads names with emoji", () => {
    const parsed = parseOembedHtml(RICH_HTML);
    expect(parsed.text).toBe('40 texts asking "you open sunday?" & I\'m mid-fade.\n\nAnyone know a tool? https://t.co/abc pic.twitter.com/pic');
    expect(parsed.authorName).toBe("Marco Reyes 💈");
    expect(parsed.authorHandle).toBe("marco_cuts");
    expect(parsed.createdAt).toBe("2026-10-14T00:00:00.000Z");
  });

  it("decodes numeric and named entities", () => {
    expect(decodeEntities("&#x2019;&#8212;&hellip;&unknown;")).toBe("’—…&unknown;");
  });
});

describe("fetchTweetByUrl", () => {
  it("uses publish.x.com and maps the response", async () => {
    const calls: string[] = [];
    const tweet = await fetchTweetByUrl("https://twitter.com/jack/status/20?s=1", async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ author_name: "jack", author_url: "https://x.com/jack", html: JACK_HTML }), { status: 200 });
    });
    expect(calls[0]).toMatch(/^https:\/\/publish\.x\.com\/oembed\?url=https%3A%2F%2Fx\.com%2Fjack%2Fstatus%2F20&/);
    expect(tweet).toMatchObject({ id: "20", authorHandle: "jack", authorName: "jack", text: "just setting up my twttr", url: "https://x.com/jack/status/20" });
  });

  it("falls back to publish.twitter.com when publish.x.com fails", async () => {
    const calls: string[] = [];
    const tweet = await fetchTweetByUrl("https://x.com/jack/status/20", async (url) => {
      calls.push(url);
      if (url.startsWith("https://publish.x.com")) return new Response("nope", { status: 503 });
      return new Response(JSON.stringify({ html: JACK_HTML }), { status: 200 });
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/^https:\/\/publish\.twitter\.com\/oembed/);
    expect(tweet.text).toBe("just setting up my twttr");
  });

  it("reports deleted/private tweets clearly", async () => {
    await expect(fetchTweetByUrl("https://x.com/jack/status/1", async () => new Response("", { status: 404 }))).rejects.toThrow(/not found or not public/);
  });
});

describe("reply intent", () => {
  it("encodes the reply with %20 and keeps unicode", () => {
    const url = replyIntentUrl("1846", 'the "saturday?" text & more — 100% ↓');
    expect(url).toBe("https://x.com/intent/post?in_reply_to=1846&text=the%20%22saturday%3F%22%20text%20%26%20more%20%E2%80%94%20100%25%20%E2%86%93");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("in_reply_to")).toBe("1846");
    expect(parsed.searchParams.get("text")).toBe('the "saturday?" text & more — 100% ↓');
    expect(url).not.toContain("+");
  });

  it("counts URLs as 23 characters", () => {
    expect(tweetLength("hello")).toBe(5);
    expect(tweetLength("see https://example.com/a/very/long/path/that/goes/on")).toBe(4 + 23);
  });
});
