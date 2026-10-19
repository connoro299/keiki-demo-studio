import { describe, expect, it } from "vitest";
import { compileDemo, validateDemo } from "@/compiler";
import { frameAt } from "@/runtime";
import { toUpstreamMessage } from "@/renderers/ios/adapt";
import { buildChatModel, clockLabel, dayLabelFor } from "@/renderers/chat/engine";
import { visibleClock } from "@/runtime/story-clock";

const start = 1_792_000_000_000;
const lastWeek = Date.UTC(2026, 9, 6, 16, 0);
const opening = Date.UTC(2026, 9, 13, 16, 0);
const nextMorning = Date.UTC(2026, 9, 14, 9, 32);

function flow(channel?: "whatsapp") {
  return {
    id: "story-clock",
    title: "Story clock",
    platform: "ios",
    ...(channel ? { channel } : {}),
    theme: "light",
    contact: { name: "Clinic" },
    nowMs: opening,
    startAtMs: start,
    draft: "",
    typing: false,
    screen: "conversation",
    messages: [
      { id: "h1", text: "here's your plan", direction: "incoming", atMs: start - 2000, sentAt: lastWeek },
      { id: "h2", text: "thanks", direction: "outgoing", atMs: start - 1000, sentAt: lastWeek + 600_000 },
      { id: "m1", text: "checking in", direction: "incoming", atMs: start + 1000, sentAt: opening },
      { id: "m2", text: "next morning", direction: "incoming", atMs: start + 3000, sentAt: nextMorning },
    ],
  };
}

function compiled(channel?: "whatsapp") {
  const result = validateDemo(flow(channel));
  if (!result.ok) throw new Error(JSON.stringify(result));
  return compileDemo(result.demo);
}

describe("authored sentAt and thread history", () => {
  it("accepts history before startAtMs and shows it settled at the opening frame", () => {
    const demo = compiled();
    const frame = frameAt(demo, 0);
    expect(frame.messages.map((message) => message.id)).toEqual(["h1", "h2"]);
    expect(frame.nowMs).toBe(opening);
  });

  it("advances the device clock to the newest arrived sentAt and maps sentAt onto the pinned row", () => {
    const demo = compiled();
    expect(frameAt(demo, 1500).nowMs).toBe(opening);
    expect(frameAt(demo, demo.durationMs).nowMs).toBe(nextMorning);
    const last = frameAt(demo, demo.durationMs).messages.at(-1)!;
    expect(toUpstreamMessage(last).sentAt).toBe(nextMorning);
  });

  it("draws chat day dividers from sentAt", () => {
    const demo = compiled("whatsapp");
    const frame = frameAt(demo, demo.durationMs);
    const model = buildChatModel(demo, frame as never, "whatsapp");
    expect(model.dayLabel).toBe("Tue, Oct 6");
    expect(model.messages.map((view) => view.dayLabel ?? null)).toEqual([null, null, "Yesterday", "Today"]);
    expect(dayLabelFor(opening, opening)).toBe("Today");
  });

  it("keeps chat day dividers static before a later time skip arrives", () => {
    const demo = compiled("whatsapp");
    const early = buildChatModel(demo, frameAt(demo, 1500) as never, "whatsapp");
    expect(early.messages.map((view) => view.dayLabel ?? null)).toEqual([null, null, "Yesterday"]);
    expect(early.dayLabel).toBe("Tue, Oct 6");
  });


  it("ticks the status bar on the frame each bubble appears, outgoing included, in every channel", () => {
    const base = flow();
    base.messages.push({ id: "m3", text: "on my way", direction: "outgoing", atMs: start + 5000, sentAt: nextMorning + 180_000 } as never);
    for (const channel of [undefined, "whatsapp", "slack", "telegram"] as const) {
      const result = validateDemo(channel ? { ...base, channel } : base);
      if (!result.ok) throw new Error(JSON.stringify(result));
      const demo = compileDemo(result.demo);
      for (let t = 0; t <= demo.durationMs; t += 50) {
        const frame = frameAt(demo, t);
        const latest = Math.max(...frame.messages.map((message) => message.sentAt ?? message.atMs));
        expect(visibleClock(frame.nowMs, frame.messages)).toBeGreaterThanOrEqual(latest);
        if (channel) {
          const model = buildChatModel(demo, frame as never, channel);
          expect(model.statusTime).toBe(clockLabel(Math.max(latest, opening), false));
        }
      }
    }
  });
});
