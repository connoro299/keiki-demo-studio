import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authoringDocumentSchema, toDemoFlow } from "@/cli/authoring";
import { compileDemo, validateDemo } from "@/compiler";
import { frameAt } from "@/runtime";
import { chooseChannels, generateDemos, GenerationError } from "@/outreach/generate";
import { lintGeneratedFlow, normalizeFlow, validateFlowDocument, withComposerDrafts } from "@/outreach/flow";
import { fakeLlm, sampleProfile, tempRoot, validFlowReply } from "./helpers";

describe("generate → validate → repair", () => {
  it("sends validator issues back to the model and accepts the fixed flow", async () => {
    const invalid = validFlowReply();
    // Broken on purpose: unknown kind, a message without direction, and an invented price.
    (invalid.flow.messages[1] as Record<string, unknown>).kind = "poll";
    delete (invalid.flow.messages[2] as Record<string, unknown>).direction;
    invalid.flow.messages[3].text = "A $350 deposit holds the room.";
    const llm = fakeLlm([invalid, validFlowReply()]);
    const root = tempRoot();
    const repoRoot = path.dirname(root);
    const demos = await generateDemos(sampleProfile(), { channels: ["imessage"], leadId: "lucia-abc123" }, { completeJson: llm.completeJson, root, repoRoot });

    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].prompt).toMatch(/failed validation/);
    expect(llm.calls[1].prompt).toMatch(/price 350 does not appear on the site/);
    expect(llm.calls[1].prompt).toMatch(/messages\/2/);

    expect(demos).toHaveLength(1);
    const demo = demos[0];
    expect(demo).toMatchObject({ channel: "imessage", flowId: "lucia-s-trattoria-imessage", story: expect.stringMatching(/private room/) });
    const file = path.resolve(repoRoot, demo.flowPath);
    expect(file).toBe(path.join(root, "leads", "lucia-abc123", "flows", "lucia-s-trattoria-imessage.json"));
    expect(existsSync(file)).toBe(true);

    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(validateFlowDocument(written).ok).toBe(true);
    expect(written).toMatchObject({ id: "lucia-s-trattoria-imessage", channel: "imessage", platform: "ios", screen: "conversation", contact: { name: "Lucia's Trattoria" } });
    expect(demo.durationMs).toBeGreaterThan(12000);
    expect(demo.durationMs).toBeLessThan(25000);
    expect(written.checkpoints).toEqual([{ id: "opening", atMs: 0 }, { id: "final", atMs: demo.durationMs }]);
  });

  it("gives up after two repairs with the outstanding issues", async () => {
    const bad = validFlowReply();
    bad.flow.messages = bad.flow.messages.slice(0, 2);
    const llm = fakeLlm([bad, bad, bad]);
    const error = await generateDemos(sampleProfile(), { channels: ["whatsapp"] }, { completeJson: llm.completeJson, root: tempRoot() }).catch((caught) => caught);
    expect(error).toBeInstanceOf(GenerationError);
    expect(llm.calls).toHaveLength(3);
    expect((error as GenerationError).issues.some((issue) => /4-8 messages/.test(issue.message))).toBe(true);
  });

  it("makes unique flow ids per channel and passes earlier stories forward", async () => {
    const llm = fakeLlm([validFlowReply(), validFlowReply(), validFlowReply()]);
    const demos = await generateDemos(sampleProfile(), { channels: ["whatsapp", "imessage"], count: 3 }, { completeJson: llm.completeJson, root: tempRoot() });
    expect(demos.map((demo) => demo.flowId)).toEqual(["lucia-s-trattoria-whatsapp", "lucia-s-trattoria-imessage", "lucia-s-trattoria-whatsapp-2"]);
    expect(llm.calls[2].prompt).toMatch(/Already made for this business/);
  });
});

describe("timeline shaping", () => {
  const flow = normalizeFlow(validFlowReply().flow, { flowId: "t", channel: "imessage", businessName: "Lucia's Trattoria" });

  it("types every outgoing text into the composer and clears it at send", () => {
    const document = authoringDocumentSchema.parse(flow);
    const result = validateDemo(toDemoFlow(document, "ios"));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const compiled = compileDemo(result.demo);
    expect(frameAt(compiled, 0).messages).toHaveLength(0);
    for (const message of result.demo.messages) {
      const at = message.atMs - result.demo.startAtMs!;
      if (message.direction === "outgoing" && (!message.kind || message.kind === "text")) {
        expect(frameAt(compiled, at - 1).draft).toBe(message.text);
        expect(frameAt(compiled, at).draft).toBe("");
      }
    }
  });

  it("adds a company typing pair before each incoming message, off exactly at arrival", () => {
    const typing = (flow.events ?? []).filter((event) => event.type === "typing");
    for (const message of flow.messages.filter((item) => item.direction === "incoming")) {
      const off = typing.find((event) => event.type === "typing" && !event.typing && event.atMs === message.atMs);
      const before = typing.filter((event) => event.atMs < message.atMs);
      if (off) expect(before.at(-1)).toMatchObject({ typing: true });
    }
    expect(typing.filter((event) => event.type === "typing" && event.typing).length).toBe(typing.filter((event) => event.type === "typing" && !event.typing).length);
    expect(typing.at(-1)).toMatchObject({ typing: false });
  });

  it("keeps grapheme clusters intact", () => {
    const { events } = withComposerDrafts([{ id: "a", direction: "outgoing", text: "Hi 👋🏽", atMs: 10000 }], [], undefined);
    const values = events.filter((event) => event.type === "draft").map((event) => (event.type === "draft" ? event.value : ""));
    expect(values).toEqual(["H", "Hi", "Hi ", "Hi 👋🏽", ""]);
  });

  it("lints outreach rules on non-Messages channels", () => {
    const whatsapp = normalizeFlow({ ...validFlowReply().flow, events: [{ type: "screen-effect", atMs: 1790008810000, effect: "confetti" }] }, { flowId: "w", channel: "whatsapp", businessName: "Somebody Else" });
    const issues = lintGeneratedFlow(whatsapp, { channel: "whatsapp", profile: sampleProfile() });
    expect(issues.map((issue) => issue.message).join("\n")).toMatch(/whatsapp does not support "screen-effect"/);
    expect(issues.map((issue) => issue.message).join("\n")).toMatch(/contact name must be exactly "Lucia's Trattoria"/);
  });
});

describe("chooseChannels", () => {
  const base = sampleProfile();
  it("leads with channels seen on the site", () => {
    expect(chooseChannels({ ...base, channelsSeen: ["whatsapp"] })).toEqual(["whatsapp", "imessage"]);
    expect(chooseChannels({ ...base, channelsSeen: ["telegram", "whatsapp"] })).toEqual(["telegram", "whatsapp"]);
  });
  it("uses iMessage for US local businesses and DTC", () => {
    expect(chooseChannels(base)).toEqual(["imessage"]);
    expect(chooseChannels({ ...base, vertical: "salon & spa" })).toEqual(["imessage"]);
    expect(chooseChannels({ ...base, vertical: "ecommerce / DTC brand" })).toEqual(["imessage"]);
  });
  it("uses WhatsApp for international businesses and adds it for travel stays", () => {
    expect(chooseChannels({ ...base, domain: "monmouthcoffee.co.uk", vertical: "cafe & bakery" })).toEqual(["whatsapp"]);
    expect(chooseChannels({ ...base, vertical: "hotel & hospitality", summary: "Boutique hotel in Charleston" })).toEqual(["imessage", "whatsapp"]);
  });
  it("uses Slack for B2B and never picks Telegram unseen", () => {
    expect(chooseChannels({ ...base, vertical: "B2B software", summary: "Scheduling platform for field service teams" })).toEqual(["slack"]);
    expect(chooseChannels(base)).not.toContain("telegram");
  });
});
