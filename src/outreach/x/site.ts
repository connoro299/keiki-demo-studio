/**
 * Find the author's business website from what X gives us: the profile URL, links in the bio, and
 * bare domains written in the bio ("owner @ lumenbakery.com"). Social profiles, link-in-bio pages
 * and shorteners are not business sites, so they are skipped.
 */
const NOT_A_BUSINESS_SITE = [
  "x.com", "twitter.com", "t.co", "instagram.com", "facebook.com", "fb.com", "tiktok.com", "youtube.com", "youtu.be",
  "linkedin.com", "threads.net", "bsky.app", "linktr.ee", "beacons.ai", "bio.link", "lnk.bio", "linkin.bio", "campsite.bio",
  "carrd.co", "taplink.cc", "solo.to", "msha.ke", "bit.ly", "tinyurl.com", "ow.ly", "buff.ly", "lnkd.in", "substack.com",
  "medium.com", "github.com", "patreon.com", "onlyfans.com", "cash.app", "venmo.com", "paypal.me", "calendly.com",
  "wa.me", "t.me", "discord.gg", "spotify.com", "apple.com", "google.com", "goo.gl", "amzn.to", "amazon.com",
];

const BARE_DOMAIN = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|co|io|ai|app|shop|store|net|org|biz|studio|salon|spa|dental|health|clinic|fitness|coffee|cafe|bar|restaurant|design|agency|ca|us|uk|au|nz|ie|co\.uk|com\.au))\b/gi;

export function isBusinessSite(url: string): boolean {
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  if (!host.includes(".")) return false;
  return !NOT_A_BUSINESS_SITE.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** Origin-only URL, e.g. "https://lumenbakery.com". */
export function siteOrigin(url: string): string {
  const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  return `${parsed.protocol}//${parsed.hostname.replace(/^www\./, "")}`;
}

export function findAuthorSite(authorLinks: string[], bio?: string): string | undefined {
  for (const link of authorLinks) {
    if (isBusinessSite(link)) return siteOrigin(link);
  }
  for (const match of (bio ?? "").matchAll(BARE_DOMAIN)) {
    // Skip handles like "@lumen.co" only when written as an email ("hi@lumen.co" still names the domain).
    if (isBusinessSite(match[1])) return siteOrigin(match[1]);
  }
  return undefined;
}

/** True when `site`'s domain literally appears in one of the texts. Guards against invented sites. */
export function siteMentioned(site: string, texts: Array<string | undefined>): boolean {
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return texts.some((text) => text?.toLowerCase().includes(host));
}
