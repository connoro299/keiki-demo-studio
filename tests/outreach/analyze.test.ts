import { describe, expect, it } from "vitest";
import { analyzeSite, businessName, USER_AGENT } from "@/outreach/analyze";
import { fakeFetch, fakeLlm, fixture } from "./helpers";

const restaurantSite = () => fakeFetch({
  "https://luciastrattoria.com/robots.txt": "User-agent: *\nDisallow: /menu\n",
  "https://luciastrattoria.com": fixture("restaurant-home.html"),
  "https://luciastrattoria.com/contact": fixture("restaurant-contact.html"),
  "https://luciastrattoria.com/about": "<html><body><h1>Our story</h1><p>Lucia and Marco opened in 2011.</p></body></html>",
});

describe("analyzeSite --no-llm (heuristic)", () => {
  it("crawls homepage + high-value pages, respects robots.txt, and ranks contacts", async () => {
    const site = restaurantSite();
    const profile = await analyzeSite("luciastrattoria.com", { fetch: site.fetch, now: () => new Date("2026-10-14T12:00:00Z") }, { llm: false, browser: "never" });
    expect(site.requested).toContain("https://luciastrattoria.com/robots.txt");
    expect(site.requested).not.toContain("https://luciastrattoria.com/menu");
    expect(profile.pages).toEqual(expect.arrayContaining(["https://luciastrattoria.com", "https://luciastrattoria.com/contact"]));
    expect(profile).toMatchObject({
      domain: "luciastrattoria.com",
      name: "Lucia's Trattoria",
      vertical: "restaurant",
      brandColor: "#9b2d20",
      logo: "https://luciastrattoria.com/apple-touch-icon.png",
      channelsSeen: ["whatsapp"],
      analyzedWith: "heuristic",
      fetchedAt: "2026-10-14T12:00:00.000Z",
    });
    expect(profile.contacts[0]).toMatchObject({ kind: "email", value: "marco@luciastrattoria.com", label: "Marco Rossi, Owner" });
    const kinds = profile.contacts.map((contact) => contact.kind);
    expect(kinds).toContain("form");
    expect(kinds.indexOf("form")).toBeLessThan(kinds.indexOf("instagram"));
    expect(kinds.indexOf("phone")).toBe(kinds.length - 1);
    expect(profile.contacts.filter((contact) => contact.value === "info@luciastrattoria.com")).toHaveLength(1);
    expect(profile.facts?.prices?.some((line) => line.includes("$19"))).toBe(true);
    expect(profile.textSample).toContain("Handmade pasta");
  });

  it("sends the KeikiDemoBot user agent", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("user-agent") ?? "");
      return new Response("<html><title>X</title><body>hello</body></html>", { headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    await analyzeSite("https://x-cafe.com", { fetch: fetchImpl }, { llm: false, browser: "never" });
    expect(seen.every((agent) => agent === USER_AGENT)).toBe(true);
  });

  it("refuses a site whose robots.txt disallows the homepage", async () => {
    const site = fakeFetch({ "https://nobots.com/robots.txt": "User-agent: *\nDisallow: /\n", "https://nobots.com": "<html></html>" });
    await expect(analyzeSite("nobots.com", { fetch: site.fetch }, { llm: false })).rejects.toThrow(/robots\.txt disallows/);
  });

  it("falls back to a headless render for a JS shell", async () => {
    const site = fakeFetch({ "https://glowstudio.co": fixture("js-shell.html") });
    const rendered: string[] = [];
    const profile = await analyzeSite("glowstudio.co", {
      fetch: site.fetch,
      renderHtml: async (url) => {
        rendered.push(url);
        return `<html><head><title>Glow Studio | Lash & Brow Bar</title></head><body><h1>Lashes, brows and facials in Austin</h1>
          <p>Book a lash lift, brow lamination or a signature facial. Walk-ins welcome on weekdays.</p>
          <a href="mailto:hello@glowstudio.co">hello@glowstudio.co</a> <a href="https://t.me/glowstudio">Telegram</a></body></html>`;
      },
    }, { llm: false });
    expect(rendered).toEqual(["https://glowstudio.co"]);
    expect(profile.name).toBe("Glow Studio");
    expect(profile.vertical).toBe("salon & spa");
    expect(profile.channelsSeen).toEqual(["telegram"]);
    expect(profile.contacts[0].value).toBe("hello@glowstudio.co");
  });

  it("keeps working when the browser fallback fails", async () => {
    const site = fakeFetch({ "https://glowstudio.co": fixture("js-shell.html") });
    const profile = await analyzeSite("glowstudio.co", { fetch: site.fetch, renderHtml: async () => { throw new Error("no browser"); } }, { llm: false });
    expect(profile.name).toBe("Glow Studio");
    expect(profile.contacts).toEqual([]);
  });

  it("finds a contact form as the only contact for a SaaS site", async () => {
    const site = fakeFetch({ "https://tidewater.io": fixture("saas-home.html"), "https://tidewater.io/contact-sales": fixture("saas-contact.html") });
    const profile = await analyzeSite("tidewater.io", { fetch: site.fetch }, { llm: false, browser: "never" });
    expect(profile.vertical).toBe("B2B software");
    expect(profile.contacts[0]).toMatchObject({ kind: "form", value: "https://tidewater.io/contact-sales" });
    expect(profile.contacts.filter((contact) => contact.kind === "email")).toEqual([]);
  });
});

describe("analyzeSite with the model", () => {
  it("merges the model's summary and labels, but never adopts contacts that were not on the site", async () => {
    const site = restaurantSite();
    const llm = fakeLlm([{
      name: "Lucia's",
      summary: "Family-run Park Slope trattoria known for handmade pasta.",
      vertical: "neighborhood Italian restaurant",
      audience: "Park Slope locals and families",
      offerings: ["Handmade pasta", "Wood-fired pizza", "Private dining room for 24"],
      tone: "warm and familial",
      facts: { policies: ["$200 deposit for the private room"] },
      contacts: [
        { value: "bookings@luciastrattoria.com", label: "Bookings inbox" },
        { value: "ceo@invented.com", label: "Made up", decisionMaker: true },
      ],
    }]);
    const profile = await analyzeSite("luciastrattoria.com", { fetch: site.fetch, completeJson: llm.completeJson }, { browser: "never" });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].prompt).toContain("marco@luciastrattoria.com");
    expect(profile).toMatchObject({ name: "Lucia's", vertical: "neighborhood Italian restaurant", tone: "warm and familial", analyzedWith: "llm" });
    expect(profile.contacts.some((contact) => contact.value === "ceo@invented.com")).toBe(false);
    expect(profile.contacts.find((contact) => contact.value === "bookings@luciastrattoria.com")?.label).toBe("Bookings inbox");
    expect(profile.facts?.policies).toEqual(["$200 deposit for the private room"]);
    expect(profile.facts?.prices?.length).toBeGreaterThan(0);
  });

  it("uses the imported email as the top contact", async () => {
    const site = restaurantSite();
    const profile = await analyzeSite("luciastrattoria.com", { fetch: site.fetch }, { llm: false, browser: "never", inputEmail: "lucia@luciastrattoria.com", inputName: "Lucia" });
    expect(profile.contacts[0]).toMatchObject({ value: "lucia@luciastrattoria.com", confidence: 1 });
  });
});

describe("businessName", () => {
  it("prefers the title segment that matches the domain", () => {
    expect(businessName({ title: "Home | Joe's Pizza", domain: "joespizzanyc.com" })).toBe("Joe's Pizza");
    expect(businessName({ title: "Best Tacos in LA - Taqueria Lupita", domain: "taquerialupita.com" })).toBe("Taqueria Lupita");
    expect(businessName({ title: undefined, domain: "glow-studio.co" })).toBe("Glow Studio");
    expect(businessName({ siteName: "Monmouth Coffee", title: "Home", domain: "monmouthcoffee.co.uk" })).toBe("Monmouth Coffee");
  });
});
