# A1-agent-authoring — Plan

Status: decision 21 accepted; deterministic compiler landed via #624;
workspace-backed validate/dev remains a v1 gate after P6-R.

## Purpose

Make the north star usable before the wider platform is complete: a developer
defines one agent in a directory, validates it, runs it locally, and hands the
same immutable definition to dedicated deployment.

## Depends on

- **BBA1-001 compiler:** landed via #624 after P6-D #623 under accepted decision
  21; preserve its deterministic, import-free boundary.
- **BBA1-002 local dev:** P6-R through the normal host resolver. P6-R already
  joins P6-D with the P1 boundary and narrow runtime/readiness branch.
- **BBA1-003 R0 migration:** BBA1-002 and proof that the shipped D1 path
  actually consumes duplicated M1 behavior configuration. Optional M1's mere
  existence does not create this gate.

## V1 convention

```txt
agents/<name>/
  agent.json
  instructions.md
```

`agent.json` contains only versioned behavior and requirement references. It
does not contain tenant roots, hostname, exposure, pricing, runtime image,
sandbox selection, secrets, or deployment policy.

`instructions.md` is the only agent-authored system-instruction asset in v1.
There is no `systemPromptFragmentRefs` list. Environment and workspace-plugin
prompt fragments stay bound to the resolved capability contribution that owns
them; authors do not copy those fragments into the agent bundle.

## Deliverables

1. Import-free directory compiler with stable validation errors.
2. A deployable `CompiledAgentBundle` containing the definition, immutable
   referenced assets, and a deterministic digest over both.
3. `boring-ui agent validate <dir>` and `boring-ui agent dev <dir>` using the
   same compiled bundle later consumed by D1. Local dev creates/selects an
   explicit local workspace, resolves an approved runtime, prefers bwrap when
   available, and permits direct host execution only under explicit
   trusted-local policy.
4. Conditional R0 hygiene: if the shipped D1 path actually consumes duplicated
   M1 behavior configuration, migrate that behavior to the canonical bundle
   before P8. Optional M1's mere existence does not gate P8.

## Exit

A fresh example directory validates and completes one scripted local
workspace-backed turn with zero platform-source edits. Editing behavior changes
the digest. The bundle is self-contained and materializes on a different host
without source-directory access. Deployment fields in `agent.json` fail
validation.
