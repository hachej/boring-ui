# Can a swappable agent loop defeat approval or elide records?

Trace against `main`, 2026-08-14. This resolves R-33-15's Refutation section.
Method: static trace of the harness contract, the tool path, and every writer to
the durable log. No spike was needed — see "Why no spike" at the end.

## Finding 0 — the loop is ALREADY a swappable seam

Before asking whether it *may* be pluggable: it already is.

```
shared/harness.ts:28              AgentHarnessFactory = (input) => AgentHarness
server/agent-host/types.ts:379    readonly harnessFactory?: AgentHarnessFactory
server/createAgent.ts:72          config.harnessFactory ?? createPiCodingAgentHarness
```

Threaded end to end by every host:
`core/createCoreWorkspaceAgentServer.ts:203,1588` ·
`workspace/createWorkspaceAgentServer.ts:172,1694` ·
`agent/createStandaloneAgentHostApp.ts:48,207` · `agent/bin/boring-agent.ts:138`
· two smoke scripts.

So "D25–D29 forbid a pluggable loop" was wrong twice over: the decisions do not
forbid it, **and we shipped it.** `buildAgentComposition.ts:249-266` treats the
default pi harness as one implementation behind the seam.

## Finding 1 — there is no approval gate to defeat

The Refutation asked whether a malicious loop could suppress an approval prompt.
It cannot, because **no server-side approval mechanism exists.**

```
git grep -ni "approval" -- packages/*/src ':!*__tests__*' | grep -v "/front/"
→ (no output)
```

Also empty for `requestApproval`, `approvalRequired`, `permissionRequest`,
`canUseTool`, `PermissionMode`, `elicit`, `hitl`, `requireConfirmation`,
`pendingApproval`, `denyTool`, `allowTool`.

The only hits are front-end render states — `Tool.tsx:13-14`
(`'approval-requested'`, `'approval-responded'`), `renderers.tsx:55`,
`tool-call-group-state.ts:1` (`'approval-needed'`). **UI states with no server
producer.** Either vestigial or awaiting a gate that was never built.

Our actual security model is not approval-based. It is **admission and
attenuation**: `runtime/readonlyFilesystemPolicy.ts`,
`runtime/filesystemBindings.ts`, `boring-sandbox/providers/runsc/fleetAdmission.ts`
— matching D28's *"governance plugins compile authorized invocation context into
attenuated Environment admission; Agents receive operations/capabilities, not
policy sources."*

Consequence: the refutation as originally posed is void, and a **separate**
finding falls out — the front ships approval affordances the server cannot
honour. Worth its own issue.

## Finding 2 — a loop cannot widen capability (at the trusted tier)

`AgentHarnessFactoryInput` (`shared/harness.ts:7-26`) hands the harness:

| field | note |
| --- | --- |
| `tools: AgentTool[]` | **pre-built, pre-attenuated, handed in** |
| `cwd`, `runtimeCwd` | strings |
| `systemPromptAppend`, `systemPromptDynamic` | prompt contribution |
| `sessionNamespace/Root/Dir` | storage location |
| `telemetry?` | *"best-effort; harnesses may ignore it"* |

The harness **has no tool-minting facility**. Tools are composed above it
(`buildAgentComposition.ts:181`) and passed down. It can only spend what it was
given. Capability attenuation happens above the loop, so the loop is not an
authority over capability — **R-33-15's classification holds.**

**Crucial caveat.** The harness runs **in-process** in the Node host. A harness
is ordinary host code and can call `node:fs` directly regardless of its tool
list. So Finding 2 holds *only for host-trusted implementations*. An untrusted or
tenant-authored harness has full host authority trivially — not by widening
agent capability, but by bypassing the agent abstraction entirely.

This is exactly D31's scope (host-trusted, deployment-static) and exactly why the
tenant-authored tier needs its own decision. It also re-indicts
`runtimeBackendRegistry.ts:228,241,243`, which imports *external* plugin code
into this same unsandboxed host process.

## Finding 3 — a loop CAN elide records. The refutation fires here.

**There is exactly one writer to the durable log in the entire repo:**

```
pi-chat/harnessPiChatService.ts:758
  await this.eventStore?.appendAgentEvent(sessionId, enriched, {
    idempotencyKey: String(enriched.seq), streamPath: channel.streamPath })
```

`git grep` for `appendAgentEvent|appendEventOnce|appendEvent(` across `packages`
returns that line and the interface declaration. Nothing else writes.

Three properties make elision undetectable:

1. **Single writer, harness-fed.** The `events` it iterates come from the
   harness's own session subscription. No event emitted ⇒ no record written.
   There is no independent observation of tool execution to reconcile against.
2. **The store is optional** — `this.eventStore?.`. It is flag-gated behind
   `BORING_CHAT_DURABLE_STREAM`, so the default deployment writes **no durable
   log at all**.
3. **The request ledger does not cover it.** `requestLedger.ts` keys on
   `operation` ∈ {`session.create`, `agent.reload`, session ops} with a
   `requestId` — it records **gateway operations, not tool executions**. It
   cannot detect a missing tool call.

And `AgentHarness.sessions: SessionStore` (`shared/harness.ts:69`) — the harness
**owns session storage outright**. It is the record author, not a reporter to an
independent recorder.

**Verdict: a swappable loop is an authority over the record, though not over
capability.**

## What this changes

R-33-15's test survives, with a precondition:

> A loop may be a mechanism **only once the host owns the log.**
> Until then it is authority over the record and D31 must not cover it.

The fix is already specified and already proven: **R-33-01** (host owns session
state, Flue's pattern), demonstrated in `~/projects/spike-pi-storage` — two real
turns in separate PIDs from one host-owned JSONL stream on pinned
`pi-agent-core@0.80.7`. That spike, run for a different reason, is the enabling
condition for loop pluggability.

So the dependency is: **R-33-01 → R-33-15/D31 → R-33-14.** D31 cannot be signed
off before R-33-01 lands, or it legalizes a seam that can rewrite history.

## Why no spike

The claim is an **absence of cross-check**, and absence is established by
enumeration, not demonstration: one writer, fed solely by harness output, an
optional store, and a ledger scoped to gateway operations. A spike would show a
custom `harnessFactory` dropping an event — which the trace already entails and
which no observer in the system contradicts.

Where a spike *would* be decisive, and is not yet run: whether pi's own JSONL
transcript retains a tool call that a wrapping harness omits from the event
stream. If it does, pi's transcript is a partial independent record and elision
is detectable after the fact. That is the one open question here, and it is
narrow enough to settle in an afternoon against `spike-pi-storage`.
