import type { ContactPoint, Lead, LeadStatus, XDraft, XDraftStatus } from "@/outreach/types";

/** Browser client for the /api/outreach/ routes served by src/outreach/api.ts. */
const BASE = "/api/outreach";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(response.status, response.status === 404 ? "The outreach API is not mounted. Start the app with `npm run dev`." : text.slice(0, 200));
  }
  if (!response.ok) throw new ApiError(response.status, (body as { error?: string }).error ?? `HTTP ${response.status}`);
  return body as T;
}

export type LeadsResponse = { leads: Lead[]; pipeline: { installed: boolean; cli: boolean }; root: string };

export const api = {
  leads: () => request<LeadsResponse>("leads"),
  addLeads: (urls: string[]) => request<{ leads: Lead[]; via: "pipeline" | "store"; invalid: string[] }>("leads", { method: "POST", body: JSON.stringify({ urls }) }),
  patchLead: (id: string, patch: { status?: LeadStatus; notes?: string; draft?: { subject?: string; body?: string; to?: ContactPoint | string | null } }) =>
    request<Lead>(`lead/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  run: (concurrency?: number) => request<{ started: boolean; command: string }>("run", { method: "POST", body: JSON.stringify({ concurrency }) }),
  drafts: () => request<{ drafts: XDraft[]; root: string }>("x"),
  patchDraft: (id: string, patch: { reply?: string; status?: XDraftStatus; notes?: string }) =>
    request<XDraft>(`x/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
};

export function mediaUrl(path: string, download = false): string {
  return `${BASE}/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}
