# Amendment — isolated published capabilities may change composition

**Ratified:** 2026-09-17  
**Owner ruling:** untrusted composition exemption

## Rule retained

The frozen-composition and capability-admission rules in the ratified architecture remain binding for the trusted, in-process tier. Trusted plugins may not add runtime registries or select authored executable code in-process. Model-visible trusted tools remain admitted through static composition.

## Narrow exemption

A capability may be added to or removed from model-visible composition between turns only when all of the following are true:

1. it was published to boring-hub as a versioned app or profile capability;
2. execution occurs in that capability's isolated cell, never in the host process;
3. the mounted tool is bound to the exact published version advertised to the model; and
4. the authenticated workspace and, for profiles, owner are checked at discovery and again at execution.

This exemption covers only published app/profile manifest tools executed remotely by boring-hub. It does not generalize to arbitrary dynamic plugins, local files, package loading, or trusted services.

## Required safeguards

- Every mounted dynamic tool carries immutable provenance: kind, app/profile address, version, and Git SHA. A tool without complete provenance is not mountable.
- Provenance is visible to the operator and logged on every call.
- Dispatch is version-bound; a stale advertised version is rejected rather than silently executing current code.
- Names are platform-namespaced so authored manifests cannot shadow trusted tools or another published address.
- Workspace membership and profile ownership are enforced independently of mutable workspace records and rechecked at execution.

## Still forbidden

- Trusted-tier runtime tool or plugin registries.
- In-process execution selected by user- or agent-authored manifests, files, package names, or other runtime data.
- Treating publication alone as admission for trusted host authority.
- Removing the ordinary capability-admission process from trusted plugins or services.

The runner boundary and terminology are described in boring-hub's `docs/PLATFORM.md`. If that repository and this amendment disagree about trusted-tier composition, this ratified amendment controls the boring-ui host.
