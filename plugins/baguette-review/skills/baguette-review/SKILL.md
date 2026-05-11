---
name: baguette-review
description: Open Baguette CX Review Mode for an iOS simulator, wait for human annotations, and retrieve structured review JSON through the Baguette Review MCP.
---

# Baguette Review

Use this skill when a user asks to review an iOS app UI with Baguette CX Mode, open Baguette in the Codex in-app browser, or retrieve Baguette review annotations.

## Workflow

1. Ensure the target iOS app is running. In an iOS project, use XcodeBuildMCP or the project-local workflow; this plugin does not build or modify the app.
2. Call `baguette_status`. If Baguette is not reachable, or if it returns `incompatible: true`, call `baguette_start`.
3. Choose the target simulator. If the user did not specify one, prefer a booted `iPhone 17 Pro`; otherwise use the first booted simulator from `baguette_status`.
4. Call `baguette_review_url` with `udid` or `deviceName`. If `baguette_start` returned a non-default `baseUrl`, use that URL for review and polling calls.
5. Open the returned URL in the Codex in-app browser. This is the expected Run-button path for this plugin.
6. Ask the human to enter CX Mode and add comments to AX targets or manual rectangles.
7. Call `baguette_wait_for_review`.
8. Call `baguette_get_latest_review` and hand the returned payload to the project-local `baguette-review-apply` skill when present.

## Boundaries

- Treat Baguette as the review surface and annotation transport.
- If `/simulators/...` loads but the CX icon and version badge are missing, assume an upstream/Homebrew Baguette binary is running. Do not use that page for CX Review; start the fork build through `baguette_start`.
- Do not decide project-specific source mapping in this skill.
- Do not require clipboard JSON unless MCP retrieval fails; clipboard copy remains a fallback.
- Do not overwrite project-local skills. Use `baguette_project_skill_status`, `baguette_project_skill_diff`, and `baguette_scaffold_project_skill`.

## Project Skill

For first-time setup in a project, call `baguette_scaffold_project_skill` after confirming the project root. The generated `.codex/skills/baguette-review-apply/SKILL.md` belongs to that project and may be customized there.
