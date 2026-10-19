# Make any product feel like itself in iMessage.

Local studio for authoring a conversation as JSON and previewing or capturing the rendered conversation with the pinned iMessage UI. It does not send iMessage, SMS, or RCS, and it does not need a provider account.

The assembled app entry is `src/main.tsx` -> `src/App.tsx`. Flows live in `scenarios/`. Two repository skills work together: [Photon Demo Creator](.agents/skills/photon-demo-creator/SKILL.md) handles company research, story selection, and review; [Make an iMessage demo](.agents/skills/make-imessage-demo/SKILL.md) handles the renderer's schema and commands.

## Give this repo to your agent

Copy this into a coding agent with terminal/filesystem access and access to this repository:

```text
Set up https://github.com/tecxbro/imessagedemo for me.
Follow the README's agent bootstrap instructions, load the included skills,
verify a sample render, and start the local preview.
When ready, tell me which skills are available and ask for a company name.
```

The agent does the setup; you do not have to install the skills individually, write JSON, or run the commands yourself. This requires repository access, a compatible Node/npm environment, and permission to download dependencies and the capture browser. A link cannot grant access to a private repo.

**Agents: follow [Agent bootstrap](docs/agent-bootstrap.md) before asking for a company.** Clone or safely reuse the checkout, load both repository skills, install the locked dependencies/browser, build, validate and capture the supplied example, and keep its local preview running. Do not research a company during setup. A review-only request is not a setup request.

The included skills are `$make-imessage-demo` (rendering) and `$photon-demo-creator` (company research and conversation design). They are available from `.agents/skills/` in this checkout; personal/global skill folders are not overwritten. Agents without a skill picker can read the files directly.

After successful verification, the agent's handoff ends like this (real paths/URLs replace the placeholders):

```text
Local setup is ready.

Skills loaded from this project:
$make-imessage-demo — render, preview, and capture conversations
$photon-demo-creator — research companies and design the demos

Preview: <actual running URL>
Sample capture: <actual inspected PNG path>

hit me with a company name.
```

Reply with a company name or URL in the same agent session. The agent then uses the included skills; no second setup prompt or second skill tag is required. A supplied company/transcript can also go directly through setup into demo creation without being requested again.

**This is local setup, not public hosting.** No Photon account, texting number, public site, or global skill installation is created. A remote agent must provide an actually reachable preview route or explain its access limitation; remote loopback is not automatically reachable on your computer.

## Start with a company

From this checkout, tell your agent:

```text
Use $photon-demo-creator to make HTML iMessage demos for https://lovable.dev.
Choose relevant conversations, inspect the renders, and return preview URLs
and PNG captures so I can screen-record them.
```

Only one tag is needed. `$make-imessage-demo` can also route a company-only request into the same research workflow. Existing transcripts go straight to authoring/rendering. Read [Agent workflow](docs/agent-workflow.md) for skill ownership and synchronization. The renderer remains unchanged; agents produce data/assets, not new UI code.

## 1. Write and validate a flow

Create a JSON file matching `DemoFlow` in `src/contracts/index.ts`, plus optional CLI fields from `src/cli/authoring.ts`. `platform` is `ios` or `macos`. `theme` is `light` or `dark`. Each message needs `direction` `incoming` or `outgoing`. Shared kinds are `text`, `link`, `attachment`, `image`, and `audio`. iOS also accepts `app-card`, `system`, `facetime`, `sticker`, and `poll`. Typing is the flow field `typing`, not a message kind. Local images are files in `public/demo-assets/` referenced as `/demo-assets/<file>`. The coverage matrix is [docs/ios-feature-coverage.md](docs/ios-feature-coverage.md).

```sh
npm run demo -- validate ./your-flow.json --json
```

Exit `0` means valid. Exit `1` means usage error. Exit `2` means invalid or unsupported flow content, including malformed polls and mini apps other than the checkout card. Exit `3` means an asset, browser, or environment failure. Supported image formats are PNG, JPEG, GIF, and WebP; SVG needs preparation as a supported image. Optional audible audio uses a local `/demo-assets/` file with an `m4a`, `mp3`, `wav`, `aac`, or `caf` extension.

Optional `channel` chooses the app the demo wears: `imessage` (default) and `sms` (green bubbles) use the Messages UI; `whatsapp`, `telegram`, and `slack` use repository-owned iPhone chat renderers (`src/renderers/chat`) fed by the same timeline. Those three need `platform: "ios"` and `screen: "conversation"`, and support text, links, images, video, files, voice notes, replies, reactions, receipts (not Slack), typing, and drafts; Messages-only kinds, effects, overlays, and navigation fail validation with `UNSUPPORTED_FOR_CHANNEL`. Examples: `scenarios/channel-<whatsapp|telegram|slack>-<light|dark>.json`. The preview's Channel switcher or `?channel=` views any scenario in another channel. See the [renderer skill](.agents/skills/make-imessage-demo/SKILL.md) for the support matrix.

`screen` is `conversation` for ordinary demos. On iOS it may also be `list` or `new-message`; macOS accepts `conversation` only. Customer messages are outgoing and company messages are incoming. Turn typing on before a company reply and explicitly turn it off when that message arrives. A message may also carry `sentAt` (epoch ms): the wall-clock time the transcript shows, decoupled from playback `atMs`, so date separators (iMessage/SMS) and day chips (WhatsApp, Telegram, Slack) read real gaps and the status-bar clock follows the newest arrived `sentAt` once it passes `nowMs`. Messages authored before `startAtMs` are thread history: present and settled at the opening frame. Reactions target stable message ids. `examples/typing-reactions.flow.json` is a small runnable example of both. `examples/agent-walkover.flow.json` has a reply arriving at playback `1000`, matching `after-reply`. Use `1690` for a post-arrival settled capture of that example.

`examples/ios-poll.flow.json` is a valid group poll. `examples/ios-poll-vote.flow.json` is the recorded single-choice vote; open it at `/?flow=ios-poll-vote` or `npm run demo -- preview examples/ios-poll-vote.flow.json`. `examples/unsupported-poll.flow.json` is a poll with no options and fails validation with exit `2`. It does not open a browser or write an image.

## 2. Preview and capture

```sh
npm run demo -- preview ./your-flow.json --json --platform ios
```

Use the actual local URL returned by the CLI and keep its process alive. Preview has one playback button outside the Messages frame: Play, Pause, Resume, or Replay. It follows the compiled timeline. A specified `--port` must be free. Capture uses the same renderer from another terminal/session:

```sh
npm run demo -- capture ./your-flow.json --json --platform ios --checkpoint after-reply --out artifacts/captures/run
npm run demo -- capture ./your-flow.json --json --platform ios --at-ms 400 --out artifacts/captures/mid
npm run demo -- capture ./your-flow.json --json --platform ios --frames --interval-ms 1000 --out artifacts/captures/frames
```

Checkpoint IDs must exist in your flow. Use fresh output directories for each run. `targets` chooses platform variants; preview/capture selects one variant per invocation, so repeat explicitly for each desired platform.

Playback time is `message.atMs` minus the first message `atMs`; checkpoints use that clock. PNGs contain `[data-demo-frame]` only. Their pixel size is the CSS viewport times the capture device scale (2 on both platforms). `manifest.json` records the scenario, timestamps, and ready receipt. Sampled PNGs are not a video, and a local preview is not publication.

Export a real video file (MP4 for X, GIF for email) through the same player:

```sh
npm run demo -- export ./your-flow.json --out artifacts/exports/run --json
npm run demo -- export ./your-flow.json --out artifacts/exports/dark --formats mp4,gif,poster --fps 30 --platform ios --theme dark
```

`export` seeks `IMESSAGE_DEMO.seek/ready` once per frame from 0 to the compiled duration plus a held tail (`--tail-ms`, default 1200) and pipes each `[data-demo-frame]` screenshot straight into ffmpeg. Outputs: `<id>.mp4` (H.264 `libx264`, `yuv420p`, CRF 18, constant frame rate, `+faststart`, 804x1748 on iOS at scale 2), `<id>.gif` (two-pass palette, 15 fps, 480 px wide, loops forever; past 5 MB it steps fps then width down and warns), `<id>-poster.png` (final settled frame), and `manifest.json`. The MP4 has an audio track only when the flow has audible audio messages; no music is added. `--out` must be missing or empty. `--json` prints the paths, `durationMs`, `frames`, and per-file bytes, dimensions, and durations. Frames whose DOM, scroll, and animation state are unchanged reuse the previous screenshot (`--no-dedupe` disables); `--concurrency` sets parallel player pages and `--gpu` trades bit-for-bit software rendering for speed. ffmpeg resolves from `FFMPEG_PATH`, then `PATH`, then the bundled `ffmpeg-static` dependency; none is exit `3`. Programmatic use: `exportVideo(flowPathOrDemoFlow, { outDir, formats })` from `src/export/video.ts`.

```sh
npm run demo -- capabilities --json
```

`supported` entries compile into one timeline: messages, tapbacks, replies, read time, links, attachments, images, audio, overlays, effects, and navigation. `catalogueOnly` stays off that timeline. The [renderer skill](.agents/skills/make-imessage-demo/SKILL.md) is the canonical command cookbook.

## Checks

```sh
npm ci
node scripts/check-demo-skills.mjs
node scripts/check-agent-bootstrap.mjs
npm run verify:upstream
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
```

`check-demo-skills` checks instructions and example timing; `check-agent-bootstrap` checks setup routing and handoff requirements. Neither executes the renderer or proves browser output. `npm run dev -- --host 127.0.0.1 --port 4173` serves the app. `/?foundation=ios` and `/?foundation=macos` are stock shell smoke routes. `/?flow=basic-ios-light&t=0` opens a corpus scenario paused at that playback time, with Play outside the Messages frame. `t` is playback milliseconds and is not forced back to zero.

## Current boundaries

The pin is the current `imessage.swerdlow.dev` registry. iOS flows can author groups, search, stickers, the recorder, Tapback details, FaceTime cards, and polls. A FaceTime card does not place a call. Photon mini apps other than the checkout card, and provider send/receive, stay out of scope. The live Photon checkout is an iOS `app-card`: its Apple Pay button opens a recreation of the recorded Apple Pay sheet over the phone, with the checkout's own values, and never calls native Apple Pay or charges anything. Its configuration (`VITE_PHOTON_CHECKOUT_ORIGINS`), bridge, provisional card picker, and measured visual differences are in [the presentation notes](docs/apple-pay-presentation.md). Do not rewrite a required unsupported interaction as text or a picture. Do not author `tail`, `gapBefore`, or pixel positions.

The current flow has contact name/initials, not an avatar-logo field, chat wallpaper, or outer presentation settings. Researching an asset does not add its placement to the renderer. Keep prepared versus visibly applied branding clear. `export` writes local MP4/GIF/poster files; there is no publish command, and publication requires actual supported tooling, not a claim based on a development URL.

## Troubleshooting

- Exit `2` with a field path: inspect the unsupported/schema error rather than inventing a replacement field.
- Exit `3` on validation: check asset existence, format, dimensions, root containment, and external paths.
- Exit `3` on preview: an explicit port may be occupied; omit `--port` for an available one.
- Capture needs `npx playwright install chromium`. The full e2e suite also needs the locked WebKit browser: `npx playwright install chromium webkit`. Missing browsers are not passing tests.
- Native Apple screenshots were not supplied with the pin. The repo's own PNGs are not native-fidelity evidence. Historical release reports describe their original run, not checks rerun today.

## Photon mini app experience

Existing web apps can be authored as iOS `app-card` messages with `app: "miniapp"` and card layout metadata. Tap to open an interactive sheet; close/reopen preserves state and reload/replay resets it. See [mini app authoring and examples](docs/photon-mini-apps.md). This is separate from live messaging or app generation.

### Explicit custom sheet apps

A human-requested, described sheet can now be generated with company-specific preview art and local app content. Company-name-only requests remain ordinary demos. Read [the sheet contract and examples](docs/imessage-sheet-apps.md) or use [Create iMessage Sheet App](.agents/skills/create-imessage-sheet-app/SKILL.md). [Recreate iMessage Sheet Motion](.agents/skills/recreate-imessage-sheet-motion/SKILL.md) owns motion maintenance and reference QA. Existing checkout/Apple Pay and web-app hosting remain separate.
