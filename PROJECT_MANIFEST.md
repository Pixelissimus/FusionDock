# Project Manifest — FusionDock

| Field | Value |
|---|---|
| Project ID | PRJ-015 |
| Type | desktop-app |
| Created | 2026-07-27 (first commit); registered 2026-07-29 |
| Status | active |
| Path | `Projects/Active/FusionDock` |
| Git | present — repo at project root, 18 commits, branch `tab-switching-and-layout-rebuild` (also `main`) → `github.com/scrappy-builds/FusionDock.git` |

## Folder map

- `docs/architecture/` — architecture notes (currently a placeholder)
- `docs/decisions/` — architecture decision records (`0001-architecture.md`)
- `docs/planning/` — `backlog.md` (history), `manual-test-plan.md` (hardware record), `publishing.md` (store listing plan)
- `docs/research/` — SDK and Fusion API findings, each marked CONFIRMED or UNVERIFIED, plus the `command-dump.json`, `panel-dump.json` and `tab-dump.json` captures
- `src/fusion-addin/` — the Python half: `FusionDock.py` entry point, `fsd_bridge.py`, `fsd_state.py`, `fsd_commands.py`, `config.json`, `command_overrides.json`
- `src/layouts/` — `default.json`, the whole key layout as data
- `src/streamdock-plugin/com.fusiondock.streamdock.sdPlugin/` — the Stream Dock half: HTML/JS plugin, property inspector, key icons, `install-fusion-addin.bat`
- `scripts/` — Node tooling: install, package, icon generation, layout audit, command resolution
- `tests/` — `node --test` suites plus `fake-bridge.js` and the N1 simulator page
- `assets/` — placeholder, currently empty
- `dist/`, `output/` — generated, git-ignored, safe to delete and rebuild

## Source-of-truth files

- **Instructions:** `CLAUDE.md` (project root) — the authoritative instruction file.
- **Outstanding work:** `TODO.md` — the only place open work is tracked. Numbered; Jamie selects by number.
- **History:** `docs/planning/backlog.md` — how things were decided and resolved. Not a to-do list.
- **Hardware truth:** `docs/planning/manual-test-plan.md` — results recorded against each step, with an honest known-unverified list at the end.
- **Architecture:** `docs/decisions/0001-architecture.md`.
- **Layout:** `src/layouts/default.json` — layouts are data; adding or moving a command is a JSON edit, never a code change.

## Technologies

- Python 3 (Fusion 360's bundled interpreter, stdlib only — no pip dependencies)
- Autodesk Fusion 360 API (`adsk.core`, `adsk.fusion`), `registerCustomEvent` / `fireCustomEvent`
- Plain HTML/JS for the Stream Dock plugin — no build step, no dependencies
- HTTP + Server-Sent Events on `127.0.0.1:8731`
- Node 20+ and `node --test` for tooling and tests — no test framework, no bundler

## Entry points

- `CLAUDE.md`
- `README.md`
- `TODO.md`
- `src/fusion-addin/FusionDock.py`
- `src/streamdock-plugin/com.fusiondock.streamdock.sdPlugin/plugin/main.js`
- `docs/decisions/0001-architecture.md`

## Dependencies

External hardware and software, none installable from this repo:

- A VSD Stream Dock N1 device
- The vendor's Stream Dock software (VSD Craft) — must be quit from the system tray to reload a plugin
- Autodesk Fusion 360, Windows only
- Node 20+ (tooling and tests only; neither runtime host uses it)

No npm or pip packages. Both hosts load these files directly, so a build step would have to run before every reload.

## Shared workspace resources used

None.

## Outputs

- `dist/com.fusiondock.streamdock.sdPlugin/` — the packaged plugin bundle, built by `npm run package`, git-ignored
- Installed add-in at `%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\FusionDock\` (via `scripts/install.js` or `install-fusion-addin.bat`)
- Intended end product: a listing on the Stream Dock plugin store — see `docs/planning/publishing.md`

## Validation commands

```
npm test                        # 56 tests, node --test
npm run audit                   # every key on every page, checked structurally
npm run package                 # build dist/, with completeness checks
npm run icons                   # regenerate and verify key icons
node scripts/install.js --dry-run
node scripts/resolve-commands.js   # re-resolve command ids against a running Fusion
```

Structural, and the only checks that prove anything about hardware: work through `docs/planning/manual-test-plan.md` against real Fusion and a real N1. The automated tests run against a simulated bridge.
