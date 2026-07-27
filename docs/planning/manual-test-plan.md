# Manual test plan

Everything here needs real Fusion 360, the real VSD Craft / Stream Dock software and the
physical N1. None of it could be run on the machine where the code was written.

Work through it in order. Stop at the first failure in Stage 1 or 2 — later stages assume the
earlier ones passed.

Record results as PASS / FAIL / N/A with a note. The unknowns flagged in Stage 3 are the ones
most likely to need a code change.

---

## Stage 0 — Before installing

Run 2026-07-27 on Jamie's machine (Windows 11, Fusion 360 + VSD Craft 3.10.200.0408 + N1 all
present).

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 0.1 | `node --version` | 20 or newer | **PASS** — v24.16.0 |
| 0.2 | `npm test` | 45 tests pass | **PASS** — 45/45 |
| 0.3 | `node scripts/install.js --dry-run` | Prints two target paths, writes nothing | **PASS** |
| 0.4 | Confirm the two target paths look right for this machine | Fusion AddIns folder and `HotSpot\StreamDock\plugins` both exist | **PASS** — both exist |

If the Stream Dock path does not exist, find where VSD Craft actually keeps plugins before
going further, and note the real path.

### Stage 0 extras — checks the plan did not anticipate

Fusion's bundled Python turned out to be reachable from the shell, so two things the plan
assumed needed Fusion were settled before installing.

| # | Check | Result |
| --- | --- | --- |
| 0.5 | Syntax-check all four add-in modules on Fusion's own interpreter (`...\webdeploy\production\9c5312df...\Python\python.exe`, **Python 3.14.0**) | **PASS** — all four compile clean. The "never even syntax-checked" caveat is now retired |
| 0.6 | Run `fsd_bridge.py` standalone and exercise every endpoint | **PASS** — `/health`, `/commands`, `/icon` (hit + 404), unknown-route 404, `POST /command` (accept + reject bad JSON), SSE initial frame, SSE published frame, client accounting, `stop()`, immediate rebind after stop |

`fsd_bridge` is therefore confirmed working on the real interpreter, independently of Fusion.
What remains unproven in the add-in is only the Fusion-facing code (`fsd_state`,
`fsd_commands`) and the event wiring in `FusionStreamDock.py`.

### Stage 0 extras — ground truth found on disk

The installed VSD Craft software carries evidence for three items on the known-unverified
list. Recorded here with its provenance so it is not mistaken for a hardware result.

- **CONFIRMED — the secondary-screen controller is `Information`, not `SecondaryScreen`.**
  Across the 14 vendor plugins installed under `%APPDATA%\HotSpot\StreamDock\plugins`, the only
  `Controllers` values that appear anywhere are `Keypad` and `Information`.
  `SecondaryScreen` appears in none of them.
  → `manifest.json` was corrected before Stage 3.

  **Correction, later the same day:** that survey was also read as evidence that `Knob` was
  not a real controller name, and it was dropped from the manifest. That inference was wrong —
  all 14 vendor plugins target devices with no dial, so their manifests could never have
  mentioned one. The symptom was that VSD Craft, which splits actions into *key* and *knob*
  sections, offered the Fusion Key only in the key section, leaving the dial unbindable.
  `Knob` is **CONFIRMED correct** by string-searching the software itself: 389 occurrences in
  `VSD Craft.exe` and 219 in `SDLibrary1.dll`, alongside `KnobClick`, `KnobRotation` and
  `KnobMode`. Elgato's equivalent term `Encoder` appears **zero** times — this fork did not
  inherit that name. `Knob` restored.

  Lesson worth keeping: absence from a sample only means something if the sample could have
  contained it.
- **CONFIRMED — the dial events are `dialDown` / `dialUp` / `dialRotate`,** and this SDK is an
  Elgato Stream Deck clone: the vendor's own `事件速查.md` in the memo plugin lists the event
  set and cites the Elgato SDK docs as the reference. The `ticks` field on `dialRotate` is
  Elgato's documented payload, so the assumption is well-founded — but still **UNVERIFIED** on
  the N1 itself.
- **UNVERIFIED, but the assumed 3×5 native grid is now doubtful.** Eleven real N1 profiles
  (`DeviceUUID: VSDN1`, serial `81D0DA782B2E` — this device has been paired with this machine)
  written by VSD Craft itself all use an **18-cell `0..2 , 0..5` coordinate space**, not 15.
  `grid.js` assumes 3 × 5 = 15. 18 = 15 keys + 2 side buttons + 1 dial, which suggests the
  native frame is 3 columns × **6** rows with the auxiliary controls occupying the last row.
  This cannot be settled from files — the profile `Controller` field is `Keypad` only for
  plugin actions and `''` for all built-in ones, so it does not mark which cells are physical
  keys. **Stage 3.4 settles it**; `plugin/main.js` now logs every `willAppear` coordinate to
  make that a read-off rather than a guess.

---

## Stage 1 — The add-in alone (no device needed)

| # | Step | Expected |
| --- | --- | --- |
| 1.1 | `node scripts/install.js` | Both targets copied, no errors |
| 1.2 | Start Fusion 360 | Fusion starts normally, no error dialog |
| 1.3 | Utilities &rsaquo; Scripts and Add-Ins &rsaquo; Add-Ins tab | `FusionStreamDock` listed and **Running** |
| 1.4 | Browser: `http://127.0.0.1:8731/health` | `{"ok": true, "protocol": 1}` |
| 1.5 | Browser: `http://127.0.0.1:8731/events` | A stream of `data: {...}` lines appears and keeps ticking |
| 1.6 | With 1.5 open, switch Fusion to the Surface tab | A new `data:` line appears within a second, with `"tab":"SurfaceTab"` |
| 1.7 | Start a sketch in Fusion | A line appears with `"inSketch": true` |
| 1.8 | Finish the sketch | `"inSketch": false` |
| 1.9 | Start an Extrude (leave the dialog open) | `"dialogOpen": true` and `"activeCommand"` names the command |
| 1.10 | Cancel the dialog | `"dialogOpen": false` |
| 1.11 | Browser: `http://127.0.0.1:8731/commands` | A large JSON list of command ids |
| 1.12 | Close Fusion | The `/events` stream ends or reports disconnected |

**Result 2026-07-27 — Stage 1 PASSED, 1.1 to 1.11.** The add-in loaded and ran first time; no
Python errors. Verified against the live `/events` stream:

| # | Observed |
| --- | --- |
| 1.3 | Loaded via `runOnStartup`. Note: Fusion only scans the AddIns folder **at startup**, so an install performed while Fusion is running is not picked up — restart Fusion after installing |
| 1.4 | `{"ok": true, "protocol": 1}` |
| 1.5 | Stream opens with an immediate state frame, then 15-second `: ping` keep-alives |
| 1.6 | `"tab":"SurfaceTab"` / `"tabName":"SURFACE"`, and back to `SolidTab` |
| 1.7 | `"inSketch":true`, `"sketchName":"Sketch1"`, tab flips to `SketchTab` |
| 1.8 | `"inSketch":false` on Finish Sketch |
| 1.9 | `"activeCommand":"Extrude"`, `"dialogOpen":true`, **and** `"selection":{"count":1,"types":["Profile"]}` — selection reporting works too |
| 1.10 | `"dialogOpen":false` on cancel |
| 1.11 | 3110 command definitions |

1.12 deferred to Stage 5.6, which covers the same ground.

Two findings worth carrying:

- **The Mesh rule could never have fired.** Fusion reports the Mesh tab as **`ParaMeshOuterTab`**,
  not `MeshTab`. Fixed in `default.json`. Live tab ids observed: `SolidTab`, `SurfaceTab`,
  `SheetMetalTab`, `PlasticTab`, `ParaMeshOuterTab`, `ToolsTab`, `ManageTab`, `SketchTab`.
- **Creating a sketch briefly reports `dialogOpen: true`** (plane selection) before settling
  into `inSketch: true`. The device will flick through the dialog page on the way into a
  sketch. Not wrong, but worth watching at Stage 4.2 — if it looks bad, the dialog rule needs
  to exclude `SketchCreate`.

**This is the make-or-break stage.** If 1.6–1.10 work, context detection is sound and the
riskiest assumption in the whole design is confirmed.

If the add-in fails to start, check Fusion's Text Commands palette (`Ctrl+Alt+C`) for lines
beginning `[StreamDock]`.

---

## Stage 2 — Command ids and icons

| # | Step | Expected |
| --- | --- | --- |
| 2.1 | In Fusion, visit every tab: Solid, Surface, Mesh, Sheet Metal, Plastic, Utilities. Open and close a sketch. | (this populates Fusion's lazily-created command list) |
| 2.2 | `node scripts/resolve-commands.js --dump docs/research/command-dump.json` | Reports how many of the layout's ids resolve |
| 2.3 | Read the report | **Expect many failures.** The ids in `default.json` are guesses |
| 2.4 | `node scripts/resolve-commands.js --write` | Applies the confident fixes |
| 2.5 | Re-run 2.2 | Fewer failures. Fix the rest by hand from the dump |
| 2.6 | Browser: `http://127.0.0.1:8731/icon?id=SketchCreate` (use a **real** id from the dump) | A Fusion icon image renders |
| 2.7 | `node scripts/install.js --force` | Updated layout pushed to the plugin |

Record in the notes: how many ids resolved first time, and any command whose icon fails to
load.

**Result 2026-07-27 — Stage 2 PASSED.**

| # | Observed |
| --- | --- |
| 2.1 | All tabs visited. **The lazy-creation warning did not apply on this build** — `/commands` returned 3110 both before and after. The list was already complete |
| 2.2 / 2.3 | **26 of 142 resolved.** 116 broken, as predicted |
| 2.4 / 2.5 | Fixed by hand against the dump rather than with `--write` (see below). **Now 130 of 130** |
| 2.6 | Icons render from the real install. 114 of 119 ids have one; the 5 without fall back to the plugin's own label rendering: `NewDocumentCommand`, `Coil`, `AppearanceCommand`, `PhysicalMaterialCommand`, `FusionSheetMetalHemFlangeCommand` |
| 2.7 | Reinstalled |

`--write` was deliberately **not** used. Most failures had several exact-name candidates that
only page context can separate — "Extrude" matches `Extrude`, `SurfaceExtrude` and
`TSplineExtrudeCommand`, and the right answer differs between the solid and surface pages.
The resolver cannot know that; it was used as a report, and the choices were made by hand.

The dominant cause was a naming convention that does not exist: the guesses appended
`Command` to everything (`ExtrudeCommand`, `SweepCommand`), where Fusion's real ids are bare
(`Extrude`, `Sweep`). Sketch geometry follows a different scheme again
(`ShapeRectangleTwoPoint`, `CircleCenterRadius`, `DrawSpline`), and constraints another
(`ConstraintCoincident`). The command dump is at `docs/research/command-dump.json`.

Three layout entries named operations that **do not exist in this Fusion build** and were
replaced with the nearest real ones, which is a data change, not a code change:

- Sheet metal "Contour Flange" → **Hem**. `FusionSheetMetalFlangeCommand` is literally named
  "Flange (Base/Edge/Contour)" and already covers contour.
- Sheet metal "Bend" → **Fold** (`SheetMetalFoldCmd`). Fusion has no "Bend" command.
- Sketch "Curvature" constraint resolves to `ConstraintSmooth`.

### The view page needed new code — and it justifies the architecture

**CONFIRMED: Fusion exposes no command definition for view orientation or visual style.**
Searched all 3110 definitions: there is no "Front View", "Top View", "Isometric" or "Shaded"
command. The only near-matches were `SDK.MAGNestDisplayCmd.*`, which belong to a nesting
add-in and are the wrong thing entirely. So 11 of the 12 view keys could never have worked
through `execute()`, whatever id was used.

They are viewport **properties**, not commands. A new `view` action was added
(`fsd_commands.set_view`) that sets `viewport.camera.viewOrientation`, `viewport.visualStyle`,
`viewport.fit()` and `viewport.goHome()` directly.

This is the strongest available evidence for the add-in architecture over keystroke injection:
these operations have neither a command id nor a bindable keyboard shortcut, so a macropad
that only sends keystrokes **cannot reach them at all**. The layout schema absorbed it as a
new key type (`"view": "front"`) — no page or grid change.

`npm test` is now **46 tests**, all passing: the layout validator accepts the `view` action,
one integration test covers it, and the test that hardcoded `SketchRectangle3Point` now reads
the expected id from the layout so it cannot go stale the next time ids are resolved.

### Stage 2 extra — command execution proven without the device

Commands were posted straight to `/command` over HTTP while watching Fusion, which tests the
whole add-in path with no Stream Dock involvement at all.

| Check | Result |
| --- | --- |
| `{"action":"execute","id":"NewDocumentCommand"}` | **PASS** — a new design opened by itself. This proves the entire threading model end to end: HTTP thread → queue → `fireCustomEvent` → main thread → `execute()` |
| `{"action":"view","view":"top"/"front"/"iso"}` | **PASS** — observed moving through all three orientations, no error frames |

Item 7 on the known-unverified list ("whether `execute()` works for view and navigation
commands") is therefore **answered, and the answer was no** — `execute()` was never going to
work for views because the commands do not exist. The `view` action replaces it and is
confirmed working.

The add-in also **reconnected its SSE stream automatically** after a full Fusion restart,
which is most of Stage 5.6 already.

---

## Stage 3 — The device

These are the **unverified assumptions**. Each has a named fix.

| # | Step | Expected | If wrong |
| --- | --- | --- | --- |
| 3.1 | Fully quit and restart the Stream Dock software | `Fusion 360` appears as a category with a `Fusion Key` action | Plugin folder path or manifest is wrong |
| 3.2 | Drag `Fusion Key` onto all 15 keys | Keys populate with icons and labels | — |
| 3.3 | Drag `Fusion Key` onto both small side buttons and the dial | They accept the action | The `Controllers` list in `manifest.json` needs the right names |
| 3.4 | **Are the keys in the right places?** Compare against the simulator | Key order matches | Swap `NATIVE_COLUMNS` / `NATIVE_ROWS` in `plugin/grid.js` |
| 3.5 | **Landscape: are the icons upright?** | Upright, not sideways | Negate `LANDSCAPE_IMAGE_ROTATION_DEG` in `plugin/grid.js` |
| 3.6 | Turn the device to portrait, set orientation in the Property Inspector | Layout re-flows to 3x5, icons upright | Same two constants |
| 3.7 | Check the fixed region (Undo / Redo / View) | Same three physical keys in both orientations | `fixedCells()` in `grid.js` |
| 3.8 | Press a key | The Fusion command runs | — |
| 3.9 | Rotate the dial on an over-full page | Pages through | `dialRotate` payload shape may differ; check `ticks` |
| 3.10 | Press the dial with a Fusion dialog open | Dialog is confirmed | `NuCommands.CommitCmd` may not work on this build |
| 3.11 | Press the two side buttons | Home and Back | Controller name may be `Information` not `SecondaryScreen` |

Note the secondary-screen image size: the C++ SDK says 64x64 and the Python SDK says 80x80.
If the side-button images look wrong, that is why.

**Result 2026-07-27 — Stage 3 partly done. 3.1 to 3.5 PASSED.**

| # | Observed |
| --- | --- |
| 3.1 | **PASS** — "Fusion 360" category with the "Fusion Key" action. VSD Craft's log confirms `com.fusiondock.streamdock.sdPlugin is now connected`. Note: the software must be quit **from the system tray** — closing the window only minimises it, and the plugin is not reloaded |
| 3.2 | **PASS** — all 15 keys accept the action and paint |
| 3.4 | **PASS after a fix** — see below |
| 3.5 | **PASS after a fix** — see below |

| 3.3 | **PASS after a fix** — `Knob` had to be restored to the manifest; see the correction above |
| 3.8 | **PASS** — pressing Sketch starts Create Sketch in Fusion |
| 3.9 | **PASS** — turning the dial cycles the view. `ticks` **CONFIRMED**: the real payload is `{"coordinates":{...},"pressed":false,"settings":{},"ticks":-1}`, one ±1 per detent. `pressed` is an undocumented bonus — the SDK reports whether the dial is held while turned |
| 3.11 | **PASS** — Undo on the top side button reaches Fusion |

**3.10 PASS** — pressing the dial committed an open Extrude. `NuCommands.CommitCmd` works on
this Fusion build (2026-07-27). It remains the one place in the system relying on an
undocumented, build-specific API: if a future Fusion update breaks it, the symptom is the dial
doing nothing with a dialog open, and the fix belongs in `command_overrides.json` rather than
in code.

**Stage 3 is complete.**

**3.6 — orientation now follows the placed action, and the majority vote is confirmed
working.** Observed 2026-07-27: placing the portrait action on a *minority* of keys left the
layout in landscape; once more than half were portrait, the whole grid re-flowed. That is the
intended behaviour — a vote rather than "last placed wins", so one stray key cannot transpose
the grid, and a half-finished switch is visible on the device rather than silent.

The re-flow itself needs no second layout. The same ordered page wraps at 3 instead of 5, and
slot 0 stays top-left in both:

```
LANDSCAPE (5 wide)                 PORTRAIT (3 wide)
Sketch  Component Extrude ...      Sketch    Component  Extrude
Fillet  Chamfer   Shell   ...      Revolve   Press Pull Fillet
Modify  Construct View    ...      Chamfer   Shell      Hole
                                   Create    Modify     Construct
                                   View      -          -
```

**Stage 4.2 also passed, early and by accident:** starting a sketch switched the device to
sketch tools **on its own**. That is the behaviour the project exists for, working on real
hardware.

One fault found and fixed at the same time: `SketchCreate` reports `dialogOpen: true` for the
whole plane-selection step, so the device flashed OK/Cancel until a plane was picked. Rules now
accept a `whenNot` veto, and the dialog rule carries `whenNot: {activeCommand: "SketchCreate"}`.

The sketch pages were also restructured after Jamie checked them against Fusion's real menus —
Mirror and the patterns were wrongly filed under Modify (they are Create tools), Project was a
single key when it is really a six-entry submenu, and Point, Text and Ellipse were missing
entirely. See `backlog.md` for what is still outstanding.

### 3.4 — the grid was right; orientation detection was not

The native frame is **3 columns x 5 rows**, exactly as `grid.js` assumed. Read directly off the
hardware: all 15 keys reported `column` 0–2 and `row` 0–4 via `willAppear`. **No constants were
swapped.** This also resolves the 18-cell profile puzzle from Stage 0 — row 5 is the auxiliary
row (side buttons and dial), not keys.

The real fault was elsewhere. Keys landed transposed because `orientationFromDeviceSize()`
overwrote the user's setting on every `deviceDidConnect` **and** at registration. The N1 always
reports its native 3x5 size however it is physically held, so that inference could only ever
return "portrait" — laying the grid out transposed for anyone using the device in landscape.

The predicted portrait layout matched the observed device exactly, which is what confirmed the
diagnosis:

```
observed  R0: Undo | Create | Chamfer | Revolve | Sketch
predicted R0: Undo | Create | Chamfer | Revolve | Sketch   (portrait)
```

Inference is **removed**, not patched: the capability cannot work on this hardware. Orientation
is a Property Inspector setting only. After the fix, landscape reads
`Undo | Sketch | Component | Extrude | Revolve` as intended.

### 3.5 — the plugin should never have been rotating icons

Icons came out 90 degrees off. The original comment claimed "the host does not rotate key
images -- the N1 device class hardcodes key_rotate_angle = 0". **That is wrong:** VSD Craft has
its own per-device icon rotation setting, which this device's owner already uses to run the N1
on its side. The plugin's pre-rotation fought it.

`LANDSCAPE_IMAGE_ROTATION_DEG` is now **0** in both orientations. Rotation belongs to the host:
it is the user's choice, it applies consistently across every plugin, and the SDK exposes no way
to read the setting back — so a plugin that rotates on its own can only guess, and will be wrong
for anyone whose preference differs.

### Design change — all 15 keys are now context keys

The three-key fixed region (Undo / Redo / View, on every page) is gone. It spent 20% of the grid
on globals while the two side buttons and the dial sat unused. The globals moved to an `aux`
block in the layout:

| Control | Binding |
| --- | --- |
| Side button 1 | View (opens the view page) |
| Side button 2 | Back — dimmed when there is nowhere to go back to |
| Dial rotate | Undo one way, Redo the other. A jog wheel is the natural control for stepping through history |
| Dial press | Confirms an open Fusion dialog; otherwise Home |

Paging still wins on the dial **only** when a page holds more keys than the grid can show —
being unable to reach a key is worse than losing undo on that one page. No page currently
exceeds 15.

The whole change is layout data plus the handlers that read it, so any of these bindings is a
JSON edit. `scripts/resolve-commands.js` now walks the `aux` block too, so ids there are checked
like any other: **137 of 137 resolve.** `npm test` is at **47 passing**.

---

## Stage 4 — The behaviour the project exists for

| # | Step | Expected |
| --- | --- | --- |
| 4.1 | With Fusion on the Solid tab, look at the device | Solid tools |
| 4.2 | Start a sketch | Device switches to sketch tools **on its own** |
| 4.3 | Press `Rectangle` | Three rectangle variants appear |
| 4.4 | Press `3-Point` | Fusion starts the 3-point rectangle tool |
| 4.5 | Press `Circle` &rsaquo; observe | Five circle variants |
| 4.6 | **Press the dial** (was "press Back on a side button" — the controls changed: the side buttons now carry Undo and Redo, and Home moved to the dial press) | Returns to the sketch page |
| 4.7 | Finish the sketch | Device returns to solid tools |
| 4.8 | Start a sketch again | **Device returns to the page you were last on in sketch mode**, not the root |
| 4.9 | Open an Extrude dialog | Device shows OK / Cancel |
| 4.10 | Cancel it | Device returns to exactly where it was |
| 4.11 | Close Fusion entirely | Device shows "Waiting for Fusion" |
| 4.12 | Reopen Fusion | Device reconnects on its own |

4.8 and 4.10 are the features that do not exist in any shipping product. If they work, the
core premise is proven.

**Result 2026-07-27 — 4.1 to 4.8 PASS. The core premise is proven.**

| # | Observed |
| --- | --- |
| 4.1 | Solid tools shown on the Solid tab |
| 4.2 | **PASS** — starting a sketch switched the device to sketch tools on its own |
| 4.3 | **PASS** — Rectangle opened its three variants |
| 4.4 | **PASS** — 3-Point started the right Fusion tool |
| 4.5 | **PASS** — Circle opened five variants |
| 4.6 | **PASS** (via the dial, not a side button — controls changed) |
| 4.7 | **PASS** — finishing the sketch returned the device to solid tools |
| 4.8 | **PASS — the flagship behaviour.** Left in the circle-variants page, finished the sketch, started another: the device returned **to the circle variants**, not to the top of the sketch page |
| 4.10 | **PASS, observed early.** Confirming a command with the dial closed the dialog and restored the exact page that was showing beforehand |

| 4.9 | **PASS** — the Extrude dialog put OK/Cancel on the device |
| 4.11 | **PASS** — closing Fusion showed "Waiting for Fusion". Verified from the host side too: the port was fully released with no stuck listener, so the next start cannot fail to bind |
| 4.12 | **PASS** — reopening Fusion reconnected the device with no intervention. With no document open it correctly showed the `home` page; opening one moved it to Solid |

**Stage 4 is complete.**

Note on 4.8: the memory applies once Fusion actually reports `inSketch: true`. While a plane is
still being picked, `inSketch` is false and the device correctly shows the solid tools — the
restore happens the moment the sketch is entered.

### A real fault found at 4.3, and fixed

Sketch drawing tools hold `dialogOpen: true` for as long as they are active, so the dialog rule
fired for every rectangle, circle and line — replacing all the sketch tools with OK/Cancel and
making it impossible to chain one tool into the next.

Excluding commands one at a time (as was done for `SketchCreate`) does not scale. The rule is
now `{"dialogOpen": true, "inSketch": false}`: in sketch mode a "dialog" is nearly always a
drawing tool, while outside it a dialog really is modal and OK/Cancel is the most useful thing
the device can offer.

Trade-off accepted knowingly: while drawing in a sketch there is no on-screen Cancel. **OK is
still on the dial** — `handleDialPress` tests Fusion's state, not the displayed page, so the
dial confirms whatever is open either way — and Escape still cancels from the keyboard.

---

## Stage 5 — Robustness

| # | Step | Expected |
| --- | --- | --- |
| 5.1 | Press a command that needs a selection, with nothing selected | Key flashes red; Fusion does not crash |
| 5.2 | Press keys rapidly for 10 seconds | No lag build-up, no dropped presses, Fusion stays responsive |
| 5.3 | Leave everything running for 30 minutes | Device still responsive; no memory growth in Fusion |
| 5.4 | Unplug and replug the N1 | Keys repaint automatically |
| 5.5 | Restart the Stream Dock software with Fusion still running | Plugin reconnects |
| 5.6 | Restart Fusion with the Stream Dock software still running | Device shows disconnected, then recovers |
| 5.7 | Work in Fusion for 15 minutes with the device connected | No noticeable slowdown vs. normal use |

5.7 matters: the add-in polls every 400 ms on Fusion's main thread. If Fusion feels sluggish,
raise `POLL_INTERVAL_SECONDS` in `FusionStreamDock.py`.

---

## Known-unverified list

Updated 2026-07-27. Kept honest: items move to RESOLVED only on evidence, and what the
evidence was is recorded.

**Resolved**

3. ~~Secondary-screen controller name and image size~~ — **RESOLVED, and both halves of the
   original question were the wrong question.** Read off the hardware via `willAppear`, the N1
   addresses everything in ONE 3x6 coordinate space:

   | Cell | Control | Controller |
   | --- | --- | --- |
   | rows 0–4, cols 0–2 | the 15 keys | `Keypad` |
   | row 5, col 0 | side button 1 | `Keypad` |
   | row 5, col 1 | side button 2 | `Keypad` |
   | row 5, col 2 | the dial | `Knob` |

   There is **no secondary screen on this device**. The side buttons are ordinary keypad
   cells in a sixth row, so neither `Information` nor `SecondaryScreen` applies, and the
   64x64-versus-80x80 image size question is moot — they take normal key images.

   The plugin now identifies them by **position**, not controller name. Matching on the name
   gave them cell ids no page contains: they painted blank and did nothing when pressed.

   This also finally explains the 18-cell coordinate space found in VSD Craft's own N1
   profiles back at Stage 0. The inference drawn from it then — "3 columns x 6 rows with the
   auxiliary controls in the last row" — was exactly right.

1. ~~Native grid orientation (3x5 assumed)~~ — **CONFIRMED CORRECT.** All 15 keys reported
   `column` 0–2, `row` 0–4 on the real device. No change needed. The transposed keys were
   caused by orientation inference, now removed.
2. ~~Landscape image rotation direction~~ — **RESOLVED, premise was wrong.** The host *does*
   rotate: VSD Craft has a per-device icon rotation setting. The plugin no longer rotates at
   all.
5. ~~Every command id in `default.json`~~ — **RESOLVED.** 26/142 → 137/137 against this build.
   Re-run `scripts/resolve-commands.js` after any Fusion update; ids are install-derived.
7. ~~Whether `execute()` works for view and navigation commands~~ — **RESOLVED, and the answer
   was no.** Fusion has no command definitions for view orientation or visual style at all.
   Replaced with the `view` action, confirmed working against real Fusion.

6. ~~`NuCommands.CommitCmd` / `CancelCmd`~~ — **CONFIRMED on this build.** The dial press
   committed an open Extrude. Still the only undocumented API in the system, and still
   build-specific: treat it as liable to break on a Fusion update, not as settled forever.

**Every hardware assumption from the original list is now resolved.** What follows is what has
been learned since, not what was carried in.

**Still unverified**

8. Whether the Stream Dock software's own auto-switching interferes with the plugin —
   untested. Nothing has been seen suggesting it does, but nothing has tested it either.
9. **New — fragile by nature, not by neglect:** `NuCommands.CommitCmd` works today but is
   undocumented and build-specific. Expect it to break on some future Fusion update. Symptom:
   the dial does nothing with a dialog open. Fix belongs in `command_overrides.json`.
10. **New — command ids are install-derived.** All 139 resolve against this build. A Fusion
    update can rename or remove them; re-run `scripts/resolve-commands.js` after one.
11. **New — design judgements, only answerable by use:** whether the dial's Iso/Top/Front cycle
    is the right thing on rotation, whether Undo/Redo sit well on the side buttons, and whether
    the View key earns a slot now the dial covers the common views.
12. **New — Stage 4 (context memory) and Stage 5 (robustness) are largely untested.** 4.2 passed
    incidentally. The per-context memory features in 4.8 and 4.10 — the ones with no equivalent
    in any shipping product — have not been exercised at all, nor has anything in Stage 5.

**Tooling note.** The bridge now exposes `GET /debug`, a 200-entry ring buffer of raw host
events mirrored by the plugin. It exists because neither channel that should have worked does:
the Stream Dock host does not write plugin `logMessage` anywhere readable, and the add-in's
`app.log` does not reach Fusion's log file. It is how the grid question was settled and how the
dial payload will be.
