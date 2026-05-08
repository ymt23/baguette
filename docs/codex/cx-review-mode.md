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
- Generate annotation JSON from one or more commented elements.
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
3. Capture the current Simulator screenshot and accessibility tree through
   `GET /simulators/:udid/review-snapshot.json`.
4. Render the screenshot as a fixed review surface.
5. Render accessibility nodes as transparent DOM overlay elements.
6. Select a target element in the overlay, or draw a manual rectangle for
   content that is not exposed through accessibility.
7. Add comments either from the inline `+` popover beside the selected target
   or from the review drawer. Edit and delete existing comments in the drawer.
8. Repeat selection and commenting across multiple targets.
9. Let Review Mode sync annotations to the local Baguette server, or copy
   selected/all annotation data as a fallback for the project-side agent.
10. Turn off Review Mode to return to the live stream.

If comments or manual rectangles exist when Review Mode is turned off,
Baguette asks for confirmation before discarding them and resuming the stream.
The same confirmation is used when leaving focus mode for the sidebar view.
v1 review state is session-local in memory. The browser syncs it to the
Baguette server while Review Mode is active so a project-side agent can fetch
it through MCP. Confirmed discard deletes the server copy.

## Synthetic DOM

Review Mode creates synthetic DOM elements from accessibility nodes. These are
not native SwiftUI views and do not represent the full SwiftUI hierarchy. They
are browser-side annotation targets derived from OS accessibility data.

Each overlay element should expose stable metadata through `data-*` attributes:

```html
<div
  class="codex-review-node"
  role="button"
  tabindex="0"
  aria-roledescription="Baguette review target"
  aria-label="Review target, ax-node, AXStaticText, Item 0, 0,146 402x57"
  data-target-type="ax-node"
  data-target-id="motion.row.0|0.3.1"
  data-ax-id="motion.row.0"
  data-role="AXStaticText"
  data-label="Item 0, Row description for scroll testing, #0"
  data-frame="0,146 402x57"
></div>
```

Review Mode shows a small inline `+` control next to the selected overlay
target. It opens a compact comment popover for quick review notes without
moving attention to the drawer. The main drawer remains available for selected
target details, comment editing, selected-target comments, manual area drawing,
all comments, and copy actions. AX coverage is shown as a collapsed
`Diagnostics` section so it remains available without competing with the review
workflow.

The Diagnostics section shows the total AX node count, overlay target count,
and role counts for important roles such as `AXImage`, `AXCell`, `AXTable`,
`AXCollection`, and `AXGroup`. A zero count means the iOS accessibility tree
did not expose that view class or visual concept in the current snapshot.

## Data Model

Review Mode v1 uses a single HTTP snapshot response as the browser-side source
of truth. The screenshot is intentionally embedded as a data URL so the
snapshot can be copied, archived, or forwarded without requiring server-side
snapshot storage.

```http
GET /simulators/:udid/review-snapshot.json
```

```json
{
  "snapshotId": "2026-05-08T17-00-00",
  "createdAt": "2026-05-08T17-00-00",
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
    "mediaType": "image/jpeg",
    "dataUrl": "data:image/jpeg;base64,..."
  },
  "axTree": {
    "role": "AXApplication",
    "children": []
  },
  "tool": {
    "name": "baguette-codex-review-mode",
    "version": "1"
  }
}
```

The copied annotation JSON is the v1 handoff contract for project-side agents.
Review Mode can copy a selected target's annotations or all annotations from
the current snapshot. Multiple comments on the same target are grouped under
one `annotations[]` entry:

```json
{
  "snapshot": {
    "snapshotId": "2026-05-08T17-00-00",
    "createdAt": "2026-05-08T17-00-00",
    "device": {
      "name": "iPhone 17 Pro",
      "runtime": "iOS 26.2",
      "udid": "043CC6B3-890A-4CFB-BA18-FD5460271991"
    },
    "screen": {
      "width": 402,
      "height": 874
    }
  },
  "annotations": [
    {
      "target": {
        "type": "ax-node",
        "targetId": "motion.row.0|0.3.1",
        "axId": "motion.row.0",
        "role": "AXStaticText",
        "label": "Item 0, Row description for scroll testing, #0",
        "value": null,
        "frame": {
          "x": 0,
          "y": 146,
          "width": 402,
          "height": 57
        },
        "treePath": "0.3.1"
      },
      "comments": [
        {
          "id": "comment-abc123",
          "type": "design-comment",
          "note": "Reduce vertical padding in this row.",
          "createdAt": "2026-05-08T17:00:30.000Z",
          "updatedAt": "2026-05-08T17:00:30.000Z"
        }
      ]
    }
  ],
  "source": {
    "confidence": "unmapped"
  },
  "tool": {
    "name": "baguette-codex-review-mode",
    "version": "1"
  }
}
```

Manual rectangle targets use the same annotation envelope, but they are not
derived from the iOS accessibility tree:

```json
{
  "target": {
    "type": "manual-rect",
    "targetId": "manual-rect-mowxxxx",
    "axId": null,
    "role": "ManualRectangle",
    "label": "Manual rectangle",
    "value": null,
    "frame": {
      "x": 12,
      "y": 150,
      "width": 180,
      "height": 120
    },
    "treePath": null
  },
  "comments": []
}
```

The browser syncs the same annotation envelope to Baguette:

```http
PUT    /simulators/:udid/review-annotations.json
GET    /simulators/:udid/review-annotations.json
DELETE /simulators/:udid/review-annotations.json
GET    /review/status.json
```

The annotation store is in-memory and keyed by UDID. `PUT` accepts the same
payload as `Copy all annotations` and returns server metadata:

```json
{
  "ok": true,
  "reviewApiVersion": "1",
  "annotationPayloadVersion": "1",
  "storedAt": "2026-05-08T17:00:00.000Z",
  "updatedAt": "2026-05-08T17:00:30.000Z",
  "annotationCount": 2,
  "manualRectCount": 1,
  "payload": {}
}
```

MCP, clipboard, file export, and future CX-native comment surfaces should all
treat this payload as the same boundary object. The current MCP integration is
a thin wrapper over the Baguette server API; it does not perform project source
mapping or implementation.

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
- UIKit `UIView`, `UIImageView`, `UITableViewCell`, and `UICollectionViewCell`
  may not appear as separate AX nodes unless the app exposes them through
  accessibility metadata.
- Manual rectangles identify a screen region for review, not a source-level
  UIKit or SwiftUI object.
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
