# AGENT.md — Loudness DD

Audience: coding agents (Cursor/Copilot) and maintainers. This is a high-signal, task-oriented guide to modify, test, and ship changes to the Loudness DD Chrome extension safely.

## TL;DR Commands

- Install toolchain: `mise install`
- Install dependencies: `mise run install`
- Dev (HMR for popup): `mise run dev`
- Build (type-check + bundle + zip): `mise run build`
- Full validation: `mise run check`
- Lint/format/type-check: `mise run lint`, `mise run format`, `mise run type-check`

The toolchain is locked in `mise.toml` and `mise.lock`: Node 24.18.0, pnpm 11.20.0,
actionlint 1.7.12, and ShellCheck 0.11.0.

## What this project does

Loudness DD is a Chrome MV3 extension that:

- Captures audio from selected tabs, measures loudness in LUFS (BS.1770-5), and balances levels toward a target LUFS.
- Provides a limiter to prevent clipping.
- Lets users register tabs, toggle auto-balance, set target LUFS, and manage per‑tab gain.

## Key architecture

- MV3 Service Worker: background coordination, lifecycle, storage, and messaging.
  - File: [src/background.ts](src/background.ts)
- Offscreen Document: runs Web Audio graph (worklet + compressor/limiter + gain), calculates LUFS, sends updates.
  - Files: [offscreen.html](offscreen.html), [src/offscreen.ts](src/offscreen.ts)
- Audio/LUFS engine: ITU-R BS.1770-4 implementation and helpers.
  - File: [src/audio/lufs.ts](src/audio/lufs.ts)
  - Worklet: [src/worklets/lufs-processor.ts](src/worklets/lufs-processor.ts)
- Popup UI: Vue 3 + Pinia app that communicates with background via `chrome.runtime.sendMessage`.
  - Entry/UI: [src/main.ts](src/main.ts), [src/App.vue](src/App.vue), [src/components/](src/components/)
- Build & packaging: Vite + CRXJS plugin; release zip produced automatically.
  - Config: [vite.config.ts](vite.config.ts), Manifest: [manifest.json](manifest.json)
- State: Pinia stores live under [src/stores/](src/stores/)

Permissions (MV3): `tabCapture`, `tabs`, `activeTab`, `offscreen`, `storage`.

## Message flow (core contracts)

Handshake:

- Offscreen → Background: `OFFSCREEN_READY`

Background notification messages (no response expected):

- `LUFS_UPDATE` { tabId, momentary, shortTerm, integrated, blockCount }
- `CAPTURE_STARTED` { tabId }
- `CAPTURE_STOPPED` { tabId }
- `CAPTURE_ERROR` { tabId, error }
- `STREAM_ENDED` { tabId, reason }
- `GAIN_UPDATED` { tabId, gainDb }
- `LIMITER_UPDATED` { settings }
- `LUFS_RESET` { tabId }

Background request/response messages (async responses):

- `GET_TABS` → { tabs, soloTabId }
- `GET_AUTO_BALANCE_SETTINGS` → { settings }
- `SET_AUTO_BALANCE_ENABLED` { enabled } → { success, settings }
- `SET_TARGET_LUFS` { targetLufs } → { success, settings }
- `GET_LIMITER_SETTINGS` → { success, settings }
- `SET_LIMITER_SETTINGS` { settings } → { success, settings }
- `START_CAPTURE_REQUEST` { tabId } → { success, error? }
- `STOP_CAPTURE_REQUEST` { tabId } → { success, error? }
- `SET_GAIN_REQUEST` { tabId, gainDb } → { success, error? }
- `SET_MAX_GAIN_REQUEST` { tabId, maxGainDb } → { success, error? }
- `TOGGLE_SOLO` { tabId } → { success, soloTabId }
- `GET_SOLO` → { soloTabId }
- `CLEAR_SOLO` → { success, soloTabId: null }
- `AUTO_BALANCE_REQUEST` { targetLufs? } → { success }
- `RESET_LUFS_REQUEST` { tabId } → { success }

Offscreen-targeted commands (Background → Offscreen via `target: 'offscreen'`):

- `START_CAPTURE` { tabId, streamId } → { success, error? }
- `STOP_CAPTURE` { tabId } → { success }
- `SET_GAIN` { tabId, gainDb } → { success }
- `GET_LUFS` { tabId } → emits `LUFS_UPDATE`
- `RESET_LUFS` { tabId } → { success }
- `SET_LIMITER` { settings } → { success, settings }
- `GET_LIMITER` → { success, settings }

Guard notes:

- Integrated LUFS is only reliable after enough samples; background enforces a `MIN_BLOCKS_FOR_RELIABLE_LUFS` gate. Avoid relying on `-Infinity` readings.
- Offscreen maintains one processor per `tabId`. Cleanup is crucial on stream end/navigation.

## Build, run, and release

Dev:

- `mise run dev` launches Vite server for the popup UI (HMR). Background SW and offscreen page reload via CRX tooling on rebuilds.

Build:

- `mise run build` installs locked dependencies, runs `vue-tsc --build`, then runs the Vite build.
- The unpacked extension is written to `dist/`.
- The versioned release zip is written to `release/loudness-dd-v<version>.zip`.

Load in Chrome:

1. `mise run build`
2. `chrome://extensions/` → enable Developer mode → Load unpacked → select `dist`

CI and release:

- `CI` calls the reusable `Test` and `Build` workflows in parallel and reports their combined result through the stable `Gate` job.
- `Test` runs `mise run check`; `Build` runs `mise run ci:package`, verifies the manifest/archive version, and uploads the zip for 14 days.
- A `v*` tag must match the version in `package.json`. `Publish` reruns Test and Build, creates checksums and provenance, then creates or updates a draft GitHub Release.

## Coding conventions

- TypeScript-first. Avoid `any` and unsafe casts; use explicit interfaces for messages.
- Prefer early returns; avoid deep nesting and try/catch without handling.
- Keep background/offscreen message enums and interfaces in sync; add types for payloads.
- Vue 3 Composition API + Pinia for state. Match existing style.
- Run `mise run check` before shipping.

## Safe-edit checklist (read before you change things)

1. If you add/rename a message type:
   - Update both senders and receivers (background, offscreen, popup).
   - Extend the corresponding TypeScript interfaces.
   - Verify no message is incorrectly handled as a “notification” when a response is needed.
2. Offscreen assets:
   - Offscreen entry must be an HTML page declared in Vite input: see [vite.config.ts](vite.config.ts) `rollupOptions.input.offscreen`.
3. Manifest changes:
   - Do not add new permissions without documented rationale. Review Chrome’s MV3 constraints.
4. Audio changes:
   - Validate CPU/perf, clamp user-facing ranges (gain, thresholds, ratios).
   - Keep limiter defaults conservative (avoid audible pumping).
5. Lifecycle:
   - Preserve cleanup paths (`STREAM_ENDED`, `onRemoved`, `onUpdated`).
   - Keep badge updates coherent with auto-balance and tab count.
6. Storage:
   - Persist only stable, recoverable state. Captured streams cannot be restored after reload; do not try to persist them.

## Common agent tasks

- Add a new control in popup:
  1. Create/extend a Pinia store in [src/stores/](src/stores).
  2. Add a Vue component in [src/components/](src/components/) and wire UI → store.
  3. Send messages to background for side effects; background may forward to offscreen.
  4. Add unit tests for store logic and E2E to verify UI → audio impact if needed.

- Add/modify a message:
  1. Define payload interface(s) next to handler.
  2. Extend background switch in [src/background.ts](src/background.ts).
  3. Extend offscreen switch in [src/offscreen.ts](src/offscreen.ts) when targeted.
  4. Update any popup callers.

- Adjust limiter defaults:
  1. Update offscreen defaults in [src/offscreen.ts](src/offscreen.ts) (`globalLimiterSettings`).
  2. Ensure UI shows current values via `GET_LIMITER_SETTINGS`.
  3. Add coverage for edge values (e.g., extreme ratios, fast attack).

## Tests

- Unit (`vitest` + `@vue/test-utils`, `jsdom`): `mise run test`
  - Location: [`src/__tests__/`](src/__tests__)

Suggested gates before merging:

- Green type-check, lint, unit tests.
- For message contract changes, add/adjust minimal tests (store and handler).

## Troubleshooting

- Offscreen never starts:
  - Ensure `OFFSCREEN_READY` is received by background and `ensureOffscreenDocument()` points at [offscreen.html](offscreen.html).
  - Verify permissions include `offscreen`.
- No LUFS readings:
  - Check `blockCount`; integrated LUFS uses gating and may remain `-Infinity` until enough valid blocks.
  - Confirm worklet loads from `src/worklets/lufs-processor.ts`.
- Stream ends unexpectedly:
  - Look for `STREAM_ENDED` reason; tabs navigating/closing stop tracks. Ensure cleanup runs without exceptions.
- Audio graph silent:
  - Offscreen connects `source → gain → limiter → destination` and also `source → worklet → destination` (silent output). Verify node connections and context state.

## Definition of Done (agent)

- Commands pass: `mise run check` and `mise run build`.
- Message contracts updated consistently (types + handlers + callers).
- No permission creep; manifest unchanged unless justified.
- User-visible behavior validated (manual or E2E for critical flows).
- Versioned release artifact builds under `release/` and unpacked `dist/` loads in Chrome.
