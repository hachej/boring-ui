# Coding Invariants

Critical architectural invariants:

1. No `node:*` imports in `src/shared/**`.
2. No `Buffer` in `src/shared/**`; use `Uint8Array`.
3. Routes and tools receive `Workspace`, not root paths.
4. Path validation is the adapter's job.
5. Workspace and Sandbox swap as a paired `RuntimeModeAdapter`.
6. `UiBridge.postCommand` is the single UI dispatch source; chat
   `data-ui-command` parts are display-only.
7. Workspace base front/shared code has zero value imports from
   `@hachej/boring-agent`.
8. Every error has a stable code from the canonical enum.
9. Pi-tools migration stays locked: shell/file tools flow through pi factories
   plus Operations adapters.
