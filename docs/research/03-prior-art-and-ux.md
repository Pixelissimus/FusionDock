# Research: prior art, UX conventions, and the Fusion command inventory

Date: 2026-07-27. CONFIRMED (primary source cited) or UNCERTAIN.

## Summary

Three findings drive the design:

1. **Nothing like this exists.** No Stream Deck *plugin* for Fusion 360 — zero GitHub results,
   nothing on Elgato's marketplace. Every existing product is a keystroke-sender with manual
   folders. The one Autodesk forum thread asking for exactly this has zero replies.
2. **Keyboard injection structurally cannot do view, navigation or display commands.** Autodesk
   states this outright. That removes the fallback and makes the add-in route mandatory.
3. **The loudest unmet complaint in the whole user corpus is losing your place** when a page
   switches. Nobody has solved it. Restoring per-context last position is the obvious win.

## Prior art

### Fusion 360 specifically

| Product | Mechanism | Context-aware | Notes |
| --- | --- | --- | --- |
| SideshowFX Fusion 360 Pro Profiles ($39.99, Nov 2025) | Keyboard shortcuts + imported keyfile | **No** | ~700 commands (XL) / 302 (MK), ~3000 icons. Manual folders only |
| SideshowFX icon packs | n/a | n/a | 700 labelled + 700 unlabelled, **originals redrawn**, not Autodesk's |
| schneik80/Macropad-fusion | Keyboard shortcuts | **No** | Adafruit Macropad, 12 keys + encoder, GPL-3.0 |
| gelatinouscactus/Steam-deck-fusion360-control | **Fusion API** (viewport camera) | Viewport only | Gamepad orbit/zoom via `pyjoystick` |
| thomasa88/AnyShortcut | Fusion API | n/a | Exposes commands Fusion won't normally let you bind |

**There is no Stream Deck plugin for Fusion 360.** CONFIRMED by absence across GitHub and the
Elgato marketplace.

### The closest analogue — DeckMania for Blender

https://deckmania.com/ — this is the architecture to learn from.

- A Stream Deck **plugin** plus a Blender **add-on**, linked, with the add-on reporting state.
- Auto-switches page on three signals: object type, object mode (Object/Edit/Sculpt), and
  workspace name. Pages are matched **by name** to the state.
- Button types include Tool buttons that **colour the key** to show the active tool, and Dial
  buttons that show a property value.
- **Stated limits:** one profile per device; auto-switching works *only* inside the
  DeckMania-distributed profile; LITE caps at 3 pages.

Also relevant: visualstorms "Blender Pro" uses a **WebSocket** bridge and detects the active
workspace to swap icons. Scale is instructive — **97 pages / 903 keys** for a 15-key device.

### 3Dconnexion SpaceMouse — the only first-party context-aware Fusion peripheral

Fusion exposes its command tree to the 3Dconnexion driver, and buttons are workspace/tab
sensitive: switching between Solid and Sheet Metal tabs automatically updates the mapped
commands. The mechanism is named in the 3DxWare SDK — apps declare "command sets" and call
`ActiveCommandSet()`. Precedent that Autodesk considers this a legitimate integration pattern.

## The decisive constraint on keyboard injection

> "Autodesk Fusion cannot currently assign keyboard shortcuts to access named views or display
> settings or navigational commands."
> — https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Keyboard-shortcuts-for-named-views-and-navigation-commands-in-Fusion-360.html (updated 8 Jul 2025)

So Home / Top / Front / Back / Left / Right / Iso, Fit, Orbit, Pan, Zoom and every Display
Settings option are **unreachable by hotkey** — precisely the category a physical pad is most
valuable for. CONFIRMED.

Custom shortcuts can be bound to most other commands (hover → ⋮ → Change Keyboard Shortcut),
but only combinations containing an alpha key register, and shortcuts are stored in the
Autodesk **account**, not a local file — so a keymap cannot be shipped the way SideshowFX does
without manual import by the user.

### Default shortcuts worth knowing

Design: `E` Extrude · `Q` Press Pull · `H` Hole · `F` Fillet · `M` Move · `I` Measure ·
`A` Appearance · `J` Joint · `V` Toggle Visibility · `S` Toolbox · `Ctrl+B` Compute All ·
`Spacebar` Repeat Last Command · `1`/`2`/`3` Window/Freeform/Paint Selection

Sketch: `L` Line · `R` 2-Point Rectangle · `C` Center Diameter Circle · `D` Dimension ·
`T` Trim · `O` Offset · `P` Project · `X` Construction toggle

System: `Ctrl+[` / `Ctrl+]` cycle workspaces · `Ctrl+Alt+C` Text Commands

## UX conventions — from real user commentary

These are the findings that should shape the layout design.

### 1. Losing your place is the top complaint — and nobody has solved it

> "When closing the pdf, the SD+ reverts to page 1 of the default profile. Even when I'm on
> page 2, or in a folder... This is counter productive and a little sad to have to press/swipe
> my way back to the folder/page I want to have back."

Users are trapped between two bad defaults: auto-return destroys navigation state; no-return
strands you in the wrong context. **Restoring per-context last position is the unclaimed
answer** and should be a core feature.

### 2. Split the grid — fixed region plus context region

> "There is also an argument to using two separate 15 keys streamdecks vs one 32 key one, since
> when you change button directories on one, you wouldn't change the set of buttons you are on
> the other."

Users literally buy a second device to fake this. Fusion's own UI does the same thing — an
immutable context-sensitive marking menu you memorise, plus a customisable `S` Toolbox.

**Design consequence: do not repaint the whole grid on context change.** Reserve a fixed
region; keep the same command in the same cell on every page.

### 3. Wrong-state buttons are worse than stateless ones

Where a plugin can't read app state, users invent workarounds under duress — splitting a toggle
into two adjacent absolute buttons ("Open"/"Close") because they never know which state they're
in. Where the back-channel exists it is rated very highly, and **colour carries as much
information as the glyph**.

We have the API to read state. Use it, or show no state at all.

### 4. Muscle memory matters less than expected — good news

A Stream Deck is a **look-at device, not a home-row device**.

> "A static grid of real buttons whose function changes within context is a more useful
> implementation in the real world, even though it is technically less capable."

Command density costs less than theory predicts because nobody is touch-typing the pad. But
note the counter-precedent: Fusion's marking menu is deliberately non-customisable "since their
efficiency is based on consistent command position and the ability to memorize them."

### 5. Nesting is loved, not avoided — observed depth 2–3

No "I never use the sub-pages" sentiment was found. The named cost is **setup labour**, not
depth. Max depth anyone described was 3.

### 6. A fixed home/back key is wanted, but resented as a tax

> "my only complaint is that you have to lose one button in order to have a 'directory up'
> button... The devices would benefit from having separate hardware 'home' and 'directory up'
> buttons."

**The N1's two auxiliary buttons solve this exactly** — home and back can live there instead of
eating main-grid keys. This is a real advantage over a plain 15-key deck.

### 7. Icons and text together; legibility is not the complaint

No complaints about small-key legibility appeared. The friction is entirely in *producing and
choosing* artwork — which is why the SideshowFX icon packs sell. Elgato's convention is to
leave room at the bottom of the icon for a label.

### 8. Where the pad actually wins

> "what really breaks my flow is moving my mouse from the middle of the screen where my model
> is, to the top of the screen where the menus is... It saves about 1 second, but really makes
> a huge difference."

The target it beats is **the mouse trip to the ribbon**, not the keyboard shortcut. The pad wins
where command breadth exceeds what one person memorises — which is exactly CAD.

## Command inventory — Design workspace

Roughly **180–220 distinct commands** including flyout variants.

**Recommendation: generate the shipping inventory at runtime from `ui.commandDefinitions`**
rather than transcribing docs. It is version-exact and yields the actual IDs.

### Sketch environment — highest confidence, and the most important for context-switching

| Group | Variants |
| --- | --- |
| Line | Line, Midpoint Line |
| Rectangle (3) | 2-Point, 3-Point, Center |
| Circle (5) | Center Diameter, 2-Point, 3-Point, 2-Tangent, 3-Tangent |
| Arc (3) | 3-Point, Center Point, Tangent |
| Polygon (3) | Circumscribed, Inscribed, Edge |
| Slot (5) | Center to Center, Overall, Center Point, 3 Point Arc, Center Point Arc |
| Spline (2) | Fit Point, Control Point |
| Others | Ellipse, Conic Curve, Point, Text, Mirror, Circular Pattern, Rectangular Pattern |
| Project/Include (7) | Project, Intersect, Include 3D Geometry, Project To Surface, Intersection Curve, Isoparametric Curve, Spun Profile |

**Modify panel (12):** Fillet, Equal Distance Chamfer, Distance And Angle Chamfer, Two Distance
Chamfer, Trim, Extend, Break, Sketch Scale, Offset, Blend Curve, Move/Copy, Change Parameters

**Constraints (exactly 12):** Horizontal/Vertical, Coincident, Tangent, Equal, Parallel,
Perpendicular, Fix/UnFix, Midpoint, Concentric, Collinear, Symmetry, Curvature

Corrections to the original brief: Offset, Fillet and Sketch Scale are **Modify** tools, not
Create. There are **three** chamfer variants. Horizontal/Vertical is **one** command that picks
whichever axis is closer, not two.

### Solid tab

- **Create from sketch:** Extrude, Revolve, Sweep, Loft, Rib, Web, Emboss
- **Primitives:** Box, Cylinder, Sphere, Torus, Coil, Pipe
- **Other create:** New Component, Hole, Thread, Pattern (Rectangular/Circular/Path), Mirror,
  Thicken, Boundary Fill, Create Base Feature, Create Form, Derive, Automated Modeling
- **Modify:** Press Pull, Fillet, Chamfer, Shell, Draft, Scale, Combine, Offset Face,
  Replace Face, Split Face, Split Body, Silhouette Split, Align, Move/Copy, Delete,
  Physical Material, Appearance, Manage Materials, Compute All, Change Parameters
- **Construct:** 8 planes, 5 axes, 6 points, UCS
- **Inspect:** Measure, Interference, plus 8 analysis tools, Section Analysis, Center of Mass
- **Insert:** 11 tools including Decal, Canvas, SVG, DXF, McMaster-Carr

Surface, Mesh, Sheet Metal and Plastic tab inventories captured at lower confidence — regenerate
from `commandDefinitions`.

### View / navigation — API-only, since none can take a shortcut

ViewCube: Home, 6 faces, 12 edges, 8 corners. Navigation bar: Orbit (Free/Constrained), Look At,
Pan, Zoom, Zoom Window, Fit. Visual styles (6): Shaded, Shaded with Hidden Edges, Shaded with
Visible Edges Only, Wireframe, Wireframe with Hidden Edges, Wireframe with Visible Edges Only.
Plus Environment, Effects, Object Visibility, Camera (Ortho/Perspective/Perspective with Ortho
Faces), Grid and Snaps, Viewports.

## Coverage gaps

forums.autodesk.com returned 403 to automated fetching throughout — the Stream Deck and custom
hotkey threads are worth a manual read. YouTube comments and transcripts unreachable. Reddit
archive coverage ends ~April 2025. Sheet Metal and Plastic inventories are partial.
