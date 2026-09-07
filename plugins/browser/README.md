# Boring Browser (trusted internal plugin)

A default-off trusted workspace plugin backed by the fixed `trusted-service-v1` Host capability. The plugin never receives a Sandbox, RuntimeBundle, provider ID, image, service selector, executable, port, or upstream URL. It registers exactly `browser_observe` and `browser_act` when the app passes `enabled: true`; disabled composition contributes no routes, tools, skills, or assets.

## Authority boundary

Boring remains the only Agent/model/admission/audit authority. Browser-Use 0.13.8 supplies `BrowserSession` only; no Browser-Use Agent, model, cloud, MCP server, or generic catalog is instantiated. `BrowserHostCapability` retains the addressed Agent session's exact Environment generation and returns only closed operation and opaque same-origin view methods.

The runtime image uses a dedicated `boring-browser` UID and private container/network namespace. Its profile, X socket, VNC password, and Unix control socket are mode 0700/0600 and never mounted into the ordinary Agent namespace. Observer VNC is `-viewonly`; controller VNC accepts input; neither is passwordless. Browser-Use 0.13.8 requires loopback TCP CDP, so CDP is allowed only inside this private namespace, is never published/projected, and is unreachable from ordinary Agent bash. Hosted modes remain unsupported until they prove this exact isolation and image/protocol digest.

## Qualification

The Dockerfile pins its base by digest and verifies the exact Browser-Use wheel SHA-256 before installation. `qualification.json` pins the service protocol source digest; `qualify-image.sh` builds the image, records its local image ID, verifies identity/file/viewer isolation, proves an independently namespaced Agent cannot reach CDP or private bytes, and drives/observes one displayed Chromium through Browser-Use.

```sh
node plugins/browser/src/runtime/verify-provenance.mjs
plugins/browser/src/runtime/qualify-image.sh
pnpm --filter @hachej/boring-browser typecheck
pnpm --filter @hachej/boring-browser test
```

An image registry digest and hosted-provider conformance proof are operator gates. This repository makes no production-readiness claim without them.
