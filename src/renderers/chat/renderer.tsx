import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import type { RendererHandle, RendererProps } from "@/contracts";
import { buildChatModel, type ChatChannel } from "./engine";
import { waitForChatReady, type ChatReadyReceipt } from "./readiness";
import { SCREEN, SYSTEM_FONT } from "./shared";
import { SlackScreen } from "./slack";
import { TelegramScreen } from "./telegram";
import { WhatsAppScreen } from "./whatsapp";

export type ChatRendererHandle = RendererHandle & {
  readonly revision: number;
  whenReady(revision: number): Promise<ChatReadyReceipt>;
};

export type ChatDemoRendererProps = RendererProps & { channel: ChatChannel };

/**
 * One renderer for the non-Messages channels. The frame is folded into a channel-neutral
 * `ChatModel` (pure, time-derived), then drawn by the channel's skin. `data-time` on the root lets
 * the runtime session confirm the committed DOM matches the sought playback time before capture.
 */
export const ChatDemoRenderer = forwardRef<ChatRendererHandle, ChatDemoRendererProps>(function ChatDemoRenderer({ compiled, frame, channel }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const revisionRef = useRef(0);
  const signatureRef = useRef<string | null>(null);
  const model = useMemo(() => buildChatModel(compiled, frame, channel), [compiled, frame, channel]);
  const signature = `${compiled.id}:${channel}:${frame.theme}:${frame.timeMs}:${frame.messages.length}:${frame.draft}:${frame.typing}`;
  if (signatureRef.current !== signature) {
    signatureRef.current = signature;
    revisionRef.current += 1;
  }

  useImperativeHandle(ref, () => ({
    seek() {
      // The frame prop is authoritative; the player re-renders this component at the sought time.
    },
    get element() {
      return rootRef.current;
    },
    get revision() {
      return revisionRef.current;
    },
    whenReady(revision: number) {
      const root = rootRef.current;
      if (!root) return Promise.reject(new Error("chat renderer has no element"));
      return waitForChatReady(root, revision, () => revisionRef.current);
    },
  }), []);

  return (
    <div
      ref={rootRef}
      data-slot="chat-demo-renderer"
      data-channel={channel}
      data-theme={frame.theme}
      data-time={frame.timeMs}
      data-revision={revisionRef.current}
      className={frame.theme === "dark" ? "dark" : undefined}
      style={{ position: "relative", width: SCREEN.width, height: SCREEN.height, overflow: "hidden", fontFamily: SYSTEM_FONT, textRendering: "optimizeLegibility", userSelect: "none" }}
    >
      {channel === "whatsapp" ? <WhatsAppScreen model={model} /> : null}
      {channel === "telegram" ? <TelegramScreen model={model} /> : null}
      {channel === "slack" ? <SlackScreen model={model} /> : null}
    </div>
  );
});
