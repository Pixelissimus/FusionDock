# Backlog — history, not the to-do list

**The to-do list is `TODO.md` in the project root.** Tickable, numbered, and the only place
outstanding work is tracked. This file is now the record of how things were decided and
resolved; `manual-test-plan.md` is the record of what was tested on hardware.

Last pruned 2026-07-27 after Stages 0–4 passed on real hardware.

---

## 1. Custom folder icons — DONE 2026-07-27

All six drawn, keyed to transparency, installed and committed: `create-solid`, `modify-solid`,
`create-sketch`, `modify-sketch`, `constrain-sketch`, `view`.

Kept below because the style spec and the extraction recipe are what any future icon work
should follow — the generator will not produce transparency, and its own download saves the
baked background.

**Design rule learned the hard way, worth keeping:** a menu icon must not depict any single
operation. The first `modify-sketch` drew a filleted corner — which is exactly what Fusion's own
Fillet icon shows, and Fillet is a command *inside the page that key opens*. Both Modify icons
were reworked to a shared device instead: a dashed ghost of the original geometry plus an arrow,
meaning "alter what exists" without naming a command, and contrasting with Create, which shows
new geometry and no ghost.

**Remaining judgement, only answerable by use:** whether they read clearly at 96x96 on the
actual keys — particularly whether the dashed ghost outlines hold up at that size. They were
reviewed at full size and as 96px mock-ups, but not yet seen on the device.

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

All six are done. What each shows:

| File | Subject |
| --- | --- |
| `create-solid` | a cube, cylinder and sphere grouped as a set — a menu, not one command |
| `modify-solid` | a solid cube with a dashed ghost cube behind it and an arrow pushing in |
| `create-sketch` | a rectangle, circle and line overlapping, with blue endpoint handles |
| `modify-sketch` | a rectangle with a dashed ghost of its former size and a resize arrow |
| `constrain-sketch` | two offset lines with a blue right-angle marker between them |
| `view` | an isometric ViewCube with a curved arrow sweeping round it |

**The image generator errors intermittently.** "The image generation step hit an error" hit
three times running on one icon, then the identical prompt worked on a retry. It is not the
prompt and not the chat length — both were ruled out. Just resend.

**The code side is done too.** The layout's `icon` field resolves to `static/<name>.png`
(commit d3d5cc6), with Fusion's own icons still winning wherever a command exists.

Note that wiring `icon` up also exposed **147 dead references**: every key carried an `icon`
name, no matching art had ever existed, and nothing read the field until now. Left alone they
would each have cost a failed fetch per repaint. They are gone. View directions, OK/Cancel and
"Waiting for Fusion" stay as text on purpose — "Front" reads better than a glyph.

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

## 3. Command coverage — rewritten 2026-07-28, now needs proving

Every context now has a full page 1 and page 2, plus a fixed region (Tabs / View / More) at
slots 13–15, and `home` has become the tab picker. All 208 command and icon ids in the layout were
checked against `command-dump.json`; none is invented. What has **not** happened is anyone
pressing them.

Open against this:

- **One tab id is still inferred.** Stage 1 already recorded the live ids on 2026-07-27 —
  `SolidTab`, `SurfaceTab`, `SheetMetalTab`, `PlasticTab`, `ParaMeshOuterTab`, `ToolsTab`,
  `ManageTab`, `SketchTab` — so Plastic now matches on `PlasticTab` like the rest. Only
  Utilities still matches on `tabName`: `ToolsTab` is almost certainly it, but that pairing was
  never observed next to its display name, and a wrong id would put the Utilities page on the
  Manage tab. `GET /tabs` settles it.
- **Tab switching is written but unproven.** `activate_tab()` in `fsd_commands.py` and the
  `tab` action are new. `Workspace.activate()` / `ToolbarTab.activate()` are documented but
  have never been called from this add-in.
- **Arrangement is still my judgement, not data.** Which command sits on page 1 versus page 2
  was chosen from names and a read of the workflow. Fusion's own ribbon order — what it
  promotes, what it buries — has never been dumped. An endpoint walking
  workspaces → tabs → panels → controls would replace the guesswork; roughly 40 lines.

---

## 2b. Ten Design tabs still fall through to the Solid page

`GET /tabs` was finally run on 2026-07-28 and the whole thing is captured in
`docs/research/tab-dump.json` — 38 workspaces, 219 tabs, ids **and** display names. Two
immediate results: `ToolsTab` is confirmed as UTILITIES so no rule matches on a display name
any more, and `ParaMeshOuterTab` reports its name as `"Mesh"`, not `"MESH"` — Fusion's own
casing is inconsistent, which retrospectively justifies matching rules on id only.

What the dump also exposed is that ten tabs in the Design workspace have no rule and therefore
show the **Solid** page, which is the same wrongness Jamie found with Plastic and Utilities,
just not yet noticed:

| Tab id | Shows as | Worth a page? |
| --- | --- | --- |
| ~~`ParaMeshBaseFeatureTab`~~ | Direct Mesh Editing | **DONE 2026-07-28** — `mesh.direct`, with Finish on slot 1. Two things unverified: whether entering the environment changes the workspace (the rule matches on tab alone so it does not care), and exactly which commands Fusion enables in there |
| `AssemblyTab` | ASSEMBLY | Probably — Joint, As-Built Joint, Rigid Group are real work and have no keyboard shortcut |
| `SketchTab` | SKETCH | No. The `inSketch` rule already covers being *in* a sketch; this tab is just the ribbon showing |
| `ManageTab`, `PCBTab`, `Package3DTab`, `BasefeatureSolidTab`, `BasefeatureSurfaceTab`, `EditSnapshotTab` | — | Unlikely for functional parts. Left deliberately |

Each is one rule plus one page, both data. The ids are no longer guesses.

---

## 3a. Full key audit — run 2026-07-28, `npm run audit`

Prompted by Jamie asking for every button to be checked after a navigation bug that no id check
would ever have caught. `scripts/audit-layout.js` walks all 33 pages, 344 keys and 12 rules and
reports reachability, exits, slot counts, conflicting actions, unknown ids, missing artwork,
label length, duplicate keys and shadowed rules. It fails on ERROR; WARN and NOTE are judgement.

**Currently: no errors, no warnings.** Four things it found and that were fixed in the same
pass:

1. **Global doors were remembered as sub-pages.** The bug Jamie hit. Pages are now marked
   `"global": true` and excluded from the per-context memory. The audit now errors if a page is
   opened from more than two contexts without that flag, so the next one cannot slip through.
2. **A failing key flashed nothing unless it was a `cmd`.** `commandResult` reported only `id`,
   which is null for tab, view and text actions — so a tab key that failed was indistinguishable
   from a key that was never wired up. That is precisely why the tab problem was invisible for
   three rounds. The result now carries the action and its identifying fields, and the plugin
   matches on all of them.
3. **Thirteen folder pages had no visible exit** — only the dial (Home) left them. Each now ends
   with a Back key and its own mirrored chevron icon.
4. **Two tests asserted a 12-slot grid**, a leftover from before all 15 keys became context
   keys. A 13-key folder looked overfull against a number that had not been true for a day.

Deliberately still open, reported as NOTE:

- **30 labels are reused across contexts** — "Extrude" is three different commands (solid,
  surface, T-Spline), "Fillet" two. Correct: they are Fusion's own names, and the context makes
  them unambiguous. Renaming them would be worse.
- **11 keys draw as text only** because `/icon` 404s for their command. Unchanged, see item 5.

---

## 3c. Code review, 2026-07-28 — ten confirmed defects, all fixed

An adversarial review of the whole two-day change set. Worth recording because eight of the ten
were in code written *to fix* the previous problem, and three were in the safety net itself.

| Defect | Fix |
| --- | --- |
| Pressing a tab on the picker left the device stranded there whenever the resolved page did not change — the tab Fusion is already on, or any tab while inside a sketch | `Navigator.closeDoors()`, called on tab press. Excluding globals from *memory* was only half the fix; nothing popped the door off the live stack, and `applyState` returns early on an unchanged root |
| `activate_tab` reported `(True, "ok")` even when Fusion refused the switch | Check the Boolean both `activate()` calls return, exactly as `execute()` already did |
| `GET /tabs` walked the Fusion API on the HTTP thread — the project's own hard rule, broken by the endpoint added to enforce good practice elsewhere | The walk moved to the main thread (startup + workspace change) into `_tabs_cache`; the handler serves plain data. `/commands` still has the same flaw and predates it |
| The whole tab path had no test or simulator coverage | Fake bridge learned the `tab` action and a `/_sim/publish` route for failure frames; three integration tests, one of which fails without the `closeDoors` fix |
| `install.js` skipped copying `__pycache__` but never pruned one already in the target — so the only machine with the problem kept it | Prune the destination as well |
| The new global-page audit check read `contexts.size > 2` where its own comment said two or more | `>= 2`. The exactly-two case is the one most likely to occur |
| The audit exempted global pages from the exit check, and `view` had no exit key while all thirteen folder pages gained one | Globals are no longer exempt; `view` gained a Back key. A `page` key no longer counts as an exit — it opens something deeper |
| The shipped-layout test accepted any `nav` value, so `nav: "Back"` would pass while doing nothing | Validated against the set `activate()` handles |
| The add-in logged tab and view failures as `None` | Log the action and whichever identifying field is present |
| `matchesResult` compared text payloads with `===`, so a key carrying an *array* of text commands could never flash | Compare by value |

Four further candidates were refuted on verification and deliberately not acted on, including a
claimed race in `activate_tab`'s tab lookup that the tab dump disproves.

---

## 3b. Stop/Run did not reload the add-in — FIXED 2026-07-28, and it cost a session

**Symptom:** every tab key did nothing, twice, across two Stop/Run cycles. `/tabs` kept
returning 404 as if the new code had never been installed. It had been — `install.js` copied it
correctly both times.

**Cause:** Fusion's Stop/Run re-runs `FusionDock.py`, but `fsd_bridge`, `fsd_commands` and
`fsd_state` were already in `sys.modules`, so `import` was a no-op and every edit to those three
files was silently ignored. The add-in kept serving yesterday's bridge. `FusionDock.py`
now `importlib.reload()`s all three at startup.

**The trap in the fix:** the reload call lives in the very file whose staleness it cures, so the
first time it has to be picked up by a **full Fusion restart**. After that, Stop/Run means what
it looks like it means.

**Worth remembering generally:** "I installed it and nothing changed" is not evidence the change
was wrong. Check that the running process is actually running it — `/health` says the bridge is
alive, `/tabs` says *which version* of it.

---

## 4. `home` offering keys that cannot work — DONE 2026-07-28

`home` became the tab picker, and a separate `dashboard` page now covers the no-document case.
Jamie, testing on the device: *"realistically, from the dashboard, you can't do any of the
other functions"*. He is right — every modelling command, every tab key and Sketch, Component
and Measure all need a design. The dashboard page is two keys, New and Open, and nothing else.
It matches on the `hasDesign` field the state reader already published.

---

## 4b. Menu icons — Tabs, More and a recoloured Constrain, DONE 2026-07-28

`scripts/draw-menu-icons.js` draws all three. It replaces the generate-and-key-out route for
these particular icons, and the reason is the two failures already recorded above: an image
generator will not produce real transparency, and it will not hit a stroke weight you ask for.
Both stop being problems when the stroke width and the palette are literals in a file.

**The constraint palette is now measured, not argued about.** Fusion's ten constraint icons
were decoded and their pixels counted on 2026-07-28: **70.1% `#F07878`** coral red, **29.7%
`#D8D8D8`** pale grey, and nothing else. The old `constrain-sketch` was 45% sky blue `#78C0FF`
and 0% red — sky blue is what Fusion uses for sketch *handles* and solid *faces*, so the icon
read as "sketch" or "solid" rather than "constraint". Jamie called this out twice before it was
measured; measuring settled it in one pass.

The **line-weight rule from 27 July still holds and is now enforced by construction**: draw at
256px with a 13px stroke, which arrives as ~3px at the 62px key size, inside Fusion's own
measured 2–4px. Do not dilate — it grows blobs, not strokes, and looked soft on the device.
`scripts/check-icons.js` fails under 2px and now covers `more` as well.

Judgement still open: whether `tabs` reads as a ribbon on the actual key. It was drawn three
ways — three tabs (the outlined pair merged into one blob at 4x reduction), two tabs with a
short rule (read as two panels), and finally two tabs on a full-width rule with no bottom edge,
which is what shipped. Only the device settles it.

---

## 5. Smaller things

- **Ten commands in the layout have no icon** and fall back to a text label. Measured on
  2026-07-28 by asking the running bridge for all 208: `NewDocumentCommand`, `Coil`,
  `AppearanceCommand`, `PhysicalMaterialCommand`, `FusionSheetMetalHemFlangeCommand`,
  `FusionSheetMetalCornerCommand`, `FusionSheetMetalFilletCommand`,
  `FusionSheetMetalChamferCommand`, `ParaMeshBridgeCommand`, `ParaMeshCloseCracksCommand`.
  Every one reports `hasIcon: true` in the command dump but 404s from `/icon`, so this is
  either a gap in `resolve_icon()` (which returns None when `resourceFolder` raises *or* when
  the folder holds no non-`_dark` PNG) or genuinely empty folders. Worth ten minutes with one
  of them and `os.listdir` before drawing any art.
- **The fixed region costs three keys of fifteen on every page.** That is the same 20% that
  got an earlier fixed row deleted. The difference is that these three are doors, not
  commands. Revisit after real use — it is a data change to remove.
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
`POLL_INTERVAL_SECONDS` in `FusionDock.py`.
