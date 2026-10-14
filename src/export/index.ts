/**
 * Video export contract. Implemented by the `export` command (src/export/video.ts).
 * Renders a validated flow by seeking the same deterministic player the capture command uses,
 * one frame per tick, and encodes MP4 (H.264, yuv420p) plus optional GIF and poster PNG.
 */
import type { DemoPlatform, DemoTheme } from "@/contracts";

export type ExportFormat = "mp4" | "gif" | "poster";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["mp4", "gif", "poster"];

export type ExportOptions = {
  /** Directory to write into; created if missing. Must be missing or empty. */
  outDir: string;
  /** Default ["mp4", "gif", "poster"]. */
  formats?: ExportFormat[];
  /** MP4 frame rate. Default 30. */
  fps?: number;
  /** Device scale for the PNG frames. Default 2 (804x1748 on iOS). */
  scale?: number;
  /** Hold the final frame this long. Default 1200. */
  tailMs?: number;
  /** GIF width in px. Default 480. */
  gifWidth?: number;
  /** GIF frame rate. Default 15. */
  gifFps?: number;
  /** GIF size budget. Over budget, fps then width step down automatically. Default 5 MB; 0 disables. */
  maxGifBytes?: number;
  /** Variant to render when the flow declares several targets. */
  platform?: DemoPlatform;
  /** Override the flow's theme. */
  theme?: DemoTheme;
  /** x264 CRF. Default 18. */
  crf?: number;
  /** Player pages seeking in parallel. Each frame depends only on its timestamp. Default: auto (up to 4). */
  concurrency?: number;
  /** Hardware GPU raster. Faster, but pixels then depend on the machine's GPU. Default false (software, matches `capture`). */
  gpu?: boolean;
  /**
   * Skip the screenshot when a frame's DOM, scroll offsets, and animation progress match the
   * previous frame's (identical pixels). Frames with video, canvas, or iframes always capture. Default true.
   */
  dedupe?: boolean;
  /** Bind the preview server to this port. Default: any free port. */
  port?: number;
  /** Called after each frame is handed to the encoder. */
  onProgress?: (progress: { frame: number; frames: number }) => void;
};

export type ExportedFile = {
  path: string;
  bytes: number;
  width: number;
  height: number;
};

export type ExportResult = {
  mp4?: string;
  gif?: string;
  poster?: string;
  /** Length of the encoded video: timeline plus tail. */
  durationMs: number;
  /** Frames encoded into the MP4 (durationMs * fps / 1000). */
  frames: number;
  /** Screenshots actually taken; the rest were the held tail or fingerprint-identical repeats. */
  capturedFrames: number;
  /** Compiled timeline length (compiled.durationMs) before the tail. */
  timelineMs: number;
  tailMs: number;
  fps: number;
  scale: number;
  scenarioId: string;
  platform: DemoPlatform;
  theme: DemoTheme;
  /** True only when the flow has audible audio messages that play. */
  audio: boolean;
  files: {
    mp4?: ExportedFile & { fps: number; frames: number; durationMs: number };
    gif?: ExportedFile & { fps: number; frames: number; durationMs: number };
    poster?: ExportedFile;
  };
  /** manifest.json in outDir. */
  manifest: string;
  ffmpeg: { path: string; source: string };
  timings: {
    framesMs: number;
    gifMs: number;
    posterMs: number;
    totalMs: number;
    /** Wall-clock seconds of rendering per second of video. */
    renderSecondsPerVideoSecond: number;
  };
  warnings: string[];
};
