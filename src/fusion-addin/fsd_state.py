"""Reads Fusion's current context into a plain dict for the Stream Dock plugin.

Every accessor here must run on Fusion's main thread. Fusion's API raises readily -- an
unopened document, a workspace mid-transition, a command definition without a resource
folder -- so every read is individually guarded. A partial state object is far more useful
to the plugin than an exception.
"""

import adsk.core
import adsk.fusion

# ui.activeCommand reports this when no command dialog is running. Fusion's own sample code
# uses the same comparison as its "is anything running?" test.
IDLE_COMMAND = "SelectCommand"

# Workspace ids we map to friendly names. Any workspace not listed still reports its raw id,
# so an unknown workspace degrades to "usable" rather than "broken".
WORKSPACE_NAMES = {
    "FusionSolidEnvironment": "Design",
    "FusionRenderEnvironment": "Render",
    "FusionSimulationEnvironment": "Simulation",
    "CAMEnvironment": "Manufacture",
    "FusionAnimationEnvironment": "Animation",
    "FusionDrawingEnvironment": "Drawing",
}


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def _active_tab(ui):
    """Id of the active toolbar tab, e.g. SolidTab / SurfaceTab / SheetMetalTab."""
    # ui.activeToolbarTab exists on current builds but has not always; fall back to
    # scanning the workspace's tabs for isActive, which is the documented property.
    tab = _safe(lambda: ui.activeToolbarTab)
    if tab:
        return _safe(lambda: tab.id), _safe(lambda: tab.name)

    workspace = _safe(lambda: ui.activeWorkspace)
    if not workspace:
        return None, None
    try:
        for candidate in workspace.toolbarTabs:
            if _safe(lambda: candidate.isActive, False):
                return _safe(lambda: candidate.id), _safe(lambda: candidate.name)
    except Exception:
        pass
    return None, None


def _sketch_context(app):
    """(in_sketch, sketch_name). Uses activeEditObject -- there is no Design.activeSketch."""
    edit_object = _safe(lambda: app.activeEditObject)
    if edit_object is None:
        return False, None
    sketch = _safe(lambda: adsk.fusion.Sketch.cast(edit_object))
    if sketch:
        return True, _safe(lambda: sketch.name)
    return False, None


def _selection(ui):
    """Selection summary. Only meaningful while idle -- see the caveat below."""
    selections = _safe(lambda: ui.activeSelections)
    if selections is None:
        return {"count": 0, "types": []}
    count = _safe(lambda: selections.count, 0) or 0
    types = []
    # Cap the scan: selecting every face of a dense model would otherwise make this read
    # cost grow without bound, and the plugin only needs the distinct kinds.
    for index in range(min(count, 50)):
        entity_type = _safe(lambda: selections.item(index).entity.objectType)
        if entity_type:
            short = entity_type.rsplit("::", 1)[-1]
            if short not in types:
                types.append(short)
    return {"count": count, "types": types}


def read_state(app, ui):
    """Snapshot Fusion's context. Safe to call from any main-thread event handler."""
    workspace_id = _safe(lambda: ui.activeWorkspace.id)
    tab_id, tab_name = _active_tab(ui)
    in_sketch, sketch_name = _sketch_context(app)
    active_command = _safe(lambda: ui.activeCommand, IDLE_COMMAND) or IDLE_COMMAND

    return {
        "type": "state",
        "connected": True,
        "workspace": workspace_id,
        "workspaceName": WORKSPACE_NAMES.get(workspace_id, workspace_id),
        "tab": tab_id,
        "tabName": tab_name,
        "inSketch": in_sketch,
        "sketchName": sketch_name,
        "activeCommand": active_command,
        # A dialog being open changes what the device should offer (OK / Cancel), so the
        # plugin gets this as an explicit flag rather than having to know the sentinel.
        "dialogOpen": active_command != IDLE_COMMAND,
        # NOTE: activeSelectionChanged does not fire while another command is running, so
        # this is reliable when idle and may be stale inside a dialog. The plugin must not
        # drive destructive choices from it.
        "selection": _selection(ui),
        "documentName": _safe(lambda: app.activeDocument.name),
        "hasDesign": _safe(lambda: adsk.fusion.Design.cast(app.activeProduct) is not None, False),
    }


def list_tabs(ui):
    """Every workspace and its ribbon tabs, as ids and display names.

    Tab ids are install-derived exactly like command ids, so they are read from the running
    Fusion rather than written from memory. Same caveat as list_commands: a workspace the
    user has not visited this session may not have built its tabs yet, so visit each one
    before trusting the dump.
    """
    workspaces = []
    try:
        items = ui.workspaces
    except Exception:
        return workspaces

    for workspace in items:
        entry = {
            "id": _safe(lambda: workspace.id),
            "name": _safe(lambda: workspace.name),
            "isActive": _safe(lambda: workspace.isActive, False),
            "tabs": [],
        }
        try:
            for tab in workspace.toolbarTabs:
                entry["tabs"].append(
                    {
                        "id": _safe(lambda: tab.id),
                        "name": _safe(lambda: tab.name),
                        "isActive": _safe(lambda: tab.isActive, False),
                        "isVisible": _safe(lambda: tab.isVisible, None),
                    }
                )
        except Exception:
            pass
        workspaces.append(entry)
    return workspaces


def state_key(state):
    """Fields that should trigger a repaint when they change.

    Deliberately excludes documentName and sketchName: renaming a sketch should not make the
    device flash. Selection is included by count and kind, not identity, so dragging a
    selection around does not repaint on every mouse move.
    """
    if not state:
        return None
    selection = state.get("selection") or {}
    return (
        state.get("connected"),
        state.get("workspace"),
        state.get("tab"),
        state.get("inSketch"),
        state.get("activeCommand"),
        selection.get("count"),
        tuple(selection.get("types") or ()),
    )
