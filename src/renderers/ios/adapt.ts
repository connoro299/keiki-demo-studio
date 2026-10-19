import type { DemoMessage } from "@/contracts";
import type { Message } from "@/components/imessage/message-list";

/**
 * Canonical / runtime messages may carry a computed `replyCount`.
 * Do not invent one here — only forward it when present.
 */
export type AdaptableMessage = DemoMessage & { replyCount?: number };

/**
 * Map a frozen demo message onto the pinned `Message`.
 * `sentAt` stays a number. Typing is not a row.
 * Reaction ids stay on the canonical message; the pin only gets type/byMe/emoji.
 * Optional fields are set only when the source has them.
 */
export function toUpstreamMessage(message: AdaptableMessage): Message {
  if (message.kind === "app-card") {
    // The pinned list has no live-card row. It lays out a plain row for the card's place in its
    // cluster; `AppCardLayer` hides that row's contents and docks the checkout iframe in it.
    return { id: message.id, text: message.text, direction: message.direction, sentAt: message.sentAt ?? message.atMs };
  }
  if (message.kind === "poll") {
    // The pinned list has no poll row. Keep the real message id and dock the renderer-owned poll
    // into this row. The placeholder bubble is hidden by PollLayer.
    const row: Message = { id: message.id, text: "", direction: message.direction, sentAt: message.sentAt ?? message.atMs };
    if (message.sender) row.sender = message.sender;
    if (message.senderInitials) row.senderInitials = message.senderInitials;
    if (message.senderPhoto) row.senderPhoto = message.senderPhoto;
    return row;
  }
  const owned = message.kind === "facetime" || message.kind === "sticker";
  const upstream: Message = {
    id: message.id,
    text: message.text,
    direction: message.direction,
    sentAt: message.sentAt ?? message.atMs,
  };
  if (message.sender) upstream.sender = message.sender;
  if (message.senderInitials) upstream.senderInitials = message.senderInitials;
  if (message.senderPhoto) upstream.senderPhoto = message.senderPhoto;
  if (message.kind === "system" && message.system) {
    upstream.kind = "system";
    upstream.system = message.system;
    return upstream;
  }
  if (owned) return upstream;
  if (message.service) upstream.service = message.service;
  if (message.status) upstream.status = message.status;
  if (
    message.kind === "text" ||
    message.kind === "link" ||
    message.kind === "attachment" ||
    message.kind === "image" ||
    message.kind === "audio"
  ) {
    upstream.kind = message.kind;
  }
  if (message.effect) upstream.effect = message.effect;
  if (message.edited) upstream.edited = message.edited;
  if (message.readAt !== undefined) upstream.readAt = message.readAt;
  if (message.replyCount !== undefined) upstream.replyCount = message.replyCount;
  if (message.replyTo) {
    upstream.replyTo = {
      id: message.replyTo.id,
      text: message.replyTo.text,
      direction: message.replyTo.direction,
      ...(message.replyTo.service ? { service: message.replyTo.service } : {}),
      ...(message.replyTo.sender ? { sender: message.replyTo.sender } : {}),
    };
  }
  if (message.reactions?.length) {
    upstream.reactions = message.reactions.map(({ type, byMe, emoji }) => ({
      type,
      ...(byMe !== undefined ? { byMe } : {}),
      ...(emoji !== undefined ? { emoji } : {}),
    }));
  }
  if (message.link) {
    upstream.link = {
      url: message.link.url,
      ...(message.link.title ? { title: message.link.title } : {}),
      ...(message.link.host ? { host: message.link.host } : {}),
      ...(message.link.image ? { image: message.link.image } : {}),
    };
  }
  if (message.attachments) {
    upstream.attachments = message.attachments.map((file) => ({
      name: file.name,
      ...(file.size ? { size: file.size } : {}),
      ...(file.href ? { href: file.href } : {}),
    }));
  }
  if (message.images) {
    upstream.images = message.images.map((image) => ({
      src: image.src,
      alt: image.alt,
      ...(image.width !== undefined ? { width: image.width } : {}),
      ...(image.height !== undefined ? { height: image.height } : {}),
    }));
  }
  if (message.audio) {
    upstream.audio = {
      duration: message.audio.duration,
      ...(message.audio.peaks ? { peaks: message.audio.peaks } : {}),
    };
  }
  return upstream;
}
