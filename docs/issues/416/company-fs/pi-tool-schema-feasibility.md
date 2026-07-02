# PR1 Pi tool schema feasibility note

Bead: `boring-ui-v2-reorg-ko57`

## Current factory path

Current user-workspace file tools are built in `packages/agent/src/server/tools/filesystem/index.ts`:

```txt
buildFilesystemAgentTools(bundle)
  -> choose runtime filesystem strategy
  -> host strategy: boundFs(storageRoot, { runtimeRoot: cwd })
  -> createReadToolDefinition(cwd, { operations: ops.read })
  -> createWriteToolDefinition(cwd, { operations: ops.write })
  -> createEditToolDefinition(cwd, { operations: ops.edit })
  -> createFindToolDefinition(cwd, { operations: ops.find })
  -> createGrepToolDefinition(cwd, { operations: ops.grep })
  -> createLsToolDefinition(cwd, { operations: ops.ls })
  -> adaptPiTool(...)
```

Remote-workspace mode follows the same pattern in `packages/agent/src/server/tools/filesystem/remoteWorkspaceTools.ts`, except grep uses `remoteWorkspaceGrepTool()` because remote grep shells into the sandbox while preserving Pi grep schema parity.

The low-level user-workspace operations are in `packages/agent/src/server/tools/operations/bound.ts`. They already form the right seam: Pi factory schemas call Operations adapters, and adapters own path validation/containment.

## Feasible PR3 wiring strategy

Preferred strategy for PR3:

```txt
Pi factory output
  -> narrow boring-bash schema wrapper adds optional filesystem?: FilesystemId
  -> execution wrapper strips/defaults filesystem
  -> filesystem-aware operation resolver selects prepared binding
  -> existing Operations adapter shape executes read/write/edit/find/grep/ls
```

Rules:

- Omitted `filesystem` defaults to `user`.
- Explicit `filesystem: 'user'` must be behavior-identical to omission.
- Explicit `filesystem: 'company_context'` routes to the prepared binding for that runtime/session.
- Path strings never choose filesystem identity. Reject path spoofing such as `company_context:/x` or `/company_context/x`.
- Do not add duplicate tools such as `read_company_context`.
- Do not fork divergent file tool behavior. Keep Pi factory descriptions/rendering/result shapes unless PR3 has a targeted parity update.

## Schema wrapper approach

The existing `adaptPiTool()` receives a Pi tool with `parameters: unknown` and `execute(...)`. PR3 can wrap each Pi tool before or inside `adaptPiTool()`:

1. Clone/extend the Pi tool parameter schema with optional `filesystem`.
2. Wrap `execute` to parse/default `filesystem` and reject path spoofing.
3. Pass params without `filesystem` (or with resolver-selected operations) to the Pi factory execution path.

If TypeBox schema extension is awkward for upstream Pi definitions, use a tiny local wrapper that preserves the original schema fields byte-for-byte and adds only the optional `filesystem` property. Add parity tests comparing the `user` default path with current Pi factory output.

## Operation resolver approach

Introduce a filesystem-aware resolver that maps `(filesystem, access, projection)` to the existing operation interfaces:

```txt
resolveToolFilesystem(params.filesystem ?? 'user', runtimeBindingPlan)
  -> user readwrite binding => current boundFs/remoteWorkspace ops
  -> company_context readonly policy-filtered binding => readonly read/list/find/grep ops
  -> company_context readwrite management binding => management ops in PR4
```

Mutation tools must reject readonly bindings before invoking write/edit operations.

## Tests required for PR3

- Existing tool calls without `filesystem` still hit `user` and existing tests pass.
- Explicit `filesystem: 'user'` equals omission.
- Explicit `filesystem: 'company_context'` read/list/find/grep uses the prepared company binding.
- Mutation tools reject readonly company bindings.
- Path spoofing does not switch filesystem.
- Tool descriptions/prompt snippets mention `company_context` only when capability is advertised.
- Pi factory / Operations adapter parity tests cover current user behavior.

## Non-goals for PR3

- No provider/projection lifecycle implementation.
- No UI tree/viewer work.
- No readwrite management binding.
- No company-specific duplicate tools.
