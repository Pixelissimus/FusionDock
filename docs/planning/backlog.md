# Backlog

Open work only. Anything fully resolved is deleted from here — the history of how it was
resolved lives in `manual-test-plan.md`, which is the record; this file is the to-do list.

Last pruned 2026-07-27 after Stages 0–4 passed on real hardware.

---

## 1. Custom folder icons — DONE 2026-07-27

All six drawn, keyed to transparency, installed and committed: `create-solid`, `modify-solid`,
`create-sketch`, `modify-sketch`, `constrain-sketch`, `view`.

Kept below because the style spec and the extraction recipe are what any future icon work
should follow — the generator will not produce transparency, and its own download saves the
baked background.

**Remaining judgement, only answerable by use:** whether they read clearly at 96x96 on the
actual keys. They were checked at full size, not on the device.

<details>
<summary>Original brief and method</summary>


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

### The working recipe — follow this, it took several failed attempts to find

**1. ChatGPT will not produce real transparency.** Asked directly, it bakes in a grey gradient
and a blue glow every time, however explicitly it is told not to. Two attempts confirmed it.

**2. So generate on a flat dark background instead** and key it out afterwards. Prompt rules
that worked:

> BACKGROUND: fill the entire square canvas, edge to edge, with solid flat #1C1C1E. That exact
> colour, completely uniform. Do NOT make it transparent, do NOT add a gradient, a vignette, a
> spotlight, a glow, a halo, a shadow or a reflection.
> STYLE: flat vector. No outlines, no black keylines, no gloss, no bevels, no gradients, no
> shading. Every face is one single flat colour.
> COLOURS: isometric 3D solids. Lit faces pale sky blue #7FC9F2. Other faces white #FFFFFF and
> very pale grey #E8E8E8. Nothing dark, nothing saturated.
> No text, letters or numbers. Must read clearly at 96x96.

**3. Extract it in the browser, not by downloading.** ChatGPT's own download saves the baked
background, and the image URLs carry auth tokens that cannot be read out. Instead run this in
the page console (or via the browser tool) — it fetches the image, keys the dark background out
by luminance, and saves a real transparent PNG straight to Downloads:

```js
const imgs = Array.from(document.images).filter(i => i.naturalWidth > 300);
const img = imgs[imgs.length - 1];                    // check this IS the newest one
const bmp = await createImageBitmap(await (await fetch(img.currentSrc)).blob());
const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
g.drawImage(bmp, 0, 0, S, S);
const im = g.getImageData(0, 0, S, S), d = im.data;
const LO = 45, HI = 85;                               // art is light, background is dark
for (let i = 0; i < d.length; i += 4) {
  const L = Math.max(d[i], d[i+1], d[i+2]);
  if (L <= LO) { d[i+3] = 0; }
  else if (L < HI) { d[i+3] = Math.round(255 * (L - LO) / (HI - LO)); }
}
g.putImageData(im, 0, 0);
const a = document.createElement('a');
a.href = c.toDataURL('image/png'); a.download = 'create-solid.png';
document.body.appendChild(a); a.click(); a.remove();
```

The soft ramp between LO and HI keeps anti-aliased edges rather than leaving a hard dark
fringe. Then copy the file into `static/` and run `node scripts/install.js --force`.

### Progress 2026-07-27

**DONE — `create-solid.png`.** A cube, cylinder and sphere grouped as a set, so it reads as a
menu rather than one command. Generated, keyed to transparency, installed and committed. Chat:
"Fusion 360 Icon Design".

**Icon 2 (Modify solid) is blocked, not abandoned.** ChatGPT's image generator returned "the
image generation step hit an error" twice in a row. Not a prompt fault — the identical rules
had just produced icon 1 cleanly. Worth simply retrying later.

**Still to make:** `modify-solid`, `create-sketch`, `modify-sketch`, `constrain-sketch`, `view`.
One at a time, each checked against Fusion's real icons before moving on.

**The code side is already done.** The layout's `icon` field now resolves to
`static/<name>.png` (commit d3d5cc6), with Fusion's own icons still winning wherever a command
exists. Dropping a PNG into `static/` and running `node scripts/install.js --force` is all that
each remaining icon needs.

**Constraint:** whatever is produced ships in `static/`. Autodesk's own artwork is never
bundled — Fusion icons are read from the local install at runtime, and that must stay true.
Matching the visual *language* is fine; copying their files is not.

---

</details>

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
