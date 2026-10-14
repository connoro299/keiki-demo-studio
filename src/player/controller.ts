import type { CompiledDemo, CompiledEvent, Player, RenderFrame, RendererHandle } from "@/contracts";
import { buildReadyReceipt, canonicalFrame, frameDigest } from "@/player/receipt";
import { POLL_VOTE_SETTLE_MS } from "@/runtime/poll";
import { stateAt } from "@/runtime/project";
import type { InspectState, IMessageDemoApi, NamedCheckpoint, ReadyReceipt, SeekResult } from "@/player/types";

export type RuntimeSession = IMessageDemoApi & {
  inspect(): InspectState;
  selectMessage(messageId: string | null): void;
  setView(platform: CompiledDemo["platform"], theme: CompiledDemo["theme"]): void;
  view(): { platform: CompiledDemo["platform"]; theme: CompiledDemo["theme"] };
  snapshot(): { frame: RenderFrame; digest: string };
  playbackCompiled(): CompiledDemo;
  liveRevision(): number;
};

export function createRuntimeSession(args: {
  compiled: CompiledDemo;
  player: Player;
  checkpoints?: NamedCheckpoint[];
  getRenderer: () => RendererHandle | null;
  getFrameElement: () => HTMLElement | null;
  now?: () => number;
}): RuntimeSession {
  let revision = 0;
  let inspect: InspectState = { messageId: null };
  let platform = args.compiled.platform;
  let theme = args.compiled.theme;
  const logicalFrames = new Map<number, RenderFrame>();
  logicalFrames.set(0, structuredClone({ ...args.player.frame(), platform, theme }));
  let liveVotes: CompiledEvent[] = [];
  let liveRevision = 0;

  function playbackCompiled(): CompiledDemo {
    if (liveVotes.length === 0) return args.compiled;
    const durationMs = liveVotes.reduce((end, event) => Math.max(end, event.atMs + POLL_VOTE_SETTLE_MS), args.compiled.durationMs);
    return { ...args.compiled, durationMs, events: [...args.compiled.events, ...liveVotes] };
  }

  function currentFrame(): RenderFrame {
    const frame = args.player.frame();
    return { ...frame, platform, theme };
  }

  function bump(timeMs: number): SeekResult {
    revision += 1;
    const frame = currentFrame();
    logicalFrames.set(revision, structuredClone(frame));
    args.getRenderer()?.seek(timeMs);
    return { revision, timeMs };
  }

  async function waitForRevision(target: number): Promise<void> {
    const started = (args.now ?? Date.now)();
    while (revision < target) {
      if ((args.now ?? Date.now)() - started > 15_000) {
        throw new Error(`Timed out waiting for revision ${target}`);
      }
      await nextTick();
    }
  }

  async function waitForRenderer(): Promise<HTMLElement> {
    const started = (args.now ?? Date.now)();
    while (true) {
      const element = args.getRenderer()?.element ?? args.getFrameElement();
      if (element) {
        // A seek updates the logical clock before React commits the corresponding DOM.
        // Do not accept media readiness measured against the previous rendered frame.
        const expectedTime = currentFrame().timeMs;
        const timed = '[data-slot="ios-demo-renderer"], [data-slot="chat-demo-renderer"]';
        const marker = element.closest?.(timed) ?? element.querySelectorAll<HTMLElement>(timed)[0];
        if (!args.player.state().playing && marker && Math.abs(Number(marker.getAttribute("data-time")) - expectedTime) > 0.001) {
          if ((args.now ?? Date.now)() - started > 15_000) throw new Error(`Renderer did not commit playback time ${expectedTime}`);
          await nextTick();
          continue;
        }
        await waitForAssets(element);
        return element;
      }
      if ((args.now ?? Date.now)() - started > 15_000) {
        throw new Error("Timed out waiting for renderer element");
      }
      await nextTick();
    }
  }

  const api: RuntimeSession = {
    async seek(timeMs: number) {
      args.player.seek(timeMs);
      return bump(timeMs);
    },
    async reset() {
      inspect = { messageId: null };
      liveVotes = [];
      liveRevision += 1;
      args.player.pause();
      args.player.reset?.();
      args.player.seek(0);
      return bump(0);
    },
    async ready(requested?: number) {
      const target = requested ?? revision;
      await waitForRevision(target);
      const element = await waitForRenderer();
      const authored = logicalFrames.get(target);
      if (!authored) throw new Error(`No authored frame for revision ${target}`);
      const live = currentFrame();
      const frame = target === revision ? live : authored;
      if (target === revision && (await frameDigest(live)) !== (await frameDigest(authored))) {
        throw new Error("Renderer warm-up changed authored logical state");
      }
      const box = element.getBoundingClientRect();
      return buildReadyReceipt({
        revision: target,
        frame,
        renderer: {
          timeMs: frame.timeMs,
          platform: frame.platform,
          theme: frame.theme,
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
      });
    },
    async play() {
      args.player.play();
    },
    async pause() {
      args.player.pause();
    },
    state() {
      return args.player.state();
    },
    frame: currentFrame,
    inspect() {
      return inspect;
    },
    selectMessage(messageId) {
      inspect = { messageId };
    },
    setView(nextPlatform, nextTheme) {
      platform = nextPlatform;
      theme = nextTheme;
    },
    view() {
      return { platform, theme };
    },
    snapshot() {
      const frame = currentFrame();
      return { frame, digest: canonicalFrame(frame) };
    },
    playbackCompiled,
    liveRevision() {
      return liveRevision;
    },
    castPollVote(vote) {
      const atMs = Math.round(args.player.state().timeMs);
      const compiled = playbackCompiled();
      const message = stateAt(compiled, atMs).messages.find((item) => item.id === vote.messageId);
      const poll = message?.poll;
      if (!poll || !poll.options.some((option) => option.id === vote.optionId)) return;
      const voted = vote.voted ?? true;
      const already = (poll.votes ?? []).some((item) => item.participantId === vote.participantId && item.optionId === vote.optionId);
      if (voted && already) return;
      if (!voted && !already) return;
      liveVotes = [
        ...liveVotes,
        { type: "poll-vote", atMs, messageId: vote.messageId, participantId: vote.participantId, optionId: vote.optionId, voted },
      ];
      liveRevision += 1;
      args.player.setDuration?.(Math.max(args.player.state().durationMs, atMs + POLL_VOTE_SETTLE_MS));
      args.player.seek(atMs);
      bump(atMs);
    },
  };

  void args.checkpoints;
  return api;
}

export function checkpointAt(checkpoints: NamedCheckpoint[], id: string): NamedCheckpoint {
  const found = checkpoints.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown checkpoint: ${id}`);
  return found;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function waitForAssets(element: HTMLElement): Promise<void> {
  const fonts = (element.ownerDocument as Document | undefined)?.fonts;
  if (fonts?.ready) {
    await Promise.race([fonts.ready, sleep(2000)]);
  }
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const pending = [...element.querySelectorAll("img")].filter((image) => image.isConnected && !image.complete);
    if (pending.length === 0) break;
    await Promise.race([
      Promise.all(pending.map((image) => new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      }))),
      sleep(50),
    ]);
  }
  const stuck = [...element.querySelectorAll("img")].filter((image) => image.isConnected && !image.complete);
  if (stuck.length > 0) throw new Error(`Image failed: ${stuck[0]?.currentSrc || stuck[0]?.src || "image"}`);
  const videoDeadline = Date.now() + 5000;
  while (true) {
    const videos = [...element.querySelectorAll<HTMLVideoElement>('video[data-slot="message-video"]')].filter(video => video.isConnected);
    const failed = videos.find(video => video.error);
    if (failed) throw new Error(`Video failed: ${failed.currentSrc || failed.src}`);
    const playing = typeof window !== "undefined" && window.IMESSAGE_DEMO?.state().playing === true;
    const pending = videos.filter(video => {
      if (video.readyState < 2) return true;
      if (playing || !video.paused) return false;
      const target = Math.min(Number(video.dataset.targetTime ?? 0), video.duration);
      return video.seeking || Math.abs(video.currentTime - target) > 0.005;
    });
    if (pending.length === 0) break;
    if (Date.now() >= videoDeadline) throw new Error(`Video did not reach its authored frame: ${pending[0]?.currentSrc || pending[0]?.src}`);
    await sleep(25);
  }

}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertReceiptRevision(receipt: ReadyReceipt, revision: number): void {
  if (receipt.revision !== revision) {
    throw new Error(`Ready receipt revision ${receipt.revision} does not match seek revision ${revision}`);
  }
}
