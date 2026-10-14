/**
 * Video export contract. Implemented by the `export` command (src/export/video.ts).
 * Renders a validated flow by seeking the same deterministic player the capture command uses,
 * one frame per tick, and encodes MP4 (H.264, yuv420p) plus optional GIF and poster PNG.
 */
export type ExportFormat = "mp4" | "gif" | "poster";

export type ExportOptions = {
  /** Directory to write into; created if missing. */
  outDir: string;
  formats?: ExportFormat[];
  fps?: number;
  /** Device scale for the PNG frames. Default 2. */
  scale?: number;
  /** Hold the final frame this long. Default 1200. */
  tailMs?: number;
  /** GIF width in px. Default 480. */
  gifWidth?: number;
};

export type ExportResult = {
  mp4?: string;
  gif?: string;
  poster?: string;
  durationMs: number;
  frames: number;
};
