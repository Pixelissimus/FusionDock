# Backlog

Open work, newest thinking first. Started 2026-07-27, during the first hardware bring-up.

Anything here that is a *decision* rather than a task says so, and says who it is waiting on.
Hardware findings live in `manual-test-plan.md`; this file is only what is still to do.

---

## 1. Custom folder icons — waiting on Jamie (credits)

**Problem.** Folder keys open a sub-page rather than running a command, so there is no Fusion
icon to read. They currently render as a label plus a blue corner dot. Jamie confirms these
icons do not exist in Fusion's own icon directory either, so there is nothing to borrow.

**Still needed, four icons:**

| Icon | Used by |
| --- | --- |
| Create (solid) | `solid` page → `solid.create` |
| Modify (solid) | `solid` page → `solid.modify` |
| Create (sketch) | `sketch` page → `sketch.create` |
| Modify (sketch) | `sketch` page → `sketch.modify` |

They must match Fusion's existing icon style, and the solid and sketch pairs must be visually
distinct — the whole point is knowing which environment you are in at a glance.

**Already solved without new art:**

- **Construct** → borrows Offset Plane's icon. Jamie approved this: Offset Plane is a real
  construction command, so the borrow is representative rather than arbitrary.
- **Geometry folders** (Rectangle, Circle, Arc, Polygon, Slot, Spline) → borrow their first
  variant's icon. A rectangle glyph on the Rectangle folder is honest.
- **Abstract folders** → label plus badge, deliberately. Borrowing an unrelated command's
  icon (Create wearing Sweep's) actively misleads.

**Not started.** Generating these costs credits, which is Jamie's call, and the standing rule
is to ask first. Worth deferring until the layout has had real use — if the badge reads fine
after a week, the icons may not be needed at all.

**Constraint:** whatever is produced ships in `static/`. Autodesk's own artwork is never
bundled — Fusion icons are read from the local install at runtime, and that must stay true.

---

## 2. Telling portrait from landscape — DONE 2026-07-27 (Jamie's design)

**Solved.** Jamie's idea: ship *two* actions instead of one, and let the placement itself carry
the answer.

| Action | UUID | Means |
| --- | --- | --- |
| Fusion Key (Landscape) | `com.fusiondock.streamdock.key` | 5 wide x 3 tall, dial bottom right |
| Fusion Key (Portrait) | `com.fusiondock.streamdock.key.portrait` | 3 wide x 5 tall, dial top right |

The host sends the action UUID on every `willAppear`, so the plugin reads orientation straight
off each key. Majority of placed keys wins, so one stray key of the wrong kind cannot flip the
layout.

Why this is better than the setting it replaced: placing the keys is something the user must do
anyway, so the answer comes from an action they cannot forget to take — where a dropdown can sit
disagreeing with the physical device forever. The orientation control is **gone** from the
Property Inspector, and a stored `orientation` in global settings is now ignored outright (an
old stored value would otherwise transpose the grid). Two tests cover it, including one that a
stale setting cannot override the placed action.

The landscape action deliberately kept the original UUID, so existing placements survived the
change; only portrait needs fresh drags.

**Note on layout authoring:** this fixes *detection*, not authoring. Pages remain ordered lists
and the per-orientation grid mapping stays derived in `grid.js` — a page authored once re-flows
from 5x3 to 3x5 automatically. Hand-authoring a second portrait copy of a page would break the
"author layouts once" rule in `CLAUDE.md`. If portrait ever needs genuinely *different content*
rather than a re-flow, that is a new feature and needs designing, not a second copy.

---

## 2b. Original notes — kept for context

**Problem.** The N1 reports its native 3x5 frame however it is physically held, so the plugin
cannot detect orientation. It is a Property Inspector setting, and if the user turns the device
without changing it, every key is transposed — which is exactly the bug that cost time at
Stage 3.4.

VSD Craft has its own icon-rotation setting, which the user sets when they turn the device.
That setting is the closest thing to ground truth, but the SDK exposes no way to read it.

**Jamie has a proposal and wants to talk it through before anything is built.** Nothing should
be implemented here until that conversation has happened.

Constraints worth having to hand for it:

- `deviceDidConnect` carries only a device id — no size, no rotation.
- Registration info reports native size only, and it never changes.
- No SDK event fires when the user changes VSD Craft's rotation setting.
- `dialRotate` carries a `pressed` boolean, so held-and-turned is available as a gesture if a
  manual toggle is ever wanted.

---

## 3. Does the View key earn its slot? — open question

Jamie: *"I'm not sure we need a View button... we'll leave it for the moment."*

The View folder opens a page holding Fit, Home, the six orientations, and three visual styles.
Since the dial now cycles Iso/Top/Front, the three most-used orientations are already on a
physical control, which is most of the value.

Left in place for now. Revisit after real use. If it goes, the view page needs another route
or it becomes unreachable — there is a test enforcing that.

---

## 4. Remaining command coverage

Surface, Mesh, Sheet Metal and Plastic were only sketched in and have not had the same
menu-fidelity pass the sketch pages just had.

| Page | Keys | Notes |
| --- | --- | --- |
| `surface` | 11 / 15 | never checked against Fusion's real Surface menus |
| `mesh` | 8 / 15 | ditto |
| `sheetmetal` | 9 / 15 | ditto; "Contour Flange" and "Bend" turned out not to exist and became Hem and Fold |
| Plastic | none | no page at all, and no rule for `PlasticTab` |

The sketch restructure is the template: check each menu against Fusion, split anything that is
really a submenu into its own page, and confirm every id with
`node scripts/resolve-commands.js`.

---

## 4b. The `home` page offers keys that cannot work

Observed at Stage 4.12. With Fusion open but no document, the `home` page shows Sketch,
Component, New, Save and View. **Sketch and Component cannot do anything without a document** —
pressing them will fail and flash the key red (which is at least honest, but it is still
offering something that cannot work).

Options: drop them from `home` and use the free slots for document-level commands (Open,
Recent, New Design From File), or keep them and accept the red flash. Cosmetic, and a data
change either way.

---

## 5. Smaller things

- **`icon` fields in the layout are dead.** Every key carries one (`"icon": "extrude"`), but
  no matching assets exist and nothing reads them — images come from Fusion via `/icon?id=`,
  or from `peek`. Harmless but misleading. Delete, or make them a real fallback.
- **Five commands have no Fusion icon** and fall back to a text label:
  `NewDocumentCommand`, `Coil`, `AppearanceCommand`, `PhysicalMaterialCommand`,
  `FusionSheetMetalHemFlangeCommand`.
- **`/debug` is bring-up tooling.** A 200-entry ring buffer of raw host events, plus the
  plugin posting to it on every `willAppear`/dial event. Worth a switch once the hardware
  questions are closed, though it costs nothing measurable today.
- **Undo/Redo on the side buttons is unproven in real use.** Confirmed working; whether the
  placement feels right after a week of modelling is a different question.
