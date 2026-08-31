# Boring Browser (trusted internal plugin)

An **unwired, refusal-only local tracer package**, not a usable browser feature. No app statically composes it. A future Host integration would have to compose both front/server exports and inject authenticated scope resolution, existing selected-environment exec, exact effect admission, audit, and exactly-once environment-reference release. The package does not select a runtime or provider.

## Proposed runtime contract (not integrated)

`BORING_BROWSER_PLUGIN_ENABLED=1` or `{ enabled: true }` is rejected by the server factory until the missing Host security seams exist; setting it cannot enable a feature. The injected `BrowserExec` maps the controller's closed intents to the bundled `src/runtime/launcher.sh` using the existing environment-generation exec lifecycle. No caller supplies executable, argv, environment, port, endpoint, provider, or runtime identity. The launcher starts one ephemeral Xvfb/Chromium/x11vnc/noVNC set and Browser-Use CLI attaches to that same Chromium at its loopback CDP endpoint. Agent control uses view-only VNC; takeover/return rotates the x11vnc process and the server's monotonic epoch is authoritative.

## Browser-Use supply-chain review

Provenance metadata pins Browser-Use **0.13.8** from official tag/commit `eb4126921bea3373f91afc49fb4b59d6eda7fed6`. The PyPI universal wheel SHA-256, unmodified official skill SHA-256, bounded Host adaptation SHA-256, and vendored MIT license SHA-256 are in `browser-use.provenance.json`. The unmodified skill is retained for provenance; because it advertises raw Bash/eval/cookie/cloud surfaces forbidden here, Agent composition contributes only the reviewed bounded adaptation that permits the two native Boring tools. Sources reviewed: GitHub release API, official tagged `SKILL.md`/`LICENSE`, and PyPI release JSON. MIT is compatible with this repository; retain the vendored notice. `node src/runtime/verify-provenance.mjs` verifies only checked-in provenance files, not an installed wheel. A future Host-owned image must enforce the wheel hash during installation and pass a real same-Chromium compatibility smoke before composition. Browser-Use's Agent/model/cloud, raw MCP catalog, eval/cookie/CDP surfaces, and cloud credentials are not used.

## Honest local-tracer boundary

The fixed launcher is executable when the selected runtime already contains exact Host-approved builds of Python, Chromium, Xvfb, x11vnc, noVNC/websockify, and the pinned Browser-Use wheel. This repository currently has no generic selected-environment exec callback exposed to trusted server plugins and no approved runtime image lock containing those prerequisites, so app composition cannot yet wire a real launcher without widening core runtime seams. The package therefore exposes the narrow injected `BrowserExec` contract and tests it with fakes; it does **not** fall back to host-global execution. Hosted/live same-Chromium proof and rollout remain blocked until that seam/image, authenticated WSS preview, and enforceable egress policy exist.

Upload/download actions are absent until Host resource resolution and quarantine/publication contracts exist. The loopback CDP/VNC launcher is not structurally isolated from other processes in the same runtime and therefore must remain unwired; its epoch argument is not a security boundary. The launcher is tracer code, not deployment or production enablement.

## Checks

```sh
pnpm --filter @hachej/boring-browser typecheck
pnpm --filter @hachej/boring-browser test
pnpm --filter @hachej/boring-browser build
node plugins/browser/src/runtime/verify-provenance.mjs
```
