import type { AudioControlState, DemoFlow, PickerSelection, StickerPayload, SystemNotice } from "@/contracts";
import { applyPollVote, clonePoll } from "@/runtime/poll";
import { tapbackMotion } from "@/contracts/tapback-motion";
import {
  bubbleEffectDuration,
  cueProgress,
  macTransitions,
  messageMotion,
  pendingCueDurations,
  screenEffectDuration,
  screenTransitionDuration,
  screenTransitionKind,
} from "@/runtime/tokens";
import type {
  ConversationState,
  Cue,
  CueDetail,
  DemoSource,
  InitialConversation,
  LogicalMessage,
  LogicalState,
  OverlayState,
  Reaction,
  RuntimeDemo,
  SceneEvent,
  SceneMessage,
  VisualFrame,
} from "@/runtime/types";

type Working = {
  screen: LogicalState["screen"];
  windowActive: boolean;
  selectedConversationId: string;
  conversations: ConversationState[];
  overlay: OverlayState;
  audio: AudioControlState | null;
  timeReveal: number;
  notices: SystemNotice[];
};

type Prepared = {
  event: SceneEvent;
  index: number;
  sourceIndex: number;
  atMs: number;
};

type CueSeed = {
  id: string;
  kind: Cue["kind"];
  startedAtMs: number;
  durationMs: number;
  sourceIndex: number;
  subjectId?: string;
  transition?: Cue["transition"];
  beforeState?: LogicalState;
  detail?: CueDetail;
};

function readEvents(compiled: DemoSource): readonly SceneEvent[] {
  return compiled.events as readonly SceneEvent[];
}

function initialOf(compiled: DemoSource): RuntimeDemo["initialState"] {
  return "initialState" in compiled ? compiled.initialState : undefined;
}

function reducedMotion(compiled: DemoSource): boolean {
  return "reducedMotion" in compiled && compiled.reducedMotion === true;
}

function queryTime(timeMs: number): number {
  return Number.isFinite(timeMs) ? timeMs : 0;
}

export function effectiveSourceIndex(event: { sourceIndex?: number }, index: number): number {
  return typeof event.sourceIndex === "number" && Number.isFinite(event.sourceIndex) ? event.sourceIndex : index;
}

export function compareTimelineEvents(
  a: { atMs: number; sourceIndex: number; index: number },
  b: { atMs: number; sourceIndex: number; index: number },
): number {
  return a.atMs - b.atMs || a.sourceIndex - b.sourceIndex || a.index - b.index;
}

function prepare(events: readonly SceneEvent[]): Prepared[] {
  return events
    .map((event, index) => ({
      event,
      index,
      sourceIndex: effectiveSourceIndex(event, index),
      atMs: event.atMs,
    }))
    .filter((item) => Number.isFinite(item.atMs))
    .sort(compareTimelineEvents);
}

function copyReactions(message: SceneMessage): Reaction[] {
  return (message.reactions ?? []).map((reaction, index) => {
    const stored: Reaction = { id: reaction.id || `${message.id}:${index}`, type: reaction.type };
    if (reaction.byMe !== undefined) stored.byMe = reaction.byMe;
    if (reaction.emoji !== undefined) stored.emoji = reaction.emoji;
    return stored;
  });
}

function copyMessage(message: SceneMessage, existing: readonly LogicalMessage[]): LogicalMessage {
  const target = message.replyTo ? existing.find((item) => item.id === message.replyTo?.id) : undefined;
  const logical: LogicalMessage = {
    id: message.id,
    text: message.text,
    direction: message.direction,
    atMs: message.atMs,
    edited: message.edited ?? false,
    reactions: copyReactions(message),
    replyCount: 0,
  };
  if (message.kind !== undefined) logical.kind = message.kind;
  if (message.service !== undefined) logical.service = message.service;
  if (message.status !== undefined) logical.status = message.status;
  if (message.effect !== undefined) logical.effect = message.effect;
  if (message.link) logical.link = { ...message.link };
  if (message.attachments) logical.attachments = message.attachments.map((item) => ({ ...item }));
  if (message.images) logical.images = message.images.map((item) => ({ ...item }));
  if (message.audio) logical.audio = { ...message.audio, peaks: message.audio.peaks?.slice() };
  if (message.appCard) logical.appCard = { ...message.appCard };
  if (message.sender !== undefined) logical.sender = message.sender;
  if (message.senderId !== undefined) logical.senderId = message.senderId;
  if (message.senderInitials !== undefined) logical.senderInitials = message.senderInitials;
  if (message.senderPhoto !== undefined) logical.senderPhoto = message.senderPhoto;
  if (message.conversationId !== undefined) logical.conversationId = message.conversationId;
  if (message.system) logical.system = { ...message.system };
  if (message.facetime) logical.facetime = { ...message.facetime };
  if (message.sticker) logical.sticker = { ...message.sticker };
  if (message.stickers) logical.stickers = message.stickers.map((sticker) => ({ ...sticker }));
  if (message.video) logical.video = { ...message.video };
  if (message.poll) logical.poll = clonePoll(message.poll);
  if (message.replyTo) {
    logical.replyTo = {
      id: message.replyTo.id,
      text: message.replyTo.text ?? target?.text ?? "",
      direction: message.replyTo.direction ?? target?.direction ?? message.direction,
    };
    const service = message.replyTo.service ?? target?.service;
    if (service !== undefined) logical.replyTo.service = service;
    if (message.replyTo.sender !== undefined) logical.replyTo.sender = message.replyTo.sender;
  }
  if (message.effect === "invisible-ink") logical.revealed = message.revealed ?? false;
  if (message.readAt !== undefined) logical.readAt = message.readAt;
  if (message.sentAt !== undefined) logical.sentAt = message.sentAt;
  if (message.edited !== undefined) logical.edited = message.edited;
  return logical;
}

function emptyConversation(id: string, contact: DemoFlow["contact"]): ConversationState {
  return {
    id,
    contact: { ...contact },
    messages: [],
    draft: "",
    typing: false,
    scroll: 0,
    overlay: { kind: "closed" },
    audio: null,
    timeReveal: 0,
    notices: [],
  };
}

function convertConversation(id: string, contact: DemoFlow["contact"], conversation?: InitialConversation): ConversationState {
  const messages: LogicalMessage[] = [];
  for (const message of conversation?.messages ?? []) messages.push(copyMessage(message, messages));
  return {
    id,
    contact: { ...(conversation?.contact ?? contact) },
    messages,
    draft: conversation?.draft ?? "",
    typing: conversation?.typing ?? false,
    scroll: conversation?.scroll ?? 0,
    overlay: { kind: "closed" },
    audio: null,
    timeReveal: 0,
    notices: [],
  };
}

function createWorking(compiled: DemoSource): Working {
  const initial = initialOf(compiled);
  const selectedConversationId = initial?.selectedConversationId ?? compiled.id;
  const seeded = initial?.conversations?.length
    ? initial.conversations.map((conversation) => convertConversation(conversation.id, compiled.contact, conversation))
    : [emptyConversation(compiled.id, compiled.contact)];
  const conversations = seeded.some((conversation) => conversation.id === selectedConversationId)
    ? seeded
    : [...seeded, emptyConversation(selectedConversationId, compiled.contact)];
  return {
    screen: initial?.screen ?? compiled.screen,
    windowActive: initial?.windowActive ?? true,
    selectedConversationId,
    conversations,
    overlay: initial?.overlay ? copyOverlay(initial.overlay) : { kind: "closed" },
    audio: null,
    timeReveal: 0,
    notices: [],
  };
}

function replyCounts(messages: readonly LogicalMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (!message.replyTo) continue;
    counts.set(message.replyTo.id, (counts.get(message.replyTo.id) ?? 0) + 1);
  }
  return counts;
}

function projectConversation(conversation: ConversationState): ConversationState {
  const counts = replyCounts(conversation.messages);
  return {
    ...conversation,
    contact: { ...conversation.contact },
    messages: conversation.messages.map((message) => {
      const copy: LogicalMessage = {
        ...message,
        reactions: message.reactions.map((reaction) => ({ ...reaction })),
        replyCount: counts.get(message.id) ?? 0,
      };
      if (message.replyTo) copy.replyTo = { ...message.replyTo };
      if (message.link) copy.link = { ...message.link };
      if (message.attachments) copy.attachments = message.attachments.map((item) => ({ ...item }));
      if (message.images) copy.images = message.images.map((item) => ({ ...item }));
      if (message.audio) copy.audio = { ...message.audio, peaks: message.audio.peaks?.slice() };
      if (message.appCard) copy.appCard = { ...message.appCard };
      if (message.system) copy.system = { ...message.system };
      if (message.facetime) copy.facetime = { ...message.facetime };
      if (message.sticker) copy.sticker = { ...message.sticker };
      if (message.stickers) copy.stickers = message.stickers.map((sticker) => ({ ...sticker }));
      if (message.video) copy.video = { ...message.video };
      if (message.poll) copy.poll = clonePoll(message.poll);
      return copy;
    }),
  };
}

function finish(compiled: DemoSource, working: Working, timeMs: number): LogicalState {
  const conversations = working.conversations.map(projectConversation);
  const selected = conversations.find((conversation) => conversation.id === working.selectedConversationId) ?? conversations[0];
  return {
    timeMs,
    playing: false,
    durationMs: compiled.durationMs,
    platform: compiled.platform,
    theme: compiled.theme,
    nowMs: storyClock(conversations, compiled.nowMs),
    screen: working.screen,
    windowActive: working.windowActive,
    selectedConversationId: selected?.id ?? working.selectedConversationId,
    conversations,
    overlay: copyOverlay(working.overlay),
    contact: selected ? { ...selected.contact } : { ...compiled.contact },
    messages: selected?.messages ?? [],
    typing: selected?.typing ?? false,
    draft: selected?.draft ?? "",
    scroll: selected?.scroll ?? 0,
    audio: working.audio ? { ...working.audio } : null,
    timeReveal: working.timeReveal,
    notices: working.notices.map((notice) => ({ ...notice })),
  };
}

function updateConversation(working: Working, id: string, updater: (conversation: ConversationState) => ConversationState): Working {
  return {
    ...working,
    conversations: working.conversations.map((conversation) => (conversation.id === id ? updater(conversation) : conversation)),
  };
}

function ensureConversation(working: Working, id: string, contact: DemoFlow["contact"]): Working {
  if (working.conversations.some((conversation) => conversation.id === id)) return working;
  return { ...working, conversations: [...working.conversations, emptyConversation(id, contact)] };
}

function withContact(working: Working, id: string, contact: DemoFlow["contact"] | undefined): Working {
  if (!contact) return working;
  return updateConversation(working, id, (conversation) => ({ ...conversation, contact: { ...contact } }));
}

function hasMessage(working: Working, messageId: string): boolean {
  return working.conversations.some((conversation) => conversation.messages.some((message) => message.id === messageId));
}

function mapMessage(working: Working, messageId: string, updater: (message: LogicalMessage) => LogicalMessage): Working {
  return {
    ...working,
    conversations: working.conversations.map((conversation) => {
      if (!conversation.messages.some((message) => message.id === messageId)) return conversation;
      return {
        ...conversation,
        messages: conversation.messages.map((message) => (message.id === messageId ? updater(message) : message)),
      };
    }),
  };
}

function findMessage(working: Working, messageId: string): LogicalMessage | undefined {
  for (const conversation of working.conversations) {
    const message = conversation.messages.find((item) => item.id === messageId);
    if (message) return message;
  }
  return undefined;
}

function conversationTarget(event: SceneEvent, selected: string): string {
  if ("conversationId" in event && typeof event.conversationId === "string") return event.conversationId;
  return selected;
}

function writeSurface(working: Working, patch: Partial<Pick<ConversationState, "overlay" | "audio" | "timeReveal" | "notices">>): Working {
  const id = working.selectedConversationId;
  const next = updateConversation(working, id, (conversation) => ({ ...conversation, ...patch }));
  return { ...next, ...patch };
}

function reduceEvent(working: Working, event: SceneEvent, fallbackContact: DemoFlow["contact"]): Working {
  switch (event.type) {
    case "message": {
      const conversationId = conversationTarget(event, working.selectedConversationId);
      const ensured = ensureConversation(working, conversationId, fallbackContact);
      if (hasMessage(ensured, event.message.id)) return ensured;
      return updateConversation(ensured, conversationId, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, copyMessage(event.message, conversation.messages)],
      }));
    }
    case "typing": {
      const conversationId = conversationTarget(event, working.selectedConversationId);
      const ensured = ensureConversation(working, conversationId, fallbackContact);
      return updateConversation(ensured, conversationId, (conversation) => ({ ...conversation, typing: event.typing }));
    }
    case "draft": {
      const conversationId = conversationTarget(event, working.selectedConversationId);
      const ensured = ensureConversation(working, conversationId, fallbackContact);
      return updateConversation(ensured, conversationId, (conversation) => ({ ...conversation, draft: event.value }));
    }
    case "status":
      return mapMessage(working, event.messageId, (message) => ({ ...message, status: event.status }));
    case "reaction":
      return mapMessage(working, event.messageId, (message) => {
        if (event.reaction === null) {
          return { ...message, reactions: message.reactions.filter((reaction) => reaction.id !== event.reactionId) };
        }
        const next: Reaction = { id: event.reactionId, type: event.reaction.type };
        if (event.reaction.byMe !== undefined) next.byMe = event.reaction.byMe;
        if (event.reaction.emoji !== undefined) next.emoji = event.reaction.emoji;
        const exists = message.reactions.some((reaction) => reaction.id === event.reactionId);
        return {
          ...message,
          reactions: exists
            ? message.reactions.map((reaction) => (reaction.id === event.reactionId ? next : reaction))
            : [...message.reactions, next],
        };
      });
    case "edit":
      return mapMessage(working, event.messageId, (message) => ({ ...message, text: event.text, edited: true }));
    case "remove":
      return {
        ...working,
        conversations: working.conversations.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.filter((message) => message.id !== event.messageId),
        })),
      };
    case "reveal":
      return mapMessage(working, event.messageId, (message) => ({ ...message, revealed: event.revealed }));
    case "screen":
      return { ...working, screen: event.screen };
    case "select-conversation": {
      const ensured = ensureConversation(working, event.conversationId, event.contact ?? fallbackContact);
      const switched = { ...withContact(ensured, event.conversationId, event.contact), selectedConversationId: event.conversationId };
      const selected = switched.conversations.find((conversation) => conversation.id === event.conversationId);
      return {
        ...switched,
        overlay: selected ? copyOverlay(selected.overlay) : { kind: "closed" },
        audio: selected?.audio ? { ...selected.audio } : null,
        timeReveal: selected?.timeReveal ?? 0,
        notices: selected ? selected.notices.map((notice) => ({ ...notice })) : [],
      };
    }
    case "scroll": {
      const conversationId = conversationTarget(event, working.selectedConversationId);
      const ensured = ensureConversation(working, conversationId, fallbackContact);
      return updateConversation(ensured, conversationId, (conversation) => ({ ...conversation, scroll: event.offset }));
    }
    case "window-active":
      return { ...working, windowActive: event.active };
    case "overlay":
      return writeSurface(working, { overlay: copyOverlay(event.overlay) });
    case "screen-effect":
      return working;
    case "audio-control":
      return writeSurface(working, {
        audio: {
          messageId: event.messageId,
          position: event.position,
          playing: event.playing,
          ...(event.seeking !== undefined ? { seeking: event.seeking } : {}),
        },
      });
    case "time-reveal":
      return writeSurface(working, { timeReveal: event.progress });
    case "notice":
      return writeSurface(working, { notices: [...working.notices, { ...event.notice }] });
    case "poll-option":
      return mapMessage(working, event.messageId, (message) => {
        if (!message.poll) return message;
        if (message.poll.options.some((option) => option.id === event.optionId) || message.poll.options.length >= 12) return message;
        return {
          ...message,
          poll: { ...message.poll, options: [...message.poll.options, { id: event.optionId, text: event.text }] },
        };
      });
    case "poll-vote":
      return mapMessage(working, event.messageId, (message) => {
        if (!message.poll || !message.poll.options.some((option) => option.id === event.optionId)) return message;
        const votes = applyPollVote(
          message.poll.votes ?? [],
          { participantId: event.participantId, optionId: event.optionId, atMs: event.atMs },
          event.voted,
          message.poll.selectionMode ?? "multiple",
        );
        return { ...message, poll: { ...message.poll, votes } };
      });
    case "sticker":
      return mapMessage(working, event.messageId, (message) => {
        if (event.sticker === null) return { ...message, stickers: [] };
        const next: StickerPayload = { ...event.sticker };
        const stickers = message.stickers ?? [];
        if (stickers.some((sticker) => sticker.id === next.id)) return message;
        return { ...message, stickers: [...stickers, next] };
      });
    default:
      return working;
  }
}

function messageCueDuration(direction: LogicalMessage["direction"], reduced: boolean): number {
  const motion = messageMotion();
  if (reduced) return motion.reduced.duration;
  return direction === "outgoing" ? motion.send.duration : motion.receive.duration;
}

function overlayMotion(overlay: OverlayState, phase: "enter" | "exit"): number {
  switch (overlay.kind) {
    case "closed":
      return 0;
    case "context-menu":
      return phase === "enter" ? macTransitions().menu.open : pendingCueDurations.contextMenuExit;
    case "plus-menu":
      return phase === "enter" ? pendingCueDurations.plusMenuEnter : pendingCueDurations.plusMenuExit;
    case "thread":
      return phase === "enter" ? pendingCueDurations.threadEnter : pendingCueDurations.threadExit;
    case "long-press":
      return phase === "enter" ? pendingCueDurations.longPressEnter : pendingCueDurations.longPressExit;
    case "effects-picker":
      return phase === "enter" ? pendingCueDurations.effectsPickerEnter : pendingCueDurations.effectsPickerExit;
    case "image-viewer":
      return pendingCueDurations.imageViewer;
    case "details":
      return phase === "enter" ? pendingCueDurations.detailsEnter : pendingCueDurations.detailsExit;
    case "photo-picker":
      return phase === "enter" ? pendingCueDurations.photoPickerEnter : pendingCueDurations.photoPickerExit;
    case "selection":
      return phase === "enter" ? pendingCueDurations.selectionEnter : pendingCueDurations.selectionExit;
    case "search":
    case "recorder":
    case "tapback-details":
    case "sticker-picker":
    case "poll-details":
      return phase === "enter" ? pendingCueDurations.plusMenuEnter : pendingCueDurations.plusMenuExit;
  }
}

function copyOverlay(overlay: OverlayState): OverlayState {
  switch (overlay.kind) {
    case "closed":
      return { kind: "closed" };
    case "plus-menu":
      return { kind: "plus-menu" };
    case "thread":
      return { kind: "thread", rootId: overlay.rootId };
    case "long-press":
      return copyLongPress(overlay);
    case "context-menu":
      return { kind: "context-menu", messageId: overlay.messageId, x: overlay.x, y: overlay.y };
    case "effects-picker":
      return {
        kind: "effects-picker",
        tab: overlay.tab,
        draft: overlay.draft,
        ...(overlay.effect !== undefined ? { effect: overlay.effect } : {}),
      };
    case "image-viewer":
      return {
        kind: "image-viewer",
        messageId: overlay.messageId,
        index: overlay.index,
        ...(overlay.zoom !== undefined ? { zoom: overlay.zoom } : {}),
        ...(overlay.chrome !== undefined ? { chrome: overlay.chrome } : {}),
        ...(overlay.dismiss !== undefined ? { dismiss: overlay.dismiss } : {}),
      };
    case "details":
      return { kind: "details" };
    case "photo-picker":
      return {
        kind: "photo-picker",
        ...(overlay.selectedId !== undefined ? { selectedId: overlay.selectedId } : {}),
        ...(overlay.selectedIds ? { selectedIds: [...overlay.selectedIds] } : {}),
        ...(overlay.detent ? { detent: overlay.detent } : {}),
      };
    case "selection":
      return { kind: "selection", messageIds: [...overlay.messageIds] };
    case "search":
      return { kind: "search", query: overlay.query };
    case "recorder":
      return {
        kind: "recorder",
        state: overlay.state,
        ...(overlay.position !== undefined ? { position: overlay.position } : {}),
        ...(overlay.duration !== undefined ? { duration: overlay.duration } : {}),
      };
    case "tapback-details":
      return {
        kind: "tapback-details",
        messageId: overlay.messageId,
        ...(overlay.filter !== undefined ? { filter: overlay.filter } : {}),
      };
    case "sticker-picker":
      return { kind: "sticker-picker", ...(overlay.tab ? { tab: overlay.tab } : {}) };
    case "poll-details":
      return { kind: "poll-details", messageId: overlay.messageId };
  }
}

function copyLongPress(overlay: Extract<OverlayState, { kind: "long-press" }>): OverlayState {
  const copy: Extract<OverlayState, { kind: "long-press" }> = { kind: "long-press", messageId: overlay.messageId };
  if (overlay.selected === null) copy.selected = null;
  else if (overlay.selected) copy.selected = copyPickerSelection(overlay.selected);
  return copy;
}

function copyPickerSelection(selected: PickerSelection): PickerSelection {
  return "emoji" in selected ? { emoji: selected.emoji } : { type: selected.type };
}

function selectionKey(selected: PickerSelection | null | undefined): string {
  if (selected === undefined) return "absent";
  if (selected === null) return "null";
  return "emoji" in selected ? `emoji:${selected.emoji}` : `type:${selected.type}`;
}

/** Long-press identity is the message. A selection update is not a close/reopen. */
function sameOverlay(left: OverlayState, right: OverlayState): boolean {
  if (left.kind === "long-press" && right.kind === "long-press") return left.messageId === right.messageId;
  return JSON.stringify(copyOverlay(left)) === JSON.stringify(copyOverlay(right));
}

function longPressSelectionUpdate(left: OverlayState, right: OverlayState): boolean {
  return left.kind === "long-press"
    && right.kind === "long-press"
    && left.messageId === right.messageId
    && selectionKey(left.selected) !== selectionKey(right.selected);
}

function seed(partial: CueSeed): CueSeed | null {
  if (!(partial.durationMs > 0)) return null;
  return partial;
}

function cuesFor(
  compiled: DemoSource,
  working: Working,
  prepared: Prepared,
  origin: LogicalState,
  gesture: { current: { messageId: string; startedAtMs: number } | null },
): CueSeed[] {
  const event = prepared.event;
  const seeds: Array<CueSeed | null> = [];
  const stamp = { startedAtMs: prepared.atMs, sourceIndex: prepared.sourceIndex };
  if (event.type === "message" && !hasMessage(working, event.message.id)) {
    const durationMs = messageCueDuration(event.message.direction, reducedMotion(compiled));
    const kind = event.message.direction === "outgoing" ? "send" : "receive";
    seeds.push(seed({
      ...stamp,
      id: `${kind}:${event.message.id}:${prepared.atMs}:${prepared.sourceIndex}`,
      kind,
      durationMs,
      subjectId: event.message.id,
      detail: { direction: event.message.direction, effect: event.message.effect },
    }));
    if (event.message.effect) {
      const effectDuration = bubbleEffectDuration(event.message.effect);
      seeds.push(seed({
        ...stamp,
        id: `bubble-effect:${event.message.id}:${prepared.atMs}:${prepared.sourceIndex}`,
        kind: "bubble-effect",
        durationMs: effectDuration,
        subjectId: event.message.id,
        detail: { effect: event.message.effect, direction: event.message.direction },
      }));
    }
  }
  if (event.type === "reaction" && findMessage(working, event.messageId)) {
    const previous = findMessage(working, event.messageId)?.reactions.find((reaction) => reaction.id === event.reactionId) ?? null;
    const next = event.reaction === null ? null : { id: event.reactionId, ...event.reaction };
    seeds.push(seed({
      ...stamp,
      id: `reaction:${event.reactionId}:${prepared.atMs}:${prepared.sourceIndex}`,
      kind: "reaction",
      durationMs: next ? tapbackMotion.reactionLandingMs : messageMotion().reaction,
      subjectId: event.messageId,
      detail: { reactionId: event.reactionId, reaction: next, previousReaction: previous ? { ...previous } : null },
    }));
  }
  if (event.type === "screen" && compiled.platform === "ios") {
    const kind = screenTransitionKind(working.screen, event.screen);
    if (kind) {
      seeds.push(seed({
        ...stamp,
        id: `screen:${kind}:${prepared.atMs}:${prepared.sourceIndex}`,
        kind: "screen",
        durationMs: screenTransitionDuration(kind),
        transition: kind,
        beforeState: origin,
        detail: { fromScreen: working.screen, toScreen: event.screen },
      }));
    }
  }
  if (event.type === "select-conversation" && compiled.platform === "macos" && event.conversationId !== working.selectedConversationId) {
    const mac = macTransitions();
    seeds.push(seed({
      ...stamp,
      id: `conversation:${event.conversationId}:${prepared.atMs}:${prepared.sourceIndex}`,
      kind: "conversation",
      durationMs: mac.conversation.duration,
      subjectId: event.conversationId,
      beforeState: origin,
      detail: { fromConversationId: working.selectedConversationId, toConversationId: event.conversationId },
    }));
    seeds.push(seed({
      ...stamp,
      id: `selection-text:${event.conversationId}:${prepared.atMs}:${prepared.sourceIndex}`,
      kind: "selection-text",
      durationMs: mac.selection.text,
      subjectId: event.conversationId,
      detail: { fromConversationId: working.selectedConversationId, toConversationId: event.conversationId },
    }));
  }
  if (event.type === "overlay" && longPressSelectionUpdate(working.overlay, event.overlay)) {
    const messageId = event.overlay.kind === "long-press" ? event.overlay.messageId : undefined;
    seeds.push(seed({
      ...stamp,
      id: `overlay-select:${messageId ?? "long-press"}:${prepared.atMs}:${prepared.sourceIndex}`,
      kind: "overlay-select",
      durationMs: tapbackMotion.selectionFeedbackMs,
      subjectId: messageId,
      detail: {
        overlay: copyOverlay(event.overlay),
        ...(gesture.current ? { longPressEntranceStartedAtMs: gesture.current.startedAtMs } : {}),
      },
    }));
  } else if (event.type === "overlay" && !sameOverlay(working.overlay, event.overlay)) {
    if (working.overlay.kind !== "closed") {
      const entranceStarted = working.overlay.kind === "long-press" ? gesture.current?.startedAtMs : undefined;
      seeds.push(seed({
        ...stamp,
        id: `overlay-exit:${working.overlay.kind}:${prepared.atMs}:${prepared.sourceIndex}`,
        kind: "overlay-exit",
        durationMs: overlayMotion(working.overlay, "exit"),
        subjectId: "rootId" in working.overlay ? working.overlay.rootId : "messageId" in working.overlay ? working.overlay.messageId : working.overlay.kind,
        beforeState: origin,
        detail: {
          overlay: copyOverlay(working.overlay),
          ...(entranceStarted !== undefined ? { longPressEntranceStartedAtMs: entranceStarted } : {}),
        },
      }));
    }
    if (event.overlay.kind !== "closed") {
      seeds.push(seed({
        ...stamp,
        id: `overlay-enter:${event.overlay.kind}:${prepared.atMs}:${prepared.sourceIndex}`,
        kind: "overlay-enter",
        durationMs: overlayMotion(event.overlay, "enter"),
        subjectId: "rootId" in event.overlay ? event.overlay.rootId : "messageId" in event.overlay ? event.overlay.messageId : event.overlay.kind,
        detail: { overlay: copyOverlay(event.overlay) },
      }));
    }
    if (event.overlay.kind === "long-press") gesture.current = { messageId: event.overlay.messageId, startedAtMs: prepared.atMs };
    else gesture.current = null;
  }
  if (event.type === "screen-effect") {
    seeds.push(seed({
      ...stamp,
      id: `screen-effect:${event.effect}:${prepared.atMs}:${prepared.sourceIndex}`,
      kind: "screen-effect",
      durationMs: screenEffectDuration(event.effect),
      subjectId: event.messageId,
      detail: { effect: event.effect },
    }));
  }
  return seeds.filter((item): item is CueSeed => item !== null);
}

function projectAt(compiled: DemoSource, timeMs: number): { state: LogicalState; seeds: CueSeed[] } {
  const t = queryTime(timeMs);
  let working = createWorking(compiled);
  const seeds: CueSeed[] = [];
  const gesture: { current: { messageId: string; startedAtMs: number } | null } = {
    current: working.overlay.kind === "long-press" ? { messageId: working.overlay.messageId, startedAtMs: 0 } : null,
  };
  for (const prepared of prepare(readEvents(compiled))) {
    if (prepared.atMs > t) break;
    const origin = finish(compiled, working, prepared.atMs);
    seeds.push(...cuesFor(compiled, working, prepared, origin, gesture));
    working = reduceEvent(working, prepared.event, compiled.contact);
  }
  return { state: finish(compiled, working, t), seeds };
}

function activate(seeds: CueSeed[], timeMs: number): Cue[] {
  const cues: Cue[] = [];
  for (const item of seeds) {
    const elapsedMs = timeMs - item.startedAtMs;
    const progress = cueProgress(elapsedMs, item.durationMs);
    if (progress === null) continue;
    const cue: Cue = {
      id: item.id,
      kind: item.kind,
      startedAtMs: item.startedAtMs,
      elapsedMs,
      durationMs: item.durationMs,
      progress,
      sourceIndex: item.sourceIndex,
    };
    if (item.subjectId !== undefined) cue.subjectId = item.subjectId;
    if (item.transition !== undefined) cue.transition = item.transition;
    if (item.beforeState !== undefined) cue.beforeState = item.beforeState;
    if (item.detail !== undefined) cue.detail = item.detail;
    cues.push(cue);
  }
  return cues;
}

export function frameAt(compiled: DemoSource, timeMs: number): VisualFrame {
  const t = queryTime(timeMs);
  const { state, seeds } = projectAt(compiled, t);
  const cues = activate(seeds, t).filter((cue) => cueHolds(state, cue));
  const cached = cues.filter((cue) => cue.beforeState !== undefined);
  const beforeState = cached.length > 0 ? cached[cached.length - 1].beforeState ?? null : null;
  return { ...state, cues, beforeState };
}

export function stateAt(compiled: DemoSource, timeMs: number): LogicalState {
  const frame = frameAt(compiled, timeMs);
  const { cues: _cues, beforeState: _beforeState, ...state } = frame;
  return state;
}

export function logicalState(frame: VisualFrame): LogicalState {
  const { cues: _cues, beforeState: _beforeState, ...state } = frame;
  return state;
}

function cueHolds(state: LogicalState, cue: Cue): boolean {
  if (cue.kind !== "send" && cue.kind !== "receive" && cue.kind !== "bubble-effect" && cue.kind !== "reaction") return true;
  if (!cue.subjectId) return false;
  return state.conversations.some((conversation) => conversation.messages.some((message) => message.id === cue.subjectId));
}

/**
 * The device clock at this point of the story. A flow that authors `sentAt` wall-clock times advances
 * the status bar to the newest arrived message's display time (its `sentAt`, else its absolute `atMs`)
 * once it passes the flow's `nowMs` (the opening clock), so the clock moves with the story and never
 * reads earlier than the latest visible timestamp. Flows without any `sentAt` keep their fixed `nowMs`.
 */
function storyClock(conversations: ConversationState[], nowMs: number): number {
  const dated = conversations.some((conversation) => conversation.messages.some((message) => message.sentAt !== undefined));
  if (!dated) return nowMs;
  let latest = nowMs;
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const shown = message.sentAt ?? (message.atMs > 1e11 ? message.atMs : undefined);
      if (shown !== undefined && shown > latest) latest = shown;
    }
  }
  return latest;
}
