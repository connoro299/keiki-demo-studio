import type { DemoChannel } from "@/contracts";
import { normalizeFlow, type FlowDocument } from "@/outreach/flow";

/**
 * Share links carry the conversation itself, so they need no storage: the messages and authored
 * events (typing and composer drafts are rebuilt on open by normalizeFlow), deflated and base64url'd.
 */
type Packed = { v: 1; n: string; c: DemoChannel; th?: "dark"; now: number; m: unknown[]; e?: unknown[] };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(flow: FlowDocument, channel: DemoChannel): Promise<string> {
  const contact = flow.contact as { name: string };
  const events = (Array.isArray(flow.events) ? flow.events : []).filter((event: { type?: string }) => event.type !== "typing" && event.type !== "draft");
  const packed: Packed = { v: 1, n: contact.name, c: channel, now: flow.nowMs as number, m: flow.messages as unknown[], ...(flow.theme === "dark" ? { th: "dark" } : {}), ...(events.length ? { e: events } : {}) };
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(packed)), new CompressionStream("deflate-raw"));
  return toBase64Url(bytes);
}

export async function decodeShare(token: string): Promise<{ flow: FlowDocument; channel: DemoChannel; name: string }> {
  const bytes = await pipe(fromBase64Url(token), new DecompressionStream("deflate-raw"));
  const packed = JSON.parse(new TextDecoder().decode(bytes)) as Packed;
  const flow = normalizeFlow({ messages: packed.m, events: packed.e, nowMs: packed.now, theme: packed.th ?? "light" }, { flowId: "shared", channel: packed.c, businessName: packed.n });
  return { flow, channel: packed.c, name: packed.n };
}

/** A short /?s=<id> link when the server can store it, otherwise the self-contained /?d= link. */
export async function shareUrl(token: string): Promise<string> {
  try {
    const response = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    if (response.ok) {
      const { id } = (await response.json()) as { id: string };
      return `${window.location.origin}/?s=${id}`;
    }
  } catch {
    // Fall through to the long link.
  }
  return `${window.location.origin}/?d=${token}`;
}

export async function fetchShared(id: string): Promise<string> {
  const response = await fetch(`/api/share?id=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("not found");
  return ((await response.json()) as { token: string }).token;
}
