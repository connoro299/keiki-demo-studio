import { describe, expect, it } from "vitest";
import {
  channelFor,
  decodeCfEmail,
  deobfuscateEmails,
  discoverPages,
  extractPage,
  isJunkEmail,
  parseRobots,
  socialFor,
} from "@/outreach/extract";
import { fixture } from "./helpers";

describe("extractPage: restaurant with mailto, obfuscated email and wa.me", () => {
  const page = extractPage(fixture("restaurant-home.html"), "https://luciastrattoria.com/");

  it("reads meta, brand and logo hints", () => {
    expect(page.title).toBe("Home | Lucia's Trattoria – Handmade Pasta in Park Slope");
    expect(page.siteName).toBe("Lucia's Trattoria");
    expect(page.description).toMatch(/family-run Italian restaurant/);
    expect(page.ogImage).toBe("https://luciastrattoria.com/images/og-dining-room.jpg");
    expect(page.themeColor).toBe("#9b2d20");
    expect(page.colorHints[0]).toBe("#9b2d20");
    expect(page.logo).toBe("https://luciastrattoria.com/apple-touch-icon.png");
  });

  it("finds mailto, [at]/[dot] and Cloudflare-protected emails, and drops junk", () => {
    const emails = page.emails.map((hit) => hit.value).sort();
    expect(emails).toContain("info@luciastrattoria.com");
    expect(emails).toContain("marco@luciastrattoria.com");
    expect(emails).toContain("press@luciastrattoria.com");
    expect(emails.some((email) => /sentry|wixpress|example\.com|@2x/.test(email))).toBe(false);
    const marco = page.emails.find((hit) => hit.value === "marco@luciastrattoria.com")!;
    expect(marco.context).toMatch(/Marco Rossi, Owner/);
    expect(page.emails.find((hit) => hit.value === "info@luciastrattoria.com")!.viaMailto).toBe(true);
  });

  it("records phones, WhatsApp and socials (not share links)", () => {
    expect(page.phones).toContain("+17185550142");
    expect(page.channelLinks.map((link) => link.channel)).toContain("whatsapp");
    expect(page.socials.instagram).toBe("https://www.instagram.com/luciastrattoria");
    expect(page.socials.facebook).toBe("https://www.facebook.com/luciastrattoria");
    expect(page.socials.x).toBeUndefined();
  });

  it("skips the newsletter box (not a contact form)", () => {
    expect(page.forms).toEqual([]);
  });

  it("pulls JSON-LD and on-page facts", () => {
    expect(page.jsonLd.name).toBe("Lucia's Trattoria");
    expect(page.jsonLd.address).toBe("412 7th Avenue, Brooklyn, NY, 11215");
    expect(page.jsonLd.openingHours[0]).toMatch(/Tuesday, Wednesday, Thursday 17:00–22:00/);
    expect(page.prices.some((line) => line.includes("Cacio e Pepe — $19"))).toBe(true);
    expect(page.policies.some((line) => /deposit/.test(line))).toBe(true);
    expect(page.hours.some((line) => /Tuesday/.test(line))).toBe(true);
    expect(page.locations[0]).toMatch(/412 7th Avenue/);
  });

  it("excludes script/style text from visible text", () => {
    expect(page.text).toContain("Handmade pasta, every night");
    expect(page.text).not.toContain("Sentry");
    expect(page.text).not.toContain("--brand-primary");
    expect(page.jsShell).toBe(false);
  });

  it("discovers high-value internal pages and skips privacy", () => {
    const pages = discoverPages(page.links, "https://luciastrattoria.com/");
    expect(pages).toEqual(expect.arrayContaining([
      "https://luciastrattoria.com/contact",
      "https://luciastrattoria.com/reservations",
      "https://luciastrattoria.com/menu",
      "https://luciastrattoria.com/about",
    ]));
    expect(pages.some((url) => url.includes("privacy"))).toBe(false);
    expect(pages.length).toBeLessThanOrEqual(6);
  });
});

describe("extractPage: contact page with entity-encoded email and a form", () => {
  const page = extractPage(fixture("restaurant-contact.html"), "https://luciastrattoria.com/contact");
  it("decodes &#64;/&#46; and finds the contact form (not the search form)", () => {
    expect(page.emails.map((hit) => hit.value)).toContain("bookings@luciastrattoria.com");
    expect(page.forms).toHaveLength(1);
    expect(page.forms[0]).toMatchObject({ pageUrl: "https://luciastrattoria.com/contact", action: "https://formspree.io/f/abc123" });
  });
});

describe("extractPage: SaaS with only a contact form", () => {
  const home = extractPage(fixture("saas-home.html"), "https://tidewater.io/");
  const contact = extractPage(fixture("saas-contact.html"), "https://tidewater.io/contact-sales");

  it("finds no usable email on the homepage (noreply and placeholders filtered)", () => {
    expect(home.emails).toEqual([]);
    expect(home.forms).toEqual([]);
    expect(home.socials).toEqual({ x: "https://x.com/tidewaterhq", linkedin: "https://www.linkedin.com/company/tidewater-software", youtube: "https://www.youtube.com/@tidewaterhq" });
  });

  it("finds the sales form", () => {
    expect(contact.forms).toHaveLength(1);
    expect(contact.forms[0].action).toBe("https://tidewater.io/api/contact");
    expect(contact.forms[0].fields).toEqual(expect.arrayContaining(["full_name", "work_email", "details"]));
    expect(contact.emails).toEqual([]);
  });

  it("ranks /contact-sales and /pricing, skips login and deep blog posts", () => {
    const pages = discoverPages(home.links, "https://tidewater.io/");
    expect(pages[0]).toBe("https://tidewater.io/contact-sales");
    expect(pages).toContain("https://tidewater.io/pricing");
    expect(pages.some((url) => /login|blog/.test(url))).toBe(false);
  });
});

describe("extractPage: JS shell", () => {
  it("flags a client-rendered page with no server text", () => {
    const page = extractPage(fixture("js-shell.html"), "https://glowstudio.co/");
    expect(page.jsShell).toBe(true);
    expect(page.text.length).toBeLessThan(100);
  });
});

describe("email helpers", () => {
  it("deobfuscates common patterns", () => {
    expect(deobfuscateEmails("write maya [at] example-cafe [dot] com today")).toContain("maya@example-cafe.com");
    expect(deobfuscateEmails("hello(at)studio(dot)co")).toContain("hello@studio.co");
    expect(deobfuscateEmails("reach jo at harbor dot co dot uk")).toContain("jo@harbor.co.uk");
    expect(deobfuscateEmails("we are at the market")).toBe("we are at the market");
  });
  it("decodes Cloudflare email protection", () => {
    expect(decodeCfEmail("c0b0b2a5b3b380acb5a3a9a1b3b4b2a1b4b4afb2a9a1eea3afad")).toBe("press@luciastrattoria.com");
    expect(decodeCfEmail("zz")).toBeUndefined();
  });
  it("filters junk", () => {
    for (const junk of ["logo@2x.png", "abc@sentry.io", "x@sentry-next.wixpress.com", "noreply@shop.com", "you@example.com", "0123456789abcdef0123@o1.ingest.io"]) {
      expect(isJunkEmail(junk), junk).toBe(true);
    }
    expect(isJunkEmail("hello@luciastrattoria.com")).toBe(false);
  });
});

describe("links", () => {
  it("maps messaging links to channels", () => {
    expect(channelFor("https://wa.me/15551234567")).toBe("whatsapp");
    expect(channelFor("https://api.whatsapp.com/send?phone=44123")).toBe("whatsapp");
    expect(channelFor("https://t.me/glowstudio")).toBe("telegram");
    expect(channelFor("https://join.slack.com/t/devs/shared_invite/zt-1")).toBe("slack");
    expect(channelFor("sms:+15551234567")).toBe("sms");
    expect(channelFor("https://bcrw.apple.com/urn:biz:123")).toBe("imessage");
    expect(channelFor("https://example.com")).toBeUndefined();
  });
  it("canonicalizes socials and rejects share URLs", () => {
    expect(socialFor("https://twitter.com/LuciasNYC?ref=x")).toEqual({ key: "x", url: "https://x.com/LuciasNYC" });
    expect(socialFor("https://twitter.com/intent/tweet")).toBeUndefined();
    expect(socialFor("https://www.instagram.com/p/abc123/")).toBeUndefined();
    expect(socialFor("https://www.tiktok.com/@glow")).toEqual({ key: "tiktok", url: "https://www.tiktok.com/@glow" });
  });
});

describe("robots.txt", () => {
  const robots = `
User-agent: *
Disallow: /private/
Disallow: /*.pdf$
Allow: /private/press

User-agent: KeikiDemoBot
Disallow: /menu

User-agent: BadBot
Disallow: /
`;
  it("uses the specific group for our agent and longest-match rules", () => {
    const allowed = parseRobots(robots, "KeikiDemoBot/1.0 (+https://onkeiki.com)");
    expect(allowed("/menu")).toBe(false);
    expect(allowed("/private/anything")).toBe(true); // our group replaces *
    const generic = parseRobots(robots, "SomeOtherBot");
    expect(generic("/private/x")).toBe(false);
    expect(generic("/private/press")).toBe(true);
    expect(generic("/files/menu.pdf")).toBe(false);
    expect(generic("/files/menu.pdf?x")).toBe(true);
    expect(generic("/contact")).toBe(true);
  });
  it("treats an empty Disallow as allow-all", () => {
    expect(parseRobots("User-agent: *\nDisallow:\n")("/anything")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow: /\n")("/")).toBe(false);
  });
});
