# 0001 — Overall architecture

Date: 2026-07-27. Status: accepted.

## Context

We need a VSD Stream Dock N1 to drive Fusion 360, with the device's keys following the user's
context inside Fusion. Research findings in `docs/research/` constrain the design:

- Fusion cannot assign keyboard shortcuts to view, navigation or display commands, so keyboard
  injection cannot cover the categories a physical pad is most useful for.
- The Stream Dock software has a real plugin SDK (an Elgato fork), but its `switchToProfile` is
  undocumented, missing from most bindings, and used by no shipped plugin.
- Fusion is single-threaded; API calls must be marshalled to the main thread.
- Fusion's own icons are readable from the local install but should not be redistributed.

## Decisions

### 1. Two processes, HTTP + Server-Sent Events between them

A **Fusion add-in** (Python) and a **Stream Dock plugin** (HTML/JS), talking over
`127.0.0.1` via plain HTTP with an SSE stream for state.

Rejected alternatives:
- *WebSocket between the two* — would need a hand-rolled WebSocket server in the add-in
  (handshake plus framing) because Fusion ships no such library. SSE is a plain text stream
  server-side and `EventSource` client-side. Same capability here, far less code.
- *Node.js plugin template* — would allow raw TCP, but adds a runtime dependency. The HTML/JS
  plugin runs in a browser context that already has `EventSource`, `fetch` and `WebSocket`.

Consequence: the add-in is the server. It serves state, accepts commands, and serves icons.
The plugin is a pure client and needs no native dependencies.

### 2. Repaint keys in place; do not use profiles or pages of the host software

The plugin owns all 15 keys and calls `setImage`/`setTitle` on each when context changes.
"Pages" are plugin-internal state.

Rationale: `switchToProfile` is probably dead code, and even Elgato's own SDK restricts plugins
to profiles they ship — which is why DeckMania for Blender carries a "our profile only"
limitation. Repainting needs no host cooperation, works regardless, and gives full control over
transitions.

### 3. Commands run via `commandDefinitions.execute()`, inside a CustomEvent handler

Device input arrives on the add-in's HTTP thread, is queued, and is marshalled to Fusion's main
thread with `fireCustomEvent`. `execute()` is forbidden inside command-related events but
permitted inside a CustomEvent handler, which is exactly where our input lands.

`executeTextCommand` is kept as a per-command escape hatch for commands `execute()` will not
start, held in an editable mapping rather than hardcoded, because text commands change between
Fusion builds.

### 4. Icons are read from the local Fusion install at runtime and served over HTTP

The add-in resolves `CommandDefinition.resourceFolder` and serves the PNG. The plugin draws it
to a canvas, scales to 96x96, and sends it as a base64 data URI.

Rationale: reading from the user's own licensed install avoids redistributing Autodesk artwork.
The commercial Stream Deck icon packs sell *redrawn originals*, which suggests redistribution is
deliberately avoided in this market. A neutral fallback set covers commands with no resolvable
icon.

### 5. Orientation is handled by us, not the device

The N1's device class hardcodes zero image rotation, so the host will not rotate anything. Since
the plugin generates every key image, it rotates them itself and applies a key-index transform.

- **Landscape** (primary): 5 columns x 3 rows, dial at bottom right.
- **Portrait**: 3 columns x 5 rows, dial at top right. Portrait rotated 90 degrees clockwise
  gives landscape.

Layouts are authored once as an ordered list of commands per page; the grid mapping is derived
per orientation rather than hand-authored twice.

**Unverified:** the rotation direction of the key images. Whether a 90 degree clockwise or
counter-clockwise pre-rotation makes icons appear upright must be checked on hardware. This is a
one-line constant.

### 6. Fixed region plus context region

The UX research is emphatic that repainting the whole grid disorients users, to the point that
people buy a second device to keep a stable region.

- The **two auxiliary buttons** are Home and Back. This is the N1's structural advantage — on a
  plain 15-key deck those two functions eat main-grid keys.
- One **fixed row** of the main grid holds constant global commands on every page.
- The rest is the context region.
- The **dial** pages through variants when a page has more entries than fit, and confirms or
  cancels an open dialog when one is active.

### 7. Per-context last position is restored

The single loudest unmet complaint in the macropad user corpus is that switching context loses
your place. When context returns to one previously visited, the plugin restores the page the
user was last on in that context rather than resetting to page 1.

## Consequences

- The add-in must be installed into Fusion's AddIns folder and the plugin into the Stream Dock
  plugins folder. Two install steps, unavoidable given two host applications.
- Fusion updates can break text commands and can remove add-ins entirely (a documented Autodesk
  behaviour). The command mapping is therefore data, not code, and an install check is needed.
- Nothing can be verified without Fusion and VSD Craft installed and the N1 connected. A
  simulator stands in for both during development.
