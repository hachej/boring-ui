# INDEX — Ordering Authority

This pack has eight work packages. Each package owns one `PLAN.md`, one executable `TODO.md`, and one `HANDOFF.md`.

## Package Map

| Package | Lane | Depends on | Status | Exit |
| --- | --- | --- | --- | --- |
| A1-external-token-auth | A | none | queued | boring-ui accepts workspace-scoped bearer tokens for approved `/api/v1` workspace routes. |
| A2-connector-packaging | A | A1 | queued | Connector lives in `integrations/pi-for-excel/` with CI-runnable tests and install docs. Passing spike exists. |
| A3-workbook-identity-e2e | A | A1, A2 | queued | Live Excel workbook resolves to SharePoint IDs, saves a ref, and posts an audit note. |
| B1-host-seam-fork | B | none | queued | `hachej/pi-for-office` has an Excel-preserving `DocumentHost` seam and PowerPoint host detection. |
| B2-powerpoint-mvp | B | B1, A2 reuse | queued | PowerPoint MVP tools run in the fork; list/read/note reuse the connector unchanged and PowerPoint ref saving is explicitly generalized. |
| C1-wrapper-shell-login-gate | C | A1 | queued | Wrapper soft fork exists with `src/wrapper/**` shell and a login gate that blocks runtime creation until Boring auth succeeds; baked demo bearer token deleted. |
| C2-model-gateway-policy | C | C1 + the gateway server bead in boring-ui | queued | Gateway-only mode enforces the Boring model policy at every selection path; BYO-key is optional and off by default. |
| C3-branding-packaging-release | C | C1 | queued | Boring-branded wrapper builds with production manifest/CSP; built assets contain no demo token/workspace id/tailnet host; release proof passes. |

## Dependency Graph

```text
Lane A: A1 -> A2 -> A3

Lane B: B1 -> B2

Lane C: A1 -> C1 -> {C2, C3}   (C2 also needs the gateway server bead in boring-ui)

Connector reuse: A2 -> B2

Wrapper tool pack reuse: A2 -> C1 (bundled builtin.boring first-party extension)

Future W-word: after B2 ships and usage validates the seam
```

Lane A and Lane B are independent except for connector reuse. B2 must verify that the A2 connector stays host-agnostic, but B1 can start before A1. Lane C (#551) depends on A1 for the external login/token contract and consumes the A2 tool pack; it never blocks Lane A or Lane B.

## Recommended Execution

Run A1, then A2 first.

That produces Excel value in days: an external Office surface can authenticate, list/read/write workspace files, and create cloud refs before the PowerPoint fork is ready.

Then run A3 for the full live workbook loop.

Run B1 in parallel only if a second agent can keep the fork minimally divergent from upstream. Run B2 only after B1's seam is merged in the fork.

## Dispatch Protocol

- One package per agent unless the owner explicitly assigns more.
- Use the package `HANDOFF.md` before touching files.
- Use branch names from the package handoff.
- Keep each TODO bead independently reviewable.
- Cite every behavior claim from a spike report or `file:line`.
- Do not silently use the missing `/tmp` review files or inaccessible GitHub issue body as evidence.

## Cross-Pack Green Gates

- No secrets, bearer tokens, cookies, OAuth artifacts, preview URLs, or absolute local paths in cloud refs, tool results, logs, fixtures, or implementation docs. Plan-pack evidence citations may use absolute local paths only when the local file is the evidence source.
- Reuse boring-sharepoint redaction and validation rules for Office refs.
- No Arcade SDK in boring-ui.
- The connector stays one reviewable `.mjs` file.
- The taskpane and connector are self-hosted for company use.
- The fork keeps upstream mergeable: new hosts in new dirs, shared-file edits minimized, upstream remote retained.
- A and B lanes do not block each other except the explicit `A2 -> B2` connector reuse verification.
- **Amendment (2026-07-06, Lane C):** the wrapper `dist/` contains no demo token, workspace id, or tailnet host.
- **Amendment (2026-07-06, Lane C):** wrapper divergences from upstream are documented in `docs/upstream-divergences.md`.
- **Amendment (2026-07-06, Lane C):** upstream drift for `src/taskpane/init.ts`, `src/compat/model-selector-patch.ts`, and `src/prompt/system-prompt.ts` is tracked in every C-lane PR description.
