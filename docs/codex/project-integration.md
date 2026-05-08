# Project Integration

## Purpose

Define how iOS projects should use Baguette Codex Review Mode as part of a
local Codex-assisted UI/UX development workflow.

## Responsibility Split

- XcodeBuildMCP handles build, run, test, E2E, logs, and simulator automation.
- Baguette Codex Review Mode handles screenshot capture, accessibility overlay,
  element selection, and UI/UX annotation.
- Project-local scripts provide stable entry points for app launch, simulator
  selection, and review snapshot capture.
- Source mapping remains project-local because each app has different module,
  naming, and accessibility identifier conventions.

## Requirements

- Xcode 26 or later.
- A local build of this Baguette fork, or an installed binary from this fork.
- A booted target Simulator.
- The target app launched through XcodeBuildMCP or a project-local workflow.
- Stable accessibility identifiers for important review targets.

## Recommended Project Files

```text
.codex/
  policies/
    CODEX_POLICY.md
  skills/
    simulator-design-review/
      SKILL.md
Scripts/
  sim-review.sh
  sim-design-context.sh
```

These files belong in the target iOS project, not in Baguette itself.

## Basic Workflow

1. Build and run the app through XcodeBuildMCP.
2. Open the Baguette stream or review URL for the target Simulator.
3. Enable Codex Review Mode.
4. Select an overlay element.
5. Add GUI comments for the selected element.
6. Repeat selection and commenting for every part that belongs in the same
   review handoff.
7. Copy all annotation JSON.
8. Apply the UI/UX changes in the target source code.
9. Rebuild and relaunch the app.
10. Capture a new review snapshot.

## Accessibility Identifier Guidance

Important UI review targets should have stable identifiers. Prefer meaningful
containers and key text or control elements.

Example:

```swift
HStack {
    Circle()
        .accessibilityIdentifier("motion.row.0.colorDot")

    VStack(alignment: .leading) {
        Text("Item 0")
            .accessibilityIdentifier("motion.row.0.title")

        Text("Row description for scroll testing")
            .accessibilityIdentifier("motion.row.0.subtitle")
    }

    Text("#0")
        .accessibilityIdentifier("motion.row.0.index")
}
.accessibilityElement(children: .contain)
.accessibilityIdentifier("motion.row.0")
```

Do not fragment VoiceOver elements only for tooling. If detailed review
metadata would harm accessibility behavior, prefer a project-local mapping file
or debug-only metadata.

## Source Mapping Strategy

Initial source mapping can be approximate:

1. Scan Swift source for `accessibilityIdentifier` literals.
2. Map identifiers to file paths and nearby symbols.
3. Attach the mapping to Review Mode annotations.
4. Treat the mapping as advisory unless verified by the agent.

Generated source maps should usually remain local cache files unless the target
project explicitly chooses to track them.

## Annotation Payload

Review Mode v1 copies annotation JSON to the clipboard. This is the stable
handoff object for a project-side Codex agent: Baguette identifies screen
elements and captures review intent, while the target iOS project decides
source mapping and implementation.

The project-side agent should treat `annotations[]` as one review batch for a
single snapshot. Each entry represents one selected target, and each target can
contain multiple comments. Targets can be accessibility-derived `ax-node`
targets or user-drawn `manual-rect` targets for views, cells, images, or
spacing that the iOS accessibility tree does not expose.

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
        "targetId": "motion.row.0.subtitle|0.4.2",
        "axId": "motion.row.0.subtitle",
        "role": "AXStaticText",
        "label": "Row description for scroll testing",
        "value": null,
        "frame": {
          "x": 60,
          "y": 171,
          "width": 240,
          "height": 16
        },
        "treePath": "0.4.2"
      },
      "comments": [
        {
          "id": "comment-abc123",
          "type": "design-comment",
          "note": "Reduce the vertical gap between title and subtitle by 2pt.",
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

Manual rectangle targets are intentionally approximate and should be mapped by
nearby visual context, frames, and project source inspection:

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
  "comments": [
    {
      "id": "comment-abc123",
      "type": "design-comment",
      "note": "Adjust the thumbnail crop in this cell.",
      "createdAt": "2026-05-08T17:00:30.000Z",
      "updatedAt": "2026-05-08T17:00:30.000Z"
    }
  ]
}
```

Future transports should treat this payload as the boundary object. MCP sending,
CX Design Mode comments, file export, or issue-tracker registration can be
added as transport choices after their receiving contracts are known.

## Risks

- Accessibility nodes may not include decorative elements.
- UIKit views, cells, and images may not be exposed as separate AX nodes unless
  the target app supplies accessibility metadata.
- Manual rectangles are review-region hints; they are not source mappings.
- Frame data supports layout review, but not exact SwiftUI padding values.
- Snapshot data becomes stale after scrolling or navigation.
- Source mapping can point to a nearby file or symbol rather than the exact
  modifier.
- Multiple simulators or windows require explicit target selection.

## Adoption Plan

1. Start with screenshot plus accessibility overlay.
2. Add selected-node annotation JSON.
3. Add project-local source mapping.
4. Add MCP endpoints only after the snapshot data model stabilizes.
5. Add project-local Codex skills once repeated review steps become stable.
