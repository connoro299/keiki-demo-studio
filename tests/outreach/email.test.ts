import { describe, expect, it } from "vitest";
import { draftEmail, emailIssues, finalizeEmail, OPT_OUT, SIGN_OFF, templateEmail } from "@/outreach/email";
import type { Lead } from "@/outreach/types";
import { fakeLlm, sampleProfile } from "./helpers";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lucia-abc123",
    url: "https://luciastrattoria.com",
    status: "rendering",
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    profile: sampleProfile(),
    demos: [{
      channel: "imessage",
      flowId: "lucia-s-trattoria-imessage",
      flowPath: "outreach/leads/lucia-abc123/flows/lucia-s-trattoria-imessage.json",
      story: "A guest books the private room for a birthday and gets the deposit link.",
      gif: "outreach/leads/lucia-abc123/media/lucia-s-trattoria-imessage/demo.gif",
      mp4: "outreach/leads/lucia-abc123/media/lucia-s-trattoria-imessage/demo.mp4",
    }],
    ...overrides,
  };
}

const goodBody = `Hi Marco,

Saw that your back room seats up to 24 and that Lucia still rolls the tagliatelle before every service. That kind of detail is why people book birthdays with you.

We made a quick demo of what an agent could do for Lucia's Trattoria on iMessage: a guest asks about the private room, gets the 7pm slot held and pays the deposit, all by text. The GIF is attached.

If you want the live version on your own number, just reply "yes".

${SIGN_OFF}

${OPT_OUT}`;

describe("draftEmail", () => {
  it("drafts a short plain email to the best contact with variants and attachments", async () => {
    const llm = fakeLlm([{ subject: "a demo for Lucia's", body: goodBody, form: `Hi, we made a short demo of an agent booking Lucia's private room by text. Happy to send it, or reply "yes" for a live version.\n\n${SIGN_OFF}\n\n${OPT_OUT}`, xDm: "Hi Marco, we made a 20-second demo of an agent booking your private room by text. Want it?" }]);
    const draft = await draftEmail(lead(), { completeJson: llm.completeJson });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].prompt).toMatch(/first name Marco/);
    expect(llm.calls[0].prompt).toMatch(/on iMessage/);
    expect(draft).toMatchObject({ channel: "email", to: { value: "marco@luciastrattoria.com" }, subject: "a demo for Lucia's" });
    expect(draft.body).toBe(goodBody);
    expect(emailIssues(draft)).toEqual([]);
    expect(draft.variants?.xDm?.length).toBeLessThanOrEqual(280);
    expect(draft.variants?.form).toContain(OPT_OUT);
    expect(draft.attachments).toEqual([
      "outreach/leads/lucia-abc123/media/lucia-s-trattoria-imessage/demo.gif",
      "outreach/leads/lucia-abc123/media/lucia-s-trattoria-imessage/demo.mp4",
    ]);
  });

  it("asks once for a fix when the first draft breaks the rules, and enforces them anyway", async () => {
    const llm = fakeLlm([
      { subject: "Revolutionize your restaurant with AI agents today", body: "Hey!! 🚀 We built a demo." },
      { subject: "Revolutionize your restaurant with AI agents today", body: "Hi there 🚀 short demo attached!" },
    ]);
    const draft = await draftEmail(lead(), { completeJson: llm.completeJson });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].prompt).toMatch(/subject must be 1-6 words/);
    expect(draft.subject.split(" ").length).toBeLessThanOrEqual(6);
    expect(draft.body).not.toMatch(/🚀|!/u);
    expect(draft.body).toContain(SIGN_OFF);
    expect(draft.body).toContain(OPT_OUT);
  });

  it("uses the form variant when the best contact is a contact form", async () => {
    const formOnly = sampleProfile({ contacts: [{ kind: "form", value: "https://luciastrattoria.com/contact", source: "https://luciastrattoria.com/contact", confidence: 0.4 }] });
    const llm = fakeLlm([{ subject: "a demo for Lucia's", body: goodBody, form: `Hi, we made a short demo of an agent for Lucia's Trattoria. Reply "yes" and we'll send it.\n\n${SIGN_OFF}\n\n${OPT_OUT}` }]);
    const draft = await draftEmail(lead({ profile: formOnly }), { completeJson: llm.completeJson });
    expect(draft.channel).toBe("form");
    expect(draft.subject).toBe("");
    expect(draft.body).toMatch(/^Hi, we made a short demo/);
    expect(draft.to?.value).toBe("https://luciastrattoria.com/contact");
  });

  it("has a no-model template that already follows the rules", async () => {
    const draft = await draftEmail(lead(), { llm: false });
    expect(emailIssues(draft)).toEqual([]);
    expect(draft.body).toMatch(/^Hi Marco,/);
    expect(draft.body).toMatch(/on iMessage/);
    expect(templateEmail(lead()).xDm!.length).toBeLessThanOrEqual(280);
  });
});

describe("finalizeEmail", () => {
  it("adds missing sign-off and opt-out and trims long subjects", () => {
    const result = finalizeEmail("Hi there, demo attached.", "one two three four five six seven");
    expect(result.subject).toBe("one two three four five six");
    expect(result.body.endsWith(`${SIGN_OFF}\n\n${OPT_OUT}`)).toBe(true);
  });
});
