import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { DemoMessage } from "@/contracts";
import { clamp01, type ChatPerson } from "./engine";

export const SCREEN = { width: 402, height: 874 } as const;
export const STATUS_BAR_HEIGHT = 54;
export const HOME_AREA_HEIGHT = 34;
export const SYSTEM_FONT = '-apple-system, "SF Pro Text", "SF Pro", system-ui, "Helvetica Neue", sans-serif';
export const DISPLAY_FONT = '-apple-system, "SF Pro Display", "SF Pro", system-ui, "Helvetica Neue", sans-serif';

/**
 * iOS status bar (402pt screen): clock, Dynamic Island, full signal, Wi-Fi and a full battery.
 * Geometry follows the pinned Messages status bar so the chat channels line up with iMessage.
 */
export function StatusBar({ time, color, style }: { time: string; color: string; style?: CSSProperties }) {
  const dim = color === "#FFFFFF" || color.toLowerCase() === "#fff" ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.36)";
  return (
    <div data-slot="chat-status-bar" style={{ position: "absolute", left: 0, top: 0, width: SCREEN.width, height: STATUS_BAR_HEIGHT, zIndex: 40, pointerEvents: "none", fontFamily: DISPLAY_FONT, ...style }}>
      <span style={{ position: "absolute", left: 0, width: 154, top: 23, textAlign: "center", fontSize: 17, lineHeight: "20px", fontWeight: 600, letterSpacing: -0.2, color, paddingLeft: 6 }}>{time}</span>
      <span style={{ position: "absolute", left: 138.33, top: 14, width: 125.33, height: 36.67, borderRadius: 999, background: "#000" }} />
      <svg width="19" height="12.5" viewBox="0 0 19 12.5" style={{ position: "absolute", left: 286.6, top: 26.4 }} fill={color} aria-hidden>
        <rect x="0" y="8" width="3.3" height="4.4" rx="1" />
        <rect x="5.1" y="5.6" width="3.3" height="6.8" rx="1" />
        <rect x="10.2" y="3" width="3.3" height="9.4" rx="1" />
        <rect x="15.3" y="0" width="3.3" height="12.4" rx="1" />
      </svg>
      <svg width="17" height="12.4" viewBox="0 0 17 12.4" style={{ position: "absolute", left: 310.5, top: 26.4 }} fill={color} aria-hidden>
        <path d="M0.01 3.16A13 13 0 0 1 16.99 3.16L15.25 5.18A10.33 10.33 0 0 0 1.75 5.18Z" />
        <path d="M2.84 6.44A8.67 8.67 0 0 1 14.16 6.44L12.42 8.46A6 6 0 0 0 4.58 8.46Z" />
        <path d="M5.45 9.47A4.67 4.67 0 0 1 11.55 9.47L8.94 12.16A0.67 0.67 0 0 0 8.06 12.16Z" />
      </svg>
      <span style={{ position: "absolute", left: 334.5, top: 26, width: 25, height: 12.5, borderRadius: 4.2, boxShadow: `inset 0 0 0 1.05px ${dim}` }}>
        <span style={{ position: "absolute", left: 2, top: 2, width: 21, height: 8.5, borderRadius: 2.6, background: color }} />
      </span>
      <span style={{ position: "absolute", left: 360.6, top: 30.4, width: 1.6, height: 4, borderRadius: "0 1px 1px 0", background: dim }} />
    </div>
  );
}

export function HomeIndicator({ color }: { color: string }) {
  return <span data-slot="chat-home-indicator" style={{ position: "absolute", left: (SCREEN.width - 139) / 2, bottom: 8, width: 139, height: 5, borderRadius: 3, background: color, zIndex: 41 }} />;
}

/**
 * Arrival wrapper: the row's height grows from 0 to its natural size (a grid `fr` track, so no
 * measurement is needed) while the content rises and fades in. Pure function of `enter`.
 */
export function Arrive({ enter, children, origin = "bottom left", rise = 10, scale = 0.94, id }: {
  enter: number; children: ReactNode; origin?: string; rise?: number; scale?: number; id?: string;
}) {
  const settled = enter >= 1;
  const fade = clamp01(enter * 1.6);
  return (
    <div data-chat-row={id} style={{ display: "grid", gridTemplateRows: settled ? "auto" : `${Math.max(0, enter)}fr`, flexShrink: 0 }}>
      <div style={{ minHeight: 0, overflow: settled ? "visible" : "clip", overflowClipMargin: settled ? undefined : 24 }}>
        <div style={settled ? undefined : {
          opacity: fade,
          transform: `translateY(${(1 - enter) * rise}px) scale(${scale + (1 - scale) * enter})`,
          transformOrigin: origin,
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

const TELEGRAM_GRADIENTS: Array<[string, string]> = [
  ["#FF885E", "#FF516A"],
  ["#FFCD6A", "#FFA85C"],
  ["#82B1FF", "#665FFF"],
  ["#A0DE7E", "#54CB68"],
  ["#53EDD6", "#28C9B7"],
  ["#72D5FD", "#2A9EF1"],
  ["#E0A2F3", "#D669ED"],
];

export function avatarGradient(index: number): string {
  const [from, to] = TELEGRAM_GRADIENTS[((index % 7) + 7) % 7];
  return `linear-gradient(180deg, ${from} 0%, ${to} 100%)`;
}

/** Round or rounded-square avatar: the person's photo, else initials on a gradient. */
export function Avatar({ person, size, radius, fallback = "initials", silhouetteColors, background, fontScale = 0.4 }: {
  person: ChatPerson;
  size: number;
  radius?: number;
  fallback?: "initials" | "silhouette";
  silhouetteColors?: { bg: string; fg: string };
  background?: string;
  fontScale?: number;
}) {
  const shape: CSSProperties = { width: size, height: size, borderRadius: radius ?? size / 2, overflow: "hidden", flexShrink: 0, position: "relative" };
  if (person.photo) {
    return <img src={person.photo} alt="" draggable={false} style={{ ...shape, objectFit: "cover", display: "block" }} />;
  }
  if (fallback === "silhouette") {
    const colors = silhouetteColors ?? { bg: "#DFE5E7", fg: "#FFFFFF" };
    return (
      <span style={{ ...shape, background: colors.bg, display: "block" }} aria-hidden>
        <svg viewBox="0 0 40 40" width={size} height={size} style={{ display: "block" }}>
          <circle cx="20" cy="15.6" r="7.2" fill={colors.fg} />
          <path d="M6.4 36.2c1.6-7.4 7-11.4 13.6-11.4s12 4 13.6 11.4" fill={colors.fg} />
        </svg>
      </span>
    );
  }
  return (
    <span style={{ ...shape, display: "flex", alignItems: "center", justifyContent: "center", background: background ?? avatarGradient(person.colorIndex), color: "#FFFFFF", fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: Math.round(size * fontScale), letterSpacing: 0.2 }} aria-hidden>
      {person.initials}
    </span>
  );
}

/**
 * Bubble tail for the last bubble of a group (iOS WhatsApp / Telegram style). Drawn for the right
 * side; mirrored for incoming. `overlap` points sit under the bubble so the joint is seamless.
 */
export function BubbleTail({ side, color, protrude = 7, height = 16 }: { side: "in" | "out"; color: string; protrude?: number; height?: number }) {
  const overlap = 6;
  const w = overlap + protrude;
  const h = height;
  const style: CSSProperties = {
    position: "absolute",
    bottom: 0,
    width: w,
    height: h,
    [side === "out" ? "right" : "left"]: -protrude,
    transform: side === "in" ? "scaleX(-1)" : undefined,
    pointerEvents: "none",
  };
  // Straight bubble edge, then a hollow (concave) sweep out to a softly rounded tip level with the
  // bubble's bottom edge: the iOS "hook" used by WhatsApp and Telegram.
  const knee = h * 0.38;
  const tipX = w - 0.6;
  const tipY = h - 0.7;
  const d = [
    `M0 0H${overlap}V${knee}`,
    `C${overlap} ${h * 0.72} ${overlap + protrude * 0.32} ${h * 0.92} ${tipX - 0.4} ${tipY}`,
    `C${w + 0.1} ${tipY + 0.15} ${w} ${h} ${tipX - 1.2} ${h}`,
    `H0Z`,
  ].join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={style} aria-hidden>
      <path d={d} fill={color} />
    </svg>
  );
}

/** WhatsApp-style single/double check. Colours cross-fade when a receipt changes. */
export function Checks({ double, color, width = 16, height = 11, style }: { double: boolean; color: string; width?: number; height?: number; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 16 11" width={width} height={height} style={{ display: "block", ...style }} aria-hidden>
      <g fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
        {double ? (
          <>
            <path d="M1.3 5.9l2.9 2.9 6.2-7.6" />
            <path d="M7.4 8l.8.8 6.2-7.6" />
          </>
        ) : (
          <path d="M3.3 5.9l2.9 2.9 6.2-7.6" />
        )}
      </g>
    </svg>
  );
}

/** Mix two #RRGGBB / rgba() colours by t. Used for receipt colour transitions. */
export function mixColor(from: string, to: string, t: number): string {
  if (t >= 1) return to;
  if (t <= 0) return from;
  const a = parseColor(from);
  const b = parseColor(to);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return `rgba(${Math.round(lerp(a[0], b[0]))}, ${Math.round(lerp(a[1], b[1]))}, ${Math.round(lerp(a[2], b[2]))}, ${lerp(a[3], b[3]).toFixed(3)})`;
}

function parseColor(value: string): [number, number, number, number] {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = Number.parseInt(full.slice(0, 6), 16);
    const alpha = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
  }
  const parts = value.replace(/rgba?\(|\)/g, "").split(",").map((part) => Number(part.trim()));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/**
 * Muted inline video on the conversation clock, mirroring the iOS renderer's `IosVideo` sync:
 * paused playback seeks exactly to (t - arrival); while playing, the media clock runs and is only
 * corrected when it drifts. `data-slot="message-video"` lets the shared readiness wait for frames.
 */
export function ChatVideo({ message, timeMs, arrivalMs, width, radius, children }: {
  message: DemoMessage; timeMs: number; arrivalMs: number; width: number; radius: number; children?: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const pendingPlay = useRef(false);
  const playing = typeof window !== "undefined" && window.IMESSAGE_DEMO?.state().playing === true;
  const target = Math.max(0, (timeMs - arrivalMs) / 1000);
  const latest = useRef({ target, playing });
  latest.current = { target, playing };
  const synchronize = () => {
    const node = video.current;
    if (!node || node.readyState < 1) return;
    const state = latest.current;
    const position = Number.isFinite(node.duration) ? Math.min(state.target, node.duration) : state.target;
    const ended = Number.isFinite(node.duration) && position >= node.duration;
    if (Math.abs(node.currentTime - position) > (state.playing ? 0.35 : 0.001)) node.currentTime = position;
    if (!state.playing || ended) {
      node.pause();
    } else if (node.paused && !pendingPlay.current) {
      pendingPlay.current = true;
      void node.play().then(() => {
        if (!latest.current.playing) node.pause();
      }).catch(() => undefined).finally(() => { pendingPlay.current = false; });
    }
  };
  useEffect(synchronize, [target, playing]);
  const payload = message.video!;
  const ratio = payload.width && payload.height ? Math.min(1.8, Math.max(0.56, payload.width / payload.height)) : 16 / 9;
  return (
    <div style={{ position: "relative", width, borderRadius: radius, overflow: "hidden", background: "#111" }}>
      <video ref={video} src={payload.src} poster={payload.poster} muted playsInline disablePictureInPicture disableRemotePlayback preload="auto"
        aria-label={message.text || "Video message"} data-slot="message-video" data-target-time={target}
        style={{ display: "block", width: "100%", aspectRatio: String(ratio), objectFit: "cover" }}
        onLoadedMetadata={synchronize} onLoadedData={synchronize} />
      {children}
    </div>
  );
}

export function imageBox(image: { width?: number; height?: number }, width: number): { width: number; height: number } {
  const ratio = image.width && image.height ? image.width / image.height : 4 / 3;
  const clamped = Math.min(1.9, Math.max(0.62, ratio));
  return { width, height: Math.round(width / clamped) };
}

/* ------------------------------------------------------------------------------------------ */
/* Wallpaper doodles                                                                            */
/* ------------------------------------------------------------------------------------------ */

const GLYPHS: Record<string, string> = {
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  star: "M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.6 6.7 19.5l1.1-6L3.4 9.3l6-.8z",
  bubble: "M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z",
  camera: "M3 8a1 1 0 0 1 1-1h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z",
  note: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
  cup: "M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h2a2.5 2.5 0 0 1 0 5h-2M8 2.5v3M12 2.5v3",
  smile: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5v.5M15 9.5v.5",
  cloud: "M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z",
  phone: "M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18.5h2",
  mail: "M3 6h18v12H3zM3 6l9 7 9-7",
  balloon: "M12 3a6 6 0 0 1 6 6c0 4-3.5 7-6 7s-6-3-6-7a6 6 0 0 1 6-6zM12 16l-1 2h2zM12 18c0 2-2 2-2 4",
  umbrella: "M3 12a9 9 0 0 1 18 0zM12 12v7a2 2 0 0 1-4 0",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2",
  plane: "M3 11l18-8-7 18-3-7zM11 14l10-11",
  gift: "M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0",
  planet: "M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10zM3 15c1.5 2 17-3.5 18-7",
  pizza: "M4 6c5-3 11-3 16 0L12 21zM9 10h.5M14 12h.5M12 15h.5",
  headphones: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z",
  gamepad: "M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-1a4 4 0 0 1 4-4zM7 11v4M5 13h4M16 12h.5M18 14h.5",
  cat: "M5 8l1-5 4 3h4l4-3 1 5v5a7 7 0 0 1-14 0zM9.5 12v.5M14.5 12v.5M10.5 15.5l1.5 1 1.5-1",
  rocket: "M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2zM9 15l-3 3 1 3 3-2M15 15l3 3-1 3-3-2M12 8.5v1",
  icecream: "M8 10a4 4 0 0 1 8 0zM8 10l4 11 4-11",
  leaf: "M5 19C5 10 10 5 20 4c-1 10-6 15-15 15zM5 19l8-8",
  bike: "M6 18a3 3 0 1 0 0-.01M18 18a3 3 0 1 0 0-.01M6 18l4-8h6l2 8M10 10l-1.5-3H6.5M16 10l-1-3h2",
  key: "M8 15a4 4 0 1 0 0-.01M11 12l9-9M17 6l2 2M15 8l2 2",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  flower: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 9c0-4 4-4 4-1M15 12c4 0 4 4 1 4M12 15c0 4-4 4-4 1M9 12c-4 0-4-4-1-4",
  anchor: "M12 5a2 2 0 1 0 0-.01M12 7v14M5 13a7 7 0 0 0 14 0M9 10h6",
  donut: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z",
};

type Placement = { glyph: keyof typeof GLYPHS; x: number; y: number; size: number; rotate: number };

function doodleTile(names: Array<keyof typeof GLYPHS>, tile: number, count: number, seed: number, sizeScale: number): Placement[] {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const columns = Math.round(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cellW = tile / columns;
  const cellH = tile / rows;
  const out: Placement[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const offset = row % 2 === 0 ? 0 : cellW / 2;
    out.push({
      glyph: names[(index * 7 + Math.floor(random() * names.length)) % names.length],
      x: (column * cellW + offset + cellW * (0.2 + random() * 0.35)) % tile,
      y: row * cellH + cellH * (0.15 + random() * 0.4),
      size: (17 + random() * 9) * sizeScale,
      rotate: Math.round(random() * 70 - 35),
    });
  }
  return out;
}

const svgCache = new Map<string, string>();

/** Seamless doodle wallpaper as a data-URI SVG tile (no network). */
export function doodleWallpaper({ stroke, names, tile = 260, count = 30, seed = 7, strokeWidth = 1.5, fills, sizeScale = 1 }: {
  stroke: string; names: Array<keyof typeof GLYPHS>; tile?: number; count?: number; seed?: number; strokeWidth?: number; fills?: string; sizeScale?: number;
}): string {
  const key = JSON.stringify({ stroke, names, tile, count, seed, strokeWidth, fills, sizeScale });
  const cached = svgCache.get(key);
  if (cached) return cached;
  const placements = doodleTile(names, tile, count, seed, sizeScale);
  const shapes: string[] = [];
  for (const item of placements) {
    const scale = item.size / 24;
    for (const dx of [-tile, 0, tile]) {
      for (const dy of [-tile, 0, tile]) {
        const x = item.x + dx;
        const y = item.y + dy;
        if (x < -40 || x > tile + 40 || y < -40 || y > tile + 40) continue;
        shapes.push(`<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${item.rotate} 12 12) scale(${scale.toFixed(3)})" d="${GLYPHS[item.glyph]}"/>`);
      }
    }
  }
  let dots = "";
  let state = seed * 31 + 3;
  for (let index = 0; index < 26; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const x = (state / 2147483648) * tile;
    state = (state * 1103515245 + 12345) % 2147483648;
    const y = (state / 2147483648) * tile;
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.3"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}"><g fill="${fills ?? "none"}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${shapes.join("")}</g><g fill="${stroke}">${dots}</g></svg>`;
  const uri = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  svgCache.set(key, uri);
  return uri;
}

export const WHATSAPP_GLYPHS: Array<keyof typeof GLYPHS> = ["heart", "star", "bubble", "camera", "note", "cup", "smile", "cloud", "phone", "mail", "balloon", "umbrella", "sun", "bolt", "moon", "clock", "gift", "pizza", "headphones", "icecream", "leaf", "bike", "key", "bell", "flower", "donut"];
export const TELEGRAM_GLYPHS: Array<keyof typeof GLYPHS> = ["plane", "star", "planet", "cat", "rocket", "heart", "note", "gamepad", "moon", "smile", "flower", "anchor", "icecream", "bolt", "cloud", "gift", "cup", "headphones"];
