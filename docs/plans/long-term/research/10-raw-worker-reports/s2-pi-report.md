# VERDICT: AVAILABLE ON THE PINNED VERSION (`pi-agent-core@0.80.7`). NO UPGRADE REQUIRED.

The central architectural claim is true at the `@earendil-works/pi-agent-core` layer pinned on disk. `SessionStorage` is public, `Session` accepts it in its constructor, and `AgentHarness` accepts that `Session`. The executable spike ran two provider-driven turns in distinct Node processes from one host-owned JSONL record stream, remembered the first turn in the second, and left pi's entire default session tree byte-metadata snapshot unchanged.

The prior claim that coding-agent's `SessionManager` is simply “file-backed and fixed” is false as stated. `@earendil-works/pi-coding-agent@0.80.7` exposes `SessionManager.inMemory()` and lets `createAgentSession()` accept a `sessionManager`. However, its `SessionManager` does not accept an arbitrary durable storage adapter. The direct host-durable injection seam is the pinned `pi-agent-core` API.

The mandatory real Gemini turn could not be completed in this managed sandbox. Vault loopback access was denied, and a separately configured Google credential reached pi but the outbound provider request failed. Actual pi output was `stopReason: "error"`, `errorMessage: "fetch failed"`; there is no fabricated assistant reply below. Thus the storage architecture is proved on the pinned version, while the requested real-Gemini integration check is environmentally blocked.

## 1. Versions and real exports

On-disk package metadata:

```text
@earendil-works/pi-coding-agent 0.80.7
@earendil-works/pi-agent-core   0.80.7
@earendil-works/pi-ai           0.80.7 (core's resolved dependency)
```

Command output from runtime export enumeration (abridged only to session-relevant names):

```text
core Agent
AgentHarness
InMemorySessionRepo
InMemorySessionStorage
JsonlSessionRepo
JsonlSessionStorage
Session
toSession

coding AgentSession
SessionManager
createAgentSession
createAgentSessionFromServices
createAgentSessionRuntime
createAgentSessionServices
```

`SessionStorage` and `SessionRepo` are TypeScript interfaces and therefore correctly have no runtime property. Runtime/type check output:

```json
{
  "coreVersion": "0.80.7",
  "coreSessionExports": [
    ["SessionStorage", false],
    ["SessionRepo", false],
    ["Session", true],
    ["InMemorySessionStorage", true],
    ["AgentHarness", true]
  ],
  "codingVersion": "0.80.7",
  "codingSessionExports": [
    ["SessionManager", true],
    ["createAgentSession", true]
  ]
}
```

### Public pinned `pi-agent-core` signatures

Copied from `dist/harness/types.d.ts`:

```ts
export interface SessionMetadata {
    id: string;
    createdAt: string;
}
export interface SessionStorage<TMetadata extends SessionMetadata = SessionMetadata> {
    getMetadata(): Promise<TMetadata>;
    getLeafId(): Promise<string | null>;
    /** Persist a leaf entry that records the active session-tree leaf. */
    setLeafId(leafId: string | null): Promise<void>;
    createEntryId(): Promise<string>;
    appendEntry(entry: SessionTreeEntry): Promise<void>;
    getEntry(id: string): Promise<SessionTreeEntry | undefined>;
    findEntries<TType extends SessionTreeEntry["type"]>(type: TType): Promise<Array<Extract<SessionTreeEntry, {
        type: TType;
    }>>>;
    getLabel(id: string): Promise<string | undefined>;
    getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
    getEntries(): Promise<SessionTreeEntry[]>;
}
export interface SessionRepo<TMetadata extends SessionMetadata = SessionMetadata, TCreateOptions extends SessionCreateOptions = SessionCreateOptions, TListOptions = void> {
    create(options: TCreateOptions): Promise<Session<TMetadata>>;
    open(metadata: TMetadata): Promise<Session<TMetadata>>;
    list(options?: TListOptions): Promise<TMetadata[]>;
    delete(metadata: TMetadata): Promise<void>;
    fork(source: TMetadata, options: SessionForkOptions & TCreateOptions): Promise<Session<TMetadata>>;
}
```

Copied from `dist/harness/session/session.d.ts`:

```ts
export declare class Session<TMetadata extends SessionMetadata = SessionMetadata> {
    constructor(storage: SessionStorage<TMetadata>, contextBuildOptions?: SessionContextBuildOptions);
    getMetadata(): Promise<TMetadata>;
    getStorage(): SessionStorage<TMetadata>;
    getLeafId(): Promise<string | null>;
    getEntry(id: string): Promise<SessionTreeEntry | undefined>;
    getEntries(): Promise<SessionTreeEntry[]>;
    getBranch(fromId?: string): Promise<SessionTreeEntry[]>;
    buildContextEntries(options?: SessionContextBuildOptions): Promise<SessionTreeEntry[]>;
    buildContext(options?: SessionContextBuildOptions): Promise<SessionContext>;
    appendMessage(message: AgentMessage): Promise<string>;
    // Other append/navigation methods omitted here; present in the source declaration.
}
```

Copied from `dist/harness/types.d.ts`:

```ts
export interface AgentHarnessOptions<...> {
    env: ExecutionEnv;
    session: Session;
    models: Models;
    tools?: TTool[];
    resources?: AgentHarnessResources<TSkill, TPromptTemplate>;
    systemPrompt?: string | ((context: { ... }) => string | Promise<string>);
    streamOptions?: AgentHarnessStreamOptions;
    model: Model<any>;
    thinkingLevel?: ThinkingLevel;
    activeToolNames?: string[];
    steeringMode?: QueueMode;
    followUpMode?: QueueMode;
}
```

### Public pinned coding-agent signatures

Copied from `dist/core/sdk.d.ts`:

```ts
export interface CreateAgentSessionOptions {
    /** Working directory for project-local discovery. Default: process.cwd() */
    cwd?: string;
    /** Global config directory. Default: ~/.pi/agent */
    agentDir?: string;
    // ... model, tools, loaders, and settings omitted ...
    /** Session manager. Default: SessionManager.create(cwd) */
    sessionManager?: SessionManager;
}
export declare function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
```

Copied from `dist/core/session-manager.d.ts`:

```ts
export declare class SessionManager {
    private sessionFile;
    private sessionDir;
    private cwd;
    private persist;
    // ...
    static create(cwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager;
    static open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager;
    static continueRecent(cwd: string, sessionDir?: string): SessionManager;
    /** Create an in-memory session (no file persistence) */
    static inMemory(cwd?: string, options?: NewSessionOptions): SessionManager;
}
```

Conclusion: coding-agent can be made non-persistent but does not expose a custom storage/writer interface. Core exposes exactly that interface.

## 2. Minimal host storage

Implemented in `src/host-session-storage.js`. It uses in-memory arrays/Maps for reads and a host-owned append-only JSONL stream for durability. Record kinds are only:

```text
{"op":"metadata",...}
{"op":"entry",...}
```

Opening a fresh instance replays those records. No pi JSONL repo/storage class is imported or used.

The first unit test exposed a non-obvious contract requirement: `Session.appendMessage()` calls `storage.appendEntry()` but does not separately call `setLeafId()`. Therefore the adapter's `appendEntry()` must update the active leaf. `setLeafId()` itself must append a typed `leaf` tree entry. The final adapter matches pinned `InMemorySessionStorage` behavior.

Unit-test command output:

```text
> spike-pi-storage@1.0.0 test
> node --test test/*.test.js

TAP version 13
# Subtest: test/host-session-storage.test.js
ok 1 - test/host-session-storage.test.js
  ---
  duration_ms: 884.562966
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
```

## 3–5. Turns, host truth, process death, continuity

The deterministic provider proof uses the pinned pi-ai faux provider, not a hand-written bypass of `AgentHarness`. Both turns call `AgentHarness.prompt()`. Turn 2's provider callback inspects the model context it receives and returns the nonce only if the replayed first turn is present.

Real command output:

```text
> spike-pi-storage@1.0.0 proof:offline
> bash scripts/run-two-process-proof.sh faux

{
  "first": {
    "pid": 24,
    "turn": "1",
    "mode": "faux",
    "text": "STORED ORCHID-7319",
    "stopReason": "stop",
    "entryCount": 2,
    "leafId": "bf2125f3-9da7-444f-8fe0-67fb6b721d67"
  },
  "second": {
    "pid": 40,
    "turn": "2",
    "mode": "faux",
    "text": "ORCHID-7319",
    "stopReason": "stop",
    "entryCount": 4,
    "leafId": "d06b6b0f-37b0-42ee-9980-f77a41819724"
  },
  "processBoundaryProved": true,
  "defaultSessionRoot": "/home/ubuntu/.pi/agent/sessions",
  "defaultSessionSnapshotBefore": "42d748c119fbc69c3b68bfb5902761f58f1a86f6df318323924f2592ca6082b1",
  "defaultSessionSnapshotAfterFirst": "42d748c119fbc69c3b68bfb5902761f58f1a86f6df318323924f2592ca6082b1",
  "defaultSessionSnapshotAfterSecond": "42d748c119fbc69c3b68bfb5902761f58f1a86f6df318323924f2592ca6082b1",
  "defaultSessionTreeUnchanged": true
}
```

The shell started `node src/turn-worker.js ... 1` and waited for it to exit. It then started a different `node src/turn-worker.js ... 2` using only the same host record path. PIDs 24 and 40 prove distinct processes. The second storage instance calls `HostSessionStorage.open(recordPath)` and reconstructs its Maps exclusively by replaying the host stream.

The record stream after turn 2 contained one metadata record and four entry records in this order:

```text
metadata
turn-1 user message, parentId null
turn-1 assistant message, parentId turn-1-user
turn-2 user message, parentId turn-1-assistant
turn-2 assistant message, parentId turn-2-user
```

### Exactly how default-session writes were checked

Before turn 1, after process 1 exited, and after process 2 exited, the script recursively enumerated every regular file below `/home/ubuntu/.pi/agent/sessions` as:

```text
relative-path|byte-size|mtime
```

It sorted that full listing and SHA-256 hashed it. All three hashes are exactly identical:

```text
42d748c119fbc69c3b68bfb5902761f58f1a86f6df318323924f2592ca6082b1
```

This asserts that no file appeared, disappeared, changed size, or changed modification time anywhere in pi's default session root during either turn. The harness was constructed with the custom `Session`; no `JsonlSessionStorage`, `JsonlSessionRepo`, or coding-agent `SessionManager` was constructed.

## Mandatory Gemini attempt: blocked, not passed

The prescribed Vault command failed before yielding a key:

```text
Get "http://127.0.0.1:8200/v1/sys/internal/ui/mounts/secret/agent/gemini": dial tcp 127.0.0.1:8200: socket: operation not permitted

Error: GEMINI_API_KEY is required
```

A pre-existing task-relevant Google API credential was present in `~/.pi/agent/auth.json`. Only its schema was printed, never the value:

```json
{"type":"object","keys":["type","key"],"fieldTypes":{"type":"string","key":"string"}}
```

Using that key, pinned pi reached the real `google/gemini-2.5-flash` provider path but outbound fetch was blocked. Exact command output:

```text
> spike-pi-storage@1.0.0 spike
> bash scripts/run-two-process-proof.sh gemini

Error: turn 1 failed: {"pid":29,"turn":"1","mode":"gemini","text":"","stopReason":"error","errorMessage":"fetch failed","entryCount":2,"leafId":"ac312c0e-3ec1-4e16-b3b7-efd6a49ccfd0"}
```

There is no assistant model reply to paste because the final assistant message was the pi error message above. A real Gemini continuity result remains unverified in this sandbox. Run `pnpm run spike` in an environment with outbound HTTPS after exporting the prescribed Vault key.

## 6. What the host still has to supply

The claim glosses over these requirements:

- **Execution environment object:** `AgentHarnessOptions.env` is mandatory. This spike supplies `NodeExecutionEnv`.
- **Working directory:** `NodeExecutionEnv` requires a `cwd`. Even with no tools it must be syntactically valid; tools and system-prompt logic may assume it exists.
- **Filesystem capability:** `ExecutionEnv` extends the full `FileSystem` interface (read/write/append, stat/list, path resolution, mkdir/remove, temp files/directories, cleanup). With `tools: []`, this spike observed no tool-driven filesystem access, but the concrete Node environment still carries those capabilities.
- **Shell/process capability:** `ExecutionEnv` also extends `Shell.exec`. Again unused with `tools: []`, but required by the interface and needed for coding tools.
- **Clock and randomness:** session entries use current ISO timestamps, assistant/user messages use timestamps, and the host adapter needs collision-resistant entry IDs.
- **Provider registry and auth:** the host supplies a `Models` collection, selected `Model`, credentials, outbound HTTPS, retry/abort behavior, and any proxy/network configuration.
- **Tool environment:** enabling coding tools introduces command binaries, environment variables, process lifecycle, filesystem permissions, output limits, and sandbox policy.
- **Durability semantics:** a production adapter needs atomic append/transactions, concurrency control, idempotency, corruption recovery, schema/version migration, and retention. The minimal JSONL spike assumes a single writer.
- **Compaction/branch semantics:** the adapter persists all `SessionTreeEntry` variants, including leaf, compaction, labels, custom entries, and model/thinking/tool changes. A host that stores only chat messages will lose pi behavior.
- **Resource loading/system prompt:** skills, prompt templates, project context, and extensions are application-owned at the harness layer. They may cause extra filesystem/environment dependencies if enabled.

## Deliverables

```text
package.json
src/host-session-storage.js
src/turn-worker.js
scripts/run-two-process-proof.sh
test/host-session-storage.test.js
NOTES.md
```

One installation caveat from this sandbox:

```text
[ERR_SQLITE_ERROR] unable to open database file
pnpm: unable to open database file
```

That was pnpm failing to open its global store database under the managed filesystem policy. The spike's `package.json` pins exact `0.80.7` dependencies. For this run, `node_modules` symlinks pointed at the already-installed on-disk 0.80.7 packages specified by the task.
