# Publishing to the VSD / Space plugin marketplace

Researched 2026-07-28. Marked CONFIRMED where it was read off the live site or the official
docs, UNVERIFIED where it could not be checked without a publisher account.

---

## The landscape, in one paragraph

VSD Craft is a rebadge of Mirabox's Stream Dock software, and it shares Mirabox's plugin
infrastructure. The marketplace is **Space** — `https://space.key123.vip/` — and VSD Craft links
to it filtered to itself:
`https://space.key123.vip/StreamDock/plugins?software=StreamDock&client=VSDCraft`. The URL Jamie
had (`vsdinside.key123.vip/streamduck/plugins`) is a tenant of the same platform. The developer
documentation lives at **`https://sdk.key123.vip/en/`**, and `creator.key123.vip` is a sibling
site covering icon packs and scene configs, not plugins — it links out to the SDK for those.

**CONFIRMED from the live store:** third parties already publish there (listings "By
wecanlstop", "By Gabilan Games" alongside "By MiraBox"), and **plugins can be paid** — visible
prices included Free, $0.2 and $1. Categories in use: Engagement, Social, Utilities, Music,
Audio, Video, Lighting, Gaming, Artistic. Browsing needs no account; **downloading does**.

---

## Part 1 — What has to change in the repo before submitting

**DONE 2026-07-28.** All four placeholders are fixed and the packaging step exists.

| Field | Now |
| --- | --- |
| `Name` | `FusionDock` — the official name |
| `Author` | `Functional 3D UK` |
| `Version` | `1.0.0` |
| `URL` | `https://functional3duk.co.uk/` — **update this** to the Fusion page once it exists |
| `Software.MinimumVersion` | `3.10.200.0408`, the version actually tested |

Icon sizes were measured and are correct: plugin icon 128×128, category 48×48, action 40×40.

`npm run package` assembles the upload bundle into `dist/` and refuses to run if any of those
placeholders come back, or if the bundle is missing anything it cannot work without. It caught
its own first bug that way: the layout file lives outside the `.sdPlugin` folder in the repo but
inside it once installed, so the first bundle would have installed cleanly and then painted
nothing at all.

---

## Part 2 — The packaging format

**CONFIRMED:** the distribution unit is the `<UUID>.sdPlugin` **folder**, not a compiled
installer. There is no `.streamDeckPlugin`-style single-file package and **no official CLI
packaging tool** — the SDK docs say build automation is per-SDK, and ours has no build step at
all. The folder installs to `%APPDATA%\HotSpot\StreamDock\plugins\` on Windows.

**UNVERIFIED:** whether the Space upload form takes a `.zip` of that folder or the folder
itself. Every reference calls the `.sdPlugin` folder "the bundle" and none mentions an archive.
A zip is the overwhelmingly likely answer and the upload form will say. Do not guess — read the
form.

So "can I package it as a downloadable installer?" — **not in the Stream Dock sense**. What
users download from Space is the plugin bundle, and VSD Craft installs it. There is no
opportunity to run an installer of your own during that process. Which leads directly to the
next part.

---

## Part 3 — The hard problem: getting the Fusion add-in installed too

This is the real question, and the honest answer is that **the marketplace has no mechanism for
it**. A Stream Dock plugin cannot install a Fusion add-in as part of its own installation. Four
routes, assessed:

### A. Make the plugin a Node.js plugin and have it self-install — best UX, worst fit

**CONFIRMED:** the manifest supports a `Nodejs` block (`"Version": "20"`), so the host can run a
plugin as a real Node process with full filesystem access. Such a plugin could copy the bundled
add-in into `%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\` on first run — genuinely
one-click.

**Why it does not fit us:** our plugin renders every key image with `<canvas>` and `Image` in the
host's webview (`render.js`). Node 20 has neither without a native dependency, and this project
forbids dependencies on both sides for a reason that still holds — both hosts load these files
directly. Converting would mean rewriting the entire rendering path. Not worth it for an
install-time convenience.

### B. Bundle the add-in inside the `.sdPlugin` and install it with one script — RECOMMENDED

The `.sdPlugin` folder can contain arbitrary files. Ship `fusion-addin/` inside it, plus a
`install-fusion-addin.bat` that copies it into the Fusion AddIns folder. Windows-native, no
Node, no Python, no dependencies. The plugin lands at a known path, so the batch file can find
itself with `%~dp0`.

The plugin already knows when the add-in is missing — the bridge simply does not answer, which
is exactly the "Waiting for Fusion" state. That state can carry the instruction instead of a
bare message, and the Property Inspector can show the full path with a copy button.

One manual step, clearly signposted, no toolchain required of the user.

### C. Publish the add-in separately to the Autodesk App Store — do this as well, later

The canonical place Fusion users look for add-ins, and it handles installation for them. It also
becomes a second discovery channel that reaches people who have never heard of a Stream Dock.

Cost: a publisher account, company/individual details and payment options, then a submission
carrying title, type (desktop-based), OS, description, screenshots and video. Autodesk respond
within 24 hours with next steps, and every submission needs an incremented version number.
Desktop submissions generally expect a proper installer, which is real work we have not done.

Worth doing once the Space listing has proven the demand. Not a blocker for v1.

### D. GitHub Releases + a link — the fallback, and useful regardless

Free, versioned, and the natural home for the source anyway. Even with route B, the `URL` field
in the manifest should point at a page that explains the two halves.

**Recommendation: B for launch, D alongside it from day one, C once it has users.**

---

## Part 4 — Step by step

### Before you touch the website

1. ~~Decide the publisher identity~~ — **DONE**, Functional 3D UK.
2. ~~Fix the manifest placeholders~~ — **DONE**, see Part 1.
3. ~~Choose a licence~~ — **DONE**. `LICENSE` is a proprietary, source-available licence: free
   to use, no modification or redistribution without written permission. It explicitly permits
   editing `default.json`, `config.json` and `command_overrides.json`, because reconfiguring
   the layout is the intended way to use this software, not a modification of it — a blanket
   no-modification clause would have forbidden the product's main feature. It also states that
   Autodesk's artwork is not bundled and is not ours to licence.
4. ~~Restructure for route B~~ — **DONE**. `npm run package` builds `dist/`, with
   `fusion-addin/` and `install-fusion-addin.bat` inside the bundle. `scripts/install.js` is
   unchanged and still installs both halves directly for development.
5. **Work through Stage 6 of `manual-test-plan.md`.** Nothing in the current layout has been
   pressed on hardware. Do not publish untested. **This is now the blocker.**
6. **Test the packaged bundle as a user would**, not as the developer: copy `dist/` somewhere
   else, run `install-fusion-addin.bat` from there, restart Fusion, and check the add-in
   appears under Utilities › Scripts and Add-Ins. The developer install path and the user
   install path are different code, and only one of them has ever run.
7. **Prepare the listing assets**: 128×128 plugin icon (have it), screenshots of the device in
   use, and a description. Photograph the real N1 running it — the store is full of renders and
   a real photograph will stand out, quite apart from it being the honest thing to do.

### On the website

7. **Register at `https://space.key123.vip/`** — the Start button leads to
   `/register_VSD`. Nickname, email, password and an emailed verification code, or sign in with
   Google, X or Discord. *You must do this yourself; I will not create accounts or handle
   credentials.*
8. **Find the creator/publisher area.** The store's left sidebar has a **Creator** entry at the
   bottom. Logged out it lands on the Creator documentation site; logged in it is the likely
   route to a submission form. **UNVERIFIED** — this is the one step nobody outside can map.
9. **Upload the bundle** in whatever form the upload accepts (see Part 2), fill in name,
   description, category, price and supported devices. Categories and a device filter both exist
   on the store, so expect fields for them. Price: free is the obvious choice for v1.
10. **Submit and wait.** No published review timescale. Automated validation checks the manifest
    fields, icon sizes and formats, and scans for malicious patterns.

### If you get stuck

- `service@key123.vip`
- Discord: `https://discord.gg/WvCkKRGavX`
- The plugin repos accept contributions and may be an alternative route in:
  `github.com/MiraboxSpace/StreamDock-Plugins` and `github.com/VSDinside/VSDinside-Plugins`.
  Their READMEs invite "submitting new plugins" without saying how — worth asking on Discord
  whether a pull request there is a supported submission path.

---

## What I could not establish

Three things, all needing an account or a person to answer:

1. **The exact upload format** — zip of the `.sdPlugin` folder, or something else.
2. **Where the submission form actually is**, and what it asks for.
3. **Review timescale and rejection criteria** beyond the automated checks.

All three are answered by registering and looking, or by one message on their Discord. None of
them changes the work in Part 1, which is worth doing either way.

## One thing worth deciding early

This plugin is **Windows-only** and needs a **second piece of software installed separately**.
Both are unusual for a store listing and both will generate support requests if they are not
stated plainly at the very top of the description. Say it before someone downloads it, not
after — the store listing is the first place the honesty rule applies.
