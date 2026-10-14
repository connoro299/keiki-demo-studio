import osteria from "../../scenarios/channel-whatsapp-light.json";
import type { StudioItem } from "./Studio";

/** A finished demo the studio can show with no server or API key. */
export function sampleItem(): StudioItem {
  return {
    id: "sample-osteria-nove",
    url: "https://osterianove.com",
    status: "ready",
    createdAt: new Date().toISOString(),
    channel: "whatsapp",
    flow: osteria as unknown as Record<string, unknown>,
    story: "A guest asks for a table for four tonight. The agent offers 8:30 on the terrace, confirms it and handles the birthday cake.",
    stories: [],
    sample: true,
    profile: {
      url: "https://osterianove.com",
      domain: "osterianove.com",
      name: "Osteria Nove",
      summary: "Neighbourhood Italian restaurant with a terrace. Guests message to book tables and ask about private events.",
      vertical: "restaurant",
      audience: "Local diners",
      offerings: ["Dinner", "Terrace seating", "Private events"],
      tone: "warm",
      socials: {},
      channelsSeen: ["whatsapp"],
      fetchedAt: new Date().toISOString(),
      contacts: [{ kind: "email", value: "ciao@osterianove.com", label: "Reservations", source: "https://osterianove.com/contact", confidence: 0.8 }],
    },
    draft: {
      channel: "email",
      to: { kind: "email", value: "ciao@osterianove.com", label: "Reservations", source: "https://osterianove.com/contact", confidence: 0.8 },
      subject: "Tables over WhatsApp",
      body: "Hi Osteria Nove team,\n\nI noticed guests can message you on WhatsApp to book, which usually means someone is answering \"any tables tonight?\" between services. We made a quick demo of an agent handling one: it offers the 8:30 terrace slot, confirms the booking and notes a birthday cake for dessert.\n\nIt runs on your existing WhatsApp number and hands anything unusual to your team. Worth a look?\n\n{{sender_name}}, Keiki\n\nNot relevant? Reply 'no' and I won't follow up.",
    },
  };
}
