# Research: VSD / Mirabox Stream Dock SDK and the N1

Date: 2026-07-27. Status of each claim marked CONFIRMED (primary source cited) or INFERRED.

## Summary

A first-party plugin SDK exists and is a literal source fork of Elgato's Stream Deck SDK.
Building a plugin is viable. Two findings change the project's scope:

1. **Device rotation is almost certainly not supported.** The requirement for separate
   portrait (3x5) and landscape (5x3) layouts may not be buildable. See "Rotation" below.
2. **Programmatic page switching is unverified and probably dead code.** The workaround —
   repainting all 15 keys in place — is better anyway. See "Page switching" below.

## The SDK — CONFIRMED

- Plugin SDK: https://github.com/MiraboxSpace/StreamDock-Plugin-SDK
- Docs: https://sdk.key123.vip/en/guide/overview.html
- Shipped plugin sources: https://github.com/MiraboxSpace/StreamDock-Plugins
- Device SDK (direct HID): https://github.com/MiraboxSpace/StreamDock-Device-SDK

It is an Elgato fork, not merely similar. `HSDSDKDefines.h` still carries
`@copyright (c) 2018, Corsair Memory, Inc.`, and the socket entry point is literally
`window.connectElgatoStreamDeckSocket`. Plugin folders use Elgato's `.sdPlugin` suffix.

Templates ship for JavaScript, Vue, Node.js, C++, Qt and Python.

**Launch and registration** — identical to Elgato. The plugin process is launched with
`-port`, `-pluginUUID`, `-registerEvent`, `-info`; it connects to `ws://127.0.0.1:<port>`
and sends `{ event: inRegisterEvent, uuid: inPluginUUID }`.

**Windows install path:** `C:\Users\<user>\AppData\Roaming\HotSpot\StreamDock\plugins`
Live debug interface at `http://localhost:23519/` reloads plugins without restarting.

**Events received:** `keyDown`, `keyUp`, `dialDown`, `dialUp`, `dialRotate` (payload `ticks`,
`pressed`), `willAppear`, `willDisappear`, `deviceDidConnect`, `deviceDidDisconnect`,
`applicationDidLaunch`, `applicationDidTerminate`, `systemDidWakeUp`, `didReceiveSettings`,
`didReceiveGlobalSettings`, `propertyInspectorDidAppear`, `sendToPlugin`, and others.

**Events sent:** `setTitle`, `setImage`, `setState`, `showAlert`, `showOk`, `setSettings`,
`getSettings`, `setGlobalSettings`, `getGlobalSettings`, `openUrl`, `logMessage`,
`sendToPropertyInspector`.

**Property Inspector** (per-action settings UI) is supported via `PropertyInspectorPath`.

**`ApplicationsToMonitor`** in the manifest, plus `applicationDidLaunch` /
`applicationDidTerminate`, gives Fusion launch/exit detection directly. This satisfies the
"know when Fusion is open" requirement without any polling.

## N1 hardware — CONFIRMED from SDK source

Source: `CPP-SDK/src/HotspotDevice/StreamDockN1/streamdockN1.cpp` and
`Python-SDK/src/StreamDock/Devices/StreamDockN1.py`.

| Property | Value |
| --- | --- |
| USB VID:PID | `0x6603:0x1011` (N1); `0x6603:0x1000` (N1E/N1EN variant) |
| Transport | USB HID (hidapi / libusb), report sizes 513 / 1025 |
| LCD keys | 15, hardware codes `0x01`–`0x0F`, row-major from top-left |
| Key image | **96x96 JPEG**, rotation 0, no flip |
| Two extra buttons | keys 16 and 17, codes `0x1E`, `0x1F` — secondary-screen keys |
| Secondary screen image | 64x64 per C++ SDK; Python SDK says 80x80. **Sources disagree — verify empirically** |
| Knob | Clicks. Press `0x23`, rotate left `0x32`, rotate right `0x33` |
| Knob detents | Discrete direction events at the HID layer, not a tick count |
| Main background screen | 480x854 JPEG portrait, requires firmware >= 13 |
| Grid | 3 columns x 5 rows portrait — INFERRED from key count and panel aspect |

## Rotation — NOT SUPPORTED (high confidence)

The N1 device class hardcodes `key_rotate_angle = 0.0f` and `bg_rotate_angle = 0.0f`. Other
models in the same SDK use non-zero values, so the field is real but fixed at zero for the N1.
No rotation setting appears in any documentation or manual found.

**Consequence:** the requirement for a portrait layout and a separate landscape layout per
menu likely cannot be met. The device appears to be portrait-only, 3 wide by 5 tall. This
needs an explicit decision before layout design begins.

## Page switching — UNVERIFIED, treat as dead

`switchToProfile` exists in the C++ headers (`kESDSDKEventSwitchToProfile`, and a real
`SwitchToProfile(deviceID, profileName)` method) but:

- It is absent from the official "Events Sent" documentation, while every other sendable
  event is documented.
- It is absent from the JavaScript, Vue, Node.js and Python bindings — present only in the
  C++/Qt ones, which are the most mechanically copied from Elgato.
- A code search across the whole `MiraboxSpace` org finds zero uses outside the inherited
  header defines. No shipped plugin uses it.

INFERRED: almost certainly dead inherited code. Cheap to test, and must be tested before any
architecture depends on it.

**The better approach regardless — repaint in place.** The plugin owns all 15 keys and calls
`setImage`/`setTitle` on each when Fusion's context changes. "Pages" become plugin-internal
state rather than host-application profiles. This stays entirely inside confirmed SDK
capability, gives full control over transitions, and sidesteps the question. This should be
the design.

The host software's own model is Scenes containing Pages (up to 10 pages per scene), navigated
by built-in actions the user places on keys. The software also supports automatic scene
switching by foreground application, but that is app-level only — not Fusion-workspace-level,
so it cannot deliver context awareness.

## Fallback: the Device SDK

https://github.com/MiraboxSpace/StreamDock-Device-SDK — first-party, MIT licensed, C++ and
Python, N1 explicitly supported, direct HID control. Docs at https://creator.key123.vip/.

**Caveat:** it takes exclusive control of the device, so the Stream Dock desktop software must
not be running. It cannot coexist with a plugin. It exposes N1-specific extras including
`change_page(page)`, `switch_mode` (KEYBOARD / CALCULATOR / DOCK) and
`set_n1_skin_bitmap(...)` with `skin_page` 1–5.

## Open-source ecosystem — the N1 is not covered

| Project | N1 support |
| --- | --- |
| OpenDeck | **No** — CONFIRMED |
| mirajazz (Rust) | **No** — supports 293S, N3, N3 rev2, N4, AKP153, AKP03 |
| opendeck-akp03 | **No** — N3 family only |
| rust-elgato-streamdeck | **No** — removed all non-Elgato support in v0.11 |
| Bitfocus Companion | **No** — only 293V3 and N4 |

Net: for the N1 there are exactly two viable routes, both first-party — the Plugin SDK or the
Device SDK.

## "VSD Insight" does not exist

No software by that name could be found. The desktop software is **VSD Craft**
(https://www.vsdinside.com/pages/download, v3.10.202). Mirabox's identical-looking equivalent
is branded **Stream Dock** (https://mirabox.net/pages/download, v3.10.185.1120), whose device
list includes the N1.

INFERRED: VSD Craft and Stream Dock are the same application under different brand skins —
same version scheme, same `AppData\Roaming\HotSpot\StreamDock\plugins` path, same
`key123.vip` SDK backend, same `com.mirabox.streamdock.*` UUIDs. VSDinside, Mirabox, Soomfon
and VAPOURD appear to be resellers of one "HotSpot" platform.

Note: the N1 product URL supplied at project start returned HTTP 404 when fetched, though it
appears in search indexes.
