# Codex Policy

## GitHub Remote Boundary

- Treat `upstream` (`tddworks/baguette`) as read-only.
- Do not create pull requests, issues, comments, tags, releases, branches, or pushes against `upstream`.
- Do not run commands that write to `upstream`, including `git push upstream ...` or GitHub operations targeting `tddworks/baguette`.
- All writable GitHub operations for this fork must target `origin` (`ymt23/baguette`) only.
- If a task appears to require an upstream change, stop and report the required fork-side action instead of acting on upstream.
