import type { DemoChannel } from "@/contracts";
import type { MakeEvent, MakeRequest } from "./server";

export const CHANNEL_LABELS: Record<DemoChannel, string> = { imessage: "iMessage", whatsapp: "WhatsApp", sms: "SMS", telegram: "Telegram", slack: "Slack" };
export const CHANNEL_ORDER: DemoChannel[] = ["imessage", "whatsapp", "sms", "telegram", "slack"];

/** POST /api/make and hand each NDJSON event to `onEvent` as it arrives. */
export async function streamMake(body: MakeRequest, accessCode: string | null, onEvent: (event: MakeEvent) => void): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/make", {
      method: "POST",
      headers: { "content-type": "application/json", ...(accessCode ? { "x-studio-code": accessCode } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    onEvent({ type: "error", code: "failed", message: "Couldn't reach the studio server. Check your connection." });
    return;
  }
  if (!response.ok || !response.body) {
    onEvent({ type: "error", code: "failed", message: response.status === 404 ? "The studio server isn't running here." : `The studio server returned ${response.status}.` });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as MakeEvent);
    }
    if (done) break;
  }
}

export function parseSites(input: string): string[] {
  const found = input
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/^<|>$/g, ""))
    .filter((part) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(part));
  return [...new Set(found)];
}

export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the studio still works for this session.
  }
}
