/**
 * Search presets for X API v2 recent search. Each targets a small-business owner describing, in
 * their own words, a pain an agent removes: inbound messages piling up, calls and bookings slipping,
 * no front desk, the same questions on repeat, or an explicit ask for a tool.
 *
 * Every query gets DEFAULT_OPERATORS appended plus EXCLUSIONS to keep out the noise that matches
 * these phrases on X: job posts, crypto/giveaway spam, webinars and promoted-only posts.
 * Recent search caps a query at 512 characters (Basic tier); tests enforce that.
 */
export type PresetName = "dms" | "receptionist" | "bookings" | "support";

export type SearchQuery = { preset: PresetName; label: string; query: string };

export const DEFAULT_OPERATORS = "-is:retweet -is:reply lang:en";

/** Job posts, crypto/giveaway spam, webinars and ad-only posts. AI chatter is left to triage, which
 *  scores it low; excluding "AI" here would also drop owners asking "is there an AI that…". */
export const EXCLUSIONS = '-hiring -"job opening" -crypto -nft -airdrop -giveaway -webinar -is:nullcast';

export const PRESETS: Record<PresetName, SearchQuery[]> = {
  dms: [
    {
      preset: "dms",
      label: "Drowning in customer DMs",
      query: '("drowning in DMs" OR "so many DMs" OR "can\'t keep up with DMs" OR "can\'t keep up with messages" OR "100 DMs" OR "inbox is a disaster") (customers OR clients OR orders OR "my shop" OR "my business")',
    },
    {
      preset: "dms",
      label: "Customer texts all day and night",
      query: '("texting customers" OR "customer texts" OR "client texts" OR "texts from clients" OR "WhatsApp messages" OR "Instagram DMs") ("all day" OR "all night" OR "at midnight" OR "can\'t keep up" OR overwhelmed OR exhausting)',
    },
  ],
  receptionist: [
    {
      preset: "receptionist",
      label: "Wishes they had a receptionist",
      query: '("need a receptionist" OR "wish I had a receptionist" OR "can\'t afford a receptionist" OR "need an assistant to answer" OR "need someone to answer") (salon OR clinic OR studio OR shop OR practice OR "my business" OR "small business")',
    },
    {
      preset: "receptionist",
      label: "Missing calls while working",
      query: '("missed calls" OR "missing calls" OR "can\'t answer the phone" OR "can\'t pick up the phone" OR "phone rings all day") (customers OR clients OR jobs OR leads OR "on a job" OR "with a client")',
    },
  ],
  bookings: [
    {
      preset: "bookings",
      label: "Lost bookings and scheduling ping-pong",
      query: '("lost a booking" OR "missed a booking" OR "lost the booking" OR "double booked" OR "back and forth to book" OR "scheduling nightmare" OR "reschedule requests") (clients OR customers OR appointments OR salon OR studio)',
    },
  ],
  support: [
    {
      preset: "support",
      label: "Same questions on repeat",
      query: '("same questions all day" OR "same question 50 times" OR "answer the same questions" OR "same questions over and over" OR "asked the same question" OR "what are your hours") (customers OR clients OR DMs OR emails OR texts)',
    },
    {
      preset: "support",
      label: "Asking for a tool",
      query: '("anyone know a tool" OR "anyone recommend a tool" OR "is there an app that" OR "is there a tool that" OR "any recommendations for") ("answer customers" OR "reply to customers" OR "customer messages" OR "customer texts" OR "answer DMs" OR "answer texts" OR "book appointments")',
    },
  ],
};

export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

/** Expand a preset name ("all" for every one) into the queries to run, operators included. */
export function queriesFor(preset: PresetName | "all" = "all"): SearchQuery[] {
  const groups = preset === "all" ? PRESET_NAMES.map((name) => PRESETS[name]) : [PRESETS[preset]];
  if (!groups[0]) throw new Error(`unknown preset "${preset}". Choose all, ${PRESET_NAMES.join(", ")}.`);
  return groups.flat().map((entry) => ({ ...entry, query: withOperators(entry.query) }));
}

/** Append the default operators and exclusions unless the query already sets its own. */
export function withOperators(query: string): string {
  const parts = [query.trim()];
  if (!/(?:^|\s)-?is:retweet\b/.test(query)) parts.push("-is:retweet");
  if (!/(?:^|\s)-?is:reply\b/.test(query)) parts.push("-is:reply");
  if (!/(?:^|\s)lang:/.test(query)) parts.push("lang:en");
  if (!query.includes("-hiring")) parts.push(EXCLUSIONS);
  return parts.join(" ");
}
