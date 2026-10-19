/** Pin the log to the end of the authored transcript. A short log stays at 0. */
export function checkpointScrollTop(list: HTMLElement): number {
  return Math.max(0, list.scrollHeight - list.clientHeight);
}

/**
 * Write the checkpoint after layout. `overflow-anchor: none` stops the browser from keeping a stale
 * offset when a reverse seek does not change the message count.
 */
export function applyCheckpointScroll(root: ParentNode, liftPx = 0): number {
  const list = root.querySelector<HTMLElement>('[data-slot="message-list"]');
  if (!list) return 0;
  list.style.overflowAnchor = "none";
  const lift = Number.isFinite(liftPx) ? Math.max(0, liftPx) : 0;
  const maxScroll = checkpointScrollTop(list);
  const scrollLift = Math.min(lift, maxScroll);
  const target = maxScroll - scrollLift;
  if (list.scrollTop !== target) list.scrollTop = target;
  const content = list.querySelector<HTMLElement>('[data-slot="message-list-content"]');
  if (content) {
    const remainder = lift - scrollLift;
    content.style.transform = remainder > 0 ? `translateY(${remainder}px)` : "";
  }
  return list.scrollTop;
}

/** Arrival id for the typing balloon appearing at the end of the log. */
export const TYPING_ARRIVAL = "\u0000typing";

/** How long the log takes to follow a new arrival to the bottom, like UIKit's animated scroll. */
export const arrivalFollowMs = 380;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Extra lift that eases the log toward its new bottom after an arrival instead of cutting to it.
 * Seek-deterministic: the distance is measured from the arriving row itself (and, when the
 * arrival replaces the typing balloon at the same instant, net of that balloon), then scaled by
 * the remaining eased progress. Capped by the real scroll range, so a short top-anchored log
 * that never scrolls is untouched.
 */
export function arrivalFollowLift(root: ParentNode, arrival: { id: string; elapsedMs: number; replacesTyping: boolean } | null): number {
  if (!arrival || arrival.elapsedMs < 0 || arrival.elapsedMs >= arrivalFollowMs) return 0;
  const list = root.querySelector<HTMLElement>('[data-slot="message-list"]');
  const row = arrival.id === TYPING_ARRIVAL
    ? list?.querySelector<HTMLElement>('[data-slot="message-row"][data-typing="true"]')
    : list?.querySelector<HTMLElement>(`[data-slot="message-row"][data-message-id="${CSS.escape(arrival.id)}"]`);
  if (!list || !row) return 0;
  const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-slot="message-row"]'));
  const previous = rows[rows.indexOf(row) - 1];
  const box = row.getBoundingClientRect();
  const gap = previous ? Math.max(0, box.top - previous.getBoundingClientRect().bottom) : 0;
  const balloon = 35;
  const growth = arrival.replacesTyping ? box.height - balloon : box.height + gap;
  if (!(growth > 0)) return 0;
  const reach = Math.min(growth, checkpointScrollTop(list));
  return reach * (1 - easeOutCubic(arrival.elapsedMs / arrivalFollowMs));
}
