# Pi Durable implementation references

The upstream [example directory](https://github.com/earendil-works/pi/tree/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples) is the starting point for runtime composition, not just illustrative reading. Julien specifically supplied the foreground/background subagent and coding-agent examples. Pin references rather than depending on moving `main` links.

Reviewed latest source: `0495646a8322ff99ce40ac2f9e15f1f49f56bb11`. Compared against initial audit `28eaccb8e87d075562593073282cc0774f2c2e3b`: no diff in durable/ai/codemode at the time of review. Published-package probes used Pi Durable 1.0.0; package and source compatibility beyond those runs is not certified.

## Map native patterns to Boring

| Example | Pattern to use | Boring boundary still required |
| --- | --- | --- |
| [22 foreground](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples/22-subagent-foreground.ts#L39-L77) | Child conversation owned by tool task; scan ownership to reuse child; stable submission request ID; `details` links child progress; task abort reaches child. | Narrow effective capabilities, bind scope/initiator/configuration, authorize child views and validate structured results; source-copying parent configuration is not permission. |
| [23 background](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples/23-subagent-background.ts#L132-L207) | Durable names→conversation document; background anchor ownership; checkpointed reporter; steer/followUp/stop/status; reporters/children survive restart. Fork starts without that registry. | Explicit detached-work/stop-all/budget policy; no inherited grants on fork; exact stop target/replay rules; parent reports are not host record publication. |
| [24 child tasks](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples/24-child-tasks.ts) | Commit creates child tasks and waiting checkpoint together; durable owned graph, wait/outcomes, restart and abort propagation. | Useful basis for producer+validation+delivery graph. Clinic independent A/B/C must not inherit example's fail-fast policy. Fake in-memory charges/refunds are not transactional external-effect evidence. |
| [26 coding agent](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples/26-coding-agent.ts) | Extension prompt sections, registry, environment factory selected from conversation cwd, runtime settings seam. | Node environment is host execution, not isolation. Stock file writes are blind. Dynamic getters are read-at-use, not pinned admission settings. Use only in explicit sandbox/staging profiles. |
| [29 per-conversation sandbox](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples/29-sandbox-per-conversation.ts) | Durable conversation document selects environment; atomic document initialization; fork resets environment assignment. | Example sandbox is a directory, not a confinement proof. Host supplies isolated environment and current authorized resource/network access. |
| [31 reload/restart](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples/31-reload-and-restart.ts) | Current calls finish with installed code; stored extension selections are names; restart requires reinstalling definitions. | Installed name is not frozen implementation code. Persist/check version compatibility for pending Boring operations; pin/migrate/refuse incompatible definitions rather than silently changing admitted behavior. |
| [19 JSON wire](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/test/examples/19-json.ts) | Snapshot then observable event batches or raw view operations; multiple storage backends. | This is JSON streaming, not structured-output validation. Compose authorized Boring snapshots/custom docs; audit remains separate. |

## Code mode reuse

Audited 1.0.0 supplies two public pieces, not an automatically installed Durable code-mode extension:

- [pi-codemode](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/codemode/README.md): public `CodemodeSandbox` runs the QuickJS/WASM engine with injected callbacks. The coding agent's built-in tool uses this standalone package; its README's `AgentTool` example targets pi-agent-core, not Pi Durable.
- [Pi Durable exports](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/src/index.ts): public `defineTool`/`defineExtension` and registry installation provide ordinary native tool registration. Durable's [CodingTools](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/src/tools/index.ts) supplies read/write/edit/bash only and installs nothing automatically.

Reuse the engine with normal host registration; do not bring in a pi-agent-core loop, copy the coding-agent implementation or add a Boring code-mode runtime. Inject already-admitted host callbacks rather than invoking raw tool handlers that bypass policy/evidence. [FILES-GIT-EXEC.md](FILES-GIT-EXEC.md#pi-code-mode) owns scope and limits. This seam is source-reviewed, not an executed Durable/code-mode integration or v4 qualification; A14 remains future evidence.

## Subagents in the redaction workload

One runtime can expose an optional subagent extension and host-submitted specialist tasks. The two are not mutually exclusive and do not require a separate agent service.

- An interactive foreground delegation belongs to the parent tool task. Show child progress through an authorized descriptor; cancel follows the owned subtree.
- A long-running background assistant uses the anchor/reporter pattern, deliberately beyond ordinary turn cancellation. Stop-current, stop-background and stop-all are distinct host-visible operations. Interrupted stop is not replayed onto newer work.
- A/B/C drafting belongs to a durable application work task, not an incidental main-chat turn. Children run independently; one failure does not discard siblings. Each validated result has a durable host-publication obligation.
- Use a checkpointed delivery task modeled on the reporter for application publication. Do **not** automatically feed every clinical result back into a main model just to save it; that adds model calls and can alter validated output. Conversational summarization is a separately admitted optional task.
- Request IDs deduplicate identical native submissions but do not establish Boring changed-body conflicts or external mutation receipts. Keep digest binding and operation reconciliation.
- Available tool/configuration copying is not a security grant. Child budgets, authority, credentials and maximum delegation depth remain host-controlled. Subagents cannot recursively widen capabilities.

## Seam qualification register

This finite investigation list extends existing acceptance/proof slots; it is not another evidence registry. Record exact package/configuration/test results when implementing. An unsupported strict guarantee is refused for that composition; softer behavior requires a separate explicit host choice, never an automatic downgrade. A small test cannot mark unrelated assertions in an entire root law complete.

| Required guarantee | Public candidate seam | Present evidence scope | Unresolved consequence |
| --- | --- | --- | --- |
| Actual model admission for claimed initial/retry/repair/compaction requests | Supported Pi/provider APIs and options; beforeTool is not a general model-request fence | Source/native pattern review, strict provider behavior unqualified | Refuse the strict variant or request a supported seam; never silently change hard budget to soft |
| Atomic producer plus delivery admission and external outcome recovery | Native commit/tasks/checkpoints, provider atomic operation and lookup | [Native document delivery crashes](../../test/contracts/delivery-crash.test.mjs) and [guard/version recovery](../../test/contracts/delivery-guards-crash.test.mjs) execute actual SIGKILL against local SQLite resources | Local atomic receipt recovery is tested; remote provider retention/revocation and cross-store delivery remain separately qualified |
| Pending question across two-service restart | Native task/document wait plus authenticated answer adapter | [Question crashes](../../test/contracts/question-crash.test.mjs) preserve pending/resolved/consumed native records; authenticated response adapter has in-process tests | Two-service deployment, network/authentication-provider recovery and delegation remain unqualified |
| Authorized remote submit/watch and version/skew handling | Public Pi client/protocol/server exports where fit | Bounded authorized retained-text projection and receiver plus in-process Fetch adapters are implemented; see [feature map](../implementation/FEATURES.md) | Live sockets, browser authentication, deployed submit/watch and full version-skew qualification remain; never serialize native Context or private raw state |
| Edge/non-Node persistence and owned background lifetime | Public Storage interface, selected host storage/ownership mechanisms | Public interface exists; edge runtime compatibility unqualified | Qualify Node first; no automatic app execution inside hub or assumed Durable Object guarantee |
| Definition and implementation compatibility after restart | Native registry/configuration plus host-pinned versioned definitions | Example 31 shows name-based reload; arbitrary code freezing not provided | Pin/migrate/refuse the affected reproducible workflow; retain ordinary native reload semantics |

S0 begins with one real native tool and one transactional document provider, exercising part of A01/A06/A33 before adding a headless editor in S1. Use actual kill points before/during commit and after the atomic commit/before acknowledgement. Do not invent a visible commit-before-receipt state in a provider claiming those are atomic. Preserve native APIs and current proof slots; reusable provider fixture factories/fault hooks belong to the existing test infrastructure.

## Executed probes

Six examples (22, 23, 24, 26, 29, 31) ran successfully against published 1.0.0 in an isolated `/tmp` installation, using faux models. Only source-relative imports were changed to package exports; model logic was unchanged. `OPENAI_API_KEY` and `CODEX_AUTH_FILE` were unset. Each had a 45-second outer deadline.

Observed: foreground child answer; background answer after Harness reopen; owned children/cancellation/restart; coding cwd switch; separate conversation directories; extension reload v1→v2 and reinstallation after restart. These establish the shown upstream patterns, not crash-safe clinic publication, process-kill equivalence, budget enforcement, sandbox confinement or Boring v4 implementation. See [BASELINE.md](../stress-tests/BASELINE.md).
