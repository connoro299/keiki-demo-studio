import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demoFlowSchema, demoMessageSchema, type ValidationIssue } from "@/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FLOW_KEYS = ["id", "title", "platform", "channel", "theme", "contact", "nowMs", "startAtMs", "draft", "typing", "screen", "messages", "events", "participants", "group", "conversations", "selectedConversationId", "library"] as const;
const CONTACT_KEYS = ["name", "initials", "photo", "silhouette"] as const;
const MESSAGE_KEYS = ["id", "text", "direction", "atMs", "kind", "service", "status", "effect", "link", "attachments", "images", "audio", "appCard", "reactions", "replyTo", "edited", "readAt", "sentAt", "revealed", "removed", "sender", "senderId", "senderInitials", "senderPhoto", "conversationId", "system", "facetime", "sticker", "stickers", "poll", "video"] as const;
const LINK_KEYS = ["url", "title", "host", "image"] as const;
const ATTACHMENT_KEYS = ["name", "size", "href"] as const;
const REACTION_KEYS = ["id", "type", "byMe", "emoji", "messageId", "targetId"] as const;
const IMAGE_KEYS = ["src", "alt", "width", "height"] as const;
const AUDIO_KEYS = ["duration", "peaks", "src"] as const;
const APP_CARD_KEYS = ["url", "live", "app", "height"] as const;

const LOCAL_PNG = /^\/demo-assets\/[a-z0-9-]+\.png$/;
const ANIMATED = /\.(gif|apng|webp|mp4|m4v|mov|webm|avi)(?:$|\?)/i;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unrecognized(key: string): string {
  return `Unrecognized key: "${key}"`;
}

function pushExtras(issues: ValidationIssue[], base: string, value: unknown, allowed: readonly string[]) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value).sort()) {
    if (!allowed.includes(key)) {
      issues.push({ path: base ? `${base}.${key}` : key, message: unrecognized(key) });
    }
  }
}

function escapesAsset(src: string): boolean {
  const lower = src.toLowerCase();
  return src.includes("..") || src.includes("\\") || lower.includes("%2e") || lower.startsWith("file:") || src.startsWith("//");
}

function isDiagnosedAttachmentHref(value: string): boolean {
  if (value.startsWith("https://")) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.length > 0;
    } catch {
      return false;
    }
  }
  if (/^[a-z][a-z+.-]*:/i.test(value)) return false;
  return value.length > 0 && !value.includes("..") && !value.includes("\\") && !value.includes("\0");
}

function pngSize(file: string): { width: number; height: number } | null {
  const bytes = readFileSync(file);
  if (bytes.length < 24 || bytes[0] !== 137 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function checkImage(issues: ValidationIssue[], base: string, image: unknown) {
  if (!isRecord(image) || typeof image.src !== "string") return;
  const src = image.src;
  if (escapesAsset(src)) {
    issues.push({ path: `${base}.src`, message: "asset path escapes the demo asset directory" });
    return;
  }
  if (ANIMATED.test(src)) {
    issues.push({ path: `${base}.src`, message: "animated media is not supported" });
    return;
  }
  if (!LOCAL_PNG.test(src)) {
    issues.push({ path: `${base}.src`, message: "image src must be a local demo asset" });
    return;
  }
  const file = path.join(root, "public", src.slice(1));
  let size: { width: number; height: number } | null = null;
  try {
    size = pngSize(file);
  } catch {
    size = null;
  }
  if (!size) {
    issues.push({ path: `${base}.src`, message: "local asset is missing" });
    return;
  }
  if (image.width !== size.width) {
    issues.push({ path: `${base}.width`, message: `width must be ${size.width}` });
  }
  if (image.height !== size.height) {
    issues.push({ path: `${base}.height`, message: `height must be ${size.height}` });
  }
}

/**
 * Acceptance diagnostics for a scenario object.
 * The frozen schema strips unknown keys. These issues name the JSON path so a
 * poll, escape path, or edit is not dropped and rendered as a plain text row.
 */
export function diagnoseDemo(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: "", message: "scenario must be an object" }];
  }

  const parsed = demoFlowSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys.filter((key): key is string => typeof key === "string") : [];
      issues.push({ path: issue.path.length > 0 ? issue.path.join(".") : keys[0] ?? "/", message: issue.message });
    }
  }

  pushExtras(issues, "", input, FLOW_KEYS);
  pushExtras(issues, "contact", input.contact, CONTACT_KEYS);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  messages.forEach((message, index) => {
    const base = `messages.${index}`;
    pushExtras(issues, base, message, MESSAGE_KEYS);
    if (isRecord(message) && Array.isArray(message.reactions)) {
      message.reactions.forEach((reaction, reactionIndex) => pushExtras(issues, `${base}.reactions.${reactionIndex}`, reaction, REACTION_KEYS));
    }
    if (!isRecord(message)) return;
    pushExtras(issues, `${base}.link`, message.link, LINK_KEYS);
    if (Array.isArray(message.attachments)) {
      message.attachments.forEach((file, fileIndex) => pushExtras(issues, `${base}.attachments.${fileIndex}`, file, ATTACHMENT_KEYS));
    }
    if (Array.isArray(message.images)) {
      message.images.forEach((image, imageIndex) => pushExtras(issues, `${base}.images.${imageIndex}`, image, IMAGE_KEYS));
    }
    pushExtras(issues, `${base}.audio`, message.audio, AUDIO_KEYS);
    pushExtras(issues, `${base}.appCard`, message.appCard, APP_CARD_KEYS);
  });

  if (input.platform === "macos" && typeof input.screen === "string" && input.screen !== "conversation") {
    issues.push({ path: "screen", message: "iOS screen value is not a macOS surface" });
  }

  const seen = new Map<string, number>();
  messages.forEach((message, index) => {
    if (!isRecord(message)) return;
    const base = `messages.${index}`;
    if (typeof message.id === "string" && message.id.length > 0) {
      const previous = seen.get(message.id);
      if (previous !== undefined) issues.push({ path: `${base}.id`, message: "duplicate message id" });
      else seen.set(message.id, index);
    }
    if (typeof message.atMs === "number" && Number.isInteger(message.atMs) && message.atMs < 0) {
      issues.push({ path: `${base}.atMs`, message: "timestamp is negative" });
    }
    if (index > 0 && isRecord(messages[index - 1])) {
      const previous = messages[index - 1] as RecordValue;
      if (typeof previous.atMs === "number" && Number.isInteger(previous.atMs) && typeof message.atMs === "number" && Number.isInteger(message.atMs)) {
        if (message.atMs === previous.atMs) issues.push({ path: `${base}.atMs`, message: "overlaps an earlier arrival" });
        else if (message.atMs < previous.atMs) issues.push({ path: `${base}.atMs`, message: "arrives before the previous message" });
      }
    }

    const kind = typeof message.kind === "string" ? message.kind : "text";
    if (message.images !== undefined && kind !== "image") issues.push({ path: `${base}.kind`, message: 'images require kind "image"' });
    if (kind === "image" && (!Array.isArray(message.images) || message.images.length === 0)) issues.push({ path: `${base}.images`, message: "image payload is required" });
    if (message.link !== undefined && kind !== "link") issues.push({ path: `${base}.kind`, message: 'link requires kind "link"' });
    if (kind === "link" && !isRecord(message.link)) issues.push({ path: `${base}.link`, message: "link payload is required" });
    if (message.attachments !== undefined && kind !== "attachment") issues.push({ path: `${base}.kind`, message: 'attachments require kind "attachment"' });
    if (kind === "attachment" && (!Array.isArray(message.attachments) || message.attachments.length === 0)) {
      issues.push({ path: `${base}.attachments`, message: "attachment payload is required" });
    }
    if (message.audio !== undefined && kind !== "audio") issues.push({ path: `${base}.kind`, message: 'audio requires kind "audio"' });
    if (kind === "audio" && !isRecord(message.audio)) issues.push({ path: `${base}.audio`, message: "audio payload is required" });

    if (isRecord(message.link) && typeof message.link.image === "string" && /^[a-z][a-z+.-]*:/i.test(message.link.image)) {
      issues.push({ path: `${base}.link.image`, message: "link images are not unfurled" });
    }
    if (Array.isArray(message.attachments)) {
      message.attachments.forEach((file, fileIndex) => {
        if (isRecord(file) && typeof file.href === "string" && !isDiagnosedAttachmentHref(file.href)) {
          issues.push({ path: `${base}.attachments.${fileIndex}.href`, message: "attachment href is not allowed" });
        }
      });
    }
    if (Array.isArray(message.images)) {
      message.images.forEach((image, imageIndex) => checkImage(issues, `${base}.images.${imageIndex}`, image));
    }
    if (message.replyTo !== undefined) {
      const replyId = typeof message.replyTo === "string" ? message.replyTo : isRecord(message.replyTo) ? message.replyTo.id : undefined;
      const target = typeof replyId === "string" ? messages.find((item) => isRecord(item) && item.id === replyId) : undefined;
      const removed = isRecord(target) && (target.removed === true || typeof target.removedAtMs === "number");
      if (typeof replyId !== "string" || !target || removed) {
        issues.push({ path: `${base}.replyTo.id`, message: "reply target is missing or removed" });
      }
    }
  });

  const unique = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.path}\0${entry.message}`;
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
}

function sameKeys(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((key) => actual.includes(key));
}

export function frozenSchemaKeysMatch(): boolean {
  return sameKeys(Object.keys(demoFlowSchema.shape), FLOW_KEYS) && sameKeys(Object.keys(demoMessageSchema.shape), MESSAGE_KEYS);
}
