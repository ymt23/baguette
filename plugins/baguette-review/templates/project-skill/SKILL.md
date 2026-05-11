---
name: baguette-review-apply
baguetteReviewTemplateVersion: 0.1.1
annotationPayloadVersion: 1
description: Apply Baguette CX Review annotations to this iOS project by mapping targets to source, implementing fixes, and verifying with the project test workflow.
---

# Baguette Review Apply

Use this repo-local skill when Baguette CX Review annotations are available for this project.

## Inputs

Use one of these sources:

- Preferred: `baguette_get_latest_review` from the Baguette Review MCP.
- Fallback: pasted `Copy all annotations` JSON from Baguette CX Mode.

The payload contains:

- `snapshot`: device and screen metadata for the reviewed UI state.
- `annotations[]`: one entry per target.
- `annotations[].target`: AX target or `manual-rect` target metadata.
- `annotations[].comments[]`: one or more human review comments for that target.

## Apply Workflow

1. Read every annotation before editing.
2. Map targets to source using `axId`, `label`, `role`, `frame`, `treePath`, and manual rectangle context.
3. Prefer stable identifiers and existing project architecture over visual guesswork.
4. Implement only the requested UI/UX fixes.
5. Run the project-approved build/run/test workflow. For iOS simulator verification, prefer XcodeBuildMCP when available.
6. Report which annotations were addressed, which were ambiguous, and what verification was run.

## Mapping Rules

- `type: ax-node`: start from accessibility identifiers, labels, view/controller names, and UI tests.
- `type: manual-rect`: use frame, surrounding AX nodes, screenshot context, and source inspection.
- `source.confidence: unmapped`: do not assume Baguette knows the source file; this project agent must decide.
- Multiple comments under one target should be treated as separate review requirements unless they conflict.

## Boundaries

- Do not modify this skill automatically when the Baguette plugin updates.
- Use `baguette_project_skill_diff` to inspect template changes, then update this skill only after human approval.
- Do not clear Baguette annotations until the user confirms the review handoff is complete.
