# Project Integration

## Purpose

Define how iOS projects should use Baguette Codex Review Mode as part of a
local Codex-assisted UI/UX development workflow.

## Responsibility Split

- XcodeBuildMCP handles build, run, test, E2E, logs, and simulator automation.
- Baguette Codex Review Mode handles screenshot capture, accessibility overlay,
  element selection, UI/UX annotation, and local annotation transport.
- Baguette Review Plugin/MCP starts or reuses Baguette, opens the review URL,
  and retrieves saved annotation payloads.
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
    baguette-review-apply/
      SKILL.md
Scripts/
  sim-review.sh
  sim-design-context.sh
```

The `baguette-review-apply` skill can be scaffolded from the Baguette Review
Plugin template, then customized and versioned by the target iOS project. The
plugin does not overwrite an existing project-local skill.

## Basic Workflow

1. Build and run the app through XcodeBuildMCP.
2. Open the Baguette stream or review URL for the target Simulator.
3. Enable Codex Review Mode.
4. Select an overlay element, or draw a manual review area for content that is
   not exposed by accessibility.
5. Add GUI comments from the inline `+` popover or the review drawer.
6. Repeat selection and commenting for every part that belongs in the same
   review handoff.
7. Let the project-side agent retrieve annotations through Baguette MCP, or use
   `Copy all annotations` as a fallback.
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

Review Mode v1 syncs annotation JSON to the Baguette server and keeps clipboard
copy as a fallback. This is the stable handoff object for a project-side Codex
agent: Baguette identifies screen elements and captures review intent, while
the target iOS project decides source mapping and implementation.

The project-side agent should treat `annotations[]` as one review batch for a
single snapshot. Each entry represents one selected target, and each target can
contain multiple comments. Targets can be accessibility-derived `ax-node`
targets or user-drawn `manual-rect` targets for views, cells, images, or
spacing that the iOS accessibility tree does not expose.

Manual rectangles are editable as review targets only within the current
Review Mode session. Deleting a manual rectangle also removes comments attached
to that rectangle, because the target no longer exists in the copied handoff.

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

## Plugin, MCP, and Skill Versioning

Baguette, the Baguette Review Plugin, the MCP server, and the project skill
template are versioned in this repository and should ship in the same release
or tag.

The browser UI always displays the base and fork-extension versions as:

```text
Baguette 0.1.x · CX 0.1.x
```

`Baguette` is the upstream/original base version. `CX` is the fork-local CX
Review extension version shared by the plugin, MCP server, and project skill
template. Upstream syncs should update the base version without changing `CX`
unless CX Review behavior, APIs, payloads, or compatibility changed.

Recommended version lines:

```text
Baguette: 0.1.x
Plugin:  0.1.x
MCP:     0.1.x
Template:0.1.x
Annotation payload: 1
Review API: 1
```

The project-local skill records its template version in frontmatter:

```md
---
name: baguette-review-apply
baguetteReviewTemplateVersion: 0.1.2
annotationPayloadVersion: 1
---
```

When the shared plugin updates, project skills are not updated automatically.
Use `baguette_project_skill_status` to detect drift and
`baguette_project_skill_diff` to review template changes. Apply those changes
to the project-local skill only after human approval.

## MCP Workflow

1. In the target iOS project, run and verify the app with XcodeBuildMCP.
2. Invoke the `baguette-review` plugin/skill.
3. Use `baguette_status`; if needed, use `baguette_start`.
4. Use `baguette_review_url` and open the returned URL in the Codex browser.
5. Add CX Mode comments in Baguette.
6. Use `baguette_wait_for_review`.
7. Use `baguette_get_latest_review`.
8. Apply the payload with the project-local `baguette-review-apply` skill.

Future transports should treat the annotation payload as the boundary object.
CX Design Mode comments, file export, or issue-tracker registration can be
added as transport choices after their receiving contracts are known.

If `baguette_status` reports `incompatible: true`, a Baguette server is
reachable but does not expose the CX Review API. The common case is an
upstream/Homebrew binary already listening on the default port. In that state
the simulator page may still load, but the CX Review icon, version badge, and
`/review/status.json` endpoint are missing. Use `baguette_start` and the
returned `baseUrl`; it will prefer the fork build and move to the next open
port when the default port is occupied.

For deterministic startup outside this repository, set either:

```text
BAGUETTE_BIN=/path/to/Baguette
BAGUETTE_REVIEW_REPO=/path/to/baguette-cx-review
```

`BAGUETTE_BIN` wins when both are present. Without these values, the MCP tries
common local fork build paths before falling back to `baguette` on `PATH`.

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
