# #526 Office In-App Agent Surface

Plan pack for bringing the Office taskpane agent surface into production.

This pack is intentionally small. It has no `architecture/` directory; the binding design is in [VISION.md](VISION.md).

## Read Order

1. [VISION.md](VISION.md) — target shape, boundaries, and green gates.
2. [INDEX.md](INDEX.md) — package map, dependencies, and execution order.
3. [PR-PLAN.md](PR-PLAN.md) — PR slicing and landing repos.
4. The relevant `work/<package>/PLAN.md`.
5. That package's `TODO.md`, then `HANDOFF.md`.

## Work Packages

See [INDEX.md](INDEX.md) for package order, status, dependencies, and exits. INDEX.md is the only package-ordering authority.

## Evidence Base

- `/home/ubuntu/projects/ext-pi-for-excel-test/REPO-EVAL.md`
- `/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md`
- `/home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs`
- `/home/ubuntu/projects/wt-excel-spike/SPIKE-REPORT.md`
- Current boring-ui repo files cited in each package.
- Current `tmustier/pi-for-excel` source files cited in B-lane packages.
- Microsoft PowerPoint JavaScript API reference, consulted 2026-07-05: <https://learn.microsoft.com/en-us/javascript/api/powerpoint?view=powerpoint-js-preview>

## Evidence Gaps

These requested sources were not available in this worktree/session and must not be treated as verified evidence:

- `/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/93262060-380a-4287-a775-05376d9c3086/scratchpad/review/pi-for-ppt-feasibility.md`
- `/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/93262060-380a-4287-a775-05376d9c3086/scratchpad/review/pi-for-excel-extensibility.md`
- `/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/93262060-380a-4287-a775-05376d9c3086/scratchpad/review/pi-for-excel-hosts.md`
- GitHub issue #526 body. `gh issue view 526` could not reach GitHub from this environment.
