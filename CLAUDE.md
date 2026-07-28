# Fusion 360 Stream Dock — Claude Instructions

## Purpose

A context-aware bridge letting a VSD Stream Dock N1 drive Autodesk Fusion 360. Device keys run
Fusion commands, and the pages shown follow the user's current context inside Fusion.

## Technology stack

- **Fusion add-in** — Python, stdlib only, runs on Fusion's bundled interpreter.
- **Stream Dock plugin** — plain HTML/JS, no build step, no dependencies.
- **Transport** — HTTP + Server-Sent Events on `127.0.0.1:8731`.
- **Tooling and tests** — Node 20+, `node --test`. No test framework, no bundler.

Do not add dependencies to either side. Both hosts load these files directly; a build step would
have to be run before every reload.

## Architecture

See `docs/decisions/0001-architecture.md` for the reasoning. In short:

- The add-in is the **server**: it serves state (`/events`), accepts commands (`/command`) and
  serves Fusion's own icons (`/icon`) and dumps workspaces/tabs (`/tabs`).
- The plugin owns **all 15 keys and repaints them**. It never uses `switchToProfile`.
- Fusion API calls happen **only on the main thread**, marshalled via `registerCustomEvent` /
  `fireCustomEvent`. Never call the Fusion API from the HTTP thread.
- `execute()` is banned inside command-related events but legal inside a CustomEvent handler,
  which is where device input lands.

Key files:

| File | Role |
| --- | --- |
| `src/fusion-addin/FusionStreamDock.py` | Entry point, event wiring, threading |
| `src/fusion-addin/fsd_bridge.py` | HTTP/SSE server. No Fusion imports — testable standalone |
| `src/fusion-addin/fsd_state.py` | Reads Fusion context into a dict |
| `src/fusion-addin/fsd_commands.py` | Command execution and icon resolution |
| `.../plugin/grid.js` | Orientation and key mapping. Pure, well tested |
| `.../plugin/layout.js` | Rule matching and navigation, incl. per-context memory |
| `.../plugin/render.js` | Canvas key rendering |
| `.../plugin/main.js` | Host and bridge glue |

## Where things are written down

- `docs/planning/backlog.md` — **the to-do list.** Outstanding work, and decisions waiting on
  the owner. Read it before starting anything new; add to it rather than starting a second list.
- `docs/planning/manual-test-plan.md` — hardware bring-up, with results recorded against each
  step and an honest known-unverified list at the end.
- `docs/decisions/` — architecture decision records.
- `docs/research/` — SDK and Fusion API findings, each marked CONFIRMED or UNVERIFIED, plus
  `command-dump.json` (every command definition in the owner's Fusion build) and
  `tab-dump.json` (every workspace and ribbon tab, ids and display names, captured 2026-07-28).

## Commands

```
npm test              # 56 tests
npm run audit         # every key on every page, checked structurally
npm run simulator     # http://127.0.0.1:8731/_sim/
npm run icons
node scripts/install.js --dry-run
node scripts/resolve-commands.js
```

## Known constraints

- **Windows only.**
- **The add-in runs, but this machine still has no Python.** It has served state, icons and
  commands against real Fusion (Stages 0–4, 2026-07-27). *Newly written* Python is therefore
  still unverified until it has been loaded inside Fusion — including `activate_tab()` and
  `/tabs`, added 2026-07-28 and not yet run.
- **Command ids in `src/layouts/default.json` are resolved, not guessed.** All 208 were checked
  against `docs/research/command-dump.json` on 2026-07-28; `scripts/resolve-commands.js`
  re-resolves them against a running Fusion. **Tab ids** are all confirmed: `GET /tabs` was run on 2026-07-28 and the full dump is in `docs/research/tab-dump.json`. Rules match on tab **id**, never display name — Fusion's casing is inconsistent (`ParaMeshOuterTab` is "Mesh", not "MESH"). Never invent an id and present it as known.
- **Slots 13–15 are a fixed region** on every context page: Tabs, View, and More (or Page 1 on
  a page 2). They must stay the *last three entries* of the ordered key list — that is the only
  block that reads coherently in both orientations. `npm test` enforces it.
- **Unverified hardware assumptions**, each with a named fix in the manual test plan: native
  grid orientation, landscape image rotation direction, secondary-screen controller name and
  image size, dial payload shape.
- `activeSelectionChanged` does not fire while another command is running — selection data is
  reliable only when Fusion is idle. Do not drive destructive behaviour from it.
- Text commands are undocumented and build-specific. They belong in `command_overrides.json`,
  never hardcoded.
- Fusion polls on the main thread every 400 ms (`POLL_INTERVAL_SECONDS`). If Fusion feels
  sluggish, that is the first dial to turn.

## Working expectations

- **Layouts are data.** Adding or moving a command should be a JSON edit, never a code change.
  If a layout change needs new code, the layout schema is probably wrong.
- **Author layouts once.** Pages are ordered lists; the grid mapping for each orientation is
  derived in `grid.js`. Never hand-author a second copy for portrait.
- Distinguish confirmed from assumed, explicitly. This project rests on a niche device with poor
  documentation and an undocumented corner of Fusion's API. Saying "unknown" is correct and
  useful; guessing is not.
- Anything sourced from research carries a CONFIRMED / UNVERIFIED marker in `docs/research/`.
  Preserve that distinction when acting on it.
- The owner's two previous projects in this workspace were archived as complete planning packs
  with no code. Prefer a working thin slice over more documents.

## Definition of done

- [ ] Requirement implemented and verified against real Fusion and real hardware.
- [ ] Tests written or updated, and passing (`npm test`).
- [ ] Manual test plan updated if the change affects a hardware assumption.
- [ ] Documentation updated (`README.md`, this file, decision records).
- [ ] No secrets committed.
