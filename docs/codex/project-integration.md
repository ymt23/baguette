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
5. Copy annotation JSON.
6. Apply the UI/UX change in the target source code.
7. Rebuild and relaunch the app.
8. Capture a new review snapshot.

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

```json
{
  "target": {
    "axId": "motion.row.0.subtitle",
    "role": "AXStaticText",
    "label": "Row description for scroll testing",
    "frame": {
      "x": 60,
      "y": 171,
      "width": 240,
      "height": 16
    }
  },
  "source": {
    "file": "Sources/Feature/Motion/MotionRow.swift",
    "symbol": "MotionRow",
    "confidence": "approximate"
  },
  "comment": {
    "type": "layout-adjustment",
    "note": "Reduce the vertical gap between title and subtitle by 2pt."
  }
}
```

## Risks

- Accessibility nodes may not include decorative elements.
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

