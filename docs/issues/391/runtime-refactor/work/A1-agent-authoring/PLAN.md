# A1-agent-authoring — Plan

Status: v1 gate.

## Purpose

Make the north star usable before the wider platform is complete: a developer
defines one agent in a directory, validates it, runs it locally, and hands the
same immutable definition to dedicated deployment.

## Depends on

- P1 safe `createAgent()` boundary.
- P6-D for the compiler/digest and P6-R for `agent dev` through the normal host
  resolver.

## V1 convention

```txt
agents/<name>/
  agent.json
  instructions.md
```

`agent.json` contains only versioned behavior and requirement references. It
does not contain tenant roots, hostname, exposure, pricing, runtime image,
sandbox selection, secrets, or deployment policy.

## Deliverables

1. Import-free directory compiler with stable validation errors.
2. A deployable `CompiledAgentBundle` containing the definition, immutable
   referenced assets, and a deterministic digest over both.
3. `boring-ui agent validate <dir>` and `boring-ui agent dev <dir>` using the
   same compiled bundle later consumed by D1.
4. R0 hygiene: when M1 exists on main, migrate its behavior config to the
   canonical bundle before P8. This gate is absent only when M1 is absent.

## Exit

A fresh example directory validates and completes one scripted local turn with
zero platform-source edits. Editing behavior changes the digest. The bundle is
self-contained and materializes on a different host without source-directory
access. Deployment fields in `agent.json` fail validation.
