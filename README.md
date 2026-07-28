# FusionDock

Turns a **VSD Stream Dock N1** into a context-aware control surface for **Autodesk Fusion 360**.
The device follows what you are doing: enter a sketch and it shows sketch tools, press Rectangle
and it offers the rectangle variants, open a command dialog and it offers OK and Cancel.

Nothing like this exists — every other Fusion macropad product is a keystroke sender with
manually-built folders.

## Status

**Running on real hardware; the current layout is not yet proven on it.** Stages 0–4 of the
manual test plan passed against real Fusion and a real N1 on 2026-07-27. All 56 automated tests
pass, but they run against a simulated bridge.

The layout was rebuilt on 2026-07-28 — every context gained a page 1 and page 2, `home` became
the tab picker, and tab switching was added. None of that has been pressed on the device yet.

Before trusting it, work through `docs/planning/manual-test-plan.md`. The known-unverified list
at the end of that document is real, not boilerplate.

## How it works

Two processes talking over `127.0.0.1`:

```
  Fusion 360                                     Stream Dock software
  +---------------------+                        +--------------------+
  |  FusionDock         |  HTTP + SSE  :8731     |  Fusion 360 plugin |
  |  (Python add-in)    | <--------------------> |  (HTML/JS)         |
  |                     |                        |                    |
  |  reads context      |  state  -->            |  repaints 15 keys  |
  |  runs commands      |  <-- commands          |  owns navigation   |
  |  serves icons       |  icons  -->            |                    |
  +---------------------+                        +--------------------+
```

- The add-in watches Fusion's workspace, tab, sketch mode, open dialog and selection, and
  pushes changes over Server-Sent Events.
- The plugin owns all 15 keys and **repaints them itself**. It never asks the host to switch
  profiles — `switchToProfile` is undocumented in this SDK and used by no shipped plugin.
- Icons are read from the user's own Fusion install at runtime and served over HTTP. Autodesk's
  artwork is never bundled.
- Commands arrive on the add-in's HTTP thread and are marshalled onto Fusion's main thread via
  a CustomEvent, which is the only safe way to call the Fusion API from outside.

Design rationale is in `docs/decisions/0001-architecture.md`; the research behind it is in
`docs/research/`.

## Layout

The keys follow your context, and three of them never move:

- **12 context keys** — every one changes with what you are doing in Fusion.
- **3 fixed keys** (slots 13–15) — **Tabs**, **View** and **More**. Not commands: doors. Tabs
  reaches every workspace, View every camera and display option, More the second page of
  wherever you are. They are the last three entries of every page list, because 13–15 is the
  only block that reads coherently in both orientations.
- **2 side buttons** — Undo and Redo.
- **Dial** — rotate to cycle Iso / Top / Front; press for Home, or to confirm an open Fusion
  dialog when one is up. Deliberately *not* Undo/Redo: an encoder is easy to nudge while
  pressing, and a stray rotation that silently undoes work is worse than one that moves the
  camera.

An earlier design reserved three keys for Undo/Redo/View and was dropped for spending 20% of
the grid on three commands. The fixed region came back on 2026-07-28 for a different reason:
these three are navigation, not commands, and without them the device could only follow Fusion's
context, never change it. All of it is data (`aux` and the page lists), so it is a JSON edit.

Both orientations are supported: **landscape** 5x3 (dial bottom right) and **portrait** 3x5
(dial top right). Layouts are authored once as ordered lists; the grid mapping is derived.

Orientation is a **setting in the Property Inspector**, not something the plugin detects. The N1
reports its native 3x5 frame however you are holding it, so there is nothing to detect. Icon
rotation is left to VSD Craft's own per-device rotation setting — the plugin draws upright.

## Install

Requires Node 20+ for the tooling. The add-in itself runs on Fusion's bundled Python — no system
Python needed.

```
node scripts/install.js --dry-run     # check the target paths first
node scripts/install.js               # install
```

Then:

1. Fully quit and restart the Stream Dock / VSD Craft software.
2. Start Fusion 360. The add-in auto-starts; confirm under Utilities &rsaquo; Scripts and Add-Ins.
3. Drag the **Fusion Key** action onto all 15 keys, both side buttons and the dial.
4. Run `node scripts/resolve-commands.js` and fix the command ids (see below).

## The command ids need fixing on first install

All 208 ids in `src/layouts/default.json` are checked against the owner's Fusion build. On a
**different** build they may not all exist, so treat them as needing a pass. Each key also
carries a `match` field holding the command's display name, which is what the resolver uses.

With Fusion running, and after visiting every tab so its lazily-created command definitions
exist:

```
node scripts/resolve-commands.js --dump docs/research/command-dump.json
node scripts/resolve-commands.js --write
node scripts/install.js --force
```

Expect a lot of failures on the first pass. This is the single largest known gap.

## Development

```
npm test              # 56 tests, no hardware needed
npm run simulator     # http://127.0.0.1:8731/_sim/
npm run icons         # regenerate the plugin's own PNG assets
```

The simulator serves a virtual N1 that loads the **real** plugin sources against a fake bridge,
so layouts, navigation and rendering can be exercised with neither Fusion nor the device
present. It counter-rotates key images to mimic physically turning the N1 — if icons look
upright in both orientations there, the rotation constant is right.

## Layout structure

`src/layouts/default.json`:

- `rules` — map Fusion's state to a page, first match wins, most specific first.
- `pages` — each an ordered list of keys. A key carries exactly one action:

  | Field | Does |
  | --- | --- |
  | `cmd` | run a Fusion command |
  | `page` | open a sub-page |
  | `tab` / `workspace` | switch Fusion's workspace and ribbon tab — there is no command for this |
  | `view` | set a viewport orientation or visual style — no command for this either |
  | `text` | run a raw text command (undocumented, build-specific) |
  | `nav` | `back` or `home` within the device's own page stack |

- `aux` — the two side buttons and the dial.

Every context page holds exactly 15 keys and ends with the fixed Tabs / View / More trio.
Adding a command is a JSON edit, not a code change.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/fusion-addin/` | Python add-in: bridge server, state reader, command executor |
| `src/streamdock-plugin/` | The `.sdPlugin` bundle: grid, layout, render, main |
| `src/layouts/` | Key layouts and context rules |
| `scripts/` | Install, command resolver, icon generator |
| `tests/` | Automated tests, fake bridge, N1 simulator |
| `docs/research/` | SDK, Fusion API and prior-art findings, with sources |
| `docs/decisions/` | Architecture decision records |
| `docs/planning/` | `manual-test-plan.md` (hardware bring-up, with results) and `backlog.md` (**the to-do list** — what is still outstanding and what is waiting on a decision) |

## Known limitations

- Windows only.
- Command ids are resolved against the owner's install. Tab ids too, except the Utilities
  pairing, which is inferred and matches on display name until `GET /tabs` confirms it.
- Tab switching (`activate_tab`) and the `/tabs` endpoint are written but have never executed.
- `activeSelectionChanged` does not fire while another command is running, so selection-driven
  behaviour is reliable only when Fusion is idle.
- Text commands (`NuCommands.CommitCmd` and friends) are undocumented and change between Fusion
  builds. They live in `command_overrides.json` so they can be repaired without touching code.
- Autodesk documents that add-ins can go missing after a Fusion update; a reinstall may be
  needed.
