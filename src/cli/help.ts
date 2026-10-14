export const HELP = `Usage: npm run demo -- <command> [file] [options]

Commands:
  plan-sheet     Gate the separate human request before sheet generation
  generate       Assemble an ordinary flow and an authorized optional sheet plan
  capabilities   Print the frozen capability manifest
  validate       Validate a demo JSON file and preflight local assets
  compile        Validate, then write deterministic compiled artifacts
  preview        Serve a local player preview and print the bound URL
  capture        Capture PNG frames through the IMESSAGE_DEMO ready API
  export         Render MP4 (H.264), GIF, and a poster PNG through the same player

Options:
  --human-request <file>    Actual human input, separate from generated app data
  --sheet-experience <quote> Verbatim intended experience from that human input
  --sheet-plan <file>       Company-specific app/pages/optional local actions
  --json              Write one JSON object to stdout
  --platform <name>   Constrain validation/compile to ios or macos
  --port <n>          Bind exactly this port; fail if it is occupied
  --out <path>        Artifact directory
  --at-ms <n>         Capture a single logical timestamp
  --checkpoint <id>   Capture a named checkpoint
  --frames            Sample fixed logical timestamps (not a real-time recording)
  --interval-ms <n>   Frame sampling interval (default 1000)
  --catalogue         Preview/capture the finite catalogue route
  --formats <list>    export: comma list of mp4,gif,poster (default all three)
  --fps <n>           export: MP4 frame rate (default 30)
  --theme <name>      export: override the flow theme, light or dark
  -h, --help          Show this help

Authoring:
  React to a message, reply to one, open its thread, long-press it, open an image,
  play an audio message at a position, open the effects picker, send with confetti,
  open the plus menu, enter selection, swipe to reveal timestamps, and move to the
  Messages list. An iOS poll is kind "poll" plus a poll-vote event
  { messageId, participantId, optionId, voted } at the moment the option should respond.
  Use the canonical events in src/contracts/index.ts. Do not author
  tail, gapBefore, or pixel positions.

Exit codes:
  0  success
  1  usage or unexpected error
  2  validation (schema, malformed polls, unsupported features)
  3  environment (assets, port, browser, ffmpeg)
`;

export const COMMAND_HELP: Record<string, string> = {
  capabilities: `Usage: npm run demo -- capabilities [--json]

Print the same capability manifest the compiler uses (src/contracts/capabilities.json).
`,
  validate: `Usage: npm run demo -- validate <file> [--json] [--platform ios|macos]

Load unknown JSON, reject malformed polls and unsupported features, preflight local assets
under public/demo-assets, then validate every declared target.
`,
  compile: `Usage: npm run demo -- compile <file> [--json] [--out <dir>] [--platform ios|macos]

Validate, then write deterministic compiled artifacts. Nothing is written on failure.
`,
  preview: `Usage: npm run demo -- preview <file> [--json] [--port <n>] [--catalogue]

Prints the real local URL only after the server is bound and the run manifest is ready.
Logs go to stderr. --json prints one ready object to stdout.
`,
  capture: `Usage: npm run demo -- capture <file> [--json] [--at-ms <n> | --checkpoint <id> | --frames] [--out <dir>] [--port <n>]

Waits on IMESSAGE_DEMO.seek/ready receipts. Screenshots [data-demo-frame] only.
A capture failure writes failure.json and does not write a success manifest.
`,
  export: `Usage: npm run demo -- export <file> --out <dir> [--formats mp4,gif,poster] [--fps 30]
       [--platform ios|macos] [--theme light|dark] [--json]

Seeks the same player as capture (IMESSAGE_DEMO.seek/ready, [data-demo-frame] only) once per frame
from 0 to the timeline end plus a held tail, and pipes the frames into ffmpeg:
  mp4     H.264 (libx264, CRF 18, yuv420p, constant frame rate, +faststart). An audio track only
          when the flow has audible audio messages that play; no music is added.
  gif     For email: two-pass palette, 15 fps, 480 px wide (lanczos), loops forever. Over 5 MB,
          fps and then width step down automatically and a warning is printed.
  poster  PNG of the final settled frame at device scale.

Options:
  --out <dir>          Must be missing or empty (default artifacts/exports/run-<pid>-<time>)
  --tail-ms <n>        Hold the final frame this long (default 1200)
  --scale <n>          Device scale for frames (default 2: 804x1748 on iOS)
  --gif-width <n>      GIF width in px (default 480)
  --gif-fps <n>        GIF frame rate (default 15)
  --crf <n>            x264 quality, lower is larger (default 18)
  --concurrency <n>    Player pages seeking in parallel (default up to 4; frames are per-timestamp)
  --gpu                Hardware GPU raster: faster, but pixels depend on this machine's GPU
  --no-dedupe          Screenshot every frame, even when DOM/scroll/animation state is unchanged
  --port <n>           Bind the local player to this port

ffmpeg comes from FFMPEG_PATH, then ffmpeg on PATH, then the bundled ffmpeg-static binary.
--json prints one object: the paths, durationMs, frames, per-file bytes/size/duration, timings.
A failure writes failure.json in the output directory and removes partial videos.
`,
};
