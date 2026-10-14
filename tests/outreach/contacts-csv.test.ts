import { describe, expect, it } from "vitest";
import { bestOutreachContact, classifyEmail, draftChannelFor, inputContact, rankContacts, type ContactCandidate } from "@/outreach/contacts";
import { csvToLeads, parseCsv } from "@/outreach/csv";

const src = "https://glow.co";

describe("contact ranking", () => {
  const candidates: ContactCandidate[] = [
    { kind: "phone", value: "+1 (555) 010-2000", source: src },
    { kind: "instagram", value: "https://www.instagram.com/glow", source: src },
    { kind: "form", value: "https://glow.co/contact", source: src },
    { kind: "email", value: "press@glow.co", source: src },
    { kind: "email", value: "hello@glow.co", source: src },
    { kind: "email", value: "Maya@glow.co", source: src, context: "Questions about the studio? Maya Chen, Founder — maya@glow.co" },
    { kind: "email", value: "hello@glow.co", source: "https://glow.co/contact" },
    { kind: "email", value: "studio@webdesignco.com", source: src },
    { kind: "x", value: "https://x.com/glow", source: src },
    { kind: "whatsapp", value: "+15550102000", source: src },
  ];

  it("orders decision-maker > role inbox > form > socials > phone and dedupes", () => {
    const ranked = rankContacts(candidates, { siteDomain: "glow.co" });
    expect(ranked.map((contact) => `${contact.kind}:${contact.value}`)).toEqual([
      "email:maya@glow.co",
      "email:hello@glow.co",
      "form:https://glow.co/contact",
      "email:press@glow.co",
      "email:studio@webdesignco.com",
      "x:https://x.com/glow",
      "instagram:https://www.instagram.com/glow",
      "whatsapp:+15550102000",
      "phone:+1 (555) 010-2000",
    ]);
    expect(ranked[0].label).toBe("Maya Chen, Founder");
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence);
  });

  it("puts an imported list's email column first", () => {
    const ranked = rankContacts(candidates, { siteDomain: "glow.co", inputEmail: "owner@glow.co", inputName: "Dana" });
    expect(ranked[0]).toMatchObject({ value: "owner@glow.co", confidence: 1, source: "import" });
  });

  it("never picks a phone or WhatsApp number as the outreach contact", () => {
    const onlyNumbers = rankContacts([{ kind: "phone", value: "+15550100", source: src }, { kind: "whatsapp", value: "+15550100", source: src }]);
    expect(bestOutreachContact(onlyNumbers)).toBeUndefined();
    expect(draftChannelFor(onlyNumbers[0])).toBeUndefined();
    const withForm = rankContacts([...onlyNumbers.map((point) => ({ ...point })), { kind: "form", value: "https://glow.co/contact", source: src }]);
    expect(draftChannelFor(bestOutreachContact(withForm))).toBe("form");
  });

  it("classifies inbox shapes", () => {
    expect(classifyEmail("info.sf@tartine.com", { siteDomain: "tartine.com" }).cls).toBe("location-inbox");
    expect(classifyEmail("pasadena@tartine.com", { siteDomain: "tartine.com" }).cls).toBe("inbox");
    expect(classifyEmail("glowstudio@glowstudio.com", { siteDomain: "glowstudio.com" }).cls).toBe("role");
    expect(classifyEmail("jane.doe@glow.co", { siteDomain: "glow.co" }).cls).toBe("person");
    expect(classifyEmail("glowbrooklyn@gmail.com", { siteDomain: "glow.co" }).cls).toBe("freemail");
    expect(classifyEmail("sam@gmail.com", { siteDomain: "glow.co", context: "Sam Ortiz, owner" }).cls).toBe("decision-maker");
    expect(classifyEmail("weddings@casamalca.com", { siteDomain: "casamalca.com", context: "Weddings and events" }).cls).toBe("support-role");
    expect(classifyEmail("jobs@glow.co", { siteDomain: "glow.co" }).cls).toBe("wrong-role");
  });

  it("reads email/name columns from an imported row", () => {
    expect(inputContact({ Website: "glow.co", "Owner Email": "dana@glow.co", "First Name": "Dana", "Last Name": "Lee" })).toEqual({ email: "dana@glow.co", name: "Dana Lee" });
    expect(inputContact({ website: "glow.co" })).toEqual({});
  });
});

describe("CSV import", () => {
  it("parses quotes, escaped quotes, embedded commas/newlines, CRLF and BOM", () => {
    const text = "﻿name,website,notes\r\n\"Lucia's, Brooklyn\",luciastrattoria.com,\"says \"\"hi\"\"\nsecond line\"\r\nGlow,https://glow.co,\r\n";
    expect(parseCsv(text)).toEqual([
      ["name", "website", "notes"],
      ["Lucia's, Brooklyn", "luciastrattoria.com", "says \"hi\"\nsecond line"],
      ["Glow", "https://glow.co", ""],
    ]);
  });

  it("maps a website column, keeps other columns, and reports bad rows", () => {
    const text = "Company,Website,Email\nLucia's,luciastrattoria.com,marco@luciastrattoria.com\nNo site,,\nGlow,www.glow.co/about,\n";
    const result = csvToLeads(text);
    expect(result.urlColumn).toBe("Website");
    expect(result.inputs).toEqual([
      { url: "luciastrattoria.com", input: { Company: "Lucia's", Email: "marco@luciastrattoria.com" } },
      { url: "www.glow.co/about", input: { Company: "Glow" } },
    ]);
    expect(result.skipped).toEqual([{ row: 3, reason: "not a URL: (empty)" }]);
  });

  it("honors --url-column and errors helpfully when it is missing", () => {
    expect(csvToLeads("biz;homepage_link\nGlow;glow.co\n", { urlColumn: "homepage_link" }).inputs).toEqual([{ url: "glow.co", input: { biz: "Glow" } }]);
    expect(() => csvToLeads("a,b\n1,2\n", { urlColumn: "site" })).toThrow(/column "site" not found/);
  });

  it("accepts a headerless list of bare domains", () => {
    expect(csvToLeads("glow.co\nluciastrattoria.com\nnot a url\n").inputs).toEqual(["glow.co", "luciastrattoria.com"]);
  });
});
