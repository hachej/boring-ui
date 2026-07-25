# R4 corrective authoring proof

- Beads: `wt-391-forward-step1a-current-xn9.1.6.1` and `.1.6.2`
- Owner decision: one corrective follow-up; no consumers, compatibility window,
  or dedicated `0.2.0` boundary
- Branch: `fix/805-r4-declarative-authoring`
- Date: 2026-07-20

## Delivered contract

Authored directories now materialize only `schemaVersion`, `agentTypeId`,
`version`, optional safe `label`/`description`, and `instructions`.

Removed:

- `AuthoredAgentToolCatalog`;
- `MaterializeAgentDirectoryInput.toolCatalog`;
- materialized `tools` and `declaredToolRefs`;
- catalog-only errors and resolution paths;
- behavior-ref fields from the trusted `AgentDefinition` and validate success
  output.

Absent/empty legacy capability/tool/skill/MCP arrays remain parseable and are
stripped. Non-empty arrays fail with the redacted
`AUTHORED_AGENT_REFERENCE_UNSUPPORTED` migration error. Normal trusted tool
composition retains `AUTHORED_AGENT_TOOL_COLLISION`. No HTTP/product endpoint or
unrelated compiler/digest/deployment export changed.

## Security and behavior proof

- manifest read is capped inclusively at 64 KiB before decode;
- instruction read is capped inclusively at 256 KiB before decode;
- files are regular, contained, and opened with `O_NOFOLLOW`;
- file identity/version is checked before and after bounded reads;
- invalid UTF-8, empty instructions, unsafe metadata, path changes, and
  symlinks fail with stable field-specific errors;
- the materialized source is frozen and sibling executable modules are never
  discovered/imported;
- `agent validate` reports only identity, metadata, and instruction byte length;
- generic failures return redacted `INTERNAL_ERROR` in human and JSON modes.

## Exact commands and results

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/shared/__tests__/agent-definition.test.ts \
  src/shared/__tests__/agent-cli-error.test.ts \
  src/shared/__tests__/error-codes.test.ts \
  src/server/agentDefinition/__tests__/compileAgentDirectory.test.ts \
  src/server/agentDefinition/__tests__/materializeAgentDirectory.test.ts \
  src/server/agentDefinition/__tests__/materializeAgentDirectory.trustBoundary.test.ts \
  src/server/agentDefinition/__tests__/resolveAgentDeployment.test.ts
# PASS: 7 files, 135 tests, no type errors

pnpm --filter @hachej/boring-agent test
# PASS: 168 files passed, 3 skipped; 1,604 tests passed, 6 skipped

pnpm --filter @hachej/boring-ui-cli exec vitest run src/__tests__/cli.integration.test.ts
# PASS: 1 file, 36 tests

pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-ui-cli typecheck
# PASS

pnpm smoke:a1-declarative-pack
# PASS: fresh build:packages, tarball install in external fixture,
# packed Agent source/export checks, and real packed CLI success/rejection checks

pnpm check:golden-path
pnpm lint:invariants
pnpm check:generated-artifacts
pnpm check:agent-resources
pnpm audit:imports
# PASS

br lint <current Step-1A graph IDs> --json
br dep cycles
# PASS: zero findings; no dependency cycles

git diff --check
# PASS
```

`pnpm --filter @hachej/boring-ui-cli test` passed all authoring/CLI tests but its
unrelated browser hot-reload fixture
`runtimePluginBrowser.integration.test.ts` failed on an existing 401/reload
race. The focused 36-test CLI integration suite passed twice. The aggregate
`pnpm lint` wrapper was terminated by the local harness without output; each of
its three constituent commands passed separately as recorded above.

## Final reviews

Tier 2:

1. `openai-codex/gpt-5.6-sol`, xhigh, standards/API review — **CLEAN**.
2. `openai-codex/gpt-5.6-sol`, xhigh, combined thermo/spec/security review —
   **CLEAN**.

Tier 3 used the owner-approved Fable manual gate. A cheap scout first produced a
21 KiB self-contained packet for reviewed SHA `d1244aaab`; Fable received only
that packet through `claude --print --safe-mode --model fable --tools=Agent`.
Fable found no design-level defect but returned **BLOCKED (not REVISE)** because
its optional Sonnet lookup returned contradictory/self-reported fabricated
filesystem results.

The coordinator independently cleared every fact Fable left unresolved:

- `AUTHORED_AGENT_TOOL_COLLISION` remains in `ErrorCode`, `mergeTools.ts`, and
  its tests;
- removed catalog error literals have zero production Agent/CLI references;
- post-read ENOENT is converted to stable field-only `PATH_NOT_FOUND` /
  compiler-code output, and `finally` closes the handle;
- pack smoke builds before packing, installs file tarballs under a generated
  `/tmp` consumer, and invokes the installed CLI bin;
- the branch changes no HTTP/route file.

Main advanced during that verification. The conflict-free production/docs patch
was preserved exactly; the tracker JSONL conflict was resolved by retaining new
main Beads and applying only R4's four changed records. Per the owner cap, no
third Fable call was made.

## Rollback

Revert the corrective PR before I0 publication. Do not restore #816/#817 or
Seneca #16. Existing `0.1.90` remains the last already-published catalog-shaped
cohort; I0 owns the later coordinated package version and publication approval.
