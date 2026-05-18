<p align="center">
  <img src="assets/logo.png" alt="Baguette" width="240">
</p>

<h1 align="center">Baguette</h1>

<p align="center"><em>Bon appétit.</em></p>

<p align="center">
  Headless iOS Simulator manager + host-side input injection for iOS 26.
</p>

<p align="center">
  <a href="https://github.com/tddworks/baguette/actions/workflows/ci.yml"><img src="https://github.com/tddworks/baguette/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/tddworks/baguette"><img src="https://codecov.io/gh/tddworks/baguette/branch/main/graph/badge.svg" alt="Coverage"></a>
  <a href="https://github.com/tddworks/baguette/releases/latest"><img src="https://img.shields.io/github/v/release/tddworks/baguette?sort=semver" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tddworks/baguette" alt="License"></a>
  <img src="https://img.shields.io/badge/Swift-6.1-orange?logo=swift" alt="Swift 6.2">
  <img src="https://img.shields.io/badge/macOS-15%2B-blue?logo=apple" alt="macOS 15+">
  <img src="https://img.shields.io/badge/Xcode-26-1575F9?logo=xcode" alt="Xcode 26">
</p>

A single Swift CLI — **`baguette`** — plus a self-contained web UI
that gives you full headless control of an iOS simulator without
opening Xcode or `Simulator.app`. Boot devices, stream their screens
at 60 fps, dispatch taps / swipes / multi-finger gestures / system
gestures / keyboard / hardware buttons, tail the unified log,
inspect the accessibility tree, take screenshots and recordings, and
— as of 0.1.72 — pipe your Mac webcam into the simulator's camera
APIs.

## Demo

https://github.com/user-attachments/assets/e904413f-16bb-4b3d-86d5-162333403cee

https://github.com/user-attachments/assets/c49c9f4b-0e4b-47ea-9272-3223b1ac7739

https://github.com/user-attachments/assets/65dc62ee-f0c7-48fb-9c57-5bd267c8c02f

> The raw clip lives at [`assets/demo.mp4`](assets/demo.mp4) — drag
> it into a GitHub web edit of this README to upload as a CDN-hosted
> video and replace the line above with the auto-generated URL.

- **Frame streaming** — MJPEG or H.264 / AVCC over stdout or WebSocket.
  Runtime-tunable bitrate / fps / scale. In-browser recording (MP4)
  composites the bezel + screen + gesture overlays into one file.
- **Host-HID input** — taps / swipes / streaming 1- and 2-finger
  gestures / pinch / pan / scroll / Mac keyboard / hardware buttons
  (home, lock, power, volume, action, plus Apple Watch's digital
  crown + side button) — all through SimulatorKit's private symbols
  with the iOS-26 calling conventions. The iOS-26 streaming-touch +
  edge-gesture path uses `IOHIDDigitizerDispatch` so home-indicator
  swipes, app-switcher drags, and Notification Center / Lock Screen
  pull-downs all fire the real iOS recognizers live. No dylib
  injection on this path; no `DYLD_INSERT_LIBRARIES` to manage.
- **Camera (new in 0.1.72)** — pipe a Mac webcam directly into the
  iOS simulator's `AVCaptureVideoPreviewLayer`, `AVCapturePhotoOutput`,
  and `UIImagePickerController`. Pick a camera in the browser's
  Camera card, click Start, the iOS app sees real frames. One
  ObjC dylib (`VirtualCamera.dylib`, vendored from
  [`asc-pro/SimCam`](https://github.com/tddworks/asc-pro))
  loaded into every sim-launched app via `DYLD_INSERT_LIBRARIES`;
  baguette pumps BGRA frames through a shared-memory ring buffer.
  See [`docs/features/camera.md`](docs/features/camera.md).
- **Device orientation** — `baguette orientation --udid <X> portrait`
  rotates a booted simulator. Wire JSON + a one-click rotate button
  on the focus-mode toolbar. Fires a `GSEventTypeDeviceOrientationChanged`
  mach message at `PurpleWorkspacePort`, bypassing SimulatorKit's
  NSView path so the host stays headless.
- **Accessibility tree** — `baguette describe-ui` returns the
  on-screen AX tree as JSON (per-node `role`, `label`, `value`,
  `identifier`, `frame` in device points). Hit-test mode (`--x --y`)
  returns the topmost node under a coordinate. Powered by the
  private `AccessibilityPlatformTranslation` framework with a
  `bridgeTokenDelegate` we install ourselves.
- **Live unified-log stream** — `baguette logs --udid <X>` streams
  `os_log` output to stdout; `WS /simulators/:udid/logs` does the
  same to the browser's Logs panel. Predicate / bundle-id filters.
- **Standalone web UI** — `baguette serve` opens
  `http://localhost:8421/simulators` with a list page, a focus-mode
  per-device view, a sidebar stream view, the Camera card, an
  Accessibility inspector overlay, a Logs panel, and in-browser
  recording. All wrapped by a small JS SDK
  (`Resources/Web/baguette/`) — `const sim = await Baguette.use({…});
  sim.mount(container);` — that hangs each part (screen, buttons,
  keyboard, …) off one `Simulator` instance.
- **Device farm** — `http://localhost:8421/farm` renders every booted
  simulator in a wall / grid / list with filtering + sorting. Click
  a tile to focus it for full-quality streaming + input through the
  same pipeline as the CLI.
- **TDD non-negotiable, layered, mock-injected** — bounded-context
  Domain / Infrastructure / App split; **460+ Swift Testing cases**
  backed by auto-generated `MockXxx` fakes for every external port
  (`Input`, `Screen`, `Accessibility`, `LogStream`, `Chromes`,
  `DeviceHost`, `Subprocess`, `CameraCapture`, `VideoCapture`,
  `CameraFrameSink`, `SimulatorInjection`, `Cameras`). `swift test`
  requires no simulator at all.

## Install

```bash
brew install tddworks/tap/baguette
```

Apple Silicon only. Requires Xcode 26 — `baguette` links against private
SimulatorKit / CoreSimulator frameworks shipped with Xcode.

## Quickstart

```bash
# Start the web UI
baguette serve

# Single-device dashboard — list, boot/shutdown, per-device stream pages
open http://localhost:8421/simulators

# Device farm — every booted simulator side-by-side, click to focus
open http://localhost:8421/farm
```

`/simulators` lists every simulator on the machine with Boot / Shutdown
buttons; click any booted device to open its focus-mode page —
full-window live stream, DeviceKit-sourced bezel, top toolbar with
Camera / Accessibility / Logs / Home / Screenshot / App-switcher
controls, and a sidebar-view jump button.

`/farm` is the multi-device control surface. See
[Device farm](#device-farm) below.

Headless from the terminal works too:

```bash
baguette list
baguette boot --udid <UDID>
baguette tap --udid <UDID> --x 219 --y 478 --width 438 --height 954
```

## Build from source

```bash
make           # release build via ./build.sh
swift test     # run the test suite
```

Hybrid build: SPM fetches dependencies (`ArgumentParser`, `Mockable`,
`Hummingbird`, `HummingbirdWebSocket`); `swiftc` compiles everything
with an Objective-C bridging header targeting `arm64e-apple-macos26.0`,
linking `CoreSimulator`, `SimulatorKit`, `IOSurface`, `VideoToolbox`,
`CoreGraphics`, `ImageIO` from Xcode's private frameworks.

## CLI

```
baguette <command> [options]

  # Lifecycle
  list [--json]                              List devices (default + custom sets;
                                             --json emits {"running":[…],"available":[…]})
  boot     --udid <UDID>                     Boot headlessly
  shutdown --udid <UDID>                     Shutdown
  orientation --udid <UDID>                  Rotate the booted simulator
              <portrait|landscape-left|       (GSEvent over PurpleWorkspacePort —
               landscape-right|portrait-      no NSView, host stays headless)
               upside-down>

  # Frames + screenshots
  stream     --udid <UDID> [--fps 60] [--format mjpeg|avcc]
                                             Stream frames on stdout
  screenshot --udid <UDID> [--output <path>] [--quality 0.85] [--scale 1]
                                             One-shot JPEG (defaults to stdout)

  # Accessibility + logs
  describe-ui --udid <UDID> [--x <px> --y <px>] [--output <path>]
                                             Dump on-screen accessibility tree as
                                             JSON; frames in DEVICE POINTS so
                                             they pipe straight back into a tap.
  logs --udid <UDID> [--level info|debug|default]
                     [--style default|compact|json|ndjson|syslog]
                     [--predicate <NSPredicate>] [--bundle-id <id>]
                                             Stream os_log output. Levels are
                                             the three the iOS-runtime accepts.

  # Long-lived gesture pipe
  input --udid <UDID>                        Read newline-delimited JSON
                                             gestures from stdin

  # Web UI — single-device dashboard + multi-device farm + Camera card +
  # Accessibility inspector + Logs panel + in-browser recording.
  serve [--port 8421] [--host 127.0.0.1] [--device-set <path>]

  # DeviceKit chrome / bezel data
  chrome layout    --udid <UDID> | --device-name "iPhone 17 Pro"
  chrome composite --udid <UDID> | --device-name "iPhone 17 Pro"

  # One-shot gestures — same HID path as `input`, one gesture per
  # invocation. Coordinates are in DEVICE POINTS; `width` / `height`
  # are the simulator's screen size in points.
  tap        --udid … --x … --y … --width … --height … [--duration 0.05]
  double-tap --udid … --x … --y … --width … --height …
                                             [--interval 0.05] [--duration 0.08]
  swipe      --udid … --startX … --startY … --endX … --endY …
                                             --width … --height …
  pinch      --udid … --cx … --cy … --startSpread … --endSpread …
                                             --width … --height …
  pan        --udid … --x1 … --y1 … --x2 … --y2 … --dx … --dy …
                                             --width … --height …

  # Keyboard (single keystroke or typed string)
  key  --udid … --code <KeyA..Z|Digit0..9|Enter|Escape|Backspace|Tab|Space|
                       Arrow*|punctuation>
                       [--modifiers shift,control,option,command] [--duration 0.2]
  type --udid … --text "<US-ASCII string>"

  # Hardware + virtual buttons. Phone: home / lock / power / volume-up /
  # volume-down / action / app-switcher / swipe-to-app-switcher /
  # swipe-to-home / pull-down-to-lock-screen / pull-down-to-notification-center.
  # Watch: digital-crown / side-button / left-side-button.
  press --udid … --button <name> [--duration <sec>]
```

## `baguette serve` — the web UI

```bash
baguette serve --port 8421
# [baguette] listening on http://127.0.0.1:8421/simulators
```

Open `http://localhost:8421/simulators` in any browser. You get the
device list (RUNNING / AVAILABLE), Boot / Shutdown buttons, and a
per-device focus-mode page at `/simulators/<UDID>` with live frames,
gesture input, the DeviceKit-sourced bezel, a top toolbar (Camera /
Accessibility / Logs / Home / Screenshot / App-switcher / Rotate),
floating Camera + Accessibility control cards, and an in-browser
MP4 recorder. A sidebar-view variant is reachable from the bottom-left
toggle on the focus page.

The HTML is editable on disk — `Sources/Baguette/Resources/Web/sim.html`
opens directly in any browser via `file://` (preview mode), and points
to its sibling `.js` files. Set `BAGUETTE_WEB_DIR` to override the
served root for live-iteration without rebuilding.

### Routes (single resource tree, no `/api/` prefix)

| Method | Path                                       | Backed by                    |
|--------|--------------------------------------------|------------------------------|
| `GET`  | `/`                                        | 302 → `/simulators`          |
| `GET`  | `/simulators`                              | list HTML                    |
| `GET`  | `/simulators.json`                         | list JSON `{running, available}` |
| `GET`  | `/simulators/:udid`                        | focus-mode HTML (single-sim) |
| `POST` | `/simulators/:udid/boot`                   | `simulator.boot()`           |
| `POST` | `/simulators/:udid/shutdown`               | `simulator.shutdown()`       |
| `POST` | `/simulators/:udid/orientation?value=…`    | `simulator.orientation().set(…)` |
| `GET`  | `/simulators/:udid/definition.json`        | SDK bootstrap: identity + screen rect + bezel image URLs + per-button envelope/box/transform |
| `GET`  | `/simulators/:udid/chrome.json`            | DeviceKit bezel layout       |
| `GET`  | `/simulators/:udid/bezel.png`              | rasterized bezel PNG         |
| `GET`  | `/simulators/:udid/screenshot.jpg`         | one-shot JPEG (`?quality=&scale=`) |
| `GET`  | `/simulators/:udid/review-snapshot.json`   | Codex Review Mode screenshot + AX tree snapshot |
| `PUT`  | `/simulators/:udid/review-annotations.json` | save current CX review annotations in memory |
| `GET`  | `/simulators/:udid/review-annotations.json` | read saved CX review annotations |
| `DELETE` | `/simulators/:udid/review-annotations.json` | clear saved CX review annotations |
| `GET`  | `/review/status.json`                      | Baguette review API and saved review status |
| `WS`   | `/simulators/:udid/stream?format=mjpeg\|avcc` | live frames + control + input + `describe_ui` |
| `WS`   | `/simulators/:udid/logs?level=&style=&predicate=&bundleId=` | live unified-log stream |
| `WS`   | `/simulators/:udid/camera`                 | virtual camera: pick a Mac webcam, frames pumped into the simulator's AVFoundation stack via the bundled `VirtualCamera.dylib` |
| `GET`  | `/farm`                                    | device-farm HTML             |
| `GET`  | `/farm/:file`                              | farm UI asset (`farm.css`, `farm-*.js`, …) |
| `GET`  | `/baguette/:file`                          | SDK module (`transport.js`, `simulator.js`, `parts/<name>.js`, `gestures/<name>.js`) |
| `GET`  | `/<file>.{html,js,css}`                    | static UI asset              |

### One bidirectional WebSocket per stream

The same WS carries everything for a viewing session:

- **Server → Browser** — encoded binary frames (one per WS message).
  - MJPEG: raw JPEG bytes per frame.
  - AVCC: 1-byte tag + payload — `0x01` avcC description, `0x02` keyframe,
    `0x03` delta, `0x04` JPEG seed (renders before H.264 IDR lands).
- **Browser → Server** — text JSON, one line per message:
  - Stream control: `{"type":"set_bitrate","bps":N}` /
    `{"type":"set_fps","fps":N}` / `{"type":"set_scale","scale":N}` /
    `{"type":"force_idr"}` / `{"type":"snapshot"}`.
  - Gesture input: same wire format as `baguette input` (see below).

No `/event` POST, no UDID-keyed registry — the WS handler closure owns
the live stream + simulator handle for the duration.

## Device farm

```bash
baguette serve
open http://localhost:8421/farm
```

A multi-device dashboard for the booted simulators on the host. Every
device renders in a single page; the same WebSocket pipeline that powers
`/simulators/:udid` drives every tile.

**What it does**

- **Three view modes** — Grid (compact thumbnails), Wall (large tiles
  with bezels), and List (one-row-per-device with metadata). Toggle from
  the header.
- **Filter and sort** — by device family, OS version, run state. The
  rail on the left holds filter state across view changes.
- **Click to focus** — clicking any tile re-parents its `<canvas>` into
  a full-quality focused pane on the right. The thumbnail keeps streaming
  at low bitrate; only the focused tile pays for full-rate frames. No
  separate mirror video element — the same canvas appears in two places.
- **Input on the focused tile** — gestures, hardware buttons (home /
  lock), and the pinch overlay all round-trip through `SimInputBridge`
  → `GestureDispatcher` → `IndigoHIDInput`. Anything the CLI can drive,
  the focused tile can drive.
- **Bezels** — each tile renders with its DeviceKit bezel by default,
  with a **9-slice composition fallback** for devices without a packaged
  asset. Toggle to a raw (no-bezel) display mode from the tile menu.

**What's served**

`/farm` is a thin HTML shell at `Resources/Web/farm/farm.html` that
loads five IIFE component scripts from `/farm/<name>.js`:

| Script           | Job                                             |
|------------------|-------------------------------------------------|
| `farm-views.js`  | Grid / Wall / List renderers (pure DOM)         |
| `farm-tile.js`   | `FarmTile` — per-device thumbnail StreamSession |
| `farm-focus.js`  | `FarmFocus` — focused-device pane               |
| `farm-filter.js` | `FarmFilter` — filter state + sidebar wiring    |
| `farm-app.js`    | `FarmApp` — orchestrator (boot, fetch, dispatch)|

`BAGUETTE_WEB_DIR` overrides the served root, so you can iterate on the
farm UI without rebuilding — point it at `Sources/Baguette/Resources/Web`
on disk and reload the browser.

## Wire protocol — `baguette input`

Newline-delimited JSON on stdin → `{"ok":true}` / `{"ok":false,"error":…}`
on stdout, one ack per line.

```json
{"type":"tap",   "x":219, "y":478, "width":438, "height":954, "duration":0.05}
{"type":"swipe", "startX":219,"startY":760, "endX":219,"endY":190,
                 "width":438,"height":954, "duration":0.3}

// 1-finger streaming (phase-driven). Optional `edge: "bottom"|"top"|
// "left"|"right"` flags the stream as a screen-edge system gesture —
// `bottom` engages iOS's home-indicator recognizer (live home /
// app-switcher preview), `top` engages the status-bar recognizer
// (live Lock Screen pull-down on the left, Notification Center on
// the right). Omit for ordinary interior touches.
{"type":"touch1-down", "x":219, "y":478, "width":438,"height":954}
{"type":"touch1-move", "x":225, "y":485, "width":438,"height":954}
{"type":"touch1-up",   "x":225, "y":485, "width":438,"height":954}

// 2-finger streaming (the primary pinch / pan path for real-time gestures)
{"type":"touch2-down", "x1":175,"y1":478, "x2":263,"y2":478, "width":438,"height":954}
{"type":"touch2-move", "x1":150,"y1":478, "x2":288,"y2":478, "width":438,"height":954}
{"type":"touch2-up",   "x1":150,"y1":478, "x2":288,"y2":478, "width":438,"height":954}

// Hardware + virtual buttons. Phone: home, lock, power, volume-up,
// volume-down, action, app-switcher, swipe-to-app-switcher,
// swipe-to-home, pull-down-to-lock-screen, pull-down-to-notification-center.
// Watch: digital-crown, side-button, left-side-button.
{"type":"button", "button":"home"}
{"type":"button", "button":"action", "duration":1.0}

// Keyboard. `code` is a W3C KeyboardEvent.code; modifiers are held
// for the keystroke. Or send a typed string in one envelope.
{"type":"key", "code":"KeyA", "modifiers":["shift"], "duration":0.2}
{"type":"type", "text":"hello"}

// Scroll
{"type":"scroll", "deltaX":0, "deltaY":-50}

// One-shot pinch (server interpolates 10 steps)
{"type":"pinch", "cx":219,"cy":478, "startSpread":60,"endSpread":240,
                 "width":438,"height":954, "duration":0.6}

// One-shot parallel pan of two fingers
{"type":"pan", "x1":175,"y1":478, "x2":263,"y2":478,
               "dx":0,"dy":200, "width":438,"height":954, "duration":0.5}

// On-screen accessibility tree — works over the same WS stream
{"type":"describe_ui"}
{"type":"describe_ui", "x":219, "y":478}
```

**Camera control** is its own WS at `/simulators/:udid/camera`:

```json
{"type":"camera_list"}
{"type":"camera_start","deviceUID":"…","fit":"fit","mirror":false}
{"type":"camera_stop"}
{"type":"camera_set_flags","fit":"fill","mirror":true}
```

Server pushes `{"type":"camera_devices","devices":[…]}` once on
connect and again on `camera_list`, plus `{"type":"camera_state",
"phase":"idle|streaming","fps":29.97,"device":"…"}` on every
state change and once per second while streaming. Full wire
reference: [`docs/features/camera.md`](docs/features/camera.md).

**Coordinate convention.** All `x` / `y` / `startX` / `endX` / `x1` / `x2`
are in **device points** — same units as `width` and `height`. The HID
adapter normalises internally before handing them to the C function.
A "tap at the centre of an iPhone 17 Pro Max" is `x:219, y:478` (half of
438×954), not `x:0.5, y:0.5`. The browser UI multiplies its normalized
coordinates by `width` / `height` before serialising.

### Known limits

- `siri` button — crashes `backboardd` via every known Indigo path;
  refused by the CLI.
- `key` / `type` cover US-ASCII via W3C `KeyboardEvent.code` strings.
  IME / Pinyin / accented / emoji aren't on the host-HID path yet —
  fall back to `xcrun simctl io <UDID> text "…"` for those.
- Single-finger streaming (`touch1-*`) routes correctly but
  `UIPinchGestureRecognizer` treats it as an interactive pan; prefer
  `touch2-*` for pinch / multi-finger.
- The Camera feature streams **one** Mac webcam at a time per host
  — all sims write the same shared-memory ring buffer
  (`/tmp/SimCam.bgra`), so two concurrent camera sessions trample.

## `baguette stream` — frame streaming

```bash
baguette stream --udid <UDID> --format avcc --fps 60 | ffplay -
```

Outputs length-prefixed binary frames on stdout. AVCC carries a 1-byte
type prefix per chunk:

| Prefix | Meaning |
|--------|---------|
| `0x01` | avcC description — feed to `VideoDecoder.configure` |
| `0x02` | Keyframe (IDR) AVCC payload |
| `0x03` | Delta frame |
| `0x04` | JPEG seed — paints before H.264 IDR lands |

Runtime control: while streaming, write one JSON line per command to
stdin to retune without restarting.

```json
{"type":"set_bitrate","bps":4000000}
{"type":"set_fps","fps":30}
{"type":"set_scale","scale":2}
{"type":"force_idr"}
{"type":"snapshot"}
```

## `baguette chrome` — DeviceKit bezel data

```bash
baguette chrome layout --device-name "iPhone 17 Pro" | jq .
baguette chrome composite --device-name "iPhone 17 Pro" > iphone17pro.png
```

Reads Apple's own DeviceKit chrome bundles
(`/Library/Developer/DeviceKit/Chrome/`) and emits the bezel layout
JSON or rasterizes the composite PDF to PNG. The `serve` page uses
this for every simulator family — no hand-curated bezel table to keep
in sync.

## Source layout

Bounded contexts mirror across `Domain/` and `Infrastructure/` so a
feature lives in one place across both layers.

```
.
├── Makefile                          wraps build.sh
├── build.sh                          builds VirtualCamera.dylib first,
│                                     then swift build -c release
├── Package.swift                     SPM manifest
│
├── VirtualCamera/                    iOS-Simulator dylib (vendored from
│   ├── Sources/*.{h,m}               asc-pro/SimCam). Cross-compiled
│   ├── build.sh                      against iphonesimulator SDK,
│   ├── VirtualCamera.dylib           linker-signed adhoc, fat arm64 +
│   └── VENDORED_FROM.md              x86_64. Loaded into sim apps via
│                                     DYLD_INSERT_LIBRARIES.
│
├── Sources/Baguette/
│   ├── App/                          CLI dispatch + use-case orchestration
│   │   ├── RootCommand.swift
│   │   ├── GestureDispatcher.swift   JSON line → Gesture → Input
│   │   ├── ReconfigParser.swift      runtime stream-control parser
│   │   ├── DoubleTapDispatcher.swift double-tap CLI recipe
│   │   ├── Logger.swift
│   │   └── Commands/                 one file per CLI subcommand
│   │
│   ├── Domain/                       pure Swift, no Apple private APIs
│   │   ├── Common/                   Point / Size / Rect / Insets /
│   │   │                             HIDUsage / DeviceButton
│   │   ├── Simulator/                Simulator + Simulators aggregate +
│   │   │                             DeviceHost (the seam adapters depend on)
│   │   ├── Input/                    Input + Gesture + GestureRegistry +
│   │   │                             Tap / Swipe / Touch1 / Touch2 / Press /
│   │   │                             Scroll / Pinch / Pan / Key / TypeText /
│   │   │                             Keyboard / DeviceEdge / GesturePhase
│   │   ├── Screen/                   Screen (frame source)
│   │   ├── Stream/                   Stream + StreamConfig / StreamFormat
│   │   │                             + Envelope (MJPEG / AVCC framing)
│   │   ├── Chrome/                   Chromes aggregate + DeviceChrome /
│   │   │                             DeviceProfile (bezel layout)
│   │   ├── Accessibility/            AXNode + Accessibility (UI tree)
│   │   ├── Orientation/              Orientation + DeviceOrientation values
│   │   ├── Logs/                     LogFilter + LogStream + Subprocess
│   │   │                             collaborator
│   │   └── Camera/                   CameraDevice / CameraFrame / CameraFlags /
│   │                                 SharedFrameLayout / BGRAConverter /
│   │                                 CameraSession (orchestrator, @MainActor) /
│   │                                 CameraMessage (WS parser) /
│   │                                 VirtualCameraInstallPlan + @Mockable
│   │                                 Cameras / CameraCapture / CameraFrameSink /
│   │                                 SimulatorInjection / VideoCapture
│   │
│   ├── Infrastructure/               concrete @Mockable port impls (private-API
│   │                                 code lives ONLY here)
│   │   ├── Simulator/                CoreSimulators (CoreSimulator + SimulatorKit
│   │   │                             ObjC bridge); Simulators + DeviceHost
│   │   ├── Input/                    IndigoHIDInput — 9-arg
│   │   │                             IndigoHIDMessageForMouseNSEvent + button +
│   │   │                             HIDArbitrary + keyboard paths +
│   │   │                             IOHIDDigitizerDispatch for streaming
│   │   │                             touches and edge gestures (iOS 26 path)
│   │   ├── Screen/                   SimulatorKitScreen, ScreenSnapshot
│   │   ├── Stream/                   MJPEG / AVCC encoders, JPEG / H.264, Scaler,
│   │   │                             SeedFilter, Stdout / WebSocket sinks
│   │   ├── Chrome/                   LiveChromes + FileSystemChromeStore +
│   │   │                             PDFRasterizer
│   │   ├── Accessibility/            AXPTranslatorAccessibility (AXPTranslator +
│   │   │                             TokenDispatcher bridge)
│   │   ├── Orientation/              PurpleWorkspacePortOrientation (GSEvent)
│   │   ├── Logs/                     SimDeviceLogStream + HostSubprocess
│   │   ├── Camera/                   AVCameras + AVCameraCapture (orchestrator) +
│   │   │                             HostVideoCapture (integration-only
│   │   │                             AVCaptureSession plumbing) +
│   │   │                             SharedMemoryFrameSink (mmap'd ring buffer)
│   │   │                             + SimctlSimulatorInjection (Subprocess)
│   │   │                             + VirtualCameraInstaller (bundle →
│   │   │                             per-hash dir)
│   │   └── Server/                   Server (Hummingbird HTTP + WS) + WebRoot
│   │
│   └── Resources/Web/                static UI for `serve`
│       ├── sim.html                  list + stream + focus-mode entry
│       ├── sim-list.js               list page renderer
│       ├── sim-stream.html           sidebar-view markup
│       ├── sim-stream.js             sidebar-view orchestrator
│       ├── sim-native.html           focus-mode markup
│       ├── sim-native.js             focus-mode orchestrator
│       ├── sim-camera.js             Camera control card
│       ├── sim-logs.js               Logs panel
│       ├── sim-ax-inspector.js       Accessibility-tree overlay
│       ├── recorder.js               In-browser MP4 recorder
│       ├── frame-decoder.js          MJPEG / AVCC strategy
│       ├── stream-session.js         WebSocket + paint loop
│       ├── capture-gallery.js        screenshot fetch + thumbs
│       ├── baguette/                 JS SDK — Baguette.use({…}) entry,
│       │   ├── baguette.js           transport.js (the only wire-format
│       │   ├── transport.js          owner), simulator.js, parts/<name>.js
│       │   ├── simulator.js          (bezel, screen, button, keyboard),
│       │   ├── parts/                gestures/<name>.js
│       │   │   ├── bezel.js          (pinch-overlay, pointer-interpreter)
│       │   │   ├── screen.js
│       │   │   ├── button.js
│       │   │   └── keyboard.js
│       │   └── gestures/
│       │       ├── pinch-overlay.js
│       │       └── pointer-interpreter.js
│       ├── farm/                     multi-device dashboard
│       └── VirtualCamera/            VirtualCamera.dylib bundled as a
│                                     .copy resource; VirtualCameraInstaller
│                                     reads it from Bundle.module at runtime.
│
└── Tests/BaguetteTests/              mirrors Sources/ contexts
    ├── App/                          GestureDispatcher / ReconfigParser /
    │                                 DoubleTapDispatcher / Commands tests
    ├── Simulator/                    Simulator / Simulators / DeviceHost tests
    ├── Input/                        Gesture / GestureRegistry / Keyboard /
    │                                 IndigoHIDInput error-path tests
    ├── Stream/                       Envelope / StreamConfig / StreamFormat tests
    ├── Server/                       BezelRoutes / WebRootSubdir tests
    ├── Chrome/                       DeviceChrome / DeviceProfile / LiveChromes /
    │                                 CoreGraphicsPDFRasterizer / integration tests
    ├── Accessibility/                AXNode / Accessibility /
    │                                 AXPTranslatorAccessibility tests
    ├── Orientation/                  DeviceOrientation tests
    ├── Logs/                         LogFilter / LogStream / Subprocess
    │                                 orchestration tests
    └── Camera/                       CameraFlags / CameraDevice / CameraFrame /
                                      SharedFrameLayout / BGRAConverter /
                                      CameraSession / CameraMessage /
                                      AVCameraCapture / SimctlSimulatorInjection /
                                      SharedMemoryFrameSink /
                                      VirtualCameraInstaller tests
```

## Testing

**TDD is non-negotiable** — every behaviour change to a Domain or
Infrastructure type lands in a failing `@Test` under `Tests/` first,
then the smallest implementation that turns it green, then refactor.
Read `CLAUDE.md`'s "TDD is non-negotiable" pre-implementation gate
before contributing — that's the project's primary rule and it
overrides "the change is small" / "I'll add the test after".

460+ tests using **Swift Testing** (`@Suite`, `@Test`, `#expect`),
not XCTest. Chicago-school state-based: every external boundary is
an `@Mockable` protocol (`Input`, `Screen`, `Accessibility`,
`LogStream`, `Chromes`, `DeviceHost`, `Subprocess`, `Orientation`,
`Cameras`, `CameraCapture`, `CameraFrameSink`, `SimulatorInjection`,
`VideoCapture`); tests substitute auto-generated `MockXxx` fakes
and assert on returned values rather than recorded calls.

Adapters that talk to private SimulatorKit / CoreSimulator /
AccessibilityPlatformTranslation symbols (`IndigoHIDInput`,
`AXPTranslatorAccessibility`, `SimDeviceLogStream`,
`SimulatorKitScreen`) take `any DeviceHost` rather than the concrete
`CoreSimulators` aggregate, so their error-path branches —
`simulatorNotBooted`, idempotent `stop`, host-deallocated, etc. —
are unit-tested via `MockDeviceHost` without needing a real booted
simulator. The successful private-API call path stays
integration-only — manually smoke-tested through the CLI and serve
UI against a booted iOS sim.

```bash
swift test                                              # all tests
swift test --filter Simulators                          # one suite
swift test --filter "GestureRegistry/parses tap"        # one test
```

The `MOCKING` compilation flag is set under `.debug` only, so release
builds (via `./build.sh`) carry no mock code.

## Why this works on iOS 26.4 when older tools don't

Three calling-convention changes in iOS 26 / Xcode 26 broke every
public simulator-control tool. Baguette navigates all three:

1. **`IndigoHIDMessageForMouseNSEvent` is now 9-argument.** `idb` /
   `AXe` use the old 5-arg signature; those messages route to a
   pointer-service target that silently drops or crashes
   `backboardd`. We use the **9-arg signature from Xcode 26's
   preview-kit**, which routes through digitizer target `0x32` — the
   target iOS 26 still honours.
2. **Streaming touches + edge gestures need a real `IOHIDEvent`.**
   The Xcode 26 SDK ships an `IndigoHIDMessageForMouseNSEvent` that
   either misroutes to the home gesture or silently drops. Baguette
   builds an `IOHIDEventCreateDigitizerEvent` parent +
   `IOHIDEventCreateDigitizerFingerEvent` child, runs it through
   `IndigoHIDMessageForTrackpadEventFromHIDEventRef`, then patches
   the byte slots the wrapper leaves uninitialised
   (`IndigoHIDTouchTarget` + `IndigoHIDEdge` bitmask). That's the
   recipe behind the home-indicator swipe, app-switcher drag, and
   Lock-Screen / Notification-Center pull-downs.
3. **Camera substitution requires a per-app dylib.** No SimulatorKit
   symbol fakes the camera, so the camera feature ships a small
   ObjC dylib (`VirtualCamera.dylib`) loaded into every
   sim-launched app via `DYLD_INSERT_LIBRARIES`. It hooks
   `AVCaptureVideoPreviewLayer.setSession:`,
   `AVCapturePhotoOutput`, and `UIImagePickerController`, then
   reads BGRA frames from a mmap'd buffer baguette fills with a Mac
   webcam. Per-hash install path dodges iOS 26's simulator dyld
   page-hash cache rejecting replaced dylibs.

The HID recipe is heavily commented in
`Sources/Baguette/Infrastructure/Input/IndigoHIDInput.swift`. The
camera pipeline lives in `Sources/Baguette/Infrastructure/Camera/`
and `VirtualCamera/`. The layered architecture is documented in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
