import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authoringDocumentSchema, toDemoFlow } from "@/cli/authoring";
import { applyChannel, compileDemo, validateDemo } from "@/compiler";
import { buildChatModel, isChatChannel } from "@/renderers/chat";
import { frameAt } from "@/runtime";

function flow(channel: string, extra: Record<string, unknown> = {}) {
  return {
    id: `channel-${channel}`, title: "Channel", platform: "ios", channel, theme: "light",
    contact: { name: "Osteria Nove" }, nowMs: 5000, draft: "", typing: false, screen: "conversation",
    messages: [
      { id: "m1", text: "Table for 4?", direction: "outgoing", atMs: 1000 },
      { id: "m2", text: "Yes, 8:30 on the terrace.", direction: "incoming", atMs: 2000 },
    ],
    ...extra,
  };
}

function issueCodes(input: unknown): string[] {
  const result = validateDemo(input);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path} ${issue.message.split(":")[0]}`);
}

describe("channel field", () => {
  it("survives the CLI authoring document into the compiled demo", () => {
    const document = authoringDocumentSchema.parse({ ...flow("whatsapp"), checkpoints: [{ id: "end", atMs: 1000 }] });
    const demo = toDemoFlow(document, "ios");
    expect(demo.channel).toBe("whatsapp");
    const result = validateDemo(demo);
    expect(result.ok).toBe(true);
    if (result.ok) expect(compileDemo(result.demo).channel).toBe("whatsapp");
  });

  it("defaults SMS messages to the sms service unless a service is explicit", () => {
    const input = flow("sms");
    (input.messages[1] as Record<string, unknown>).service = "imessage";
    const result = validateDemo(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const compiled = compileDemo(result.demo);
    const services = compiled.events.flatMap((event) => (event.type === "message" ? [event.message.service] : []));
    expect(services).toEqual(["sms", "imessage"]);
    expect(frameAt(compiled, 1000).messages.map((message) => message.service)).toEqual(["sms", "imessage"]);
  });

  it("leaves iMessage flows without a service and re-views compiled demos with applyChannel", () => {
    const result = validateDemo(flow("imessage"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const compiled = compileDemo(result.demo);
    expect(compiled.events.some((event) => event.type === "message" && event.message.service !== undefined)).toBe(false);
    expect(applyChannel(compiled, "imessage")).toBe(compiled);
    const sms = applyChannel(compiled, "sms");
    expect(sms.channel).toBe("sms");
    expect(sms.events.filter((event) => event.type === "message").every((event) => event.type === "message" && event.message.service === "sms")).toBe(true);
    expect(applyChannel(compiled, "slack").channel).toBe("slack");
  });

  it("rejects non-Messages channels on macOS", () => {
    expect(issueCodes(flow("telegram", { platform: "macos" }))).toContain("/channel PLATFORM_MISMATCH");
  });

  it.each(["whatsapp", "telegram", "slack"])("rejects Messages-only content in %s demos", (channel) => {
    const input = flow(channel, {
      screen: "list",
      events: [
        { type: "overlay", atMs: 1500, overlay: { kind: "long-press", messageId: "m2" } },
        { type: "screen-effect", atMs: 1600, effect: "confetti" },
        { type: "reaction", atMs: 2500, messageId: "m2", reactionId: "r1", reaction: { type: "love", byMe: true } },
      ],
    });
    (input.messages[0] as Record<string, unknown>).effect = "slam";
    input.messages.push({ id: "m3", text: "", direction: "incoming", atMs: 3000, kind: "poll", poll: { question: "", options: [{ id: "a", text: "A" }] } } as never);
    const codes = issueCodes(input);
    expect(codes).toEqual(expect.arrayContaining([
      "/screen UNSUPPORTED_FOR_CHANNEL",
      "/messages/0/effect UNSUPPORTED_FOR_CHANNEL",
      "/messages/2/kind UNSUPPORTED_FOR_CHANNEL",
      "/events/0/type UNSUPPORTED_FOR_CHANNEL",
      "/events/1/type UNSUPPORTED_FOR_CHANNEL",
    ]));
    expect(codes.some((code) => code.startsWith("/events/2"))).toBe(false);
    const result = validateDemo(input);
    if (!result.ok) expect(result.issues.find((issue) => issue.path === "/screen")?.message).toContain(channel === "whatsapp" ? "WhatsApp" : channel === "telegram" ? "Telegram" : "Slack");
  });

  it("accepts the supported chat content: links, images, files, voice notes, replies, reactions, statuses", () => {
    const input = flow("whatsapp", {
      events: [
        { type: "typing", atMs: 1500, typing: true },
        { type: "status", atMs: 1500, messageId: "m1", status: "read" },
        { type: "typing", atMs: 2000, typing: false },
        { type: "reaction", atMs: 2500, messageId: "m2", reactionId: "r1", reaction: { type: "custom", emoji: "🙏", byMe: true } },
        { type: "draft", atMs: 2600, value: "Gra" },
      ],
    });
    input.messages.push(
      { id: "m3", text: "osterianove.com", direction: "incoming", atMs: 3000, kind: "link", link: { url: "https://osterianove.com", title: "Osteria" } } as never,
      { id: "m4", text: "Menu", direction: "incoming", atMs: 3100, kind: "attachment", attachments: [{ name: "menu.pdf", size: "1 MB" }] } as never,
      { id: "m5", text: "", direction: "incoming", atMs: 3200, kind: "audio", audio: { duration: 7 } } as never,
      { id: "m6", text: "Sure", direction: "incoming", atMs: 3300, replyTo: "m1" } as never,
    );
    expect(issueCodes(input)).toEqual([]);
  });

  it("validates the checked-in channel scenarios", () => {
    for (const channel of ["whatsapp", "telegram", "slack"]) {
      for (const theme of ["light", "dark"]) {
        const raw = JSON.parse(readFileSync(path.resolve(`scenarios/channel-${channel}-${theme}.json`), "utf8"));
        const document = authoringDocumentSchema.parse(raw);
        const result = validateDemo(toDemoFlow(document, "ios"));
        expect(result.ok, `${channel}-${theme}`).toBe(true);
        if (result.ok) expect(compileDemo(result.demo).channel).toBe(channel);
      }
    }
  });
});

describe("chat renderer model", () => {
  const compiled = (() => {
    const result = validateDemo(flow("whatsapp", {
      events: [
        { type: "typing", atMs: 1400, typing: true },
        { type: "typing", atMs: 2000, typing: false },
        { type: "reaction", atMs: 2500, messageId: "m2", reactionId: "r1", reaction: { type: "love", byMe: true } },
        { type: "draft", atMs: 2600, value: "Gra" },
      ],
    }));
    if (!result.ok) throw new Error("fixture invalid");
    return compileDemo(result.demo);
  })();
  const model = (timeMs: number) => buildChatModel(compiled, { ...frameAt(compiled, timeMs), platform: "ios", theme: "light" }, "whatsapp");

  it("knows its channels", () => {
    expect(["whatsapp", "telegram", "slack"].every(isChatChannel)).toBe(true);
    expect(isChatChannel("sms")).toBe(false);
  });

  it("is a pure function of time", () => {
    for (const t of [0, 450, 1100, 1500, 2100, 2650, 3000]) expect(model(t)).toEqual(model(t));
  });

  it("derives arrival, typing, receipts, reactions and caret from the clock", () => {
    // Playback clock is relative to the first message (atMs 1000 -> 0).
    expect(model(0).messages[0].enter).toBe(1);
    expect(model(1000).messages[1].enter).toBe(0);
    expect(model(1100).messages[1].enter).toBeGreaterThan(0);
    expect(model(1100).messages[1].enter).toBeLessThan(1);
    expect(model(500).typing.visible).toBe(true);
    expect(model(200).messages[0].status).toBe("delivered");
    expect(model(450).messages[0].status).toBe("read");
    expect(model(1490).messages[1].reactions).toEqual([]);
    expect(model(1500).messages[1].reactions[0].emoji).toBe("❤️");
    expect(model(1500).messages[1].reactions[0].enter).toBeLessThan(1);
    expect(model(2000).messages[1].reactions[0].enter).toBe(1);
    expect(model(1600).draft.text).toBe("Gra");
    expect(model(1600).draft.caret).toBe(true);
  });
});
