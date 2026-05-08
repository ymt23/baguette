# Codex Review Mode

## Purpose

Add a Codex-oriented UI/UX review mode to Baguette.

Instead of continuously inspecting a live stream, Review Mode captures the
current Simulator screen on demand, reads the accessibility tree, and builds a
synthetic DOM overlay that Codex can inspect and use as an annotation target.

## Goals

- Provide selectable DOM overlay elements in the Codex browser.
- Display screenshot, accessibility tree, and frame information in one
  coordinate space.
- Generate annotation JSON from the selected element.
- Let humans leave UI/UX comments against concrete screen elements.
- Leave room for future Swift source mapping and MCP integration.

## Non-Goals

- Fully reconstruct the SwiftUI view hierarchy.
- Become a Figma-equivalent visual editor.
- Solve live stream quality or latency at the stream layer.
- Replace build, run, test, or E2E responsibilities handled by XcodeBuildMCP.

## User Flow

1. Open the Simulator stream page.
2. Turn on Review Mode.
3. Capture the current Simulator screenshot.
4. Read the current accessibility tree with `describe-ui`.
5. Render the screenshot as a fixed review surface.
6. Render accessibility nodes as transparent DOM overlay elements.
7. Select a target element in the overlay.
8. Copy JSON or annotation data for the selected target.
9. Turn off Review Mode to return to the live stream.

## Synthetic DOM

Review Mode creates synthetic DOM elements from accessibility nodes. These are
not native SwiftUI views and do not represent the full SwiftUI hierarchy. They
are browser-side annotation targets derived from OS accessibility data.

Each overlay element should expose stable metadata through `data-*` attributes:

```html
<div
  class="codex-review-node"
  data-ax-id="motion.row.0"
  data-role="AXStaticText"
  data-label="Item 0, Row description for scroll testing, #0"
  data-frame="0,146 402x57"
></div>
```

## Data Model

```json
{
  "snapshotId": "2026-05-08T17-00-00",
  "device": {
    "name": "iPhone 17 Pro",
    "runtime": "iOS 26.2",
    "udid": "043CC6B3-890A-4CFB-BA18-FD5460271991"
  },
  "screen": {
    "width": 402,
    "height": 874
  },
  "screenshot": {
    "url": "/review/snapshots/2026-05-08T17-00-00.jpg"
  },
  "selectedNode": {
    "id": "motion.row.0",
    "role": "AXStaticText",
    "label": "Item 0, Row description for scroll testing, #0",
    "frame": {
      "x": 0,
      "y": 146,
      "width": 402,
      "height": 57
    }
  },
  "annotations": []
}
```

## Annotation Types

- `design-comment`: visual feedback or human design intent.
- `layout-adjustment`: spacing, alignment, sizing, or hierarchy adjustment.
- `accessibility-note`: accessibility label, role, order, or grouping issue.
- `technical-style`: request to apply a specific SwiftUI technique or style.
- `source-followup`: comment that requires source-level investigation.

## Technical-Style Notes

Technical-style annotations should be scoped to a selected element or component
and include implementation constraints when possible.

Example:

```json
{
  "type": "technical-style",
  "targetId": "motion.tabBar",
  "note": "Apply a Kavsoft-style animated SwiftUI tab treatment to this part.",
  "constraints": [
    "Keep the existing navigation structure",
    "Preserve accessibility identifiers",
    "Provide fallback behavior where needed"
  ]
}
```

## Limitations

- Purely decorative SwiftUI elements may not appear in the accessibility tree.
- Padding is not available as a direct value; it must be inferred from parent
  and child frames.
- Review snapshots must be refreshed after scrolling, navigation, or state
  changes.
- Source mapping can only be approximate unless the target project provides
  stable identifiers and metadata.

## Future Work

- Source mapping from `accessibilityIdentifier` to Swift files and symbols.
- SwiftUI modifier and design token extraction.
- MCP endpoints for snapshots, selected nodes, and annotations.
- Snapshot export for handoff and issue tracking.
- Optional project-local review configuration.

