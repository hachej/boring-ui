# Project Think and the Cloudflare agent execution stack
Research date: 2026-08-10. Status note: all discussed APIs are experimental, preview, beta, or recently shipped. Primary source set:
- Project Think: https://blog.cloudflare.com/project-think/
- Think docs: https://developers.cloudflare.com/agents/harnesses/think/
- Code Mode overview: https://developers.cloudflare.com/agents/tools/codemode/
- Code Mode durable runtime: https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/
- Code Mode mechanism: https://developers.cloudflare.com/agents/tools/codemode/how-it-works/
- Code Mode API: https://developers.cloudflare.com/agents/tools/codemode/api-reference/
- Fibers: https://developers.cloudflare.com/agents/runtime/execution/durable-execution/
- Agents source: https://github.com/cloudflare/agents
- Agents raw implementation: https://raw.githubusercontent.com/cloudflare/agents/main/packages/agents/src/index.ts
- Dynamic Workflows post: https://blog.cloudflare.com/dynamic-workflows/
- Dynamic Workflows source: https://github.com/cloudflare/dynamic-workflows
- Dynamic Workers post: https://blog.cloudflare.com/dynamic-workers/
- Code Mode post: https://blog.cloudflare.com/code-mode/
- `@cloudflare/think`: https://www.npmjs.com/package/@cloudflare/think
- `@cloudflare/codemode`: https://www.npmjs.com/package/@cloudflare/codemode
- `@cloudflare/shell`: https://www.npmjs.com/package/@cloudflare/shell
- historical workspace announcement: https://blog.cloudflare.com/agents-platform-flue-sdk/
- workspace repository redirect/current Computer repo: https://github.com/cloudflare/workspace
- Computer README: https://github.com/cloudflare/computer
- Computer sync protocol: https://github.com/cloudflare/computer/blob/main/docs/02_sync_protocol.md
- Computer package guide: https://github.com/cloudflare/computer/blob/main/docs/README.md
## Executive finding
The novel approval mechanism is real. It belongs to the durable runtime in `@cloudflare/codemode`. Think is the first-party harness that can expose/use Code Mode. The mechanism is not ordinary chat-loop continuation. It is source-code continuation by whole-program re-execution against a durable call log. The shortest correct model is:

```text
pass 1
  run generated source from line 1
  execute call 0; persist args + result
  execute call 1; persist args + result
  reach approval-gated call 2
  persist call 2 as pending
  abort the disposable sandbox pass
human approves execution E
pass 2
  run the identical source from line 1 under execution E
  call 0: verify identity/args; return persisted result
  call 1: verify identity/args; return persisted result
  call 2: consume approval; execute exactly now; persist result
  continue into call 3, branches, loops, and return
```
The durable object is not the suspended JavaScript VM. The durable object stores enough history to re-drive the program. The isolate is disposable. The continuation is reconstructed, not resumed. Source: https://developers.cloudflare.com/agents/tools/codemode/how-it-works/
## 1. Where the protocol sits
The stack has three distinct pieces.

```text
Think / application
  owns chat, messages, policy, UI, model loop
       |
       v
@cloudflare/codemode durable runtime
  owns execution id, source, log, approval, replay, rollback
       |
       v
DynamicWorkerExecutor
  owns one isolated execution pass; no durable state
       |
       v
connectors
  own host capabilities and actual side effects
```
The executor runs code once and stores nothing. The connectors provide callable capabilities and store no replay cursor. The durable runtime mediates every connector call. It makes the execute/replay/pause decision. It persists the log in a Durable Object facet's SQLite. Source: https://developers.cloudflare.com/agents/tools/codemode/how-it-works/
Think itself remains an agent harness. It owns the agentic loop, sessions, streaming, client tools, workspaces, and recovery. Its Code Mode helper is `createExecuteTool()`. The package dependency graph explicitly includes `@cloudflare/codemode`. Source: https://www.npmjs.com/package/@cloudflare/think
Do not conflate three different approvals:
- Think/AI SDK direct-tool approvals.
- Think client-tool approvals over `CF_AGENT_TOOL_APPROVAL`.
- Code Mode durable connector approvals using abort-record-replay. The third is the mechanism studied here.
## 2. The model-facing Code Mode contract
The model normally receives one outer tool.

```ts
type CodeModeInput = {
  code: string;
};
type CodeModeOutput =
  | {
      status: "completed";
      executionId: string;
      result: unknown;
      logs?: string[];
    }
  | {
      status: "paused";
      executionId: string;
      pending: PendingAction[];
    }
  | {
      status: "error";
      executionId: string;
      error: string;
      logs?: string[];
    };
```
The sandbox receives connector namespaces plus `codemode`.

```ts
declare const codemode: {
  search(query: string): Promise<SearchOutput>;
  describe(target: string): Promise<DescribeOutput>;
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  run(name: string, input?: unknown): Promise<unknown>;
};
```

`search()` and `describe()` implement progressive discovery. `step()` records sandbox-local nondeterminism. `run()` invokes a saved snippet. Connector methods are ordinary-looking async methods:

```ts
const pulls = await github.list_pull_requests({
  owner: "cloudflare",
  repo: "agents",
  state: "open",
});
```
But the method call crosses Workers RPC into the host runtime. The host decides whether to replay, execute, or pause. Source: https://developers.cloudflare.com/agents/tools/codemode/api-reference/
## 3. How generated code is aborted mid-execution
The generated code runs inside a fresh Dynamic Worker. `DynamicWorkerExecutor` is configured with a Worker Loader binding. The default timeout is 60,000 ms. The default `globalOutbound` is `null`. Therefore ordinary external `fetch()` and `connect()` are blocked by default. The sandbox calls connectors through an RPC dispatcher. At an approval-required connector method:
1. The runtime allocates the next sequence number.
2. It persists connector, method, args, and approval requirement.
3. It marks the entry `pending`.
4. It returns/throws an internal pause signal through the RPC bridge.
5. The executor terminates the current sandbox pass.
6. The runtime converts that termination into `{status:"paused"}`. Public docs describe this as “records the action as pending and aborts the current pass.”
The gated method's `execute()` has not run. It receives no provisional/simulated result. The generated program cannot keep executing past the awaited call. The entire Dynamic Worker pass is disposable after abort. Source: https://developers.cloudflare.com/agents/tools/codemode/how-it-works/

`PendingAction` contains:

```ts
type PendingAction = {
  executionId: string;
  seq: number;
  connector: string;
  method: string;
  args: unknown;
};
```
That is the approval UI's minimum review object. There is no serialized JS stack. There is no captured closure continuation. There is no suspended isolate. The “continuation” is achieved by replaying source from the beginning.
### Implementation detail: abort carrier
The public docs and exported `.d.ts` describe pass abortion semantically. They do not promise the private exception/RPC-envelope class used to unwind the pass. UNVERIFIED: exact internal thrown value and its wire serialization are not public API. Depending on that class would be unsafe. The public boundary is the paused `ProxyToolOutput`.
## 4. Exactly what is recorded
The durable execution record is:

```ts
type ExecutionStatus =
  | "running"
  | "paused"
  | "completed"
  | "error"
  | "rejected"
  | "rolled_back";
type ExecutionState = {
  id: string;
  code: string;
  status: ExecutionStatus;
  log: ToolLogEntry[];
  result?: unknown;
  error?: string;
  logs?: string[];
  connectors?: string[];
  createdAt: number;
  updatedAt: number;
};
```
Each call/step entry is:

```ts
type ToolLogEntry = {
  seq: number;
  connector: string;
  method: string;
  args: unknown;
  result?: unknown;
  requiresApproval: boolean;
  ephemeral?: boolean;
  state:
    | "executing"
    | "applied"
    | "pending"
    | "reverted"
    | "error";
};
```
Source: https://developers.cloudflare.com/agents/tools/codemode/api-reference/
The execution stores the original source code. It stores the execution ID. It stores the configured connector namespace list. It stores timestamps and terminal result/error/logs. Every connector call gets a monotonically increasing sequence number. Every `codemode.step()` also gets a sequence number. For normal `replay: "log"` connector calls, it stores arguments and result. For `replay: "reexecute"`, it stores identity/arguments but not result. Such log entries are `ephemeral: true`. For pending approval, it stores identity/arguments and `pending` state. Before actual invocation, it marks a call `executing`. After the result is durably recorded, it marks it `applied`. This ordering creates an important ambiguity window.

```text
durable state = executing
external side effect may or may not have happened
result not yet durably recorded
```
If the host dies in that window, Code Mode cannot prove whether the side effect happened. It does not claim distributed exactly-once side effects. Connector actions still need idempotency keys or reconciliation. The constant `MAX_DURABLE_VALUE_BYTES` is `1_000_000`. It is a serialized JavaScript string-length limit for one Code Mode durable value. Source: https://developers.cloudflare.com/agents/tools/codemode/api-reference/
## 5. Approval application and replay
Host API:

```ts
runtime.approve({ executionId }): Promise<ProxyToolOutput>;
```
Approval is scoped to the paused execution ID. The public `approve()` input does not include an arbitrary result. It also does not include a mutable replacement argument set. It means: permit the currently pending action for this execution to run. The runtime starts a new sandbox pass. It uses the same stored source and stable execution ID. For every observed call position:

```ts
type ToolDecision =
  | { kind: "replay"; result: unknown }
  | { kind: "execute"; seq: number }
  | { kind: "pause"; seq: number };
```
Applied entries return their stored result. Their connector implementations are not invoked again. When the replay cursor reaches the approved pending entry:
1. Its identity and arguments must match.
2. The runtime recognizes the previously pending sequence.
3. The connector method changes from denied/pending to executable.
4. The runtime marks it `executing`.
5. It calls the connector's `execute(args, {executionId})`.
6. It persists the returned result.
7. It marks the entry `applied`.
8. The sandbox promise resolves with that real result.
9. Generated code continues normally after its `await`. If another gated action is reached, the next pass pauses again. Thus a program with N approvals may execute N+1 full passes. Only a currently paused execution can resume. An approval cannot revive completed, rejected, errored, or rolled-back execution. Source: https://developers.cloudflare.com/agents/tools/codemode/how-it-works/
### Is “only the approved action is applied” exact? Within the replay prefix, yes:
- completed logged calls replay results;
- the approved pending call executes once in this pass;
- later calls may execute normally after it;
- another gated call pauses before execution. Across a distributed connector side effect, “once” is not absolute. A crash after remote commit but before local `applied` persistence is ambiguous. Portable implementations must treat side-effect idempotency separately.
## 6. Determinism contract
Replay is call-trace deterministic, not VM deterministic. At sequence `i`, the new pass must issue:

```text
same connector namespace
same method
deep-equal / canonical-equivalent arguments
same relative sequence position
```
A mismatch terminates with replay divergence. The error is returned as `{status:"error"}`. It does not escape to the agent loop as an uncaught RPC exception. Recorded connector results stabilize ordinary data-dependent branches. Example:

```ts
async () => {
  const issue = await github.get_issue({ id: 42 });
  if (issue.state === "open") {
    return github.close_issue({ id: 42 });
  }
  return "already closed";
}
```
If `get_issue` was applied before a pause, replay sees the historical result. The branch remains stable even if GitHub changes meanwhile.
### Sandbox-local nondeterminism
These values are not automatically intercepted:

```ts
Date.now();
Math.random();
crypto.randomUUID();
iteration over externally mutable ambient data;
direct network access when explicitly enabled;
```
Wrap such computation in `codemode.step()`.

```ts
async () => {
  const createdAt = await codemode.step(
    "created-at",
    () => Date.now(),
  );
  return github.create_issue({
    owner: "cloudflare",
    repo: "agents",
    title: `Review created at ${createdAt}`,
  });
}
```
The closure runs on the first pass. Its result is recorded. Replay returns the record without running the closure. Source: https://developers.cloudflare.com/agents/tools/codemode/how-it-works/
### Concurrent calls
Do not use `Promise.all()` around calls in approval-capable programs. Sequence numbers are assigned by host arrival order. RPC arrival order can differ across passes. That produces replay divergence even when the source is unchanged. Use sequential awaits.
### What if a replayed tool is nondeterministic? Default policy is `replay: "log"`. The tool is not rerun. Its historical result is returned. Its original nondeterminism therefore becomes deterministic input to replay. Optional policy:

```ts
type ConnectorTool = {
  replay?: "log" | "reexecute";
  requiresApproval?: boolean;
  execute(args: unknown, ctx?: { executionId: string }): unknown;
};
```

`replay: "reexecute"` reruns on each pass. The result is not stored. Use it only for idempotent reads with large, cheap results. Changed results may alter subsequent branches or arguments. The program must tolerate that. Argument/sequence divergence is still detected later. Approval-required methods cannot use `reexecute`. This prohibition prevents an approved side effect from being rerun during replay. Source: https://developers.cloudflare.com/agents/tools/codemode/how-it-works/
## 7. Approval protocol failure modes
### Replay divergence
Cause:
- `Date.now()` or randomness outside `codemode.step()`;
- changed source for the same execution;
- changed loop cardinality;
- `Promise.all()` arrival reordering;
- a reexecuted read changing downstream arguments;
- connector/method renaming between pause and approval. Result:
- execution becomes error;
- approved action may remain unapplied if divergence occurs before it;
- earlier applied actions remain applied;
- the agent receives an error outcome as data.
### Crash while call is `executing`
The runtime has durably announced intent. The external system may have committed. The result may not have been recorded. This is the classic side-effect/result atomicity gap. Mitigation:
- derive connector idempotency key from `(executionId, seq)`;
- make connector endpoint idempotent;
- query external state on recovery;
- expose compensation via `revert`;
- never claim global exactly-once. UNVERIFIED: Code Mode docs do not specify automatic reconciliation of an `executing` call.
### Stale `running`
A host stop can leave execution `running`. Approval does not resume it. `expirePaused()` marks stale running executions error. Default stale age is 24 hours.
### Stale `paused`
Paused executions are not automatically pruned. `expirePaused()` rejects/disposes stale paused runs. Default `DEFAULT_PAUSED_TTL_MS = 86_400_000`.
### Rejection

```ts
runtime.reject({ executionId, seq }): Promise<boolean>;
```
Rejection ends the execution. It does not undo earlier actions. It returns `false` if the action is no longer pending.
### Rollback

```ts
runtime.rollback({ executionId }): Promise<void>;
```
Rollback walks applied calls in reverse order. It invokes currently configured `revert(args, result, ctx)` handlers. Missing connectors are skipped. Methods without `revert` remain applied. A failed revert does not stop later compensation attempts. Status becomes `rolled_back` only if at least one revert succeeds. This is compensation, not transaction rollback. External concurrent changes can make compensation incomplete or destructive.
### Connector drift
Every configured connector name is recorded when an execution starts. Approval replay requires all recorded connectors to remain available. This applies even if source did not call every connector. Removing/renaming a connector while an execution is paused can break replay.
### Oversized durable values
Code Mode caps one serialized durable value at 1,000,000 string characters. Large results should use `reexecute` only when safely idempotent,
or be externalized behind a stable handle.
### Resource lifecycle mismatch
Pass resources die after every completed, failed, or paused pass. Execution resources live across pause. Hooks:

```ts
onPassEnd(executionId, status): Promise<void>;
disposeExecution(executionId, status): Promise<void>;
```
Connector instance memory cannot bridge approval waits. Persist resource metadata keyed by stable `executionId`. Cleanup must be idempotent. Cleanup errors are ignored to avoid changing a terminal result.
### Retention
Default terminal execution retention is 50. Running and paused executions are not pruned on new runs. Completion can temporarily leave 51 terminal records. Use `pruneExecutions()` and `expirePaused()` explicitly.
## 8. Why the protocol is genuinely different
Generic approval in an agent loop is usually:

```text
model requests tool
loop pauses
human approves
loop sends “approved”
tool executes
model is called again
```
The continuation unit is the agent loop. Code Mode instead uses:

```text
model writes a complete program
program pauses at a capability boundary
human approves exact logged arguments
same program is deterministically re-driven
approved call resolves in-program
remaining local control flow continues without a model round-trip
```
The continuation unit is generated source plus an execution log. This preserves local variables by recomputation. It preserves prior tool observations by recorded-result replay. It turns approval into a deterministic capability grant at one trace position. It does not require serializing a JavaScript continuation. That combination is the novel part.
## 9. Agents SDK fibers: exact surface
Public methods:

```ts
class Agent {
  runFiber<T>(
    name: string,
    fn: (ctx: FiberContext) => Promise<T>,
  ): Promise<T>;
  startFiber(
    name: string,
    fn: (ctx: FiberContext) => Promise<void>,
    options?: StartFiberOptions,
  ): Promise<StartFiberResult>;
  inspectFiber(fiberId: string): Promise<FiberInspection | null>;
  inspectFiberByKey(key: string): Promise<FiberInspection | null>;
  listFibers(options?: ListFibersOptions): Promise<FiberInspection[]>;
  cancelFiber(fiberId: string, reason?: string): Promise<boolean>;
  cancelFiberByKey(key: string, reason?: string): Promise<boolean>;
  resolveFiber(id: string, result: FiberRecoveryResult): Promise<boolean>;
  deleteFibers(options?: DeleteFibersOptions): Promise<number>;
  stash(data: unknown): void;
  onFiberRecovered(
    ctx: FiberRecoveryContext,
  ): Promise<void | FiberRecoveryResult>;
}
```
Current source types:

```ts
type FiberContext = {
  id: string;
  signal: AbortSignal;
  stash(data: unknown): void;
  snapshot: unknown | null;
};
type StartFiberOptions = {
  fiberId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  waitForCompletion?: boolean;
};
type FiberStatus =
  | "pending"
  | "running"
  | "completed"
  | "aborted"
  | "interrupted"
  | "error";
```
Source: https://raw.githubusercontent.com/cloudflare/agents/main/packages/agents/src/index.ts
## 10. `runFiber()` mechanism

`runFiber()` generates a unique run ID. Before user code runs, it inserts:

```sql
CREATE TABLE IF NOT EXISTS cf_agents_runs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  snapshot TEXT,
  created_at INTEGER NOT NULL
);
```
Normal lifecycle:

```text
insert cf_agents_runs row
acquire keepAlive heartbeat
enter AsyncLocalStorage fiber context
run closure
stash() may replace snapshot
closure returns/throws
delete cf_agents_runs row
release heartbeat
return/throw to caller
```

`keepAlive()` uses a ref-counted 30-second alarm heartbeat by default. It reduces idle eviction. It does not prevent deploy/restart/resource-limit loss. Source: https://developers.cloudflare.com/agents/runtime/execution/durable-execution/
On next activation, recovery scans orphan `cf_agents_runs` rows. Activation can be an incoming request/connection. A persisted alarm provides a fallback wake for background agents. The original closure is gone. Only `id`, `name`, `snapshot`, and `createdAt` remain. The SDK calls `onFiberRecovered(ctx)`. The application decides whether to restart, resume from snapshot, compensate, or skip. An unmanaged `runFiber` recovery row is deleted after a successful hook. To continue, the hook normally calls a new `runFiber()`. That creates a new run row and a new closure invocation. There is no bytecode/history replay.
## 11. `startFiber()` durable admission and dedup

`startFiber()` adds a retained job ledger:

```sql
CREATE TABLE IF NOT EXISTS cf_agents_fibers (
  fiber_id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot TEXT,
  metadata_json TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);
```
Source: https://raw.githubusercontent.com/cloudflare/agents/main/packages/agents/src/index.ts
Admission sequence:

```text
validate nonblank optional fiberId/idempotencyKey
lookup by fiberId
lookup by idempotencyKey
reject inconsistent pair
if either exists: return existing, accepted=false
else insert pending row
start callback in background
transition pending -> running
return accepted receipt (or wait if requested)
```
The row is inserted before callback execution. This is the durable-acceptance boundary. If the caller times out after insertion, retrying with the same key finds the row.
### Exact dedup-key semantics

`fiber_id` is a primary key. `idempotency_key` has a SQLite `UNIQUE` constraint. The uniqueness scope is one Agent/Durable Object SQLite database. It is not global across agents. It is not scoped by `name`. Therefore two different fiber names with the same key deduplicate to one row. The first accepted row wins. Later metadata/name/callback changes are not merged into it. If caller supplies both identifiers and they resolve to different rows, it throws. If the same key resolves to an existing terminal row, it still returns that row. It does not automatically create a new generation after completion. Deletion is required before key reuse. `accepted: false` means “matched retained admission,” not “work succeeded.”
Inspect `status` separately. Source: https://raw.githubusercontent.com/cloudflare/agents/main/packages/agents/src/index.ts
### Duplicate waiting
Without `waitForCompletion`, duplicates return retained state immediately. With `waitForCompletion: true`:
- a duplicate nonterminal call joins active in-memory execution when possible;
- otherwise recovery/status machinery is consulted;
- returned receipt has `accepted: false`;
- callback return value is never retained. `startFiber()` is status-oriented, not value-oriented.
### Cancellation
Cancellation writes terminal `aborted` state. It also aborts the in-memory `AbortController` if present. The callback must cooperate with `ctx.signal`. A non-cooperative callback may continue side effects after ledger status is aborted. This is cancellation intent, not forced transactional termination.
## 12. `stash()` exact contract
Implementation:

```ts
const writeSnapshot = (data: unknown) => {
  const snapshot = JSON.stringify(data);
  sql`UPDATE cf_agents_runs SET snapshot = ${snapshot} WHERE id = ${id}`;
  if (managed) {
    sql`UPDATE cf_agents_fibers SET snapshot = ${snapshot}
        WHERE fiber_id = ${id}`;
  }
};
```
Source: https://raw.githubusercontent.com/cloudflare/agents/main/packages/agents/src/index.ts
The API returns `void`. The SQLite write is synchronous. After `stash()` returns, the SQL update has completed. Each stash fully replaces the prior snapshot. It is not a merge. `ctx.stash()` closes directly over the fiber ID. `this.stash()` uses Node-compatible `AsyncLocalStorage` to find the current fiber. Concurrent fibers get separate ALS contexts. `this.stash()` outside a fiber throws. Data must survive `JSON.stringify` and later `JSON.parse`. Consequences:
- cycles throw;
- `BigInt` throws without custom conversion;
- functions/symbols are omitted or become `null` in arrays;
- `undefined` top-level produces no JSON string and is unsafe;
- class prototypes, `Map`, `Set`, and typed semantics are not preserved;
- binary data should be externalized or encoded deliberately.
### Size limit
There is no explicit fiber snapshot byte/character limit in the current Agents source. There is no preflight size check around `JSON.stringify` or the SQL update. The practical limit is therefore inherited from Durable Object SQLite/storage limits,
memory used by stringification,
and any platform row/value limits. UNVERIFIED: no fiber-specific maximum is documented. Do not import Code Mode's 1,000,000-value cap into fibers; it is a separate package contract. Use a compact cursor plus external rows/R2 for large checkpoints.
## 13. `onFiberRecovered()` semantics
Context:

```ts
type FiberRecoveryContext = {
  id: string;
  name: string;
  status?: FiberStatus;
  idempotencyKey?: string;
  metadata?: Record<string, unknown> | null;
  snapshot: unknown | null;
  createdAt: number;
  recoveryReason: "interrupted";
};
```
Managed `startFiber` rows are moved from `pending`/`running` to `interrupted`. The hook receives the last stash and metadata. The closure cannot be replayed. The hook can return:

```ts
type FiberRecoveryResult =
  | { status: "completed"; snapshot?: unknown; metadata?: Record<string, unknown> }
  | { status: "error"; error?: unknown; snapshot?: unknown }
  | { status: "aborted"; reason?: string; snapshot?: unknown }
  | { status: "interrupted"; reason?: string; snapshot?: unknown };
```
Returning `undefined` keeps a managed fiber interrupted. Returning a result records the application's recovery decision. `resolveFiber()` can later apply the same decision to an interrupted managed row. It returns `false` for pending, running, or already-terminal rows. Docs say a throwing managed recovery remains interrupted and records recovery error. Current raw source observed during this research includes recovery-failure terminalization logic. Because this area changed recently, treat precise throw-to-status behavior as version-sensitive. UNVERIFIED across published package version: pin `agents` and test throw behavior. Recovery attempts use exponential alarm backoff capped at five minutes. Default maximum recovery age is 24 hours. Setting `fiberRecoveryMaxAgeMs: 0` retains/retries indefinitely. Source: https://developers.cloudflare.com/agents/runtime/execution/durable-execution/
## 14. Fibers versus Temporal/Restate/DBOS-style replay
Fibers are a durable recovery marker plus application checkpoint. They are not a deterministic workflow interpreter.

```text
Property                    Agents fiber
--------------------------  -------------------------------------------
records function history    no
serializes closure/stack    no
replays original lambda     no
intercepts activities       no
enforces deterministic API  no
automatic step retry        no
checkpoint                  app-written JSON replacement
recovery                    app hook by name + snapshot
side-effect idempotency     app responsibility
```
Temporal/Restate/DBOS-style systems generally rebuild workflow state by replaying event history,
or by durable step/output records under a deterministic execution contract. They constrain nondeterminism or force it through recorded APIs. Cloudflare fibers deliberately do neither. The original lambda can capture arbitrary live values during the first incarnation. On recovery those captures do not exist. `onFiberRecovered()` is a separate application method. It may choose a different algorithm. That flexibility is the feature and the risk. `@cloudflare/codemode` approval replay is closer to a tiny deterministic replay engine than fibers are. Even Code Mode only checks its mediated call trace. It does not virtualize all JavaScript nondeterminism.
## 15. Dynamic Workflows: exact dispatch mechanism
Package: `@cloudflare/dynamic-workflows`. Its purpose is not a new workflow engine. It is envelope-and-dispatch glue over Cloudflare Workflows and Dynamic Workers. There are three layers:

```text
Cloudflare Workflows engine
          |
          v
static dispatcher WorkflowEntrypoint
          |
          v
tenant-selected Dynamic Worker WorkflowEntrypoint
```
Dispatcher setup:

```ts
import {
  createDynamicWorkflowEntrypoint,
  DynamicWorkflowBinding,
  wrapWorkflowBinding,
} from "@cloudflare/dynamic-workflows";
export { DynamicWorkflowBinding };
function loadTenant(env: Env, tenantId: string) {
  return env.LOADER.get(tenantId, async () => ({
    compatibilityDate: "2026-01-01",
    mainModule: "index.js",
    modules: { "index.js": await fetchTenantCode(tenantId) },
    env: {
      WORKFLOWS: wrapWorkflowBinding({ tenantId }),
    },
    globalOutbound: null,
  }));
}
export const DynamicWorkflow =
  createDynamicWorkflowEntrypoint<Env>(async ({ env, metadata }) => {
    return loadTenant(env, metadata.tenantId as string)
      .getEntrypoint("TenantWorkflow");
  });
```
Source: https://github.com/cloudflare/dynamic-workflows
The static `DynamicWorkflow` class is registered in `wrangler.jsonc`. Tenant code sees a `Workflow`-shaped binding. It is actually a specialized RPC stub for `DynamicWorkflowBinding`. Bindings crossing the Dynamic Worker boundary must be RPC stubs. A plain object is not structured-clonable as a binding. The raw Workflow binding is not serializable.
## 16. How routing survives isolate recycle
Tenant call:

```ts
env.WORKFLOWS.create({
  params: { name: "Alice" },
});
```
Dispatcher-visible call:

```ts
env.WORKFLOWS.create({
  params: {
    __workerLoaderMetadata: { tenantId: "t-42" },
    params: { name: "Alice" },
  },
});
```
The exact envelope field is internal and must not be parsed by consumers. The real Workflows engine persists the entire `event.payload` envelope. That durable payload carries routing metadata across sleeps, crashes, and deploys. When Workflows calls the static dispatcher's `run(event, step)`:
1. `dispatchWorkflow()` validates/unpacks the envelope.
2. It passes metadata to `loadRunner({metadata, env, ctx})`.
3. The loader selects/reloads the tenant Dynamic Worker.
4. It gets the tenant's named `WorkflowEntrypoint` RPC stub.
5. It forwards an event containing the original inner params.
6. It passes through the real Workflows `step` object. Workflow IDs, `status`, pause/resume, retries, sleeps, and events stay platform-native. Source: https://blog.cloudflare.com/dynamic-workflows/
### Why step progress survives
Cloudflare Workflows owns step durability. The tenant `run(event, step)` function can be re-entered after recycle. Previously completed `step.do(name, fn)` operations are represented in workflow history. The engine supplies their committed results instead of blindly redoing them. The dynamic library only re-selects the code that expresses those step calls. Therefore the durable state is split:

```text
event payload envelope  -> tenant routing
workflow history        -> step progress/results/waits
Dynamic Worker cache    -> performance only, not durability
```
Worker Loader `get(tenantId, loader)` caches by ID while alive. After eviction, the loader callback fetches code again. The next workflow step can continue against the newly loaded isolate.
### Code version pinning
The example cache key is only `tenantId`. The durable envelope contains only routing metadata chosen by the host. The example loader fetches tenant source again after eviction. Therefore “same tenant” does not inherently mean “same code version.”
If tenant code changes, an in-flight workflow may re-enter new source. UNVERIFIED: the package does not provide automatic source hashing/version pinning. Portable and production-safe design:

```ts
wrapWorkflowBinding({
  tenantId,
  workflowVersion,
  sourceDigest,
});
LOADER.get(`${tenantId}:${sourceDigest}`, loadExactVersion);
```
Store immutable source by digest. Authorize the tuple server-side. Do not fetch mutable `latest` for an existing workflow unless migration is deliberate.
## 17. Dynamic Workflows isolation and trust
Tenant code runs in a Dynamic Worker V8 isolate. It does not run in the dispatcher isolate. The host chooses every environment binding exposed to it. The example sets `globalOutbound: null`. This blocks ambient network access. Capabilities cross the boundary as explicit Workers RPC bindings. Secrets can stay in the host-side capability implementation. Tenant code sees the narrowed RPC interface, not raw credentials. Dynamic Workers add Cloudflare's isolate sandbox and defense-in-depth layers. Cloudflare notes V8 escapes remain a different risk class from hypervisor escapes. Source: https://blog.cloudflare.com/dynamic-workers/
The routing metadata is not authorization. Tenant code can observe it through workflow status. Do not store secrets in it. The dispatcher must authenticate tenant identity before selecting source/bindings. The loader must enforce plan, region, code version, and capability policy. `MissingDispatcherMetadataError` is thrown when static `run()` receives a non-envelope payload. This catches raw-binding creation mistakes. It is not an authorization control.
### Trust boundary summary
Trusted:
- dispatcher Worker;
- loader callback;
- code registry/source digest mapping;
- capability RPC implementations;
- Workflow binding and engine. Untrusted or tenant-controlled:
- runtime-loaded source;
- its arguments;
- its calls to exposed capabilities;
- metadata it can read back;
- workload/CPU/resource consumption within platform limits.
## 18. `@cloudflare/codemode`
Main exports include:

```ts
createCodemodeRuntime(options): CodemodeRuntimeHandle;
DynamicWorkerExecutor;
CodemodeConnector;
McpConnector;
OpenApiConnector;
ToolDispatcher;
runCode;
normalizeCode;
```
Subpaths cover AI SDK, MCP, TanStack AI, browser, and Vite. Durable runtime construction:

```ts
const runtime = createCodemodeRuntime({
  ctx: this.ctx,
  executor: new DynamicWorkerExecutor({
    loader: this.env.LOADER,
    globalOutbound: null,
  }),
  connectors: [github, notes],
  name: "operations",
  maxExecutions: 50,
});
```
The named runtime is a Durable Object facet. Default name is `default`. Runtime name selects durable history/snippet storage. It does not name a model or an individual run. The Vite plugin exports the facet class for `ctx.exports` resolution. Source: https://developers.cloudflare.com/agents/tools/codemode/api-reference/
Security properties:
- fresh isolated Worker per execution pass;
- no Node `process` or `require` in generated code;
- no host credential/client objects;
- network blocked unless a Fetcher is supplied;
- connector RPC is the capability boundary;
- schemas/type declarations describe allowed methods;
- approval/replay policy is host-side. Non-properties:
- not a Linux environment;
- not complete JS nondeterminism capture;
- not distributed exactly-once;
- not automatically safe if a connector is overpowered;
- not safe from prompt-induced misuse of legitimately exposed capabilities.
## 19. `@cloudflare/shell`
Despite the name, the package's core structured surface is not a Bash parser. It provides:
- `StateBackend`;
- `FileSystem` abstraction;
- `InMemoryFs`;
- `WorkspaceFileSystem`;
- durable `Workspace` on SQLite with optional R2 spillover;
- `stateTools(workspace)` for Code Mode;
- pure-JS git via isomorphic-git;
- `gitTools(workspace)` with host-injected auth. Source: https://www.npmjs.com/package/@cloudflare/shell
Typical composition:

```ts
const workspace = new Workspace({
  sql: this.ctx.storage.sql,
  r2: this.env.R2,
  name: () => this.name,
});
const result = await executor.execute(code, [
  resolveProvider(stateTools(workspace)),
  resolveProvider(gitTools(workspace, {
    token: this.env.GITHUB_TOKEN,
  })),
]);
```
Generated code gets a typed `state.*` namespace. It does not get direct SQLite or R2 credentials. Coarse operations reduce RPC crossings:

```ts
await state.searchFiles("src/**/*.ts", "TODO");
await state.replaceInFiles("src/**/*.ts", "foo", "bar");
await state.applyEditPlan(plan);
```
Batch edits are transactional by default. `rollbackOnError: false` opts into partial progress. Git auth defaults are injected host-side so the model need not see secrets. Think's built-in `bash` is a different layer. It uses `just-bash` in a sandboxed environment. Think snapshots workspace files into that shell and writes changes back. Current default bounds reported by Think:
- at most 1,000 files;
- skip files larger than 1 MB;
- skipped paths are protected during write-back;
- network disabled by default. Source: https://www.npmjs.com/package/@cloudflare/think
This snapshot/write-back path is not the FUSE container sync protocol below.
## 20. `@cloudflare/workspace`: name/status correction
Cloudflare's June announcement said it was “building `@cloudflare/workspace`.”
Source: https://blog.cloudflare.com/agents-platform-flue-sdk/
As of the research date:
- https://github.com/cloudflare/workspace redirects to `cloudflare/computer`;
- the repository calls the product Cloudflare Computer;
- the public package in that repo is `@cloudflare/computer`;
- lower layers are `@cloudflare/dofs`, `@cloudflare/computer-rpc`, and `@cloudflare/computerd`;
- the package/repo is preview-only and explicitly not production-ready. No first-party source found a current published `@cloudflare/workspace` package contract. UNVERIFIED: whether that exact npm name was ever publicly released. The mechanism requested by the target is now documented and implemented in `cloudflare/computer`. Source: https://github.com/cloudflare/computer
## 21. Workspace/container sync: authoritative mechanism
The Durable Object SQLite VFS is authoritative across restarts. The container exposes a second VFS as a FUSE mount. `computerd` runs inside the container. It provides:
- a process-lifetime VFS database;
- a FUSE mount, normally `/workspace`;
- shell/exec service;
- Cap'n Web RPC over HTTP/WebSocket;
- sync endpoints. The container-side VFS is currently in memory/process-lifetime. A container restart loses that mirror. The next DO push re-baselines it. Source: https://github.com/cloudflare/computer/blob/main/docs/02_sync_protocol.md
### Execution round trip

```text
workspace.runtime.exec(command)
  1. DO -> container incremental push
  2. hydrate any lazy mount stubs needed
  3. run command against FUSE /workspace
  4. container -> DO fetch changed entries
  5. transfer missing content chunks by hash
  6. apply batches into authoritative DO SQLite
  7. return/stream stdout, stderr, exit
```
Files written through `workspace.fs` before exec are pushed first. Files written by Linux tools during exec are pulled after exec. Explicit APIs also exist:

```ts
workspace.push(): Promise<number>;
workspace.pull(): Promise<{ applied: number; skipped: number }>;
workspace.ready(): Promise<void>;
workspace.close(): Promise<void>;
```
Source: https://github.com/cloudflare/computer/blob/main/docs/README.md
### Change representation
Both sides maintain monotonic revision counters. Every mutation is stamped with a revision. Push sends changes newer than the container's applied watermark. Pull fetches changes newer than the DO's `(rev, path)` cursor. Changes are state-based, not operation-based. There is no rename opcode. A rename materializes destination live entries plus source tombstones. This makes cold bootstrap and idempotent reapply use the same logic. Changes are coalesced to latest state per path. Five rewrites between sync points usually produce one wire entry. Hardlink identity is not preserved. Each hardlink name becomes an independent file with identical bytes.
### Content transfer
File bytes are not inline in change entries. Files use deterministic fixed 512 KiB chunks. Each chunk is content-addressed by SHA-256. Wire entry carries `(hash, size)[]`. Receiver calls `hasObjects(hashes)`. Sender transfers only missing chunks via `pushObjects`/`fetchObjects`. Duplicate content is transferred/stored once. A localized large-file edit transfers only changed chunks.
### Watermarks/cursors

```text
pushRev             DO: last DO rev successfully pushed
fetchCursor         DO: last container (rev,path) fetched
currentRev          each side: latest local mutation rev
appliedPushCursor   container: DO-side cursor successfully applied
```
DO watermarks live in SQLite. Container watermarks live in its VFS database. The current container database is process-lifetime. The receiver echoes `appliedPushCursor`. The DO asserts that it covers local `pushRev`. This detects cursor regression instead of silently accepting drift.
### Pull batching and crash recovery

`PULL_BATCH_SIZE` is 256 entries. The DO streams rather than buffering the full change set. It unions referenced hashes per batch. It fetches only missing objects. It applies the batch. Then it advances `(rev, path)` to the last committed entry. A DO crash mid-pull redoes at most the uncheckpointed batch. `alreadyApplied` makes reapplication idempotent.
### Push atomicity
Container-side push application uses one synchronous SQLite transaction. Nested filesystem mutations use reentrant SAVEPOINTs. A missing chunk or mid-apply failure rolls back the entire push batch. The receiver does not expose a partial pushed tree. Pull cannot hold one synchronous transaction across network streaming. It commits per mutation/batch and relies on cursor/idempotency recovery.
### Scheduling/concurrency

`Workspace.push()` and `pull()` use a per-Workspace tail-promise FIFO. Concurrent sync callers serialize. Failed operations do not poison the queue. Pure DO-side reads bypass this FIFO. The FIFO is not held for the entire command execution. Overlapping commands can therefore mutate concurrently.
### Conflict semantics
One DO incarnation serializes its own mutations through input gates. Two containers sharing one workspace can conflict. The protocol uses last-writer-wins at sync granularity. It does not detect two independent edits to the same path. There is no merge and no conflict error. Safe default: one active writer/container per workspace. Alternative: partition paths by agent. Do not use a shared workspace file as a multi-writer transactional database.
### Ignore behavior
Default ignored segment is `node_modules`. A custom list replaces rather than extends the default. Ignored bytes remain visible inside the container. They do not sync back to the DO. They are invisible to `Workspace.fs` reads/listing/stat. This prevents dependency trees/build output from flooding durable storage.
### Failure modes
- Container restart: mirror and watermarks can vanish; next push re-baselines.
- WebSocket close: connection is rebuilt lazily.
- Container crash mid-push: receiver transaction rolls back batch.
- DO crash mid-pull: resume from last `(rev,path)` checkpoint.
- Concurrent container writers: silent last-write-wins loss.
- Ignored outputs: intentionally unavailable through DO-side FS.
- Large dirty set: current design can OOM; backpressure is future work.
- Protocol upgrade: no version negotiation; DO and `computerd` need lockstep rollout.
- Directory rename: O(subtree) mutations and wire entries.
- FUSE heavy I/O: slower than native disk for installs/extractions. Source: https://github.com/cloudflare/computer/blob/main/docs/02_sync_protocol.md
## 22. The execution ladder, mechanically
The “escalate only when needed” pattern is not one runtime growing privileges. It is one durable filesystem exposed to multiple execution backends.

```text
Tier 0: DO SQLite/R2 virtual filesystem operations
  no generated code required
Tier 1: Dynamic Worker JavaScript / just-bash
  isolate, explicit RPC capabilities, no ambient network
Tier 2: bundled npm dependencies in Dynamic Worker
  same isolate model, larger code surface
Tier 3: Browser Run
  browser-specific authority
Tier 4: container/sandbox
  Linux binaries and real OS, FUSE mirror synced to DO
```
For isolate shell/JavaScript, calls reach the authoritative Workspace via Workers RPC. There is no second filesystem store and no push/pull round trip. For containers, a real FUSE mirror is necessary. That is where the revision/chunk sync protocol applies. The durable filesystem is the continuity layer between cheap and expensive compute. Source: https://github.com/cloudflare/computer
## 23. Cross-mechanism comparison

```text
Mechanism            Durable record             Resume strategy
-------------------  -------------------------  ------------------------------
Code Mode approval   source + ordered call log  rerun source, replay results
Agent runFiber       name + JSON snapshot       app hook chooses recovery
Agent startFiber     retained job ledger        app hook resolves interrupted
Dynamic Workflow     payload + step history     engine re-enters tenant run()
Computer workspace   VFS + rev/object logs      incremental bidirectional sync
Think chat recovery  transcript/stream/fiber    harness repairs/continues turn
```
Only Code Mode approval uses the exact abort-record-replay protocol. Fibers and Workflows solve different durability layers. Combining them does not make all side effects exactly-once.
## **What a non-Cloudflare host can copy**
### Abort-record-replay approvals
Cloudflare dependency: no, conceptually portable. Dynamic Workers and DO facets provide convenient isolation and colocated durability. The protocol itself needs only:
- a sandboxed JS executor;
- a durable SQL transaction log;
- host-mediated capability calls;
- stable execution IDs;
- deterministic call-position validation;
- an approval API;
- idempotent connector design. Ordinary Node + SQL shape:

```sql
CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE TABLE execution_calls (
  execution_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  capability TEXT NOT NULL,
  method TEXT NOT NULL,
  args_json TEXT NOT NULL,
  result_json TEXT,
  approval_required BOOLEAN NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (execution_id, seq)
);
```
Run generated code in `isolated-vm`, a subprocess, container, microVM, or remote sandbox. Never use same-process `eval` for untrusted code. Every capability call becomes:

```ts
decision(executionId, seq, capability, method, canonicalArgs)
  -> replay(recordedResult)
  -> pause(pendingApproval)
  -> executeAndRecord()
```
Use an internal abort exception only within the sandbox adapter. Expose paused/error as data. Store random/time/direct-I/O results with a `step()` primitive. Bind remote idempotency key to `${executionId}:${seq}`. Verdict: highly portable; DOs/isolates are implementation choices, not conceptual requirements.
### `runFiber()` checkpoint/recovery
Cloudflare dependency: no, portable. Node + SQL version:

```text
insert active_run before callback
run callback under AsyncLocalStorage
stash() = synchronous transaction/update of JSON snapshot
heartbeat/lease active_run
process supervisor scans expired leases
dispatch recovery handler by name
delete/resolve row after policy decision
```
Use `better-sqlite3` for truly synchronous local stash,
or make `stash()` async with Postgres. Do not pretend an async network database write is synchronous. Verdict: portable; Cloudflare alarms/DO activation replace a conventional scheduler and worker lease scanner.
### `startFiber()` durable admission/dedup
Cloudflare dependency: no, directly portable. Node + SQL version:

```sql
INSERT INTO jobs(id, idempotency_key, status, metadata)
VALUES (...) ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;
```
Use a unique index scoped to the desired tenant/agent boundary. Queue only after the row commits,
or use transactional outbox polling from the same table. Retain terminal rows as long as retry dedup must work. Verdict: standard durable admission; no DO requirement.
### Dynamic Workflows tenant dispatch
Cloudflare dependency: the exact `WorkflowEntrypoint`/Worker Loader glue is Cloudflare-specific. The pattern is portable. Portable envelope:

```ts
type DynamicWorkflowEnvelope = {
  tenantId: string;
  sourceDigest: string;
  workflowType: string;
  params: unknown;
};
```
Persist it with the workflow instance. At every activation:
1. authenticate host-owned tenant mapping;
2. fetch immutable code by digest;
3. start isolated runtime;
4. inject narrowed capability stubs;
5. re-enter `run(event, step)` against durable step history. An ordinary Node host still needs a workflow engine or a step-log interpreter. SQL can store step states/results/timers/events. A scheduler can wake due timers. Containers/processes can run tenant code. Verdict: dispatch envelope is portable; Cloudflare supplies the hard scalable sandbox and workflow engine.
### Dynamic Worker capability isolation
Cloudflare dependency: the fast, same-thread, globally scheduled V8 isolate service is Cloudflare-specific. Capability-security pattern is portable. Start with no network/filesystem/secrets. Expose small RPC interfaces implemented by the trusted host. Keep credentials in host calls. Proxy/allowlist outbound HTTP if enabled. On Node, use a real security boundary. Node `vm` is not a sufficient hostile-code sandbox. Verdict: idea portable; Cloudflare's performance/operations are not.
### `@cloudflare/shell` structured state API
Cloudflare dependency: no. Define a runtime-neutral filesystem backend. Expose coarse typed methods to generated code. Back them with local disk, SQLite blobs, S3, or a remote file service. Make multi-file edit plans transactional or compensating. Inject git credentials at the host boundary. Verdict: portable and valuable even without isolates.
### Workspace-to-container sync
Cloudflare dependency: no for the protocol; yes for its current bindings/lifecycle integration. Portable version:
- SQL database is authoritative VFS metadata;
- object store holds content-addressed 512 KiB chunks;
- FUSE daemon presents a local mirror;
- bidirectional change log uses monotonic revisions;
- receiver probes hashes before transfer;
- `(rev,path)` cursor checkpoints pulls;
- push batches apply atomically;
- one-writer policy avoids lost updates;
- pre-exec push and post-exec pull create the handoff fence. This can run with Node/Postgres/S3 plus a Rust/Go FUSE daemon. For a simpler host, avoid bidirectional sync:

```text
materialize immutable snapshot -> run container -> compute manifest diff -> commit diff
```
That is slower but much easier to reason about. Verdict: portable; DO SQLite, Cap'n Web, and Cloudflare Containers are replaceable components.
### Execution ladder
Cloudflare dependency: no as architecture; yes for millisecond Dynamic Workers and zero-idle DO economics. Portable ladder:

```text
SQL/object-store workspace
  -> pure host filesystem APIs
  -> restricted JS subprocess
  -> dependency-enabled sandbox
  -> browser service
  -> Linux container/microVM
```
Use the same durable workspace identity across tiers. Grant capabilities monotonically and explicitly. Do not automatically carry high-tier ambient authority back into lower tiers. Verdict: fully copyable architecture; economics and cold-start profile will differ.
### Bottom line
Think is the integration harness. Code Mode owns the novel approval continuation. The approval continuation is durable because source and call records live outside the sandbox. It is deterministic only at mediated call/step boundaries. Nondeterministic local code must use `codemode.step()`. Non-deterministic connectors replay historical results by default. `reexecute` is an explicit, read-only/idempotent escape hatch. Fibers are not workflow-history replay. They durably admit or mark work, checkpoint JSON, and delegate recovery semantics to application code. Dynamic Workflows persists a routing envelope and relies on the real Workflows engine for step durability. Tenant isolation comes from Dynamic Workers plus capability-only bindings, not from the envelope. The workspace/container bridge is a real bidirectional revisioned object-sync protocol,
not a shared disk and not a full-copy-on-every-command trick. All five ideas can be reproduced on Node + SQL. What Cloudflare uniquely supplies is their composition:
- per-agent actor identity and SQLite;
- alarm-driven zero-idle recovery;
- millisecond hostile-code isolates;
- workflow step durability;
- RPC capability plumbing;
- container escalation behind one durable filesystem.
