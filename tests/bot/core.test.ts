import { describe, expect, it } from "vitest";
import { channelFrom, extractSites } from "@/bot/core";

describe("bot message parsing", () => {
  it("pulls sites from Slack-formatted text, lists and CSV", () => {
    const text = "<@U123> make one for <https://sproutdental.com|sproutdental.com> and harborbarbers.co\nname,website\nTide,tidepoolyoga.com\nkim@northpaw.vet logo.png";
    expect(extractSites(text)).toEqual(["https://sproutdental.com", "https://harborbarbers.co", "https://tidepoolyoga.com"]);
  });
  it("ignores email addresses and file names", () => {
    expect(extractSites("ping hello@sprout.com about deck.pdf")).toEqual([]);
  });
  it("reads a requested channel", () => {
    expect(channelFrom("sproutdental.com on WhatsApp please")).toBe("whatsapp");
    expect(channelFrom("do it via text")).toBe("sms");
    expect(channelFrom("sproutdental.com")).toBeUndefined();
  });
});
