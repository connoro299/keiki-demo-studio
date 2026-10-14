import type { ContactPoint, Lead, LeadStatus } from "@/outreach/types";
import type { DemoChannel } from "@/contracts";

export const CHANNEL_LABEL: Record<DemoChannel, string> = {
  imessage: "iMessage",
  sms: "SMS",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  slack: "Slack",
};

export const CONTACT_LABEL: Record<ContactPoint["kind"], string> = {
  email: "Email",
  form: "Form",
  phone: "Phone",
  x: "X",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  other: "Other",
};

export type LeadFilter = "all" | "ready" | "working" | "approved" | "sent" | "skipped" | "failed";

export const LEAD_FILTERS: Array<{ id: LeadFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "working", label: "In progress" },
  { id: "approved", label: "Approved" },
  { id: "sent", label: "Sent" },
  { id: "skipped", label: "Skipped" },
  { id: "failed", label: "Failed" },
];

const WORKING: LeadStatus[] = ["queued", "analyzing", "generating", "rendering"];

export function isWorking(status: LeadStatus): boolean {
  return WORKING.includes(status);
}

export function matchesFilter(lead: Lead, filter: LeadFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "ready":
      return lead.status === "drafted";
    case "working":
      return isWorking(lead.status);
    default:
      return lead.status === filter;
  }
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  generating: "Writing demos",
  rendering: "Rendering",
  drafted: "Ready",
  approved: "Approved",
  sent: "Sent",
  skipped: "Skipped",
  failed: "Failed",
};

/** Tone for the status dot: neutral, progress, good, bad. */
export function statusTone(status: string): "neutral" | "progress" | "good" | "bad" | "ready" {
  if (status === "failed") return "bad";
  if (status === "sent" || status === "posted") return "good";
  if (status === "drafted" || status === "pending") return "ready";
  if (WORKING.includes(status as LeadStatus)) return "progress";
  return "neutral";
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function rankedContacts(lead: Lead): ContactPoint[] {
  return [...(lead.profile?.contacts ?? [])].sort((a, b) => b.confidence - a.confidence);
}

export function bestContact(lead: Lead): ContactPoint | undefined {
  return lead.draft?.to ?? rankedContacts(lead)[0];
}

export function leadChannels(lead: Lead): DemoChannel[] {
  const fromDemos = lead.demos.map((demo) => demo.channel);
  return [...new Set(fromDemos.length ? fromDemos : lead.profile?.channelsSeen ?? [])];
}

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const diff = now - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function mailtoUrl(to: string, subject: string, body: string): string {
  const params = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`].join("&");
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${params}`;
}

/** URLs from pasted text (one per line, commas ok) or a CSV with a url/website/domain column. */
export function parseSiteList(text: string): string[] {
  const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (!rows.length) return [];
  const cells = rows.map(splitCsvRow);
  const header = cells[0].map((cell) => cell.toLowerCase());
  const column = header.findIndex((cell) => /^(url|website|site|domain|homepage|web)$/.test(cell));
  const body = column >= 0 ? cells.slice(1) : cells;
  const found: string[] = [];
  for (const row of body) {
    const candidates = column >= 0 ? [row[column]] : row;
    const hit = candidates.find((cell) => cell && looksLikeSite(cell));
    if (hit && !found.includes(hit.trim())) found.push(hit.trim());
  }
  return found;
}

function looksLikeSite(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes("@")) return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(trimmed);
}

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      if (quoted && row[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if ((char === "," || char === "\t" || char === ";") && !quoted) {
      out.push(current.trim());
      current = "";
    } else current += char;
  }
  out.push(current.trim());
  return out;
}
