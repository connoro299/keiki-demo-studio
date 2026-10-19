import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@/components/imessage/message-list";
import { MacMessagesApp, macScreen } from "@/components/imessage/macos-messages-app";
import { ReplyThread } from "@/components/imessage/message-reply";
import { ScreenEffect } from "@/components/imessage/screen-effects";
import { useBubbleEffectOnMessage } from "@/components/imessage/message-effects";
import { pinTypingDot } from "@/renderers/ios/cues";
import { arrivalFor, mapDemoMessage, playbackArrival, resolveMacScene, toSidebarConversation, type ResolvedConversation } from "@/renderers/macos/map-message";
import { macSourceLimitations, rejectMacFrame } from "@/renderers/macos/limits";
import { waitForMacReady } from "@/renderers/macos/readiness";
import { initialSwitchPhase, isSwitchAligned, nextSwitchPhase, type SwitchPhase } from "@/renderers/macos/switch-phase";
import type { MacDemoRendererProps, MacRendererHandle } from "@/renderers/macos/types";
import { composerPlaceholder } from "@/renderers/sms-composer";

function messagesFor(conversation: ResolvedConversation): Message[] {
  return conversation.messages.map(mapDemoMessage);
}

export const MacDemoRenderer = forwardRef<MacRendererHandle, MacDemoRendererProps>(function MacDemoRenderer({ compiled, frame, scene }, ref) {
  const windowRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [soughtMs, setSoughtMs] = useState<number | null>(null);
  const [inspectCleared, setInspectCleared] = useState(false);
  const revisionRef = useRef(0);
  const signatureRef = useRef<string | null>(null);

  const signature = JSON.stringify({
    compiled: compiled.id,
    frame,
    scene,
    soughtMs,
    inspectCleared,
  });
  if (signatureRef.current !== signature) {
    signatureRef.current = signature;
    revisionRef.current += 1;
  }

  const model = useMemo(() => resolveMacScene(frame, scene, soughtMs), [frame, scene, soughtMs]);
  const rejection = rejectMacFrame(frame)
    ?? (compiled.platform !== "macos" ? { code: "platform", message: `MacDemoRenderer rejects compiled platform "${compiled.platform}".` } : null)
    ?? (scene?.switchFromId && !model.switchFrom ? { code: "missing-switch", message: `Unknown switchFromId "${scene.switchFromId}".` } : null);
  const [phase, setPhase] = useState<SwitchPhase>(() => initialSwitchPhase(model.checkpoint, Boolean(model.switchFrom)));
  const modelRef = useRef(model);
  modelRef.current = model;

  useLayoutEffect(() => {
    setPhase((current) => nextSwitchPhase(current, modelRef.current.checkpoint, Boolean(modelRef.current.switchFrom)));
  }, [model.checkpoint, phase.kind, phase.checkpoint]);

  useLayoutEffect(() => {
    const root = windowRef.current;
    if (!root || !frame.typing) return;
    root.querySelectorAll<HTMLElement>('[data-slot="typing-indicator"] > span[data-dot]').forEach((dot) => {
      const index = Number(dot.dataset.dot ?? 0);
      pinTypingDot(dot, index, Math.max(0, frame.timeMs));
    });
  }, [frame.typing, frame.timeMs, model.checkpoint]);

  // The pinned MacMessagesApp does not forward a composer placeholder, so an SMS thread relabels the
  // unfocused field itself (React leaves the attribute alone until the composer's own value changes).
  const placeholder = composerPlaceholder(compiled.channel);
  useLayoutEffect(() => {
    const field = windowRef.current?.querySelector<HTMLTextAreaElement>('[data-slot="mac-composer"] textarea');
    if (placeholder && field && field.placeholder === "iMessage") field.placeholder = placeholder;
  });

  const aligned = isSwitchAligned(phase, model.checkpoint, Boolean(model.switchFrom));
  const presentingFrom = Boolean(model.switchFrom) && !aligned;
  const presented = presentingFrom && model.switchFrom ? model.switchFrom : model.selected;
  const presentedMessages = messagesFor(presented);
  const timedArrival = model.arrival ?? playbackArrival(compiled, frame);
  const arrivalTarget = timedArrival ? presentedMessages.find((message) => message.id === timedArrival.id) : undefined;
  const arrival = presentingFrom ? { send: null, receive: null } : arrivalFor(arrivalTarget, timedArrival);
  const bubbleEffect = useMemo(() => {
    if (presentingFrom || !model.bubbleEffect) return null;
    return model.bubbleEffect;
  }, [presentingFrom, model.bubbleEffect]);
  useBubbleEffectOnMessage(paneRef, bubbleEffect);

  const sidebar = model.conversations.map((conversation) => toSidebarConversation(conversation, frame.nowMs));
  const conversationTransition = aligned && model.switchFrom
    ? model.conversationProgress === undefined ? {} : { progress: model.conversationProgress }
    : null;
  const shellKey = model.switchFrom
    ? "switching"
    : `settled:${model.selected.id}:${presented.messages.length}:${presented.messages.at(-1)?.id ?? ""}`;
  const inspect = inspectCleared ? null : model.inspect;
  const flightRef = useRef({ arrival: false, switching: false });
  const rejectionRef = useRef(rejection);
  flightRef.current = {
    arrival: Boolean(arrival.send || arrival.receive),
    switching: Boolean(model.switchFrom) && aligned,
  };
  rejectionRef.current = rejection;

  useImperativeHandle(ref, () => ({
    seek(timeMs: number) {
      setSoughtMs(timeMs);
    },
    get element() {
      return windowRef.current;
    },
    get revision() {
      return revisionRef.current;
    },
    whenReady(revision: number) {
      const root = windowRef.current;
      if (!root) return Promise.reject(new Error("renderer has no element"));
      return waitForMacReady(root, revision, () => revisionRef.current, {
        arrivalInFlight: flightRef.current.arrival,
        switchInFlight: flightRef.current.switching,
        rejection: rejectionRef.current,
      });
    },
    reset() {
      setInspectCleared(true);
      setSoughtMs(null);
    },
  }), []);

  const thread = !presentingFrom && model.thread ? model.thread : null;
  const threadRoot = thread ? presentedMessages.find((message) => message.id === thread.rootId) : undefined;
  const threadReplies = thread ? presentedMessages.filter((message) => message.replyTo?.id === thread.rootId) : [];
  const screenEffect = !presentingFrom && model.screenEffect ? model.screenEffect : null;

  return (
    <div data-mac-demo-root={compiled.id}>
      <div
        ref={windowRef}
        data-slot="mac-demo-frame"
        data-theme={frame.theme}
        data-revision={revisionRef.current}
        data-error={rejection?.code}
        data-context-message-id={model.contextMenu?.id}
        className={frame.theme === "dark" ? "dark" : undefined}
        style={{ width: macScreen.width, height: macScreen.height, position: "relative" }}
        onClickCapture={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("a")) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {!rejection && (
          <MacMessagesApp
            key={shellKey}
            width={macScreen.width}
            height={macScreen.height}
            active={model.active}
            conversations={sidebar}
            selectedId={presented.id}
            contact={presented.contact}
            group={presented.group}
            messages={presentedMessages}
            typing={presented.typing}
            now={frame.nowMs}
            composer={{ value: presented.draft, onChange: () => undefined, onSend: () => undefined }}
            sendAnimation={arrival.send}
            receiveAnimation={arrival.receive}
            selectedMessageIds={model.selectedMessageIds}
            contextMenu={model.contextMenu}
            plusMenu={model.plusMenu}
            menuTransition={model.menuProgress === undefined ? null : { progress: model.menuProgress }}
            conversationTransition={conversationTransition}
            footer={model.footer}
            frameRef={paneRef}
            overlay={
              <>
                {thread && threadRoot && (
                  <ReplyThread platform="macos" title="Replies" open={thread.open !== false} progress={thread.progress} root={<p data-thread-root={threadRoot.id}>{threadRoot.text}</p>}>
                    {threadReplies.map((reply) => (
                      <p key={reply.id} data-thread-reply={reply.id}>{reply.text}</p>
                    ))}
                  </ReplyThread>
                )}
                {screenEffect && (
                  <ScreenEffect kind={screenEffect.kind} progress={screenEffect.progress} anchorMessageId={screenEffect.anchorMessageId} />
                )}
              </>
            }
          />
        )}
      </div>
      <aside
        data-developer-metadata
        data-confidence="mixed"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}
      >
        {macSourceLimitations.map((item) => (
          <span key={item.id} data-limitation={item.id} data-confidence={item.confidence}>{item.summary}</span>
        ))}
        {inspect && <span data-inspect-note data-confidence={inspect.confidence}>{inspect.note}</span>}
      </aside>
    </div>
  );
});
