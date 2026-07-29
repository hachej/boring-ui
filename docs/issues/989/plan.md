---
github: https://github.com/hachej/boring-ui/issues/989
issue: 989
state: ready-for-agent
updated: 2026-07-29
flag: not-needed
---

# gh-989 package Boring UI as a macOS desktop app

## Problem

The published `boring-ui` Node CLI already serves the complete multi-workspace product on macOS, but it requires terminal installation and process management. Users need a normal macOS application that owns the local server lifecycle and presents the existing SPA in a desktop window without forking product behavior.

## Solution

Add a private `apps/macos-desktop` Electron Forge host. It starts a new supported embedded-server API from `@hachej/boring-ui-cli` in-process on an ephemeral `127.0.0.1` port, authenticates every desktop request with an in-memory capability injected by Electron's session layer, and loads the existing CLI SPA in a hardened `BrowserWindow`.

The application owns single-instance behavior, startup failure reporting, window recreation, and idempotent server shutdown. Forge configuration supports separate macOS arm64 and x64 DMG/ZIP builds and optional environment-driven Developer ID signing/notarization. Publishing remains owner-controlled.

## Decisions

1. **Electron Forge, not Tauri or Node SEA.** Electron embeds the Node runtime required by the existing Fastify/agent stack. Tauri requires a separately compiled Node sidecar; Node SEA remains a poor fit for the CLI's ESM, dynamic imports, assets, and plugin discovery.
2. **Private app under `apps/`.** This is a product host, not a reusable package.
3. **In-process server through a narrow public CLI export.** Do not invoke the CLI parser, open an external browser, spawn a child CLI, or duplicate workspace-server composition.
4. **Ephemeral loopback endpoint.** Bind literal `127.0.0.1` on port `0` and derive the selected port after Fastify listens.
5. **Desktop capability required on every request.** Electron generates a random in-memory token. An optional authentication parameter is passed into the Fastify composition seam and installs `onRequest` immediately after `fastify()` creation, before any route or plugin registration. Electron installs `session.webRequest.onBeforeSendHeaders` before the first load for the exact `http://127.0.0.1:<port>/*` origin, merges the capability header into existing headers, and removes the listener during shutdown. Missing/wrong tokens are rejected across static, API, and runtime-plugin routes. The token is not placed in URLs, renderer-readable state, logs, or environment. It blocks unrelated local clients, but code executing in the trusted renderer origin can still invoke authenticated APIs because Electron injects the header.
6. **No preload or IPC.** The existing SPA is the renderer. `nodeIntegration` stays disabled; context isolation, renderer sandboxing, and web security stay enabled.
7. **Exact-origin policy.** Deny permissions, downloads, unexpected navigation, and new windows. External-link support is deferred rather than exposing an unsafe generic `openExternal` bridge.
8. **Preserve user state.** Continue using `~/.boring-ui`, `~/.pi/agent`, workspace `.pi`, and the existing Pi session conventions. Electron `userData` owns Chromium/Electron metadata only.
9. **Trusted plugins remain trusted code.** Renderer sandboxing does not turn local Pi plugins into untrusted/safe code; the desktop app preserves the CLI's current plugin trust model.
10. **Filesystem-first packaging.** The first release uses `asar: false`: CLI `import.meta.url` package-root discovery, `public/`, bundled default plugin packages, runtime plugin scanning, and subprocess-visible files remain real filesystem paths. Do not bundle the CLI server into the Electron main artifact. Revisit selective ASAR packaging only after packaged plugin/runtime proof.
11. **Supported package export.** Add `@hachej/boring-ui-cli/server` with built JavaScript and declarations and include the embedded entry in tsup. Preserve the bin and any existing package paths when adding an export map. Desktop build/package ordering requires the CLI full build.
12. **Separate architecture artifacts first.** Build arm64 and x64 independently. Universal packaging is deferred until architecture-specific artifacts are proven.
13. **No release from this issue.** The PR provides build configuration and documented signing/notarization commands, but does not publish, require Apple credentials, or claim Linux proves Gatekeeper/notarization.

## Flag / Abstraction

- Needed?: No runtime flag. The desktop host is a new opt-in application and does not alter normal CLI startup.
- Path: `@hachej/boring-ui-cli/server` exposes the owned embedded-server seam used by the desktop host.
- Rollback: Stop distributing the desktop app and remove the private host; the standalone CLI remains independently usable. The embedded API is additive.

## Test Seams

- Highest public seam: start the embedded CLI server, make authenticated and unauthenticated HTTP requests, then close it and prove the listener stops.
- Desktop seam: Electron-independent lifecycle coordinator and security-policy functions tested with injected app/window/session adapters.
- Packaging seam: an unsigned packaged-app smoke is mandatory. It launches the Forge package with a temporary HOME and verifies SPA load, authenticated API access, default plugin resolution, Pi-root plugin discovery, clean quit, and listener shutdown. Linux proves the package layout; macOS runtime/signing proof remains separate.
- Existing prior art: `packages/cli/src/__tests__/cli.integration.test.ts`, CLI workspaces-mode tests, and Fastify `onClose` runtime cleanup.
- Avoid testing: Electron/Chromium internals, Apple signing on Linux, or private implementation details of workspace/agent packages.

## Acceptance

- `apps/macos-desktop` exists as a private Electron Forge workspace and reuses the existing CLI SPA/server.
- A supported `@hachej/boring-ui-cli/server` entry starts workspaces mode on `127.0.0.1:0`, returns its actual origin/initial URL, and closes idempotently.
- Missing frontend assets and startup failures throw/report errors rather than terminating the embedding Electron process.
- Authentication is installed before route/plugin registration, and every embedded-server request requires the in-memory desktop capability; missing and incorrect capabilities fail for static root, representative API, and runtime-plugin routes.
- Electron injects the capability only for the exact application origin, merges rather than replaces request headers, removes the injector during shutdown, and does not expose the token as a renderer-readable value. Trusted renderer-origin code can still make authenticated requests by design.
- BrowserWindow uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`.
- Permissions, downloads, unexpected navigation, and new windows are denied.
- Single-instance, activate/recreate-window, startup error, and close-on-quit behavior are implemented and tested.
- Forge has explicit macOS arm64/x64 package/make commands, DMG and ZIP makers, an initial `asar: false` filesystem policy, and optional complete-credential signing/notarization configuration.
- Documentation states the macOS signing, notarization, stapling, and Gatekeeper commands and the Linux proof limitation.
- Existing CLI behavior and scoped quality gates remain green.

## Proof

- Exact command: `pnpm --filter @hachej/boring-ui-cli test`
- Exact command: `pnpm --filter boring-ui-macos-desktop test`
- Exact command: `pnpm --filter @hachej/boring-ui-cli typecheck && pnpm --filter boring-ui-macos-desktop typecheck`
- Exact command: `pnpm --filter @hachej/boring-ui-cli build:full && pnpm --filter boring-ui-macos-desktop build`
- Exact command: mandatory unsigned Forge packaged-app smoke defined by the desktop package. It verifies SPA load, authenticated API access, bundled default plugin resolution, temporary Pi-root plugin discovery, clean quit, and listener shutdown.
- Manual macOS release proof: on a macOS runner, build each architecture, launch the packaged app against a temporary HOME, verify bundled and Pi-root plugin diagnostics, then run `codesign --verify --deep --strict`, `spctl --assess`, notarization/stapling verification, quit, and confirm the loopback listener closes.
- Waiver: This Linux implementation environment cannot produce or verify an Apple-signed/notarized DMG. Residual risk remains until the documented macOS proof is executed with owner-controlled Developer ID credentials.

## Slices

### Slice: secure desktop boot-to-close spine

**Delivers:** Embedded authenticated CLI server seam; hardened Electron host; lifecycle/security/integration tests; Forge arm64/x64 DMG/ZIP configuration; packaging and macOS release documentation.

**Blocked by:** None for implementation. Apple Developer credentials and a macOS runner block signed/notarized artifact proof only.

**Proof:** Scoped CLI and desktop tests/typechecks/builds, authenticated HTTP integration, and unsigned packaged smoke where supported. Manual macOS proof is explicitly deferred.

**Review budget:** Inside. Target under 1,500 added production-code lines; dependency lockfile and tests/docs are excluded from the production-code budget.

## Out of Scope

- Mac App Store sandboxing.
- Auto-update feeds or publishing automation.
- Windows/Linux desktop installers.
- New renderer UI, preload APIs, or Electron IPC.
- Changing the plugin trust model.
- Universal macOS binary until separate arm64/x64 artifacts are proven.
- Publishing a release or storing Apple credentials.

## Open Questions

None blocking implementation. The initial `asar: false` policy removes ASAR path ambiguity; the mandatory packaged smoke must still prove pnpm dependency closure and filesystem-relative plugin/resource discovery before handoff.
