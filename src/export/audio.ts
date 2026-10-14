import { existsSync } from "node:fs";
import path from "node:path";
import type { CompiledDemo, DemoMessage } from "@/contracts";

/** One stretch of an authored audible audio message, placed on the video clock. */
export type AudioSegment = {
  messageId: string;
  /** Absolute local file under public/. */
  file: string;
  /** Where the segment starts on the playback clock. */
  startMs: number;
  /** Offset into the source file, in seconds (the audio-control `position`). */
  offsetSeconds: number;
  durationMs: number;
};

/**
 * Audible audio exists only where the flow says so: a message with `audio.src` plus an
 * `audio-control` event that starts it. Playback runs until the next audio-control event,
 * the end of the clip, or the end of the video. No flow audio means no audio track.
 */
export function planAudio(compiled: CompiledDemo, totalMs: number, repoRoot: string): { segments: AudioSegment[]; warnings: string[] } {
  const messages = new Map<string, DemoMessage>();
  for (const conversation of compiled.initialState?.conversations ?? []) {
    for (const message of conversation.messages ?? []) messages.set(message.id, message);
  }
  for (const event of compiled.events) {
    if (event.type === "message") messages.set(event.message.id, event.message);
  }
  const controls = compiled.events
    .filter((event): event is Extract<CompiledDemo["events"][number], { type: "audio-control" }> => event.type === "audio-control")
    .sort((a, b) => a.atMs - b.atMs);
  const segments: AudioSegment[] = [];
  const warnings: string[] = [];
  controls.forEach((control, index) => {
    if (!control.playing || control.seeking) return;
    const audio = messages.get(control.messageId)?.audio;
    if (!audio?.src) return;
    const file = localAudioFile(audio.src, repoRoot);
    if (!file) {
      warnings.push(`audio ${control.messageId}: ${audio.src} is not a local /demo-assets file; skipped`);
      return;
    }
    const next = controls[index + 1];
    const clipRemainingMs = Math.max(0, (audio.duration - control.position) * 1000);
    const endMs = Math.min(totalMs, next ? next.atMs : Infinity, control.atMs + clipRemainingMs);
    const durationMs = Math.round(endMs - control.atMs);
    if (durationMs <= 0 || control.atMs >= totalMs) return;
    segments.push({
      messageId: control.messageId,
      file,
      startMs: Math.max(0, Math.round(control.atMs)),
      offsetSeconds: Math.max(0, control.position),
      durationMs,
    });
  });
  return { segments, warnings };
}

function localAudioFile(src: string, repoRoot: string): string | null {
  if (!src.startsWith("/") || src.startsWith("//")) return null;
  const publicRoot = path.join(repoRoot, "public");
  const file = path.resolve(publicRoot, `.${decodeURI(src.split(/[?#]/)[0]!)}`);
  if (!file.startsWith(publicRoot + path.sep) || !existsSync(file)) return null;
  return file;
}

/**
 * ffmpeg inputs and filter graph for the segments. Input indexes start at `firstInput`
 * (the frame pipe is input 0). Returns null when there is nothing audible.
 */
export function audioFilterGraph(segments: AudioSegment[], totalMs: number, firstInput = 1): { inputs: string[]; filter: string; label: string } | null {
  if (segments.length === 0) return null;
  const files = [...new Set(segments.map((segment) => segment.file))];
  const inputs = files.flatMap((file) => ["-i", file]);
  const parts = segments.map((segment, index) => {
    const input = firstInput + files.indexOf(segment.file);
    const start = (segment.offsetSeconds).toFixed(3);
    const duration = (segment.durationMs / 1000).toFixed(3);
    return `[${input}:a]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,adelay=${segment.startMs}:all=1[s${index}]`;
  });
  const total = (totalMs / 1000).toFixed(3);
  const mixed = segments.length === 1
    ? `[s0]apad,atrim=0:${total}[aout]`
    : `${segments.map((_, index) => `[s${index}]`).join("")}amix=inputs=${segments.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total}[aout]`;
  return { inputs, filter: [...parts, mixed].join(";"), label: "[aout]" };
}
