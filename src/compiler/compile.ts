import { validateSheetSpec, type SheetValidationContext } from "@/generator/sheet-request";
import type { CompiledDemo, CompiledEvent, DemoChannel, DemoFlow, DemoMessage, OverlayState, PickerSelection, Reaction } from "@/contracts";
import { tapbackMotion } from "@/contracts/tapback-motion";
import { clonePoll, POLL_VOTE_SETTLE_MS } from "@/runtime/poll";
import { arrivalWindow } from "./motion";

function copyContact(contact: DemoFlow["contact"]): DemoFlow["contact"] {
  const copy: DemoFlow["contact"] = { name: contact.name };
  if (contact.initials !== undefined) copy.initials = contact.initials;
  if (contact.photo !== undefined) copy.photo = contact.photo;
  if (contact.silhouette !== undefined) copy.silhouette = contact.silhouette;
  return copy;
}

function replyOf(message: DemoMessage, messages: readonly DemoMessage[]): DemoMessage["replyTo"] {
  const reply = message.replyTo as DemoMessage["replyTo"] | string | undefined;
  if (reply === undefined) return undefined;
  if (typeof reply === "string") {
    const target = messages.find((item) => item.id === reply);
    if (!target) return undefined;
    return { id: target.id, text: target.text, direction: target.direction };
  }
  return {
    id: reply.id,
    text: reply.text,
    direction: reply.direction,
    ...(reply.service !== undefined ? { service: reply.service } : {}),
    ...(reply.sender !== undefined ? { sender: reply.sender } : {}),
  };
}

function copyMessage(message: DemoMessage, messages: readonly DemoMessage[]): DemoMessage {
  const copy: DemoMessage = {
    id: message.id,
    text: message.text,
    direction: message.direction,
    atMs: message.atMs,
  };
  if (message.kind !== undefined) copy.kind = message.kind;
  if (message.service !== undefined) copy.service = message.service;
  if (message.status !== undefined) copy.status = message.status;
  if (message.effect !== undefined) copy.effect = message.effect;
  if (message.link !== undefined) {
    const link: NonNullable<DemoMessage["link"]> = { url: message.link.url };
    if (message.link.title !== undefined) link.title = message.link.title;
    if (message.link.host !== undefined) link.host = message.link.host;
    if (message.link.image !== undefined) link.image = message.link.image;
    copy.link = link;
  }
  if (message.attachments !== undefined) {
    copy.attachments = message.attachments.map((item) => {
      const attachment: NonNullable<DemoMessage["attachments"]>[number] = { name: item.name };
      if (item.size !== undefined) attachment.size = item.size;
      if (item.href !== undefined) attachment.href = item.href;
      return attachment;
    });
  }
  if (message.images !== undefined) {
    copy.images = message.images.map((item) => {
      const image: NonNullable<DemoMessage["images"]>[number] = { src: item.src, alt: item.alt };
      if (item.width !== undefined) image.width = item.width;
      if (item.height !== undefined) image.height = item.height;
      return image;
    });
  }
  if (message.audio !== undefined) {
    const audio: NonNullable<DemoMessage["audio"]> = { duration: message.audio.duration };
    if (message.audio.peaks !== undefined) audio.peaks = [...message.audio.peaks];
    if (message.audio.src !== undefined) audio.src = message.audio.src;
    copy.audio = audio;
  }
  if (message.sender !== undefined) copy.sender = message.sender;
  if (message.senderId !== undefined) copy.senderId = message.senderId;
  if (message.senderInitials !== undefined) copy.senderInitials = message.senderInitials;
  if (message.senderPhoto !== undefined) copy.senderPhoto = message.senderPhoto;
  if (message.conversationId !== undefined) copy.conversationId = message.conversationId;
  if (message.system !== undefined) copy.system = { ...message.system };
  if (message.facetime !== undefined) copy.facetime = { ...message.facetime };
  if (message.sticker !== undefined) copy.sticker = { ...message.sticker };
  if (message.stickers !== undefined) copy.stickers = message.stickers.map((sticker) => ({ ...sticker }));
  if (message.video !== undefined) copy.video = { ...message.video };
  if (message.poll !== undefined) copy.poll = clonePoll(message.poll);
  if (message.appCard !== undefined) {
    const appCard: NonNullable<DemoMessage["appCard"]> = { url: message.appCard.url, live: true, app: message.appCard.app };
    if (message.appCard.sheet) appCard.sheet = structuredClone(message.appCard.sheet);
    if (message.appCard.layout) appCard.layout = { ...message.appCard.layout };
    if (message.appCard.height !== undefined) appCard.height = message.appCard.height;
    copy.appCard = appCard;
  }
  const reply = replyOf(message, messages);
  if (reply) copy.replyTo = reply;
  const ownReactions = (message.reactions ?? []).filter((reaction) => {
    const target = (reaction as Reaction & { messageId?: string; targetId?: string }).messageId
      ?? (reaction as Reaction & { targetId?: string }).targetId;
    return target === undefined || target === message.id;
  });
  if (ownReactions.length > 0) {
    copy.reactions = ownReactions.map((reaction, index) => {
      const stored: Reaction = { id: reaction.id || `${message.id}:${index}`, type: reaction.type };
      if (reaction.byMe !== undefined) stored.byMe = reaction.byMe;
      if (reaction.emoji !== undefined) stored.emoji = reaction.emoji;
      return stored;
    });
  }
  if (message.edited !== undefined) copy.edited = message.edited;
  if (message.readAt !== undefined) copy.readAt = message.readAt;
  if (message.sentAt !== undefined) copy.sentAt = message.sentAt;
  if (message.revealed !== undefined) copy.revealed = message.revealed;
  return copy;
}

function copyEvent(event: CompiledEvent, baseline: number): CompiledEvent {
  const atMs = event.atMs - baseline;
  switch (event.type) {
    case "message":
      return { ...event, atMs, message: copyMessage(event.message, [event.message]) };
    case "typing":
      return { type: "typing", atMs, typing: event.typing, ...(event.sourceIndex !== undefined ? { sourceIndex: event.sourceIndex } : {}), ...(event.conversationId !== undefined ? { conversationId: event.conversationId } : {}) };
    case "draft":
      return { type: "draft", atMs, value: event.value, ...(event.sourceIndex !== undefined ? { sourceIndex: event.sourceIndex } : {}), ...(event.conversationId !== undefined ? { conversationId: event.conversationId } : {}) };
    case "reaction":
      return {
        ...event,
        atMs,
        reaction: event.reaction === null ? null : { ...event.reaction },
      };
    case "overlay":
      return { ...event, atMs, overlay: copyOverlay(event.overlay) };
    case "notice":
      return { ...event, atMs, notice: { ...event.notice } };
    default:
      return { ...event, atMs };
  }
}

function copyPickerSelection(selected: PickerSelection): PickerSelection {
  return "emoji" in selected ? { emoji: selected.emoji } : { type: selected.type };
}

function copyOverlay(overlay: OverlayState): OverlayState {
  if (overlay.kind === "selection") return { kind: "selection", messageIds: [...overlay.messageIds] };
  if (overlay.kind !== "long-press") return { ...overlay };
  const copy: Extract<OverlayState, { kind: "long-press" }> = { kind: "long-press", messageId: overlay.messageId };
  if (overlay.selected === null) copy.selected = null;
  else if (overlay.selected) copy.selected = copyPickerSelection(overlay.selected);
  return copy;
}

function selectionKey(selected: PickerSelection | null | undefined): string {
  if (selected === undefined) return "absent";
  if (selected === null) return "null";
  return "emoji" in selected ? `emoji:${selected.emoji}` : `type:${selected.type}`;
}

export function compileDemo(demo: DemoFlow, context?: SheetValidationContext): CompiledDemo {
  for (const message of [...demo.messages, ...(demo.events ?? []).flatMap(e => e.type === "message" ? [e.message] : [])]) if (message.appCard?.app === 'sheet') {
    const errors = validateSheetSpec(message.appCard.sheet, context);
    if (errors.length) throw new Error(errors.join(' '));
  }
  const baseline = demo.startAtMs ?? demo.messages[0]?.atMs ?? demo.events?.[0]?.atMs ?? 0;
  const events: CompiledDemo["events"] = [];
  let durationMs = 0;
  let openLongPress: { messageId: string; selectedKey: string } | null = null;

  for (const message of demo.messages) {
    if (message.removed === true) continue;
    const atMs = message.atMs - baseline;
    const copied = copyMessage(message, demo.messages);
    delete copied.removed;
    events.push({
      type: "message",
      atMs,
      message: copied,
      ...(message.conversationId ? { conversationId: message.conversationId } : {}),
    });
    durationMs = Math.max(durationMs, atMs);
    const window = arrivalWindow(message);
    if (window) durationMs = Math.max(durationMs, window.end - baseline);
  }

  for (const event of demo.events ?? []) {
    const copied = copyEvent(event, baseline);
    events.push(copied);
    durationMs = Math.max(durationMs, copied.atMs);
    if (copied.type === "sheet-app") durationMs = Math.max(durationMs, copied.atMs + (copied.action === "close" ? 2300 : 500));
    if (copied.type === "poll-vote") durationMs = Math.max(durationMs, copied.atMs + POLL_VOTE_SETTLE_MS);
    if (copied.type === "reaction" && copied.reaction) {
      durationMs = Math.max(durationMs, copied.atMs + tapbackMotion.reactionLandingMs);
    }
    if (copied.type !== "overlay") continue;
    if (copied.overlay.kind === "long-press") {
      const nextKey = selectionKey(copied.overlay.selected);
      if (openLongPress && openLongPress.messageId === copied.overlay.messageId) {
        if (openLongPress.selectedKey !== nextKey) {
          durationMs = Math.max(durationMs, copied.atMs + tapbackMotion.selectionFeedbackMs);
        }
        openLongPress = { messageId: copied.overlay.messageId, selectedKey: nextKey };
      } else {
        if (openLongPress) durationMs = Math.max(durationMs, copied.atMs + tapbackMotion.exitMs);
        durationMs = Math.max(durationMs, copied.atMs + tapbackMotion.entranceMs);
        openLongPress = { messageId: copied.overlay.messageId, selectedKey: nextKey };
      }
    } else if (openLongPress) {
      durationMs = Math.max(durationMs, copied.atMs + tapbackMotion.exitMs);
      openLongPress = null;
    }
  }

  // Initialization shares time zero with authored events. Give it an earlier source
  // index so playback applies it first and an authored value at the same instant wins.
  // Authored events keep the order they were compiled in.
  let earliest = 0;
  events.forEach((event, index) => {
    const source = typeof event.sourceIndex === "number" && Number.isFinite(event.sourceIndex) ? event.sourceIndex : index;
    if (source < earliest) earliest = source;
  });
  events.push({ type: "draft", atMs: 0, value: demo.draft, sourceIndex: earliest - 2 });
  events.push({ type: "typing", atMs: 0, typing: demo.typing, sourceIndex: earliest - 1 });

  // A final checkout needs time to settle and present the recorded visual sheet during Play.
  const lastMessage = events.filter(event => event.type === "message").sort((a, b) => a.atMs - b.atMs).at(-1);
  if (lastMessage?.message.kind === "app-card") durationMs = Math.max(durationMs, lastMessage.atMs + 5000);

  if (demo.channel === "sms") defaultSmsService(events);

  return {
    id: demo.id,
    platform: demo.platform,
    ...(demo.channel ? { channel: demo.channel } : {}),
    theme: demo.theme,
    durationMs,
    contact: copyContact(demo.contact),
    nowMs: demo.nowMs,
    screen: demo.screen,
    events,
    ...(demo.participants ? { participants: demo.participants.map((person) => ({ ...person })) } : {}),
    ...(demo.group ? { group: { ...demo.group } } : {}),
    ...(demo.conversations ? { conversations: demo.conversations.map((conversation) => ({ ...conversation, contact: { ...conversation.contact } })) } : {}),
    ...(demo.selectedConversationId ? { selectedConversationId: demo.selectedConversationId } : {}),
    ...(demo.library ? { library: demo.library.map((photo) => ({ ...photo })) } : {}),
  };
}

/** SMS wears the Messages UI as green bubbles: every message without an explicit service is SMS. */
function defaultSmsService(events: CompiledEvent[]): void {
  events.forEach((event, index) => {
    if (event.type === "message" && event.message.service === undefined) {
      events[index] = { ...event, message: { ...event.message, service: "sms" } };
    }
  });
}

/**
 * View an already compiled demo in another channel (the player's channel switcher and `?channel=`).
 * Returns the same object when nothing changes so memoized players stay stable.
 */
export function applyChannel(compiled: CompiledDemo, channel: DemoChannel | undefined): CompiledDemo {
  if (channel === undefined || channel === (compiled.channel ?? "imessage")) return compiled;
  const events = [...compiled.events];
  if (channel === "sms") defaultSmsService(events);
  return { ...compiled, channel, events };
}
