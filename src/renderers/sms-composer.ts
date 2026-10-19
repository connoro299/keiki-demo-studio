import type { DemoChannel } from "@/contracts";

/**
 * A text-message (SMS) conversation's composer, as current iOS / macOS Messages draw it: the field
 * reads "Text Message • SMS" instead of "iMessage", and the iOS send arrow is green rather than blue.
 * The pinned composers take a placeholder but hard-code the blue arrow, so the green comes from the
 * renderer-owned rule in `src/styles.css` keyed on `[data-channel="sms"]`.
 */
export const SMS_COMPOSER_PLACEHOLDER = "Text Message • SMS";

/** The composer placeholder for a channel, or undefined to keep the pinned "iMessage" default. */
export function composerPlaceholder(channel: DemoChannel | undefined): string | undefined {
  return channel === "sms" ? SMS_COMPOSER_PLACEHOLDER : undefined;
}
