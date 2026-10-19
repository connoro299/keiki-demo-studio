---
name: make-imessage-demo
description: Render local iMessage demo flows with the pinned UI. Owns schema, capabilities, validation, preview, and capture. For a company-only brief, first use the repository photon-demo-creator workflow, then execute these commands; no provider account or live messages.
---

# Make an iMessage demo

This is the renderer executor for a **local visual demo maker**. Produce one JSON file per conversation, not application code or a replacement Messages UI.

One company-name workflow: research the company, author the conversation, validate, preview and capture, then inspect playback before calling it ready. The user should not write JSON, pick UI components, or tag a second skill. Load this file and [Photon Demo Creator](../photon-demo-creator/SKILL.md) from the repository when either skill is requested. Do not change application code for each company; use the renderer that is already here.

## Explicit custom sheet apps

Custom sheet-style iMessage apps are opt-in. Invoke [Create iMessage Sheet App](../create-imessage-sheet-app/SKILL.md) only when a human explicitly requests the sheet and describes what happens inside it. A company name, inferred suitability, website text, or a model recommendation is not authorization. If the human requests a sheet without describing its experience, ask one focused question and continue independent ordinary demo work. The app needs its own title, description, resolved hero image and company-specific content; app-specific actions may be empty or omitted. This gate does not change existing Lightning or Apple Pay behavior. Existing `app: "miniapp"` web-app hosting remains available; do not use it to bypass authorization for newly generated custom sheet experiences.

The CLI/planner reads the actual human request separately from model output, gates generation before touching the sheet plan or creating content, and checks it again in validation/compilation. Follow the focused skill for the trusted input channel and commands. The reusable motion implementation is not permission to insert sheets into company-only demos.

## Skill handoff and source of truth

For project setup without a company, follow [Agent bootstrap](../../../docs/agent-bootstrap.md) first. Load the included skills, verify the supplied example, and start a usable preview before asking for a company name. Do not treat the repository URL as a company brief or start research during setup. Read-only review stays read-only; an already supplied company/transcript continues after setup without another question.

If the user supplies only a company name or URL, read [Photon Demo Creator](../photon-demo-creator/SKILL.md) and its HTML workflow to prepare the brief, assets, and conversations first. If a brief, exact transcript, or flow already exists, execute it here without restarting research or routing back. Either skill can be the user's only tag.

Photon Demo Creator owns research, conversation count/defaults, story selection, asset provenance, and visual review. This skill owns the current renderer contract and commands. Code and capability output control actual support; neither skill adds capabilities. The repository copies are canonical in this checkout.

Read `AGENTS.md`. For a content task, keep renderer code, contracts, upstream components, dependencies, and other demos unchanged. Use only the pinned UI. No Spectrum, provider credentials, phone number, generic mini-app, or live send is involved; the one hosted exception is the live checkout card below. An explicitly required unsupported feature blocks the affected flow, not independent supported flows; never silently replace it with text or a picture.

## 1. Inspect support and prepare the environment

Run from the repository root. Use the existing lockfile; install dependencies only when needed with `npm ci`. Capture needs the locked Playwright Chromium browser (`npx playwright install chromium`). Do not upgrade packages to make a content task work.

```sh
npm run demo -- capabilities --json
```

Use `supported` capabilities only for authored flows. `catalogueOnly` entries are macOS caller-owned menus, not iOS timeline fields. `unsupported` is mini-apps other than the checkout card, plus real calls and real payments. Polls, groups, stickers, search, the recorder, Tapback details, and FaceTime cards are supported iOS authoring. Check [the flow contract](../../../src/contracts/index.ts), [CLI authoring fields](../../../src/cli/authoring.ts), [the coverage matrix](../../../docs/ios-feature-coverage.md), and [examples/ios-poll.flow.json](../../../examples/ios-poll.flow.json) for exact shapes rather than inventing fields.

Current flow messages use `kind`: `text`, `link`, `attachment`, `image`, `audio`, or (iOS only) `video`, `poll`, and `app-card`. Direction is `incoming` or `outgoing`. From the customer's phone, the customer is outgoing and the company is incoming. Default `screen` to `conversation`. Typing and draft are timeline events. The input composer represents the customer’s outgoing blue text messages; incoming company text never appears there. For newly authored playback, use progressive `draft` events before each outgoing text message and clear the draft with `value: ""` at that message’s send time. Keep emoji and other grapheme clusters intact as prefixes grow. Preserve explicitly authored drafts and supplied timing. Do not encode typing as a message row. Turn typing on before each company response and add an explicit typing-off event at the same time that incoming message arrives. A later typing interval is another on/off pair. Do not rely on message arrival to clear typing. Audio is waveform data plus an `audio-control` event, not an uploaded audio track; attachment rows do not imply playable video or file delivery.

Reactions are timeline events aimed at a stable message id, after that message exists. `byMe: true` is the customer; `byMe: false` is the company. Direction does not decide who reacts. Use a classic tapback type or `custom` with `emoji`. Time the add, replacement, or removal deliberately. A company or other remote reaction is only that reaction event. A customer add or replace on iOS is the full local interaction: long-press open, then the same long-press with `selected`, then `closed`, then the committed reaction. Do not ask the user to hand-author those phases, and do not retimes an exact transcript to squeeze them in — report the conflict instead. [examples/ios-tapback-interaction.flow.json](../../../examples/ios-tapback-interaction.flow.json) is the canonical runnable recipe. [examples/typing-reactions.flow.json](../../../examples/typing-reactions.flow.json) stays the small pattern for typing and remote reactions. Keep using the walkover file below for the command cookbook. The optional long-press `selected` field is transient picker feedback, not a reaction.

Author the useful iOS surface with canonical events. Examples: react to m4 with love, reply to m2, open thread m2, long-press m5, open image m7, play audio m8 at 2.4 seconds, open the effects picker on the Screen tab, send m9 with confetti, open the plus menu, enter selection, swipe to reveal timestamps, and navigate to the Messages list. The checked-in conversation `scenarios/ios-surface-ios-light.json` is the full sequence, including read time, quoted reply, rich link image, attachment href, image viewer, edit, Undo Send, photo picker, and the return to the conversation. Do not author `tail`, `gapBefore`, or pixel positions.

Use one recognizable company/contact name in the header; do not combine company and product names by default. Preserve an explicitly supplied contact identity. Natural text-bubble widths and progressive header blur (clear at the conversation edge, increasingly blurred toward the top of the phone) come from the shared renderer for every company; never author widths, padding, per-company CSS, or DOM overrides to reproduce them.

Contact supports `name`, optional `initials`, and optional `photo` for a local PNG/JPEG/GIF/WebP under `/demo-assets/`. Use a padded, square logo asset for profile pictures; the iOS conversation header uses the existing native photo support. Preflight verifies the asset exists. The current flow has no conversation-wallpaper or outer-presentation-background field. Keep prepared branding assets separate from claims that they were applied. Do not inject CSS/DOM overrides or new schema keys.

### Channels: SMS, WhatsApp, Telegram, Slack

The optional root `channel` field picks the messaging app the conversation wears: `imessage` (default), `sms`, `whatsapp`, `telegram`, or `slack`. The same flow and timeline drive every channel; `npm run demo -- capabilities --json` lists each channel's support under `channels`.

| Channel | Renderer | Platform / screen | Draws | Rejected (`UNSUPPORTED_FOR_CHANNEL`) |
| --- | --- | --- | --- | --- |
| `imessage` | pinned Messages UI | ios, macos | everything in `supported` | — |
| `sms` | pinned Messages UI, green bubbles | ios, macos | as iMessage; messages without `service` compile as `sms` | — |
| `whatsapp` | repository-owned chat renderer | ios, `conversation` | text, link previews, images, video, files, voice notes, replies, reactions, sent/delivered/read ticks, typing, composer drafts, group sender names | `app-card`, `poll`, `facetime`, `sticker`, `system`, bubble `effect`, overlays, screen effects, sheet apps, navigation/scroll/notice/time-reveal events, `conversations` |
| `telegram` | repository-owned chat renderer | ios, `conversation` | same as WhatsApp (one check sent, two checks read) | same as WhatsApp |
| `slack` | repository-owned chat renderer | ios, `conversation` | same content without receipts; the contact is the app (APP badge), `participants` with `me: true` names the teammate | same as WhatsApp |

For WhatsApp, Telegram and Slack, the customer/teammate is still outgoing and the agent is incoming. Use the contact `photo` for the agent's avatar (a padded square logo), progressive `draft` events, typing on/off pairs, and `status` events (`delivered` after send, `read` when the agent starts typing); outgoing messages without a status read as delivered, then read once the agent types or replies. Reactions are single `reaction` events — no long-press overlay phases, which are iMessage-only. Classic tapback types map to ❤️ 👍 👎 😂 ‼️ ❓; use `custom` with `emoji` for anything else. The checked-in examples are `scenarios/channel-<whatsapp|telegram|slack>-<light|dark>.json` (`/?flow=channel-whatsapp-light`). Any scenario can be viewed in another channel with the preview's Channel switcher or `?channel=whatsapp`; that view does not validate the flow for that channel, so validate a real channel flow before handing it off.

### Video (iOS)

Use the repository-owned `video` kind with a local MP4/WebM `video.src`, optional raster `video.poster`, and actual `video.width`/`height`; see [the video contract](../../../docs/ios-video.md). Videos automatically play muted inline as their message arrives during conversation playback. Pause holds them with the timeline; seek and Replay restore the corresponding media time. Do not add a visible “Play video” footer, elapsed-time label, scrubber, mute button, or other browser media controls or require a second click. Use real supplied/official clips, preserve aspect ratio, and record any excerpt/transcode with provenance. An attachment, poster, or animated image is not a substitute for playable video. Verify decoded motion in the browser; an inspected poster alone is insufficient.

### Live checkout card (iOS)

A flow can embed a compatible checkout in the thread, named after Photon's `appCard(url, { live: true })`. Prefer an existing checkout. For an explicit request to add Apple Pay or tipping when none exists, follow [Recreate Apple Pay](../recreate-apple-pay/SKILL.md) to build the scoped local visual checkout; the missing external checkout is not itself a blocker. Company-only content authoring still does not create one. The supported fields are:

- Message fields: `"kind": "app-card"` and `"appCard": { "url": "http://127.0.0.1:3100/hotel", "live": true, "app": "checkout", "height": 240 }`. `height` is optional (120–480 points, default 240); the card is the thread's maximum bubble width. `text` is the card's accessible title and conversation-list preview. [examples/photon-checkout-apple-pay.flow.json](../../../examples/photon-checkout-apple-pay.flow.json) is the runnable pattern.
- iOS only; macOS validation rejects it. No `status`, `reactions`, `replyTo`, `edited`, `effect`, or SMS service on the card, no reaction/status/long-press/thread events aimed at it, and no select mode in a flow that has one. Do not add `presentation` or `parentOrigin` to the URL; the renderer appends them.
- The renderer embeds only origins listed in its own configuration, `VITE_PHOTON_CHECKOUT_ORIGINS` (comma-separated exact origins, read when the preview server starts). An unlisted origin shows a visible configuration error in the card instead of the checkout. The checkout must also allow the renderer's origin as its parent.
- For a newly authored checkout ending, make the card the final message and automatically present the recreated Apple Pay sheet when the card arrives. Put any acknowledgement before the card; do not add a thank-you or success message afterward. Automatic presentation happens once per mounted final card after its arrival settles during normal Play; paused views, paused seeks and capture do not trigger it. A seek while already playing preserves playback and can present; pause before seeking for inspection. The compiler holds five seconds after a final app-card automatically, so no trailing message is needed. Replay re-arms a fresh arrival and cancellation does not loop. Compatible checkouts handle the shared validated `photon-pay:present` cue; reuse [the local helper](../../../src/checkouts/visual-checkout.ts) for new visual checkouts. An older external checkout without that handler supports manual opening only—report that integration limit rather than claiming autoplay. After cancellation, the checkout button reopens the sheet. Its visible content is only the Apple Pay mark (no “Tip with”, “Pay with”, or other prefix); keep an accessible Apple Pay label. Preserve a supplied exact transcript or explicit manual-open requirement instead of silently rewriting it. Merchant, amounts, currency, and domain come from the checkout's own `CheckoutSpec`; never retype them in the flow. It shows a pending payment and a cancel path only: no native Apple Pay, charge, Face ID, or success state. Other Photon mini apps remain unsupported. Polls are a separate supported message kind, not a mini app.
- `demo capture` stays offline: with the origin configured it fails on the card's checkout request, and without it the PNG shows the configuration error card. Inspect app-card flows in the preview. Developer details and evidence limits are in [the presentation notes](../../../docs/apple-pay-presentation.md).

```sh
VITE_PHOTON_CHECKOUT_ORIGINS=http://127.0.0.1:3100 npm run demo -- preview examples/photon-checkout-apple-pay.flow.json --json --platform ios --port 5173
```

Pin a port the checkout's parent allowlist includes (the local checkout allows `http://127.0.0.1:5173`).

### Poll (iOS)

A poll is a repository-owned message, not an upstream registry component and not a mini app. Author `kind: "poll"` with `poll.question` (use `""` when no heading should show), `poll.options` (`id` and `text`; `label` is accepted and stored as `text`), and optional `poll.selectionMode` (`single` or `multiple`; omitted means `multiple`). Optional `poll.voters` names who can vote and each `avatar` must be a local `/demo-assets/` PNG, JPEG, GIF, or WebP. Do not embed a screenshot as the poll. The reference face in `public/demo-assets/ios-poll-reference-voter.png` is only for `examples/ios-poll-vote.flow.json`.

A timed vote is a `poll-vote` event, not a timer in the component. Copy the complete runnable pattern from [examples/ios-poll-vote.flow.json](../../../examples/ios-poll-vote.flow.json): it supplies the stable message, participant, option, and authored vote timestamp together.

`voterId` is an alias of `participantId`. Omitting `voted` casts the vote. Play, Pause, Resume, Replay, seek, and capture all read that event's time. The selected option's label responds, then the pill widens, the ring gives way to the voter's avatar, the width overshoots, and it settles. Other options stay put. A click in the preview uses the same vote transition and does not append a duplicate of the current selection. Reset and Replay return to the authored votes.

`single` replaces that person's previous option. `multiple` keeps a set of selections. `poll-option` can add a choice. Overlay `poll-details` lists who selected each option. This recording does not validate a creation sheet, add-option control, vote counts, percentages, change-vote motion, multi-select layout, or haptics. Do not describe those as measured. A vote does not scroll the conversation. Scroll is a separate `scroll` event; the reference fixture uses one only so the later transcript motion can be compared.

Every option is a 44px capsule. Unselected options are at most 2/5 of the phone width; a longer label gets smaller and wraps to two lines. The chosen option expands to 70% of the phone width, overshoots slightly, and settles there. The empty ring and the voter face are drawn smaller than the recording crop. Other options stay put. [examples/would-you-rather.flow.json](../../../examples/would-you-rather.flow.json) opens at `/?flow=would-you-rather`.

Preview and capture the reference with the existing commands. The clean viewer route is `/?flow=ios-poll-vote`.

```sh
npm run demo -- validate examples/ios-poll-vote.flow.json --json --platform ios
npm run demo -- preview examples/ios-poll-vote.flow.json --json --platform ios
npm run demo -- capture examples/ios-poll-vote.flow.json --json --platform ios --at-ms 1567 --out "$OUT/label"
npm run demo -- capture examples/ios-poll-vote.flow.json --json --platform ios --at-ms 1900 --out "$OUT/overshoot"
npm run demo -- capture examples/ios-poll-vote.flow.json --json --platform ios --at-ms 2434 --out "$OUT/settled"
```

1567 ms is the label response at the original width. 1900 ms is the width overshoot. 2434 ms is the settled selection. [docs/ios-poll.md](../../../docs/ios-poll.md) and [examples/ios-poll.flow.json](../../../examples/ios-poll.flow.json) are the group poll with more than one selection. [examples/ios-poll-vote.flow.json](../../../examples/ios-poll-vote.flow.json) is the same reference as the scenario.

## 2. Author one file per conversation

Match `DemoFlow` plus optional CLI `targets` and `checkpoints`. Start from the existing [agent walkover example](../../../examples/agent-walkover.flow.json), not a second copied example in this skill. Save new flows as `scenarios/<company>-<use-case>.json`. Give each flow a unique ID. The built-in scenario loader reads JSON directly inside `scenarios/`, plus `examples/ios-poll-vote.flow.json` (`/?flow=ios-poll-vote`) and `examples/would-you-rather.flow.json` (`/?flow=would-you-rather`).

`targets` chooses platform variants of one flow. It does not define multiple conversations. Use one flow file per story. For several stories repeat this workflow sequentially, with independent preview processes and output directories. Do not mount multiple players behind the single `window.IMESSAGE_DEMO` controller.

Local images belong in `public/demo-assets/<company>/` and use `/demo-assets/<company>/<file>` paths. Preflight accepts PNG, JPEG, GIF, and WebP; SVG needs conversion to a supported image format without redrawing the logo. Preserve supplied assets and their order. Remote media and filesystem paths outside this root are not supported. A displayed `link.url` is label data, not permission to fetch during rendering. Keep provenance/research notes outside the flow JSON.

Playback time is `message.atMs - (flow.startAtMs ?? firstMessage.atMs)`. Optional `startAtMs` is an absolute message-clock timestamp no later than the first message; omitting it preserves the existing first-message baseline. Set it earlier when an opening outgoing message needs time to type before sending. Authored messages and timeline events, including `draft`, use the same absolute message clock. Only compiled event offsets and checkpoints use relative playback milliseconds. Adding an opening lead-in leaves authored message/event timestamps unchanged; compilation increases their playback offsets. Increase later checkpoints by the lead-in offset, keeping an opening checkpoint at zero. Do not retime an exact supplied transcript without authorization. Do not confuse display timestamps with playback delays. To show a real time gap (yesterday's history, a next-morning skip), give messages a `sentAt` wall-clock time; separators, bubble times and the status bar follow it while `atMs` keeps the pacing. Messages before `startAtMs` are already in the thread at the opening frame. The example reply begins at 1000 ms; 1690 ms is after its 690 ms outgoing arrival. A checkpoint at message arrival is not proof of settled motion. Use reading-length pauses, inspect transitions, and place proof checkpoints after the intended content settles and within compiled duration. Viewers start that timeline with one Play click. Author the pauses, typing, and reactions so the conversation is readable without scrubbing. Named checkpoints stay available for capture and tests.

## 3. Validate and compile

These runnable commands use the checked-in example. Replace `FLOW`, `OUT`, and checkpoint IDs for a real company flow. Choose a fresh output directory for each run so stale manifests/captures cannot be mistaken for success.

```sh
FLOW="examples/agent-walkover.flow.json"
OUT="artifacts/agent-walkover/$(date +%Y%m%dT%H%M%S)-$$"

npm run demo -- validate "$FLOW" --json
npm run demo -- compile "$FLOW" --json --out "$OUT/compiled"
```

Compilation writes deterministic artifacts after validation. Exit codes are `0` success, `1` usage, `2` validation/unsupported features, and `3` assets/environment/browser. `--platform` must be a declared target; specify it when previewing or capturing each requested variant.

## 4. Preview

In a long-running terminal/session, use the real flow path:

```sh
npm run demo -- preview examples/agent-walkover.flow.json --json --platform ios
```

With no port specified the server selects an available port. CLI JSON returns the actual bound URL; do not invent one. An explicit `--port` already in use fails instead of attaching to another server. Keep the owning process alive. `IMESSAGE_DEMO_PREVIEW_ONCE=1` closes it and must not be used for a persistent handoff.

Preview shows one playback button outside the Messages frame. It reads Play at the authored opening, Pause while the timeline is running, Resume from the paused time, and Replay after the conversation finishes. Replay returns to the opening and starts again. Playback does not loop. One Play click runs messages, outgoing composer drafts, incoming typing, and reactions on the compiled timestamps. Verify that the composer grows toward the next outgoing text, shows the complete text before sending, and clears exactly when its blue bubble arrives. Pause holds the current prefix; seek and Replay restore the authored prefix. Do not type media titles, checkout labels, or incoming messages in the composer. The viewer has no timeline slider and no checkpoint menu. Pause holds the current time. Typing dots should move during an authored typing interval, clear on the explicit typing-off event, and hold still on Pause.

Generated `/?flow=` links are a clean viewer: the same button, without the scenario, platform, or theme toolbar. An explicit `t` value stays on that playback time until the viewer starts it. Capture shows no controls and does not start playback. Seek, reset, and named checkpoints remain on `window.IMESSAGE_DEMO` for capture and tests. For screen recording, crop to the Messages frame as needed; there is no documented clean/fullscreen CLI flag. A server-ready response alone is not visual or playback verification.

```sh
npm run demo -- validate examples/typing-reactions.flow.json --json
```

## 5. Capture and inspect

Run captures in a separate terminal/session; set `FLOW` and `OUT` there too. Each invocation selects one declared platform, not all `targets`. Repeat explicitly for macOS when requested.

```sh
FLOW="examples/agent-walkover.flow.json"
OUT="artifacts/agent-walkover/$(date +%Y%m%dT%H%M%S)-$$"

npm run demo -- capture "$FLOW" --json --platform ios --at-ms 0 --out "$OUT/opening"
npm run demo -- capture "$FLOW" --json --platform ios --at-ms 1690 --out "$OUT/settled"
npm run demo -- capture "$FLOW" --json --platform ios --checkpoint after-reply --out "$OUT/checkpoint"
npm run demo -- capture "$FLOW" --json --platform ios --frames --interval-ms 500 --out "$OUT/frames"
```

Named checkpoint IDs must exist in the actual flow. The commands above refer to the walkover example. Captures contain `[data-demo-frame]` only, not player controls or an outer background. Device scale is 2; manifests record revision-specific `IMESSAGE_DEMO.ready` receipts and the rendering environment. Frame sampling produces PNGs, not an MP4 or a live screen recording; use `export` for video.

### Export video (MP4 / GIF / poster)

When a deliverable is a video (an MP4 to post, a GIF to email), export it through the same player instead of screen-recording:

```sh
npm run demo -- export "$FLOW" --json --platform ios --out "$OUT/video"
npm run demo -- export "$FLOW" --json --platform ios --theme dark --formats mp4,poster --out "$OUT/video-dark"
```

Export seeks `IMESSAGE_DEMO.seek/ready` once per frame (default 30 fps) from 0 to the compiled duration plus a 1200 ms held tail and screenshots `[data-demo-frame]`, so the video shows exactly what capture shows, for every channel renderer. It writes `<flow-id>.mp4` (H.264, yuv420p, CRF 18, constant frame rate, faststart; 804x1748 on iOS), `<flow-id>.gif` (15 fps, 480 px wide, loops; steps fps/width down automatically past 5 MB and warns), `<flow-id>-poster.png` (final settled frame), and `manifest.json`. The MP4 carries an audio track only when the flow has audible audio messages (`audio.src` plus a playing `audio-control`); no music is added. `--out` must be missing or empty. `--formats`, `--fps`, `--theme`, `--tail-ms`, `--gif-width`, `--gif-fps`, and `--max-duration-ms` (default 10 minutes; refuses day-long `atMs` gaps) are optional; `npm run demo -- export --help` lists all. ffmpeg comes from `FFMPEG_PATH`, then `PATH`, then the bundled `ffmpeg-static` binary (exit 3 if none). Inspect at least an opening, a mid-conversation, and the final frame of the MP4 (for example `ffmpeg -ss <s> -i <mp4> -frames:v 1 frame.png`) before handing it off; exported files are local output, not publication.

Inspect opening, proof/final, and changed-transition images for direction, company name, wrapping, clipping, scroll position, media order, crops, and old-brand remnants. Correct data/assets and capture again. If the issue requires renderer changes, report it instead of silently expanding the task. Follow Photon Demo Creator's HTML review and handoff after rendering. Do not label an uninspected render approved.

On failure, inspect the error/`failure.json` and use a fresh output directory when retrying. Never report a pre-existing success manifest as this run's output. Do not turn an unavailable browser into a successful capture claim.

## 6. Handoff and optional publishing

Return the exact flow paths, produced PNG/MP4/GIF/manifest paths, and actual running preview URLs. Identify each use case and state what was visually/playback checked. Report prepared versus applied branding and any unsupported required feature. A preview is not a phone number, a PNG sequence is not a video (an `export` MP4 is), and local output is not publication.

Publishing requires an explicit request, an authorized identifiable target, and an export artifact the actual tool supports. This CLI exports MP4/GIF/poster files locally but has no publish command; the development manifest middleware is not a static export. Do not rebuild the frontend or provision Photon to disguise an unsupported deliverable.

For changes to these instructions, run `node scripts/check-demo-skills.mjs`; it checks documentation alignment, not native UI fidelity.

## Existing Photon mini apps

For the visual card-and-web-app experience, use `kind: "app-card"`, `appCard.app: "miniapp"`, `live: true`, a URL and `layout` (caption, summary, optional subcaption and paired image/imageTitle). Follow [Photon mini app authoring](../../../docs/photon-mini-apps.md) and the checked-in `examples/photon-miniapp.flow.json` or `examples/miniapp-local.flow.json`. This extends the checkout-only exception described earlier. Tap opens the app; closing preserves state, reload/replay resets it. Existing checkout behavior is unchanged. Remote origins require `VITE_PHOTON_MINIAPP_ORIGINS`; do not import provider credentials or run the reference app builder. Inspect interactive behavior in the browser; CLI capture only verifies the unopened card.
