# Boring UI for macOS

Private Electron Forge host for the existing `@hachej/boring-ui-cli` multi-workspace application. Electron owns a loopback Fastify server and displays the CLI SPA in a hardened `BrowserWindow`; it does not fork workspace or agent product logic.

## Architecture

- `src/main.ts` owns Electron/app lifecycle and starts `@hachej/boring-ui-cli/server` on an ephemeral `127.0.0.1` port.
- A random in-memory capability is required by Fastify and injected by Electron's session request layer only for the exact application origin. It is never put in a URL, renderer-readable value, environment variable, or log.
- The renderer has Node integration disabled, context isolation and sandboxing enabled, and no preload/IPC API. Permissions, downloads, external navigation, and new windows are denied.
- `asar` is intentionally disabled for the first release. CLI public assets, package-root discovery, default plugin packages, and Pi runtime plugins require ordinary filesystem paths. Revisit selective ASAR only with packaged plugin proof.
- User workspaces and auth/plugin state remain in `~/.boring-ui` and `~/.pi/agent`. Chromium metadata uses Electron's normal application data directory.

Trusted local Pi plugins remain trusted application code. The Electron renderer sandbox does not make those plugins untrusted-safe.

## Development and proof

From the repository root:

```bash
pnpm install
pnpm --filter boring-ui-macos-desktop build:full
pnpm --filter boring-ui-macos-desktop test
pnpm --filter boring-ui-macos-desktop typecheck
```

The mandatory Linux package-layout smoke builds an unsigned Forge package with a smoke-only entry, launches it under Xvfb with a temporary HOME, verifies the SPA and authenticated APIs, proves bundled default and global Pi plugin discovery, quits, and proves the loopback listener closed. The smoke entry is excluded from normal release packages:

```bash
pnpm --filter boring-ui-macos-desktop smoke:package
```

This Linux smoke does **not** prove macOS execution, signing, notarization, Gatekeeper acceptance, or DMG layout.

## macOS packages

Build each architecture separately on macOS:

```bash
pnpm --filter boring-ui-macos-desktop make:mac:arm64
pnpm --filter boring-ui-macos-desktop make:mac:x64
```

The packaging script uses `pnpm deploy` to create a self-contained hoisted staging directory before invoking Forge; packaging the workspace symlink tree directly is unsupported. Forge prints the retained staging/output path when it finishes. Set `BORING_DESKTOP_STAGE_ROOT` to choose its parent directory. Universal packaging is intentionally deferred until both architecture-specific artifacts pass the manual proof below.

## Signing and notarization

Use an owner-controlled **Developer ID Application** identity and App Store Connect API key. Do not commit credentials.

```bash
export BORING_MAC_SIGN_IDENTITY='Developer ID Application: Example Corp (TEAMID)'
export APPLE_API_KEY='/absolute/path/to/AuthKey_ABC123.p8'
export APPLE_API_KEY_ID='ABC123'
export APPLE_API_ISSUER='00000000-0000-0000-0000-000000000000'

pnpm --filter boring-ui-macos-desktop make:mac:arm64
```

All three `APPLE_API_*` variables must be supplied together. Forge signs and notarizes the `.app` before the makers run. The final DMG is a separate artifact: submit and staple it explicitly after `make` completes, then verify both artifacts:

```bash
APP='<printed-out-dir>/Boring UI-darwin-arm64/Boring UI.app'
DMG='<printed-out-dir>/make/Boring-UI.dmg'

codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=4 "$APP"
xcrun notarytool submit "$DMG" \
  --key "$APPLE_API_KEY" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"
```

Exact output directories can vary by Forge version; use the artifact paths printed by `electron-forge make`.

## Manual macOS release proof

Before any release:

1. Run both architecture-specific makes on matching macOS runners.
2. Launch each packaged `.app` with a temporary `HOME` and workspace registry.
3. Verify the workspace list loads and the initial available workspace opens.
4. Verify diagnostics include `ask-user`, `diagram`, `tasks`, and a temporary `~/.pi/agent/extensions` plugin.
5. Quit the app and prove its loopback listener is no longer reachable.
6. Run `codesign --verify --deep --strict`, `spctl --assess`, and `xcrun stapler validate` against the final artifacts.
7. Install from the DMG on a clean Apple Silicon and Intel account before publishing.

Publishing, auto-update feeds, Mac App Store sandboxing, Windows, and Linux installers are outside issue #989.
