import type { CompiledDemo } from "../contracts";

const cache = new WeakMap<CompiledDemo, number>();

/**
 * Fixed reference time for relative day labels ("Today", "Yesterday", weekday, date): the latest wall
 * time anywhere in the story. Labels are computed against the story's end, so a separator reads the same
 * on every frame instead of morphing (e.g. "Today" → "Thu, Oct 15") when a later time skip arrives.
 * The status-bar clock still follows the frame's own `nowMs`.
 */
export function storyLabelClock(compiled: CompiledDemo): number {
  const hit = cache.get(compiled);
  if (hit !== undefined) return hit;
  let latest = compiled.nowMs;
  let dated = false;
  const visit = (message: { atMs: number; sentAt?: number } | undefined) => {
    if (!message) return;
    if (message.sentAt !== undefined) dated = true;
    const shown = message.sentAt ?? (message.atMs > 1e11 ? message.atMs : undefined);
    if (shown !== undefined && shown > latest) latest = shown;
  };
  for (const event of compiled.events) if (event.type === "message") visit(event.message);
  for (const conversation of compiled.initialState?.conversations ?? []) {
    for (const message of (conversation as { messages?: readonly { atMs: number; sentAt?: number }[] }).messages ?? []) visit(message);
  }
  const value = dated ? latest : compiled.nowMs;
  cache.set(compiled, value);
  return value;
}

/**
 * Status-bar clock for one rendered frame: never earlier than any bubble on screen. In a flow that
 * authors `sentAt`, the clock is the latest of the frame's `nowMs` and the display time (`sentAt`, else
 * absolute `atMs`) of every message in the frame, incoming or outgoing, so it ticks on the same frame a
 * new bubble appears. Flows without `sentAt` keep the frame's `nowMs`.
 */
export function visibleClock(nowMs: number, messages: readonly { atMs: number; sentAt?: number }[]): number {
  if (!messages.some((message) => message.sentAt !== undefined)) return nowMs;
  let latest = nowMs;
  for (const message of messages) {
    const shown = message.sentAt ?? (message.atMs > 1e11 ? message.atMs : undefined);
    if (shown !== undefined && shown > latest) latest = shown;
  }
  return latest;
}
