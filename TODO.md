# TODO — FusionDock

Everything still outstanding, in one place. Tick a box, or tell me the number — "let's do 2.3
and 2.4" — and I will work on those.

Each item says what it is, why it matters, and what "done" looks like. Anything already
finished lives in `docs/planning/backlog.md` (history) and `docs/planning/manual-test-plan.md`
(the hardware record).

Last updated 2026-07-28.

---

## 1. Blocking release

Nothing ships until these are done.

- [ ] **1.1 — Work through Stage 6 of the manual test plan on the device.**
  The whole layout was rebuilt today and almost none of it has been pressed. `npm test` and
  `npm run audit` both pass, but they test a simulated bridge, not a real key under a real
  finger. Steps are in `docs/planning/manual-test-plan.md`.
- [ ] **1.2 — Test the packaged bundle the way a user gets it.**
  Run `npm run package`, copy `dist/` somewhere else entirely, double-click
  `install-fusion-addin.bat` from *there*, restart Fusion, confirm the add-in appears under
  Utilities › Scripts and Add-Ins. The developer install path and the user install path are
  different code and only one of them has ever run.
- [ ] **1.3 — Confirm the SVG icons actually draw on the device.**
  Nine blank keys were fixed today by serving SVG as well as PNG. The files declare
  `width`/`height` so the renderer should size them, but that has only been reasoned about,
  not seen. Look at Appearance, Material, Hem, Corner, SM Fillet, SM Chamfer, Bridge and
  Close Cracks.
- [ ] **1.4 — Press the three keys whose ids appear nowhere in Fusion's ribbon.**
  `FusionDeleteFacesCommand` (Surface / Delete Face), `FusionSurfaceOffsetShellCommand`
  (Offset Shell), `SurfaceShellConvertCommand` (Shell Srf). All three are real command
  definitions, so they are probably palette-only rather than wrong — but that is an assumption,
  and if any does nothing, the ribbon dump now has what is needed to fix it.

---

## 2. Publishing to the Space marketplace

Full research and step-by-step is in `docs/planning/publishing.md`.

- [ ] **2.1 — Register a publisher account.**
  `https://space.key123.vip/` → **Start** (top right) → `/register_VSD`. Nickname, email,
  password and an emailed code, or sign in with Google, X or Discord. Yours to do — I will not
  create accounts or handle credentials.
- [ ] **2.2 — Find the actual upload form and record where it is.**
  Store sidebar, bottom left, **Creator**. Logged out it goes to their docs site; logged in it
  should reach a submission form. This is the one step nobody outside the platform can map.
- [ ] **2.3 — Confirm what the upload expects: a zip, or the `.sdPlugin` folder.**
  Every document calls the folder "the bundle" and none mentions an archive. Zip is very
  likely. Read the form rather than guessing.
- [ ] **2.4 — Find out the review timescale and rejection criteria.**
  Nothing published beyond automated manifest and malware checks. `service@key123.vip` or
  their Discord `https://discord.gg/WvCkKRGavX` will answer 2.2, 2.3 and 2.4 in one message.
- [ ] **2.5 — Build the Fusion page on functional3duk.co.uk and repoint the manifest.**
  `URL` currently points at the site root because the page does not exist yet. The page is
  meant to cover Fusion Smart Bit, Fusion Smart Split and FusionDock together.
  One line in `manifest.json` once it is live.
- [ ] **2.6 — Prepare the listing assets.**
  Description, and photographs of the real N1 running it. The store is full of renders; a real
  photograph will stand out, and it is the honest option anyway.
- [ ] **2.7 — State the two constraints at the very top of the listing.**
  Windows only, and it needs a second piece of software installed. People forgive a limitation
  they were told about and resent one they discover.

---

## 3. After launch, not before

- [ ] **3.1 — Publish the Fusion add-in to the Autodesk App Store separately.**
  The canonical place Fusion users look, and it handles installation for them. Publisher
  account, company details, screenshots, video; Autodesk reply within 24 hours. Desktop
  submissions generally expect a real installer, which does not exist yet.
- [ ] **3.2 — Make the GitHub repo public.**
  Note the tension already flagged: once public, GitHub's terms let anyone fork it, and forking
  is copying. If no-derivatives matters more than openness, keep it private and publish only
  the built bundle. You cannot have both.
- [ ] **3.3 — Merge `tab-switching-and-layout-rebuild` into `main`,** or open a PR. Two days of
  work sit on that branch.
- [ ] **3.4 — Have a solicitor read `LICENSE` if real money is ever attached.**
  It was drafted to express "nobody modifies it without my permission" in the usual shape, and
  says plainly at the bottom that it has not been reviewed.

---

## 4. Smart Split — pencilled in, deliberately

- [ ] **4.1 — Decide whether to add a Smart Split page.**
  Your own plugin is in the Solid ribbon as an eleven-command panel: Split Bodies, Add
  Connectors, Connect Existing Parts and Explode Parts are promoted, plus Collapse Parts,
  Diagnose Operation, Remove Split, Remove Connectors, Printer Profiles, Clearance Test Print
  and Help and About.

  Your position, 2026-07-28: worth doing *if* Smart Split is installed, and you would give up
  the View key for it — but you do not want it to feel like people are being pushed into
  installing your other product. That is the real problem to solve, not the slots.

  Worth knowing: the device can already tell whether it is installed, because a command that
  does not exist fails on press. A Smart Split key that only appears when the plugin is
  present would remove the objection entirely — it would need the add-in to report which
  command ids exist, which is a small change to the state reader.
- [ ] **4.2 — If 4.1 goes ahead, decide what it costs.** The View key is the candidate you
  named. See 5.1, which is the same question from the other side.

---

## 5. Open design questions — only answerable by using it

- [ ] **5.1 — Does the View key earn its slot?**
  It appears on every context page, so it is the most expensive key in the layout. The dial
  already cycles Iso/Top/Front, which is most of the value. If it goes, the view page needs
  another route or it becomes unreachable — there is a test enforcing that.
- [ ] **5.2 — Does the fixed region earn 3 keys of 15?**
  Same 20% that got an earlier fixed row deleted. The difference is that Tabs, View and More
  are doors rather than commands. A data change either way.
- [ ] **5.3 — Should page 1 match what Fusion itself promotes?**
  Fusion promotes Revolve, Split Body and Create Form on the Solid tab and the device does not
  carry them on page 1; it does carry Chamfer and Rect Pattern, which Fusion does not promote.
  Not changed, because you approved the current page 1 and a machine's opinion does not
  override that.
- [ ] **5.4 — Is the dial's Iso/Top/Front cycle the right thing on rotation?**
- [ ] **5.5 — Do Undo and Redo sit well on the side buttons?**
- [ ] **5.6 — Does losing the on-screen Cancel inside sketches bite?**
  OK is still on the dial and Escape still works.
- [ ] **5.7 — Do the drawn icons read at 96×96 on the real keys?**
  Particularly the dashed ghost outlines on the two Modify icons, and whether the Tabs chooser
  grid reads as "pick a section". Option B, stacked cards, is drawn and one line away if you
  prefer it.

---

## 6. Contexts still falling through to the Solid page

Each is one rule plus one page, both data. The tab ids are confirmed, not guesses —
`docs/research/tab-dump.json`.

- [ ] **6.1 — `AssemblyTab` (ASSEMBLY).** The strongest candidate: Joint, As-Built Joint and
  Rigid Group are real work with no keyboard shortcut, and they are currently absent from the
  whole device.
- [ ] **6.2 — Decide on `ManageTab`, `PCBTab`, `Package3DTab`, `BasefeatureSolidTab`,
  `BasefeatureSurfaceTab`, `EditSnapshotTab`.** Left out deliberately as unlikely for
  functional parts. Confirm that is right, or pick any that are not.
  `SketchTab` needs nothing — the `inSketch` rule already covers being in a sketch.
- [ ] **6.3 — Verify the Direct Mesh Editing page.** Built today from the mesh command set and
  never seen. Two unknowns: whether entering the environment changes the workspace (the rule
  matches on tab alone, so it should not care), and exactly which commands Fusion enables in
  there.

---

## 7. Robustness — Stage 5, never started

- [ ] **7.1 — Does the 400 ms main-thread poll make Fusion feel sluggish during real
  modelling?** The one item here that could still force an architectural change. Work in Fusion
  for fifteen minutes with the device connected. If it drags, raise `POLL_INTERVAL_SECONDS`.
- [ ] **7.2 — Rapid key presses for ten seconds.** No lag build-up, no dropped presses.
- [ ] **7.3 — Thirty-minute soak.** Still responsive, no memory growth in Fusion.
- [ ] **7.4 — Unplug and replug the N1.** Keys repaint automatically.
- [ ] **7.5 — Restart each side independently** while the other keeps running.
- [ ] **7.6 — Does the Stream Dock software's own auto-switching interfere with the plugin?**
  Never tested. Nothing seen suggesting it does.

---

## 8. Code and tooling

- [ ] **8.1 — `/commands` reads the Fusion API on the HTTP thread.**
  The same fault that was fixed for `/tabs` today, and it predates it. Fusion's API is not
  thread-safe and no `except` catches a native crash. Fix it the same way: cache on the main
  thread, serve plain data.
- [ ] **8.2 — Draw our own icon for `New`.** `NewDocumentCommand` genuinely has no resource
  folder — it is now the only key in the whole layout with no artwork. `scripts/draw-menu-icons.js`
  is where it would go.
- [ ] **8.3 — Put `/debug` behind a switch.** A 200-entry ring buffer of raw host events plus a
  POST on every `willAppear` and dial event. It answered the grid, controller-name and
  dial-payload questions and those are all closed now. Costs nothing measurable, but it is
  bring-up tooling living in a shipped product.
- [ ] **8.4 — Re-dump the research files after any Fusion update.**
  `command-dump.json`, `tab-dump.json` and `panel-dump.json` are all install-derived and a
  Fusion update can rename or remove ids. `npm run audit` checks the layout against all three.

---

## 9. Known-unverified, carried forward

Not tasks exactly — things that are true today and might stop being true.

- [ ] **9.1 — `NuCommands.CommitCmd` is undocumented and build-specific.** It works today. Expect
  it to break on some future Fusion update; the symptom is the dial doing nothing with a dialog
  open. The fix belongs in `command_overrides.json`.
- [ ] **9.2 — `activeSelectionChanged` does not fire while another command is running.**
  Selection data is reliable only when Fusion is idle. Nothing destructive may be driven from it.
