# FusionDock

Turns compatible **VSD Craft Stream Dock** devices into a context-aware control surface for
**Autodesk Fusion 360**. Hardware support currently includes the original **VSD Stream Dock N1**
and the **Stream Dock 293SV3**.

The device follows what you are doing: enter a sketch and it shows sketch tools, press Rectangle
and it offers the rectangle variants, open a command dialog and it offers OK and Cancel.

Nothing like this exists — every other Fusion macropad product is a keystroke sender with
manually-built folders.

## Status

**Running on real hardware.** Stages 0–4 of the manual test plan passed against real Fusion and
a real N1 on 2026-07-27. The 15-key main surface has also been tested with real Fusion on a
Stream Dock 293SV3.

The layout was rebuilt on 2026-07-28 — every context gained a page 1 and page 2, `home` became
the tab picker, and tab switching was added. The automated tests run against a simulated bridge,
so the manual test plan remains useful when validating new Fusion or Stream Dock versions.

Before trusting it, work through `docs/planning/manual-test-plan.md`. The known-unverified list
at the end of that document is real, not boilerplate.

## Hardware compatibility

### VSD Stream Dock N1

The N1 is the original FusionDock target. It reports its 15 main keys as a native 3x5 keypad,
which FusionDock rotates when the Landscape action is used.

The N1 auxiliary controls remain supported as before:

- two side buttons for Undo and Redo
- dial rotation for cycling Iso / Top / Front
- dial press for Home, or dialog confirmation when a Fusion dialog is open

### Stream Dock 293SV3

The Stream Dock 293SV3 has been tested on real hardware with FusionDock.

Unlike the N1, the 293SV3 reports its 15 main keys directly as a native 5x3 landscape keypad:

- columns `0..4`
- rows `0..2`
- controller `Keypad`

FusionDock detects this native 5x3 layout automatically from the coordinates reported by the
Stream Dock host. No manual `grid.js` replacement or device-specific configuration is required.

All 15 main LCD keys have been verified with Fusion 360, including context-aware page changes
and command execution.

The 293SV3 also reports its long side area separately as controller `Information` at coordinate
`(5,1)`. FusionDock does not currently map this area to the N1 side-button or dial functions,
so 293SV3 support currently covers the 15-key main surface only.

### Other devices

Other Stream Dock models may work if they expose either the N1-style native 3x5 keypad or the
native 5x3 keypad layout described above, but they have not been hardware-tested.

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

On the N1, FusionDock additionally uses:

- **2 side buttons** — Undo and Redo.
- **Dial** — rotate to cycle Iso / Top / Front; press for Home, or to confirm an open Fusion
  dialog when one is up. Deliberately *not* Undo/Redo: an encoder is easy to nudge while
  pressing, and a stray rotation that silently undoes work is worse than one that moves the
  camera.

An earlier design reserved three keys for Undo/Redo/View and was dropped for spending 20% of
the grid on three commands. The fixed region came back on 2026-07-28 for a different reason:
these three are navigation, not commands, and without them the device could only follow Fusion's
context, never change it. All of it is data (`aux` and the page lists), so it is a JSON edit.

Both logical orientations are supported: **landscape** 5x3 and **portrait** 3x5. Layouts are
authored once as ordered lists; the grid mapping is derived.

Orientation is a **setting in the Property Inspector**, not something inferred from how the
device is physically held. The N1 reports a native 3x5 frame and FusionDock maps Landscape onto
it. Native 5x3 devices such as the 293SV3 report the Landscape grid directly. Icon rotation is
left to VSD Craft's own per-device rotation setting — the plugin draws upright.

## Install

The packaged plugin bundle is in [`releases/`](releases/) — `FusionDock-1.0.0.zip`. To install it
in the Stream Dock software, rename the file to `com.fusiondock.streamdock.sdPlugin` and
double-click it. Rebuild it from source with `npm run package && node scripts/make-release.js`.

To install from the source tree instead: requires Node 20+ for the tooling. The add-in itself runs
on Fusion's bundled Python — no system Python needed.

```
node scripts/install.js --dry-run     # check the target paths first
node scripts/install.js               # install
```

Then:

1. Fully quit and restart the Stream Dock / VSD Craft software.
2. Start Fusion 360. The add-in auto-starts; confirm under Utilities &rsaquo; Scripts and Add-Ins.
3. Drag the **Fusion Key** action onto all 15 main keys.
4. On an N1, also assign the FusionDock actions to the two side buttons and dial.
5. Run `node scripts/resolve-commands.js` and fix the command ids (see below).

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
npm test
npm run simulator     # http://127.0.0.1:8731/_sim/
npm run icons         # regenerate the plugin's own PNG assets
```

The simulator serves a virtual N1 that loads the **real** plugin sources against a fake bridge,
so layouts, navigation and rendering can be exercised with neither Fusion nor the device
present. It counter-rotates key images to mimic physically turning the N1 — if icons look
upright in both orientations there, the rotation constant is right.

The grid tests also cover native 5x3 keypad detection and mapping used by devices such as the
293SV3.

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

- `aux` — the two side buttons and the dial used by the N1.

Every context page holds exactly 15 keys and ends with the fixed Tabs / View / More trio.
Adding a command is a JSON edit, not a code change.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/fusion-addin/` | Python add-in: bridge server, state reader, command executor |
| `src/streamdock-plugin/` | The `.sdPlugin` bundle: grid, layout, render, main |
| `src/layouts/` | Key layouts and context rules |
| `scripts/` | Install, command resolver, icon generator |
| `tests/` | Automated tests, fake bridge, N1 simulator and grid mapping tests |
| `docs/research/` | SDK, Fusion API and prior-art findings, with sources |
| `docs/decisions/` | Architecture decision records |
| `docs/planning/` | `manual-test-plan.md` (hardware bring-up, with results) and `backlog.md` (**the to-do list** — what is still outstanding and what is waiting on a decision) |

## Known limitations

- Windows only.
- On the Stream Dock 293SV3, the long `Information` side area is detected but is not currently
  mapped to FusionDock controls; the 15-key main surface is supported.
- Command ids are resolved against the owner's install. Tab ids too, except the Utilities
  pairing, which is inferred and matches on display name until `GET /tabs` confirms it.
- Tab switching (`activate_tab`) and the `/tabs` endpoint are written but have never executed.
- `activeSelectionChanged` does not fire while another command is running, so selection-driven
  behaviour is reliable only when Fusion is idle.
- Text commands (`NuCommands.CommitCmd` and friends) are undocumented and change between Fusion
  builds. They live in `command_overrides.json` so they can be repaired without touching code.
- Autodesk documents that add-ins can go missing after a Fusion update; a reinstall may be
  needed.
