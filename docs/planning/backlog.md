# Backlog

Open work only. Anything fully resolved is deleted from here — the history of how it was
resolved lives in `manual-test-plan.md`, which is the record; this file is the to-do list.

Last pruned 2026-07-27 after Stages 0–4 passed on real hardware.

---

## 1. Custom folder icons — in progress

**Problem.** Folder keys open a sub-page rather than running a command, so there is no Fusion
icon to read. Jamie confirms these icons do not exist in Fusion's own icon directory either, so
there is nothing to borrow. They currently render as a label plus a blue corner dot.

They must read as **a menu, not a single function**, and match the visual language of Fusion's
existing icons — with the solid and sketch pairs clearly distinct, since knowing which
environment you are in at a glance is the point.

**Needed:**

| Icon | Used by |
| --- | --- |
| Create (solid) | `solid` → `solid.create` |
| Modify (solid) | `solid` → `solid.modify` |
| Create (sketch) | `sketch` → `sketch.create` |
| Modify (sketch) | `sketch` → `sketch.modify` |
| Constrain (sketch) | `sketch` → `sketch.constrain` |
| View | the View key — appears on **six** pages, so it is the most-seen key in the whole layout |

**Solved without new art** (borrowed icons that genuinely represent the folder):

- Construct → Offset Plane · Project → Project · Rectangle, Circle, Arc, Polygon, Slot,
  Spline → their first variant.

### Fusion's real icon style, measured from the actual files

Do not guess this. Taken from Fusion's own PNGs on 2026-07-27 by pulling them off the bridge
(`/icon?id=...`) and looking at them:

- **Flat vector.** No outlines, no gloss, no gradients, no shading, no drop shadows, no bevels.
  Shapes are defined purely by flat blocks of colour meeting each other.
- **Solid icons** (Extrude, Revolve, Draft): isometric 3D shapes. Lit faces in a soft, pale sky
  blue, roughly **#7FC9F2**. Secondary faces in white and very pale grey **#E8E8E8**. Nothing
  dark, nothing saturated.
- **Sketch icons** (Rectangle, Coincident): thin pale grey **#C8C8C8** line geometry with small
  solid sky-blue square handles at the line endpoints.
- Transparent background, square canvas, readable at 96x96, never any text.

Note they are drawn for a **light** toolbar. They read well on the N1's dark keys only because
they are light-coloured — worth remembering before adding anything dark.

### Progress 2026-07-27

A first candidate for **Create (solid)** was generated in ChatGPT (chat: "Toolbar Icon Design
Request"): a cube, cylinder and sphere clustered as a set, which reads as a menu rather than a
single command. The first attempt came back with thick black outlines, oversaturated blue and a
gradient-shaded sphere — all three wrong against the spec above. A later render corrected them
and is close, with some residual thin dark edging on the cube and cylinder.

**Not downloaded.** Two attempts to save it through browser automation did not produce a file.
The image is still in that chat. Either save it by hand, or retry.

**The other five were deliberately not generated.** The style is an aesthetic call that is
Jamie's to make, and generating five more before he has approved one risks wasting credits —
the standing rule is to test cheap first and ask before spending.

**Also needs a small code change once the art exists.** The `icon` field in the layout is
currently dead — nothing reads it. Images come from Fusion via `/icon?id=`, or from `peek`.
Wiring `icon: "createsolid"` to `static/createsolid.png` is the last step, and it doubles as
the fix for item 4 below.

**Constraint:** whatever is produced ships in `static/`. Autodesk's own artwork is never
bundled — Fusion icons are read from the local install at runtime, and that must stay true.
Matching the visual *language* is fine; copying their files is not.

---

## 2. Does the View key earn its slot? — open question

Jamie: *"I'm not sure we need a View button... we'll leave it for the moment."*

The View folder opens a page holding Fit, Home, the six orientations and three visual styles.
The dial already cycles Iso/Top/Front, which is most of the value, and the key appears on six
pages — so it is the most expensive key in the layout in slot terms.

Revisit after real use. If it goes, the view page needs another route or it becomes
unreachable; there is a test enforcing that.

---

## 3. Remaining command coverage

Surface, Mesh, Sheet Metal and Plastic have not had the menu-fidelity pass the sketch pages
got, where each menu was checked against Fusion and real submenus were split out.

| Page | Keys | Notes |
| --- | --- | --- |
| `surface` | 11 / 15 | never checked against Fusion's real Surface menus |
| `mesh` | 8 / 15 | ditto |
| `sheetmetal` | 9 / 15 | ditto |
| Plastic | none | no page at all, and no rule for `PlasticTab` |

The sketch restructure is the template. Confirm every id with
`node scripts/resolve-commands.js` — never invent one.

---

## 4. The `home` page offers keys that cannot work

With Fusion open but no document, `home` shows Sketch, Component, New, Save and View. **Sketch
and Component cannot do anything without a document** — pressing them fails and flashes the key
red. Honest, but it is still offering something that cannot work.

Either drop them and use the free slots for document-level commands (Open, Recent, New Design
From File), or accept the red flash. A data change either way.

---

## 5. Smaller things

- **Five commands have no Fusion icon** and fall back to a text label: `NewDocumentCommand`,
  `Coil`, `AppearanceCommand`, `PhysicalMaterialCommand`, `FusionSheetMetalHemFlangeCommand`.
  Fixed for free by the `icon` wiring in item 1 if art ever exists for them.
- **`/debug` is bring-up tooling.** A 200-entry ring buffer of raw host events, plus the plugin
  posting to it on every `willAppear` and dial event. It answered the grid, controller-name and
  dial-payload questions. Worth a switch now those are closed, though it costs nothing
  measurable.
- **Design judgements, only answerable by use:** whether the dial's Iso/Top/Front cycle is
  right, whether Undo/Redo sit well on the side buttons, and whether losing the on-screen
  Cancel inside sketches bites (OK is still on the dial; Escape still works).

---

## 6. Stage 5 — robustness, not yet started

Rapid key presses, a 30-minute soak, unplug/replug, restarting either side independently, and
the one that could still force an architectural change: **whether the add-in's 400 ms main-thread
poll makes Fusion feel sluggish during real modelling.** If it does, raise
`POLL_INTERVAL_SECONDS` in `FusionStreamDock.py`.
