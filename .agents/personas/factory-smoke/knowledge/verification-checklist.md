# Factory smoke verification checklist

This knowledge file exists so the smoke persona also exercises the optional
`knowledge/` folder of the agent-package convention. Keep it tiny.

A factory smoke run verifies, in order:

1. **Discovery** — the package under `.agents/personas/factory-smoke/` is
   projected by plugin scan with `preflight.ok = true`.
2. **Compilation** — `materializeAgentDirectory` reads `package.json`'s
   `boring.agent` block plus `instructions.md`, computes a
   `sha256:` definition digest, and collects this `knowledge/` directory.
3. **Composition** — when seated in `.agents/factory/fleet.yaml`
   (`skills: []`, matching this package's empty `pi.skills`), the seat
   composes through `loadConfiguredAgentFleet` with no diagnostics.

If any step fails, the defect is in the fleet loader or the package
convention — never in downstream agents.
