"""Executes Fusion commands and resolves their icons from the local install.

Must only be called on Fusion's main thread.

Two execution paths:
  * commandDefinitions.itemById(id).execute() -- the supported route, used by default.
  * executeTextCommand -- an escape hatch for commands execute() will not start on its own.
    Text commands are undocumented and change between Fusion builds, so they live in an
    editable JSON file rather than in this module.
"""

import json
import os
import re
import sys

import adsk.core

# Icons ship as a folder per command containing size-named PNGs. We render onto 96x96 keys,
# so prefer the largest available and let the plugin downscale.
_SIZE_PATTERN = re.compile(r"(\d+)\s*x\s*(\d+)", re.IGNORECASE)

_OVERRIDES_FILENAME = "command_overrides.json"

_icon_cache = {}
_overrides = None


def deploy_folder():
    """The webdeploy/production/<hash> folder for the running Fusion build.

    The hash changes on every Fusion update, so it must never be hardcoded. sys.argv[0] is
    the Fusion executable on Windows, which lives inside the deploy folder.
    """
    try:
        return os.path.dirname(os.path.realpath(sys.argv[0]))
    except Exception:
        return ""


def load_overrides(addin_dir):
    """Load per-command text-command overrides. Missing file is normal, not an error."""
    global _overrides
    path = os.path.join(addin_dir, _OVERRIDES_FILENAME)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        _overrides = data.get("overrides", {}) if isinstance(data, dict) else {}
    except FileNotFoundError:
        _overrides = {}
    except Exception:
        # A malformed overrides file must not stop the add-in loading; the built-in
        # execute() path still works for the great majority of commands.
        _overrides = {}
    return _overrides


def _get_overrides():
    return _overrides if _overrides is not None else {}


def execute(app, ui, command_id):
    """Run a Fusion command. Returns (ok, message)."""
    if not command_id:
        return False, "no command id"

    override = _get_overrides().get(command_id)
    if override:
        return execute_text_sequence(app, override)

    try:
        definition = ui.commandDefinitions.itemById(command_id)
    except Exception as exc:
        return False, "lookup failed: %s" % exc
    if not definition:
        return False, "unknown command: %s" % command_id

    try:
        # Documented as equivalent to the user clicking the command's button. Legal here
        # because we are inside a CustomEvent handler, not a command-related event.
        started = definition.execute()
    except Exception as exc:
        return False, "execute failed: %s" % exc
    if not started:
        # Common and expected: many commands refuse to start without a valid selection or
        # outside their own environment. The plugin surfaces this as a key alert.
        return False, "command declined to start (context or selection may be wrong)"
    return True, "ok"


# Fusion exposes NO command definition for the standard view orientations or visual styles --
# confirmed against a dump of all 3110 definitions on 2026-07-27: there is no "Front View",
# "Top View", "Isometric" or "Shaded" command to execute(). They are viewport properties.
#
# This is the strongest argument for the add-in architecture: a keystroke sender cannot reach
# these at all, because they have neither a command id nor a bindable keyboard shortcut.
_VIEW_ORIENTATIONS = {
    "front": "FrontViewOrientation",
    "back": "BackViewOrientation",
    "left": "LeftViewOrientation",
    "right": "RightViewOrientation",
    "top": "TopViewOrientation",
    "bottom": "BottomViewOrientation",
    "iso": "IsoTopRightViewOrientation",
}

_VISUAL_STYLES = {
    "shaded": "ShadedVisualStyle",
    "shadededges": "ShadedWithVisibleEdgesOnlyVisualStyle",
    "wireframe": "WireframeVisualStyle",
}


def set_view(app, target):
    """Point the active viewport at a named orientation, visual style, fit or home.

    Main thread only. Returns (ok, message).
    """
    if not target:
        return False, "no view target"

    try:
        viewport = app.activeViewport
    except Exception as exc:
        return False, "no viewport: %s" % exc
    if not viewport:
        return False, "no active viewport"

    if target == "fit":
        try:
            viewport.fit()
        except Exception as exc:
            return False, "fit failed: %s" % exc
        return True, "ok"

    if target == "home":
        try:
            viewport.goHome(True)
        except Exception as exc:
            return False, "home failed: %s" % exc
        return True, "ok"

    if target in _VISUAL_STYLES:
        # getattr rather than a direct reference: if a style is renamed in a future Fusion
        # build this reports a clear message instead of raising on import.
        style = getattr(adsk.core.VisualStyles, _VISUAL_STYLES[target], None)
        if style is None:
            return False, "unknown visual style: %s" % target
        try:
            viewport.visualStyle = style
        except Exception as exc:
            return False, "visual style failed: %s" % exc
        return True, "ok"

    if target in _VIEW_ORIENTATIONS:
        orientation = getattr(adsk.core.ViewOrientations, _VIEW_ORIENTATIONS[target], None)
        if orientation is None:
            return False, "unknown orientation: %s" % target
        try:
            camera = viewport.camera
            camera.viewOrientation = orientation
            # The camera is a value object -- mutating it does nothing until it is assigned
            # back. isSmoothTransition is set so the move reads as a camera move, not a jump.
            camera.isSmoothTransition = True
            viewport.camera = camera
        except Exception as exc:
            return False, "orientation failed: %s" % exc
        return True, "ok"

    return False, "unknown view target: %s" % target


def activate_tab(ui, workspace_id, tab_id, tab_name=None):
    """Switch Fusion to a workspace and one of its ribbon tabs. Returns (ok, message).

    Fusion has no command definition for "show the Sheet Metal tab" -- like the view
    orientations, it is a property, not a command. Workspace.activate() and
    ToolbarTab.activate() are the documented route and the only one available to us.

    The tab is looked up by id and then, failing that, by display name. Tab ids are
    install-derived and this project does not invent them; the name fallback means a key
    still works if an id in the layout is stale, and /tabs reports the real ones.
    """
    if not workspace_id and not tab_id:
        return False, "no workspace or tab"

    workspace = None
    if workspace_id:
        try:
            workspace = ui.workspaces.itemById(workspace_id)
        except Exception as exc:
            return False, "workspace lookup failed: %s" % exc
        if not workspace:
            return False, "unknown workspace: %s" % workspace_id
        try:
            # activate() returns a Boolean, exactly like commandDefinition.execute(), and
            # refusing is a normal outcome rather than an error -- a workspace that cannot be
            # entered from where Fusion currently is simply returns False and changes nothing.
            # Discarding it reported every refusal as success, which is the silent dead key.
            if not workspace.isActive and not workspace.activate():
                return False, "workspace declined to activate: %s" % workspace_id
        except Exception as exc:
            return False, "workspace activate failed: %s" % exc
    else:
        workspace = _safe_active_workspace(ui)
        if not workspace:
            return False, "no active workspace"

    if not tab_id and not tab_name:
        return True, "ok"

    tab = None
    try:
        if tab_id:
            tab = workspace.toolbarTabs.itemById(tab_id)
        if not tab and tab_name:
            for candidate in workspace.toolbarTabs:
                if (candidate.name or "").strip().lower() == tab_name.strip().lower():
                    tab = candidate
                    break
    except Exception as exc:
        return False, "tab lookup failed: %s" % exc

    if not tab:
        return False, "unknown tab: %s" % (tab_id or tab_name)
    try:
        if not tab.activate():
            return False, "tab declined to activate: %s" % (tab_id or tab_name)
    except Exception as exc:
        return False, "tab activate failed: %s" % exc
    return True, "ok"


def _safe_active_workspace(ui):
    try:
        return ui.activeWorkspace
    except Exception:
        return None


def execute_text_sequence(app, commands):
    """Run one or more text commands in order. Undocumented API -- may break on updates."""
    if isinstance(commands, str):
        commands = [commands]
    results = []
    for text in commands:
        try:
            results.append(app.executeTextCommand(text))
        except Exception as exc:
            return False, "text command failed at %r: %s" % (text, exc)
    return True, " | ".join(str(r) for r in results if r)


def _best_icon_file(folder):
    """Best icon in a folder: largest size-named PNG, else largest SVG.

    PNG is preferred because it is what most of Fusion's own folders hold and it composites
    onto the keys with no surprises. But a good number of folders are SVG ONLY -- Appearance,
    Physical Material and the whole sheet-metal set among them -- and looking for PNG alone
    made those commands appear to have no icon at all. Measured on 2026-07-28 via /iconinfo:
    Appearance's folder holds seven files and every one is .svg.

    That single omission accounted for eight of the ten text-only keys. The ninth and tenth,
    Coil and New, genuinely have no resourceFolder at all -- nothing to find.
    """
    try:
        names = os.listdir(folder)
    except Exception:
        return None

    best_path, best_area = None, -1
    fallback = None
    svg_path, svg_area = None, -1
    for name in names:
        lowered_name = name.lower()
        if lowered_name.endswith(".svg"):
            # Same dark-variant rule as below; sized SVGs win over unsized ones.
            if "_dark" in lowered_name or "-dark" in lowered_name:
                continue
            match = _SIZE_PATTERN.search(name)
            area = int(match.group(1)) * int(match.group(2)) if match else 0
            if area > svg_area:
                svg_path, svg_area = os.path.join(folder, name), area
            continue
        if not lowered_name.endswith(".png"):
            continue
        # Fusion ships light and dark variants in the same folder. The device keys are dark,
        # so the standard icon reads correctly; skip explicit dark variants, which are drawn
        # FOR light backgrounds and disappear on ours.
        #
        # Fusion spells it with a HYPHEN -- 16x16-dark.png, 32x32-dark@2x.png -- which the
        # original underscore test never matched. Confirmed by listing
        # Fusion/UI/FusionUI/Resources/solid/Coil on disk, 2026-07-28. Both spellings are
        # accepted now rather than trading one guess for another.
        lowered = name.lower()
        if "_dark" in lowered or "-dark" in lowered:
            continue
        path = os.path.join(folder, name)
        match = _SIZE_PATTERN.search(name)
        if match:
            area = int(match.group(1)) * int(match.group(2))
            if area > best_area:
                best_path, best_area = path, area
        elif fallback is None:
            fallback = path
    return best_path or fallback or svg_path


def resolve_icon(ui, command_id):
    """(bytes, content_type) for a command's icon, or (None, None). Cached for the session.

    The content type travels with the bytes because Fusion's icon folders are a mix of PNG and
    SVG, and an <img> in the plugin will not render an SVG served as image/png.
    """
    if command_id in _icon_cache:
        return _icon_cache[command_id]

    data = None
    content_type = None
    try:
        definition = ui.commandDefinitions.itemById(command_id)
        folder = definition.resourceFolder if definition else None
    except Exception:
        # Some command definitions raise on resourceFolder. Community code all guards this.
        folder = None

    if folder:
        if not os.path.isabs(folder):
            folder = os.path.join(deploy_folder(), folder)
        icon_file = _best_icon_file(folder)
        if icon_file:
            try:
                with open(icon_file, "rb") as handle:
                    data = handle.read()
                content_type = ("image/svg+xml" if icon_file.lower().endswith(".svg")
                                else "image/png")
            except Exception:
                data = None
                content_type = None

    _icon_cache[command_id] = (data, content_type)
    return _icon_cache[command_id]


def describe_icon(ui, command_id):
    """Why a command's icon did or did not resolve. Diagnostic only.

    Ten keys draw as text because /icon returns 404 for them, while command-dump.json says
    they have an icon. The files are demonstrably on disk -- Fusion's own Coil folder holds
    16x16.png and 32x32.png -- so the fault is in the resolution here, not in Fusion. This
    reports each step so the answer comes from the running add-in rather than from reasoning
    about it.
    """
    info = {"id": command_id}
    try:
        definition = ui.commandDefinitions.itemById(command_id)
    except Exception as exc:
        info["error"] = "lookup failed: %s" % exc
        return info
    if not definition:
        info["error"] = "no such command definition"
        return info

    try:
        info["resourceFolder"] = definition.resourceFolder
    except Exception as exc:
        info["resourceFolder"] = None
        info["resourceFolderError"] = str(exc)
        return info

    folder = info.get("resourceFolder")
    if not folder:
        info["result"] = "definition reports no resource folder"
        return info

    info["wasAbsolute"] = os.path.isabs(folder)
    if not os.path.isabs(folder):
        folder = os.path.join(deploy_folder(), folder)
    info["resolvedPath"] = folder
    info["exists"] = os.path.isdir(folder)
    if info["exists"]:
        try:
            info["files"] = sorted(os.listdir(folder))
        except Exception as exc:
            info["files"] = "listdir failed: %s" % exc
    info["chosen"] = _best_icon_file(folder)
    return info


def list_panels(ui):
    """Fusion's own ribbon structure: workspace -> tab -> panel -> controls, in Fusion's order.

    MAIN THREAD ONLY -- the caller marshals this.

    Which command belongs in the Create folder and which in Modify has been my judgement up to
    now, and Jamie found the cost of that on the device: our Create folder held the primitives
    nobody uses and omitted Revolve, Sweep, Loft and Mirror, all of which Fusion itself puts
    there. This reads the real answer instead: what Fusion groups together, in the order it
    shows them, and which controls it promotes to the top level.
    """
    workspaces = []
    try:
        items = ui.workspaces
    except Exception:
        return workspaces

    for workspace in items:
        ws_id = _safe(lambda: workspace.id)
        # Only the design workspace is of interest, and walking all 38 is slow enough to be
        # felt on the main thread.
        if ws_id not in ("FusionSolidEnvironment", "TSplineEnvironment"):
            continue
        entry = {"id": ws_id, "name": _safe(lambda: workspace.name), "tabs": []}
        try:
            for tab in workspace.toolbarTabs:
                tab_entry = {
                    "id": _safe(lambda: tab.id),
                    "name": _safe(lambda: tab.name),
                    "panels": [],
                }
                try:
                    for panel in tab.toolbarPanels:
                        panel_entry = {
                            "id": _safe(lambda: panel.id),
                            "name": _safe(lambda: panel.name),
                            "controls": [],
                        }
                        try:
                            for control in panel.controls:
                                panel_entry["controls"].append(_describe_control(control))
                        except Exception:
                            pass
                        tab_entry["panels"].append(panel_entry)
                except Exception:
                    pass
                entry["tabs"].append(tab_entry)
        except Exception:
            pass
        workspaces.append(entry)
    return workspaces


def _describe_control(control):
    """One ribbon control. Drop-downs carry their own children, which is where Fusion hides
    most of what we want -- Revolve and Sweep live inside the Create drop-down, not beside it.
    """
    item = {
        "id": _safe(lambda: control.id),
        "isPromoted": _safe(lambda: control.isPromoted),
        "isVisible": _safe(lambda: control.isVisible),
        "objectType": _safe(lambda: control.objectType),
    }
    definition = _safe(lambda: control.commandDefinition)
    if definition is not None:
        item["commandId"] = _safe(lambda: definition.id)
        item["name"] = _safe(lambda: definition.name)
    children = _safe(lambda: control.controls)
    if children is not None:
        item["children"] = []
        try:
            for child in children:
                item["children"].append(_describe_control(child))
        except Exception:
            pass
    return item


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def list_commands(ui):
    """Every command definition Fusion has created so far.

    Note: definitions are created lazily. A workspace the user has not visited this session
    may contribute nothing here, so this list grows as Fusion is used. Dump it after
    visiting every workspace to get a complete inventory.
    """
    commands = []
    try:
        definitions = ui.commandDefinitions
    except Exception:
        return commands

    for definition in definitions:
        try:
            command_id = definition.id
        except Exception:
            continue
        entry = {"id": command_id}
        try:
            entry["name"] = definition.name
        except Exception:
            entry["name"] = command_id
        try:
            entry["isNative"] = definition.isNative
        except Exception:
            pass
        try:
            entry["hasIcon"] = bool(definition.resourceFolder)
        except Exception:
            entry["hasIcon"] = False
        commands.append(entry)
    commands.sort(key=lambda item: item["id"])
    return commands
