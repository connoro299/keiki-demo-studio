import { visibleClock } from "../../runtime/story-clock";
import type { DemoTheme, RenderFrame } from "@/contracts";
import { prefersReducedMotion } from "@/components/imessage/message-motion";
import { iosScreen } from "@/components/imessage/ios-messages-app";
import { statusClock } from "./clock";
import type { CueState } from "./cues";
import { applyCheckpointScroll } from "./scroll";

export type IosSettleReceipt = {
  revision: number;
  width: number;
  height: number;
  timeMs: number;
  theme: DemoTheme;
  digest: string;
};

const timeoutMs = 2500;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function digestText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function assertImages(root: ParentNode): Promise<void> {
  const failed = root.querySelector('[data-slot="photo-tile"][data-state="failed"]');
  if (failed) throw new Error("missing asset: image");
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
  for (const image of images) {
    if (!image.complete || image.naturalWidth === 0) {
      throw new Error(`missing asset: ${image.currentSrc || image.src || image.alt || "image"}`);
    }
  }
}

function imagesPending(root: ParentNode): boolean {
  return Boolean(root.querySelector('[data-slot="photo-tile"][data-state="loading"]'));
}

function themeOf(host: HTMLElement, frame: RenderFrame): DemoTheme {
  const marked = host.dataset.theme === "dark" || host.dataset.theme === "light" ? host.dataset.theme : null;
  const dark = host.classList.contains("dark") || Boolean(host.closest(".dark"));
  const actual: DemoTheme = dark ? "dark" : "light";
  if (marked && marked !== actual) throw new Error("missing node: theme");
  if (actual !== frame.theme) throw new Error("missing node: theme");
  return actual;
}

function gradientsReady(shell: HTMLElement): boolean {
  const screen = shell.getBoundingClientRect();
  const list = shell.querySelector<HTMLElement>('[data-slot="message-list"]');
  if (!list) return true;
  const bubbles = list.querySelectorAll<HTMLElement>('[data-slot="message-bubble"], [data-slot="typing-indicator"]');
  if (bubbles.length === 0) return true;
  for (const bubble of bubbles) {
    const body = bubble.querySelector<HTMLElement>('[data-slot="bubble"], [data-slot="emoji"]')
      ?? (bubble.dataset.slot === "typing-indicator" ? bubble : null);
    if (!body) return false;
    const expected = body.getBoundingClientRect().bottom - screen.top;
    const actual = Number.parseFloat(bubble.style.getPropertyValue("--bubble-bottom"));
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1.5) return false;
  }
  return true;
}

function effectCanvasReady(shell: HTMLElement): boolean {
  const canvas = shell.querySelector<HTMLCanvasElement>('canvas[data-slot="screen-effect"]');
  if (!canvas) return true;
  const box = canvas.getBoundingClientRect();
  return box.width >= 1 && box.height >= 1;
}

function transitionPoseReady(shell: HTMLElement): boolean {
  if (!shell.dataset.transition) return true;
  if (prefersReducedMotion()) return true;
  const layer = shell.querySelector('[data-slot="screen-conversation"], [data-slot="screen-list"], [data-slot="ios-new-message-sheet"]');
  if (!layer) return false;
  return layer.getAnimations().length > 0;
}

function overlayPoseReady(shell: HTMLElement): boolean {
  const nodes = shell.querySelectorAll<HTMLElement>(
    '[data-slot="long-press-layer"], [data-slot="thread-panel"], [data-slot="ios-plus-menu"], [data-slot="image-viewer"], [data-slot="ios-details"], [data-slot="photo-picker"], [data-slot="swipe-times"]',
  );
  for (const node of nodes) {
    if (getComputedStyle(node).display === "contents") continue;
    const box = node.getBoundingClientRect();
    if (box.width < 1 && box.height < 1) return false;
  }
  return true;
}

function poseReady(shell: HTMLElement, cues: CueState): boolean {
  if (prefersReducedMotion()) return true;
  const ghost = shell.querySelector('[data-slot="send-ghost"], [data-slot="send-clone"]');
  if (cues.send) return Boolean(ghost);
  return !ghost;
}

function structureProblem(shell: HTMLElement, frame: RenderFrame): string | null {
  if (shell.dataset.slot !== "ios-messages-app") return "missing node: ios-messages-app";
  if (shell.offsetWidth !== iosScreen.width || shell.offsetHeight !== iosScreen.height) return "missing node: frame size";
  if (!shell.querySelector('[data-slot="ios-status-bar"]')) return "missing node: ios-status-bar";
  const clock = shell.querySelector('[data-slot="time"]');
  if (!clock || clock.textContent !== statusClock(visibleClock(frame.nowMs, frame.messages))) return "missing node: status clock";
  if (frame.screen === "list" || frame.screen === "new-message") {
    if (!shell.querySelector('[data-slot="ios-conversation-list"]')) return "missing node: ios-conversation-list";
  }
  if (frame.screen === "new-message" && !shell.querySelector('[data-slot="ios-new-message-sheet"]')) {
    return "missing node: ios-new-message-sheet";
  }
  if (frame.screen === "conversation") {
    if (!shell.querySelector('[data-slot="message-list"]')) return "missing node: message-list";
    if (!shell.querySelector('[data-slot="ios-composer"] [data-slot="field"] textarea')) return "missing node: composer";
    const field = shell.querySelector<HTMLTextAreaElement>('[data-slot="field"] textarea');
    if (!field || field.value !== frame.draft) return "missing node: composer draft";
    const rows = new Set(Array.from(shell.querySelectorAll<HTMLElement>("[data-message-id]")).map((row) => row.dataset.messageId));
    for (const message of frame.messages) {
      if (!rows.has(message.id)) return `missing node: message ${message.id}`;
    }
    if (shell.querySelector('[data-message-id][data-kind="typing"]')) return "missing node: typing row";
  }
  return null;
}

function receiptFor(shell: HTMLElement, host: HTMLElement, frame: RenderFrame, revision: number): IosSettleReceipt {
  const theme = themeOf(host, frame);
  const width = shell.offsetWidth;
  const height = shell.offsetHeight;
  const list = shell.querySelector<HTMLElement>('[data-slot="message-list"]');
  const bottoms = Array.from(shell.querySelectorAll<HTMLElement>('[data-slot="message-list"] [data-slot="message-bubble"], [data-slot="message-list"] [data-slot="typing-indicator"]'))
    .map((bubble) => bubble.style.getPropertyValue("--bubble-bottom"))
    .join(",");
  const digest = digestText([
    width,
    height,
    theme,
    frame.timeMs,
    frame.screen,
    frame.draft,
    list?.scrollTop ?? 0,
    frame.messages.map((message) => `${message.id}:${message.text}:${message.direction}`).join("|"),
    shell.querySelector('[data-slot="time"]')?.textContent ?? "",
    bottoms,
  ].join("~"));
  return { revision, width, height, timeMs: frame.timeMs, theme, digest };
}

export async function settleIosScene(options: {
  host: HTMLElement;
  shell: HTMLElement | null;
  frame: RenderFrame;
  cues: CueState;
  revision: () => number;
  expectedRevision: number;
}): Promise<IosSettleReceipt> {
  const { host, frame, cues, revision, expectedRevision } = options;
  if (revision() !== expectedRevision) {
    throw new Error(`stale revision ${expectedRevision}; committed ${revision()}`);
  }
  if (frame.platform !== "ios") throw new Error("missing node: ios frame");
  const started = performance.now();
  let problem = "readiness timeout";
  while (performance.now() - started < timeoutMs) {
    if (revision() !== expectedRevision) throw new Error(`stale revision ${expectedRevision}; committed ${revision()}`);
    const shell = options.shell ?? host.querySelector<HTMLElement>('[data-slot="ios-messages-app"]');
    if (!shell || host.dataset.posed !== "true") {
      problem = "readiness timeout: pose";
      await nextFrame();
      continue;
    }
    await document.fonts.ready;
    if (document.fonts.status !== "loaded") throw new Error("missing asset: fonts");
    if (imagesPending(shell)) {
      problem = "readiness timeout: image";
      await nextFrame();
      continue;
    }
    const sheet = shell.querySelector<HTMLElement>('[data-slot="sheet-app-shell"]:not([hidden])');
    if (sheet?.dataset.content === 'error') throw new Error('missing asset: sheet app content');
    if (sheet?.dataset.content === 'loading') {
      problem = 'readiness timeout: sheet app content';
      await nextFrame();
      continue;
    }
    await assertImages(shell);
    applyCheckpointScroll(shell);
    shell.querySelector('[data-slot="message-list"]')?.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextFrame();
    if (revision() !== expectedRevision) throw new Error(`stale revision ${expectedRevision}; committed ${revision()}`);
    const structure = structureProblem(shell, frame);
    if (structure) {
      problem = structure;
      await nextFrame();
      continue;
    }
    if (!gradientsReady(shell)) {
      problem = "readiness timeout: gradients";
      await nextFrame();
      continue;
    }
    if (!poseReady(shell, cues)) {
      problem = "readiness timeout: arrival pose";
      await nextFrame();
      continue;
    }
    if (!effectCanvasReady(shell)) {
      problem = "readiness timeout: effect canvas";
      await nextFrame();
      continue;
    }
    if (!transitionPoseReady(shell)) {
      problem = "readiness timeout: transition pose";
      await nextFrame();
      continue;
    }
    if (!overlayPoseReady(shell)) {
      problem = "readiness timeout: overlay pose";
      await nextFrame();
      continue;
    }
    const effect = cues.bubbleEffect;
    if (effect && !prefersReducedMotion()) {
      const target = shell.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(effect.id)}"] [data-slot="bubble-frame"]`);
      const running = target?.getAnimations().some((animation) => animation.playState === "paused" || animation.playState === "running");
      if (!running) {
        problem = "readiness timeout: bubble effect";
        await nextFrame();
        continue;
      }
    }
    return receiptFor(shell, host, frame, expectedRevision);
  }
  throw new Error(problem);
}
