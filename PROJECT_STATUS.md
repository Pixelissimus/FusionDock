# Project Status — FusionDock

**Last updated:** 2026-07-29 · **Stage:** running on real hardware; current layout not yet proven on it

## Completed

- Project registered as PRJ-015 (2026-07-29) — the folder and its code already existed; this was registration, not creation.
- Renamed from "Fusion 360 Stream Dock" to FusionDock (2026-07-29) — folder, add-in entry files, code identifiers and documentation, matching the GitHub repo name.
- Both halves working end to end: Python add-in serving state, icons and commands over HTTP + SSE; HTML/JS plugin owning and repainting all 15 keys.
- Stages 0–4 of the manual test plan passed against real Fusion and a real N1 (2026-07-27).
- Layout rebuilt (2026-07-28) — every context gained a page 1 and page 2, `home` became the tab picker, tab switching added.
- All 208 command ids resolved against `docs/research/command-dump.json`; all tab ids confirmed from a live `GET /tabs` capture (2026-07-28).
- 56 automated tests passing, plus a structural layout audit.

## Active work

Nothing in flight. `TODO.md` holds the open items, numbered — Jamie picks by number.

## Next actions

1. Delete the stale add-in copy if it reappears, then reinstall under the new name: `node scripts/install.js`.
2. TODO 1.1 — work through Stage 6 of the manual test plan on the device. The rebuilt layout has barely been pressed.
3. TODO 1.2 — test the packaged bundle the way a user gets it: `npm run package`, copy `dist/` elsewhere, run `install-fusion-addin.bat` from there.
4. TODO 1.3 — confirm the SVG icons actually draw on the device.
5. Push `tab-switching-and-layout-rebuild` work toward `main` once the hardware pass is done.

## Blockers

- **No Python on this machine.** Newly written Python cannot be checked outside Fusion — `activate_tab()` and `/tabs` (added 2026-07-28) have not been run at all.
- **Hardware assumptions still unverified:** native grid orientation, landscape image rotation direction, secondary-screen controller name and image size, dial payload shape. Each has a named fix in the manual test plan.
- Automated tests run against a simulated bridge, so a green `npm test` says nothing about the device.

## Recent decisions

- **2026-07-29 — Registered as `desktop-app`.** No workspace type covers a CAD plugin plus a device plugin; `desktop-app` is the closest fit and matches the precedent set by Fusion Smart Split (PRJ-014). Recorded in the registry's migration notes as an approximation, not an exact classification.
- **2026-07-29 — The `com.fusiondock.streamdock.sdPlugin` UUID and action UUIDs were left unchanged through the rename.** They already read as *fusiondock*; "streamdock" there names the host platform, and changing a UUID would break layouts already saved on the device.
- **2026-07-29 — `CLAUDE.md` and `README.md` were left as written during registration.** Only the two missing standard docs were added; the existing instruction file stands.
