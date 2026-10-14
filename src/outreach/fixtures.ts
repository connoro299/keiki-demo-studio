import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leadDir, writeLead, writeXDraft } from "./store";
import type { ContactPoint, DemoAsset, Lead, SiteProfile, XDraft } from "./types";

/**
 * Realistic fixture data for the review dashboard: a populated X queue and lead list, with two
 * real demo videos (rendered from this repo's iMessage renderer) under tests/fixtures/outreach.
 * All names, handles and sites are invented. Seed into a scratch OUTREACH_DIR, never the real one.
 */
const MEDIA_SOURCE = fileURLToPath(new URL("../../tests/fixtures/outreach/media/", import.meta.url));

const HOUR = 3600_000;

function ago(ms: number, now: number): string {
  return new Date(now - ms).toISOString();
}

function copyMedia(root: string, leadId: string, name: string): string {
  const dir = path.join(leadDir(leadId, root), "media");
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(MEDIA_SOURCE, name), path.join(dir, name));
  return path.relative(root, path.join(dir, name)).split(path.sep).join("/");
}

function demo(root: string, leadId: string, base: "harbor-imessage" | "sprout-sms", channel: DemoAsset["channel"], story: string): DemoAsset {
  return {
    channel,
    flowId: `${leadId}-${channel}`,
    flowPath: `leads/${leadId}/flows/${channel}.json`,
    story,
    mp4: copyMedia(root, leadId, `${base}.mp4`),
    poster: copyMedia(root, leadId, `${base}.png`),
    durationMs: 9900,
  };
}

function contact(kind: ContactPoint["kind"], value: string, confidence: number, label: string | undefined, source: string): ContactPoint {
  return { kind, value, confidence, label, source };
}

function profile(partial: Partial<SiteProfile> & Pick<SiteProfile, "url" | "name" | "summary" | "vertical">, now: number): SiteProfile {
  return {
    domain: new URL(partial.url).hostname.replace(/^www\./, ""),
    audience: "local customers",
    offerings: [],
    tone: "warm, plain-spoken",
    socials: {},
    contacts: [],
    channelsSeen: [],
    fetchedAt: ago(5 * HOUR, now),
    ...partial,
  };
}

export function fixtureLeads(root: string, now = Date.now()): Lead[] {
  const harborId = "harborbarbers-co-a1b2c3";
  const sproutId = "sproutdental-com-d4e5f6";
  const base = (id: string, url: string, status: Lead["status"], hoursAgo: number): Lead => ({
    id, url, status, demos: [], createdAt: ago(hoursAgo * HOUR, now), updatedAt: ago(hoursAgo * HOUR * 0.5, now),
  });

  const harborContacts = [
    contact("email", "marco@harborbarbers.co", 0.92, "Marco Reyes, Owner", "https://harborbarbers.co/about"),
    contact("email", "book@harborbarbers.co", 0.7, "Bookings inbox", "https://harborbarbers.co/contact"),
    contact("instagram", "https://instagram.com/harborbarbers", 0.45, undefined, "https://harborbarbers.co"),
    contact("phone", "+1 (617) 555-0142", 0.4, "Shop line", "https://harborbarbers.co/contact"),
  ];
  const sproutContacts = [
    contact("email", "hello@sproutdental.com", 0.74, "Front desk", "https://sproutdental.com/contact"),
    contact("form", "https://sproutdental.com/contact#form", 0.55, "Contact form", "https://sproutdental.com/contact"),
    contact("phone", "+1 (503) 555-0187", 0.4, "Main line", "https://sproutdental.com"),
  ];

  return [
    {
      ...base(harborId, "https://harborbarbers.co", "drafted", 3),
      profile: profile({
        url: "https://harborbarbers.co",
        name: "Harbor Barbers",
        tagline: "Cuts, fades and hot-towel shaves in the Seaport.",
        summary: "A two-chair barbershop in Boston's Seaport doing fades, beard work and hot-towel shaves. Most bookings come in by text and Instagram DM, and walk-ins fill the gaps.",
        vertical: "Barbershop",
        audience: "Neighborhood regulars and office workers nearby",
        offerings: ["Skin fades", "Beard trims", "Hot-towel shaves", "Kids cuts"],
        contacts: harborContacts,
        channelsSeen: ["imessage", "sms"],
        socials: { instagram: "https://instagram.com/harborbarbers" },
      }, now),
      demos: [
        demo(root, harborId, "harbor-imessage", "imessage", "A regular asks for a Saturday fade; the agent offers two slots, books 9:30 and sets a reminder."),
      ],
      draft: {
        channel: "email",
        to: harborContacts[0],
        subject: "Saturday fades, booked by text",
        body: "Hi Marco,\n\nI saw on your site that most Harbor bookings come in by text and DM. I built a short demo of an agent answering those for you: a regular asks for a Saturday fade, it offers Marco's open slots, books 9:30 and sends the Friday reminder. Video's attached.\n\nIt works over iMessage and SMS from your existing number, and hands anything unusual straight to you. Happy to set one up for the shop if it's useful.\n\nConnor\nKeiki",
      },
    },
    {
      ...base(sproutId, "https://sproutdental.com", "drafted", 6),
      profile: profile({
        url: "https://sproutdental.com",
        name: "Sprout Dental",
        tagline: "Family dentistry in Southeast Portland.",
        summary: "A family dental practice in Portland with two dentists and same-day emergency slots. Patients text the front desk to book, reschedule and ask about insurance.",
        vertical: "Dental clinic",
        audience: "Families and kids in Southeast Portland",
        offerings: ["Checkups and cleanings", "Pediatric dentistry", "Emergency visits", "Invisalign"],
        contacts: sproutContacts,
        channelsSeen: ["sms"],
      }, now),
      demos: [demo(root, sproutId, "sprout-sms", "sms", "A parent texts about a chipped tooth; the agent triages and books the 4:10 emergency slot.")],
      draft: {
        channel: "email",
        to: sproutContacts[0],
        subject: "After-hours texts at Sprout",
        body: "Hi Sprout team,\n\nYour site mentions same-day emergency slots, which usually means the front desk is fielding texts all day. I made a quick demo of an agent handling one: a parent texts about a chipped tooth, it checks for pain, books Dr. Patel's 4:10 slot and gives the milk tip.\n\nIt runs over SMS on your current number and passes anything clinical to your staff. Worth a look?\n\nConnor\nKeiki",
      },
    },
    {
      ...base("lumencoffee-com-0a9b8c", "https://lumencoffee.com", "approved", 20),
      profile: profile({
        url: "https://lumencoffee.com",
        name: "Lumen Coffee",
        summary: "Two specialty cafés in Austin with online pickup ordering and a busy catering inbox.",
        vertical: "Café",
        audience: "Austin commuters and offices ordering catering",
        offerings: ["Espresso bar", "Pickup orders", "Office catering"],
        contacts: [contact("email", "catering@lumencoffee.com", 0.78, "Catering", "https://lumencoffee.com/catering")],
        channelsSeen: ["imessage"],
      }, now),
      draft: {
        channel: "email",
        to: contact("email", "catering@lumencoffee.com", 0.78, "Catering", "https://lumencoffee.com/catering"),
        subject: "Catering quotes over text",
        body: "Hi Lumen team,\n\nAn agent could take catering requests by text, quote from your menu and confirm pickup times. Happy to show you.\n\nConnor",
      },
    },
    {
      ...base("northpaw-vet-5e6f7a", "https://northpaw.vet", "sent", 52),
      profile: profile({
        url: "https://northpaw.vet",
        name: "Northpaw Veterinary",
        summary: "A neighborhood vet clinic in Denver that books visits by phone and WhatsApp.",
        vertical: "Veterinary clinic",
        audience: "Pet owners in Denver",
        contacts: [contact("email", "dr.kim@northpaw.vet", 0.88, "Dr. Hana Kim, Owner", "https://northpaw.vet/team")],
        channelsSeen: ["whatsapp"],
      }, now),
      draft: { channel: "email", to: contact("email", "dr.kim@northpaw.vet", 0.88, "Dr. Hana Kim, Owner", "https://northpaw.vet/team"), subject: "WhatsApp bookings at Northpaw", body: "Hi Dr. Kim, …" },
      notes: "Sent Tuesday. Follow up next week if no reply.",
    },
    { ...base("tidepoolyoga-com-1c2d3e", "https://tidepoolyoga.com", "rendering", 1), demos: [] },
    { ...base("brickandmortar-shop-7f8e9d", "https://brickandmortar.shop", "queued", 0.2), demos: [] },
    { ...base("oldtownlocksmith-com-4b5a6c", "https://oldtownlocksmith.com", "failed", 9), error: "site returned 403 to the fetcher (Cloudflare challenge)", demos: [] },
  ];
}

export function fixtureXDrafts(root: string, now = Date.now()): XDraft[] {
  const harborDemo = demo(root, "harborbarbers-co-a1b2c3", "harbor-imessage", "imessage", "Saturday fade booked by text, with a reminder.");
  const sproutDemo = demo(root, "sproutdental-com-d4e5f6", "sprout-sms", "sms", "Emergency slot triaged and booked over SMS.");
  const draft = (partial: Omit<XDraft, "createdAt" | "updatedAt" | "status"> & { status?: XDraft["status"]; hoursAgo: number }): XDraft => {
    const { hoursAgo, ...rest } = partial;
    return { status: "pending", ...rest, createdAt: ago(hoursAgo * HOUR, now), updatedAt: ago(hoursAgo * HOUR, now) };
  };
  return [
    draft({
      id: "x-1846210000000000001",
      hoursAgo: 1,
      tweet: {
        id: "1846210000000000001",
        url: "https://x.com/marco_cuts/status/1846210000000000001",
        authorHandle: "marco_cuts",
        authorName: "Marco Reyes",
        authorBio: "Barber. Owner @ Harbor Barbers, Seaport. harborbarbers.co",
        authorFollowers: 1840,
        text: "Two chairs, one of me, and 40 unread texts asking \"you got anything saturday?\" every single week. I cut hair, I don't want to be a switchboard.",
        createdAt: ago(2 * HOUR, now),
        metrics: { likes: 112, replies: 18, reposts: 6, views: 9400 },
      },
      reason: "Shop owner drowning in booking texts; exactly the Saturday-slot question an agent answers.",
      score: 0.94,
      site: "https://harborbarbers.co",
      demo: harborDemo,
      reply: "the \"you got anything saturday?\" text is the perfect thing to hand off. made you a quick demo of what that'd look like for a two-chair shop ↓",
      alternatives: [
        "an agent on your shop number could answer those with your open slots and book them straight in, so you only see the ones that need you. you shouldn't be a switchboard mid-fade",
        "do most of those come in as iMessage or plain texts? either way you can have something reply with Saturday's openings and lock the slot while you're cutting",
      ],
      source: "search: Customer texts all day and night",
    }),
    draft({
      id: "x-1846210000000000002",
      hoursAgo: 2,
      tweet: {
        id: "1846210000000000002",
        url: "https://x.com/drpriya_smiles/status/1846210000000000002",
        authorHandle: "drpriya_smiles",
        authorName: "Dr. Priya Patel",
        authorBio: "Pediatric dentist. Co-owner, Sprout Dental PDX. sproutdental.com",
        authorFollowers: 3120,
        text: "Our front desk spent 3 hours today answering \"do you take Delta Dental\" and \"can you see my kid today\" texts. We need a receptionist for our receptionist.",
        createdAt: ago(3 * HOUR, now),
        metrics: { likes: 64, replies: 11, reposts: 2, views: 5100 },
      },
      reason: "Practice owner with repeat insurance and same-day booking texts; strong fit for an SMS agent.",
      score: 0.91,
      site: "https://sproutdental.com",
      demo: sproutDemo,
      reply: "\"do you take Delta\" and \"can you see my kid today\" are two questions an agent can answer instantly and book from. made you a quick demo of what that'd look like for Sprout ↓",
      alternatives: [
        "a receptionist for your receptionist is basically an agent on your texting line: it answers the insurance questions from your list and books same-day slots, and passes anything clinical to the desk",
        "how many of those texts are the same five questions? usually it's most of them, and those are easy to answer automatically so your desk only gets the real ones",
      ],
      source: "search: Same questions on repeat",
    }),
    draft({
      id: "x-1846210000000000003",
      hoursAgo: 4,
      tweet: {
        id: "1846210000000000003",
        url: "https://x.com/kaylabakes_atx/status/1846210000000000003",
        authorHandle: "kaylabakes_atx",
        authorName: "Kayla | Crumb & Co",
        authorBio: "Custom cakes, Austin TX. Orders via DM only.",
        authorFollowers: 8900,
        text: "Anyone know a tool that can answer cake order DMs? Same 6 questions (price, flavors, how far ahead, delivery?) 50 times a day and I'm losing actual orders in the pile.",
        createdAt: ago(5 * HOUR, now),
        metrics: { likes: 41, replies: 23, reposts: 3, views: 3800 },
      },
      reason: "Asking for a tool to answer repeat order DMs and losing orders; explicit buying intent.",
      score: 0.89,
      reply: "you could have an agent answer those six from your price sheet and collect the order details (date, size, flavor, pickup or delivery) so you just approve the ones you want. no more digging through the pile",
      alternatives: [
        "for cake orders the big win is having it ask the date first, then quote and hold the slot. you'd only step in to confirm the design",
        "do you have a price sheet or menu already? that's basically all an agent needs to handle the price, flavor and lead-time questions for you",
      ],
      source: "search: Asking for a tool",
    }),
    draft({
      id: "x-1846210000000000004",
      hoursAgo: 6,
      tweet: {
        id: "1846210000000000004",
        url: "https://x.com/jessplumbsco/status/1846210000000000004",
        authorHandle: "jessplumbsco",
        authorName: "Jess Moreno",
        authorBio: "Licensed plumber. Moreno Plumbing, Phoenix AZ",
        authorFollowers: 640,
        text: "Missed 7 calls today because I was under a sink. Every one of them probably called the next plumber on Google. Hate this part of the job.",
        createdAt: ago(7 * HOUR, now),
        metrics: { likes: 28, replies: 9, reposts: 1, views: 2200 },
      },
      reason: "Trades owner missing calls on jobs; an agent can text back missed callers and book.",
      score: 0.86,
      reply: "rough one. you can have an agent text back every missed call within a minute, ask what's going on and book a time, so they wait for you instead of calling the next plumber",
      alternatives: [
        "most people who call a plumber will happily text instead if something replies right away. an agent can do the missed-call text back and get the address and the problem before you're out from under the sink",
        "worth setting up a missed-call text back at minimum. even better if it can quote your call-out fee and grab a slot for you",
      ],
      source: "search: Missing calls while working",
    }),
    draft({
      id: "x-1846210000000000005",
      hoursAgo: 9,
      tweet: {
        id: "1846210000000000005",
        url: "https://x.com/studio_ondine/status/1846210000000000005",
        authorHandle: "studio_ondine",
        authorName: "Ondine Pilates",
        authorBio: "Reformer studio in Brooklyn. Book at ondinepilates.com",
        authorFollowers: 2300,
        text: "Spent my whole Sunday doing back and forth over WhatsApp to reschedule 14 people after a class got cancelled.",
        createdAt: ago(10 * HOUR, now),
      },
      reason: "Studio owner doing manual rescheduling over WhatsApp; good fit, a little less urgent.",
      score: 0.78,
      site: "https://ondinepilates.com",
      reply: "that's exactly the kind of thing an agent can do in one go: message all 14, offer the open classes and rebook each one as they reply. you'd get your Sunday back",
      alternatives: [
        "if your schedule lives somewhere it can read, an agent on WhatsApp can handle the whole reshuffle and only ping you when someone wants a refund",
      ],
      source: "search: Lost bookings and scheduling ping-pong",
      status: "approved",
    }),
    draft({
      id: "x-1846210000000000006",
      hoursAgo: 26,
      tweet: {
        id: "1846210000000000006",
        url: "https://x.com/rentalsbyamir/status/1846210000000000006",
        authorHandle: "rentalsbyamir",
        authorName: "Amir",
        text: "Guests texting me \"what's the wifi password\" at 2am is my villain origin story.",
        createdAt: ago(27 * HOUR, now),
      },
      reason: "Short-term rental host with repeat late-night guest questions.",
      score: 0.72,
      reply: "an agent on your guest number could answer the wifi, checkout and parking questions at 2am from your house manual and only wake you for real problems",
      alternatives: [],
      source: "manual: add",
      status: "posted",
    }),
    draft({
      id: "x-1846210000000000007",
      hoursAgo: 30,
      tweet: {
        id: "1846210000000000007",
        url: "https://x.com/growthbro_ai/status/1846210000000000007",
        authorHandle: "growthbro_ai",
        authorName: "AI Growth Daily",
        text: "AI agents will replace 80% of customer support by 2027. Here's a thread on the 10 tools you need to know.",
        createdAt: ago(31 * HOUR, now),
      },
      reason: "AI commentary thread, not a business owner with the problem.",
      score: 0.12,
      reply: "",
      alternatives: [],
      source: "search: Drowning in customer DMs",
      status: "skipped",
      notes: "auto-skipped: score 0.12 below threshold 0.6",
    }),
  ];
}

/** Write fixture leads and X drafts into `root`. Refuses a non-empty root unless `force`. */
export function seedFixtures(root: string, options: { force?: boolean; now?: number } = {}): { leads: number; drafts: number; root: string } {
  if (!existsSync(path.join(MEDIA_SOURCE, "harbor-imessage.mp4"))) throw new Error(`fixture media missing in ${MEDIA_SOURCE}`);
  if (existsSync(root) && readdirSync(root).length && !options.force) {
    throw new Error(`${root} is not empty. Pass --force to add fixtures to it anyway.`);
  }
  const now = options.now ?? Date.now();
  const leads = fixtureLeads(root, now);
  for (const lead of leads) writeLead(lead, root);
  const drafts = fixtureXDrafts(root, now);
  for (const draft of drafts) writeXDraft(draft, root);
  return { leads: leads.length, drafts: drafts.length, root };
}
