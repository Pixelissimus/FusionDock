# Fusion 360 Stream Dock

Turns a **VSD Stream Dock N1** into a context-aware control surface for **Autodesk Fusion 360**.
The device follows what you are doing: enter a sketch and it shows sketch tools, press Rectangle
and it offers the rectangle variants, open a command dialog and it offers OK and Cancel.

Nothing like this exists — every other Fusion macropad product is a keystroke sender with
manually-built folders.

## Status

**Written but never run against real hardware.** All 45 automated tests pass, but they run
against a simulated bridge. Fusion 360, the Stream Dock software and the N1 were all absent from
the development machine.

Before trusting it, work through `docs/planning/manual-test-plan.md`. The known-unverified list
at the end of that document is real, not boilerplate.

## How it works

Two processes talking over `127.0.0.1`:

```
  Fusion 360                                     Stream Dock software
  +---------------------+                        +--------------------+
  |  FusionStreamDock   |  HTTP + SSE  :8731     |  Fusion 360 plugin |
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

All 15 keys follow your context. The globals live on the physical controls instead:

- **15 context keys** — every one changes with what you are doing in Fusion.
- **2 side buttons** — View and Back.
- **Dial** — rotate for Undo and Redo (a jog wheel is the natural control for stepping through
  history); press for Home, or to confirm an open Fusion dialog when one is up. If a page ever
  holds more than 15 keys, rotation pages through it instead.

An earlier design reserved three keys for Undo/Redo/View on every page. It was dropped after
testing on real hardware: it spent 20% of the grid on three commands while the side buttons and
dial sat unused. The bindings are data (`aux` in the layout), so they are a JSON edit.

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

The ids in `src/layouts/default.json` are **best guesses**, written without a Fusion install to
check against. Each key also carries a `match` field holding the command's display name.

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
npm test              # 45 tests, no hardware needed
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
- `pages` — each an ordered list of keys. A key has `cmd` (run a Fusion command), `page` (open a
  sub-page), or `text` (run a raw text command).
- `fixed` — exactly three keys, always visible.

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
- Command ids are unverified (see above).
- The Python side has never been executed — no Python was available on the development machine.
- `activeSelectionChanged` does not fire while another command is running, so selection-driven
  behaviour is reliable only when Fusion is idle.
- Text commands (`NuCommands.CommitCmd` and friends) are undocumented and change between Fusion
  builds. They live in `command_overrides.json` so they can be repaired without touching code.
- Autodesk documents that add-ins can go missing after a Fusion update; a reinstall may be
  needed.
