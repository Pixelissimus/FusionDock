# Research: Fusion 360 add-in API for a macropad bridge

Date: 2026-07-27. Claims marked CONFIRMED (primary source) or UNVERIFIED.

## Summary

The add-in route works. Commands can be executed, context can be observed, and Fusion's own
icons can be read from the local install. Three things shape the architecture:

1. All Fusion API calls must happen on the main thread. Input from a socket thread must be
   marshalled via a **CustomEvent** — this is Autodesk's own documented pattern.
2. `execute()` cannot be called from inside command-related events, but **can** be called
   from a CustomEvent handler. That is exactly where our device input arrives.
3. `activeSelectionChanged` does **not** fire while another command is running. Selection
   tracking is reliable when idle, unreliable inside a dialog.

## Command execution

### `commandDefinitions.itemById(id).execute()` — CONFIRMED

Works for built-in commands. Autodesk's own blog documents it:

```python
cmdDef = ui.commandDefinitions.itemById("ExportCommand")
cmdDef.execute()
```
https://blog.autodesk.io/run-fusion-commands/

API doc: "This is the same as the user clicking a button that is associated with this command
definition." The `input` parameter is documented as ignored.

**The documented restriction — CONFIRMED:**

> "The execute method is not supported within any of the Command related events because it
> results in starting a new command which has the side-effect of terminating the current
> command, which is your running command."

So `execute()` cannot be called from `commandCreated`, `commandStarting`, `commandTerminated`,
`inputChanged`, `validateInputs` etc. It **can** be called from a CustomEvent handler, because
a CustomEvent is not a command-related event.

**Not every command works standalone.** Community consensus (thomasa88/AnyShortcut,
Zxynine/AnyMacro): not all actions produce commands, some only function in specific contexts,
and some require a particular selection state. No authoritative allow/deny list exists — each
bound ID must be tested empirically.

### `app.executeTextCommand(...)` — CONFIRMED method, UNSUPPORTED vocabulary

The method is officially documented (introduced May 2020) and returns a string. The *text
commands themselves* come from Fusion's internal debug console (View → Show Text Commands,
`Ctrl+Alt+C`) and are undocumented, unsupported, and change between builds.

The canonical community pattern — start a dialog, set its inputs, press OK:

```python
app.executeTextCommand('Commands.Start Coil')
app.executeTextCommand('Commands.SetString infoSizeType infoRevolutionAndHeight')
app.executeTextCommand(f'Commands.SetDouble CoilRevolutions {revs}')
app.executeTextCommand('NuCommands.CommitCmd')
```
(know-how-schmiede/PrintThreadWizard; same shape in hanskellner/Fusion360ImportCSVPoints,
0xhexdec/S3DtoFusion, hajimen/p2ppcb_software)

Useful text commands:

| Command | Purpose |
| --- | --- |
| `Commands.Start <CommandId>` | Start an available command |
| `Commands.SetString/SetDouble/SetBool/SetIntValue/...` | Set a named input on the active dialog (~80 variants) |
| `Commands.SetSelections`, `Commands.Select`, `Commands.Pick` | Drive selection |
| `NuCommands.CommitCmd` | Press OK on the active dialog |
| `NuCommands.CancelCmd` | Cancel the active dialog |
| `DebugCommands.ListCommandDefinitions` | List all command definitions |
| `Toolkit.cmdDialog` | Dump the open dialog and its inputs |
| `TextCommands.List` | List available text commands |

Full ~2,600-entry dump (build 2.0.8176, **stale** — regenerate on the target build):
https://github.com/kantoku-code/Fusion360_Small_Tools_for_Developers/blob/master/TextCommands/TextCommands_txt_Ver2_0_8176.txt

### Dumping every command ID, name and icon folder — CONFIRMED

```python
for cd in ui.commandDefinitions:
    try:
        folder = cd.resourceFolder     # raises for some definitions
    except:
        folder = ''
    record(cd.id, cd.name, cd.isNative, folder)
```

Caveat: `commandDefinitions` only contains definitions already *created*. Some are created
lazily when a workspace or tab is first visited — dump after visiting every workspace.

## Context detection

### Events — CONFIRMED

`UserInterface`: `commandStarting` (cancellable via `args.isCanceled`), `commandCreated`,
`commandTerminated`, `activeSelectionChanged`, `workspacePreActivate`, `workspaceActivated`,
`workspacePreDeactivate`, `workspaceDeactivated`, `markingMenuDisplaying`.

`ApplicationCommandEventArgs` gives `commandId`, `commandDefinition`, `terminationReason`.

`Application`: `documentActivated`, `documentClosed`, `documentOpened`, `startupCompleted`,
`cameraChanged`, and others.

**`activeProductChanged` does not exist** (CONFIRMED by absence). Use `workspaceActivated` plus
`documentActivated` and read `app.activeProduct`.

### What we can detect

| Need | Mechanism | Status |
| --- | --- | --- |
| Active workspace | `ui.activeWorkspace.id` | CONFIRMED |
| Active environment tab (Solid/Surface/Mesh/Sheet Metal/Plastic/Utilities) | `next(t for t in ui.activeWorkspace.toolbarTabs if t.isActive)` | CONFIRMED |
| **In sketch edit mode** | `adsk.fusion.Sketch.cast(app.activeEditObject)` is not None | CONFIRMED |
| Current selection | `ui.activeSelections`, inspect `.entity.objectType` | CONFIRMED |
| **Is a dialog open, and which** | `ui.activeCommand` — `'SelectCommand'` means idle | CONFIRMED |
| The open dialog's inputs | `executeTextCommand('Toolkit.cmdDialog')` | works, format unstable |

There is **no `Design.activeSketch` property** (CONFIRMED by absence). `activeEditObject` is the
supported route; it returns the container new entities would be added to, and can be a
component or a sketch.

### The selection caveat — CONFIRMED, must design around

> "This event is only associated with the selection associated with the Select command and does
> not fire when any other command is running."

So `activeSelectionChanged` fires reliably when idle, but **not** for selections made inside
another command's dialog (picking a face for Extrude, for example). Selection-driven key layouts
work in the idle state; inside a dialog they would need polling.

### Setting values in an open dialog from outside

Public API: **not possible** — no property exposes another command's live `CommandInputs`.

Text commands: **possible and community-proven** — `Commands.SetDouble <inputId> <value>` then
`NuCommands.CommitCmd`. Input IDs are internal labels (`CoilRevolutions`, `infoSizeType`),
discoverable via `Toolkit.cmdDialog`, and **build-specific**.

Assessment: this makes "turn the knob to change the value in the open dialog" technically
achievable but fragile — it will break on Fusion updates. If built, it must sit behind a
user-repairable mapping table, never hardcoded.

## Threading — the pattern we must use

Fusion is single-threaded. Official doc: *"You should not call any Fusion API functions within
the worker thread."* Also: do not spin `adsk.doEvents()` in a loop (documented as crash-prone).

Autodesk's own sample (https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/CustomEventSample_Sample.htm):

```python
class ThreadEventHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        if ui.activeCommand != 'SelectCommand':
            ui.commandDefinitions.itemById('SelectCommand').execute()
        eventArgs = json.loads(args.additionalInfo)
        ...

def run(context):
    global customEvent, stopFlag
    customEvent = app.registerCustomEvent(myCustomEvent)
    onThreadEvent = ThreadEventHandler()
    customEvent.add(onThreadEvent)
    handlers.append(onThreadEvent)          # keep a reference or it is GC'd
    stopFlag = threading.Event()
    MyThread(stopFlag).start()

def stop(context):
    customEvent.remove(handlers[0])
    stopFlag.set()
    app.unregisterCustomEvent(myCustomEvent)
```

Two idioms worth copying:
- `ui.activeCommand != 'SelectCommand'` is the "is a dialog open?" test.
- Keep handlers in a module-level list or they are garbage-collected and events silently stop.

Production refinement (faust-machines/fusion360-mcp-server `addon/server/event_bridge.py`):
a `WorkItem` + queue + `threading.Event` request/response bridge, plus a **200 ms backup timer
that re-fires the custom event if the queue is non-empty**, because `fireCustomEvent` from a
daemon thread is not always reliable. Worth adopting if we see dropped events.

## Icons

**Location — CONFIRMED:**
```
C:\Users\<user>\AppData\Local\Autodesk\webdeploy\production\<40-hex-hash>\Fusion\UI\FusionUI\Resources\...
```
The hash **changes on every Fusion update** — never hardcode it. A second tree at
`<deploy>/Electron/UI/Resources/Icons/...` also holds icons.

**Resolving it at runtime — CONFIRMED:**
```python
import sys, pathlib
def get_fusion_deploy_folder():
    return pathlib.Path(sys.argv[0]).parent
```
(thomasa88/fusion360-thomasa88lib, MIT — can be vendored.)

**Mapping command to icon — CONFIRMED:** `CommandDefinition.resourceFolder` returns an absolute
path under the deploy folder for native commands. Real examples:
```
Fusion/UI/FusionUI/Resources/sketch/Sketch_feature    -> SketchActivate
Fusion/UI/FusionUI/Resources/Modeling/FilletEdges     -> FusionDcFilletEditCommand
```
Each icon is a **folder** containing size-named files; `16x16.png` is confirmed present. The
exact set of sizes is UNVERIFIED — enumerate `os.listdir(resourceFolder)` rather than assuming.
Some definitions raise on `.resourceFolder`; the try/except is not optional.

**Licensing — assessment, not legal advice.** Reading icons from the end user's own install at
runtime is materially safer than redistributing them. Bundling Autodesk's artwork into a
downloadable plugin is redistribution and is the risky path. Note that the commercial Stream
Deck icon packs for Fusion sell *original redrawn* icons rather than Autodesk's — itself
evidence that redistribution is avoided.

**Decision: read from the local install at runtime, cache into the user's AppData, never
bundle. Ship a neutral fallback set for keys where no `resourceFolder` resolves.**

## Add-in lifecycle and IPC

**Install path — CONFIRMED:**
```
C:\Users\<user>\AppData\Roaming\Autodesk\Autodesk Fusion 360\API\AddIns\<Name>\
```
Folder name must match the `.manifest` basename. Install = copy folder + restart Fusion.

Manifest fields: `autodeskProduct`, `type`, `id` (GUID), `author`, `description`, `version`,
**`runOnStartup`**, `supportedOS`, `sourcewindows`/`sourcemac`.

Autodesk KB confirms **custom add-ins can go missing after a Fusion update** — plan a repair step.

**Known-good socket add-ins** (all the same shape, bind `127.0.0.1`):
- faust-machines/fusion360-mcp-server — TCP 9876, JSON, best main-thread bridge of the group
- perkovicluka/fusion-360-mcp-server — TCP 8765
- Joelalbon/Fusion-MCP-Server — JSON socket 8080

Use stdlib `socket` or a pure-Python websocket lib; do not add a native dependency.

## Prior art for hardware control

| Project | Approach | Notes |
| --- | --- | --- |
| thomasa88/AnyShortcut | API — records commands, re-exposes them so Fusion's native shortcut dialog can bind them | **Most relevant prior art.** Documents the real limits of `execute()` |
| Zxynine/AnyMacro | API — records and replays command sequences; exposes an external `fireCustomEvent` hook | Proven external-process entry point |
| thomasa88/KeyboardShortcutsSimple | API — lists all commands and their shortcuts | Useful for building our ID/name/shortcut table |
| schneik80/Macropad-fusion | **Keyboard injection** — Adafruit Macropad, no add-in | Immune to API breakage, but zero state awareness |
| SideshowFX Stream Deck profiles | Keyboard injection + 700+ original redrawn icons | Confirms the commercial approach to the icon licensing problem |
| 3Dconnexion SpaceMouse | Native, first-party since build 2.0.11685 | Not an add-in route |

**The architectural fork:** keyboard injection is robust and stateless; the API route is the
only way to get context *out* of Fusion. Our requirement — keys that reflect Fusion's real state
and real icons — forces the add-in route.

**Recommended shape:** add-in for state out, `commandDefinition.execute()` for commands in, with
`executeTextCommand` reserved as a per-command escape hatch for commands `execute()` won't start,
held in a user-editable mapping table because it will break on updates.
