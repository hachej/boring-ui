# Host recipe: AWS (AgentCore Runtime + Code Interpreter + EFS)

Status: **built and proven offline; never run against AWS** (no account yet). Owner: the host-recipe track in [ROADMAP.md §10](ROADMAP.md#10-package-useful-recipes-and-keep-one-source-of-instructions).
Code: [`@hachej/boring-execution/aws-code-interpreter`](../../packages/execution/README.md#aws-code-interpreter-environment) and [`examples/aws`](../../examples/aws/README.md). Facts about AWS services were checked against AWS documentation and the `@aws-sdk/client-bedrock-agentcore@3.1146.0` model on 2026-10-06 (links at the end); re-check them before the live run.

## Goal

One executable recipe that runs a library agent (`defineAgent`, document/artifact/ask-user tools, chat transport) on AWS
with durable Pi state, a real shell, and the `pi-chat` UI talking to it, the same way the studio does locally. It is a
recipe, not a framework: native AWS pieces wired directly, no generic multi-cloud deploy layer, no second harness or
scheduler (BORING-PI-1..6). Cloudflare (`PiHarness` in a Durable Object) is the sibling recipe; both share only the
library adapters listed under "Library work".

## What AWS supports (checked 2026-10-06)

- **Code Interpreter can mount EFS**, per interpreter or per session: `filesystemConfigurations` with `efsConfiguration { accessPointArn, fileSystemArn, mountPath }` on `CreateCodeInterpreter` (inherited by every session) or `StartCodeInterpreterSession` (that session only); both are combined. It needs VPC network mode, subnets in the mount targets' Availability Zones, TCP 2049 to the mount targets, and `elasticfilesystem:ClientMount`/`ClientWrite` on the **interpreter's execution role** with an `AccessPointArn` condition. At most 2 EFS access points per request (4 per session); mount paths are `/mnt/<name>`; a failed mount fails the session start. All operations through an access point run as its POSIX uid/gid. ([Code Interpreter file systems](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-filesystem-configurations.html), [StartCodeInterpreterSession](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_StartCodeInterpreterSession.html).) The CloudFormation type `AWS::BedrockAgentCore::CodeInterpreterCustom` (cfn-lint 1.57.2 schema) has VPC network configuration but no file system property, so the recipe mounts per session, which is also what per-user folders need.
- **AgentCore Runtime can mount EFS** (`filesystemConfigurations[].efsAccessPoint`, VPC mode, `/mnt/<name>`, at most 2 EFS access points), but **per runtime, mounted into every session**: a session cannot choose a per-user access point. ([Runtime file systems](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-filesystem-configurations.html).) ECS task definitions are likewise static per task definition.
- **Code Interpreter tools** (`InvokeCodeInterpreter`, response is an event stream of `result` events or exceptions): `executeCode`, `executeCommand`, `startCommandExecution`, `getTask`, `stopTask`, `readFiles`, `writeFiles`, `listFiles`, `removeFiles`; arguments `command`, `taskId`, `paths`, `content[{ path, text | blob }]`, `directoryPath`; results carry `content` blocks and `structuredContent { taskId, taskStatus: submitted | working | completed | canceled | failed, stdout, stderr, exitCode, executionTime }`. Commands take no cwd or environment argument. The official Python client documents file paths as **relative to the interpreter's working directory** (absolute paths refused), so the file tools cannot address the EFS mount by absolute path; the response shapes of `getTask` (cumulative or incremental output) are not documented. ([API reference examples](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-api-reference-examples.html), [InvokeCodeInterpreter](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_InvokeCodeInterpreter.html).) Sessions last `sessionTimeoutSeconds` (default 900, maximum 28 800).
- **Runtime HTTP contract**: `POST /invocations` (JSON in, JSON or SSE out), `GET /ping` (`Healthy` | `HealthyBusy`; `HealthyBusy` keeps the session active; `time_of_last_update` must change only with the status), optional `/ws`, ARM64 container on `0.0.0.0:8080`. ([HTTP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html).)

## Mapping (as built)

| Need | AWS piece | Library seam |
|---|---|---|
| Agent process and lifecycle | **AgentCore Runtime** (one session for the host) or one **ECS** task | `examples/aws/server.mjs`: `/ping`, `/invocations`; one native Harness for every user, the workspace per call from its env ([Workspace per call](FILES-GIT-EXEC.md#workspace-per-call)) |
| Durable Pi state | EFS through the host's access point (root `/boring`, mounted at `/mnt/efs`) | Pi Durable SQLite at `/mnt/efs/state/harness.pi.sqlite`, one file for the host |
| Workspace files | The user's folder `/mnt/efs/users/<user>` on the same mount | `createWorkspaceProvider` over the environment below; journal at `/mnt/efs/state/<user>/journal.sqlite`, outside the folder |
| Real shell | **Code Interpreter** session per user, mounting the user's own access point (root `/boring/users/<user>`) at `/mnt/workspace` | `createCodeInterpreterEnv`: commands through `startCommandExecution`/`getTask`/`stopTask`, files on the host's mount of the same folder |
| Browser chat | `pi-chat` + `createRemoteChat` | The chat transport operations in the `/invocations` body (`{ op, conversation, params, input }`); a browser fetch adapter is not built |
| Identity | AgentCore JWT authorizer (Cognito or another OIDC issuer), checked again in the container | `examples/aws/jwt.mjs`; `sub` → `users.json` (uid, access point) is host policy |

## Decisions and why

1. **One process, one harness for every user.** The harness's `env(target, context)` resolves the conversation's owner (`<user>/<key>` in its managed metadata) to that user's workspace, opened by one `createWorkspaceCache` entry: the user's folder, their Code Interpreter session (started with their access point, looked up when the workspace opens) and the provider with its journal, so file tools and commands of a call see the same instance; it closes when idle and reopens on the next use. Pi's file has one writer, this process: on ECS one task and never two during a deployment; on AgentCore Runtime every client sends the host's one session id (`RUNTIME_SESSION_ID`, other ids are refused with 409), so one microVM serves everyone. One harness per conversation key (a microVM each, `@hachej/boring-agent/harness-pool`) is the alternative, described in the [example README](../../examples/aws/README.md#harness-per-owner).
2. **Durable state on EFS, not managed session storage.** Managed session storage is per-session and **wiped on every runtime version update** and after 14 idle days. Pi state and published files must survive deploys, so they live on EFS.
3. **One SQLite file per writer, opened with the network file system preset.** EFS is NFS (close-to-open consistency, advisory locks): one harness file and a journal per user, written only by the one process. Every SQLite file on EFS is opened with `sqliteSettings.networkFilesystem` from `@hachej/boring-files/sqlite` (the host option `sqlite` of `startAwsHost`): `journal_mode=DELETE` (WAL's shared-memory index is unsafe across hosts), `locking_mode=EXCLUSIVE` with the lock taken at open and held until close (a second opener, for example a second task or session by mistake, gets `SqliteLockedError` after the busy timeout instead of writing beside the owner), `synchronous=FULL`, `busy_timeout=10000`, `temp_store=MEMORY`. The journal goes through `openNodeConnection(file, settings)`. Pi's harness files go through Pi's public adapter: `SqliteStorage.open(new NodeSqliteDatabase(openNodeDatabase(file, settings)))` (`examples/shared/pi-storage.mjs`), because Pi's own `openNodeSqliteStorage(path, { walAutoCheckpointPages?, busyTimeoutMs? })` always runs `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL` and has no option for either; its `NodeSqliteDatabase` constructor and `SqliteStorage.open` are public, so nothing of Pi is patched. Remaining Pi detail: `NodeSqliteDatabase.close()` runs `PRAGMA wal_checkpoint(TRUNCATE)`, a no-op outside WAL. Latency of the rollback journal on EFS is still to measure.
4. **Idle termination vs background work.** `/ping` reports `HealthyBusy` while the harness has live tasks or unsettled submissions (`Harness.inspect`), with a stable `time_of_last_update`. Whether that holds a session past `idleRuntimeSessionTimeout` (900 s) is to verify; nothing reopens a stopped session by itself (an EventBridge Scheduler wake is not built).
5. **Code Interpreter as the execution environment, not the agent host; the files stay where they are.** The owner's design: the runtime and the interpreter see the same EFS folder. Because the runtime cannot mount per user, it mounts the host access point and confines itself in code to the user's folder; the interpreter, which runs the agent's commands, is confined by the user's access point. File operations run on the runtime's mount (no bytes through the API, no copy, no sync: one place for files, [FILES-GIT-EXEC](FILES-GIT-EXEC.md#one-place-for-files)); tool paths are interpreter paths (`/mnt/workspace/...`) so commands and file tools name the same file. Symbolic links made in the interpreter are resolved on the runtime side before use and refused when they leave the folder. An expired session is reported lost (`shell_unavailable`); the host renews explicitly and the next command starts a new session on the same files.
6. **POSIX identity.** Each user's access point has the user's own uid and the shared gid 1000 with setgid `2770` folders; the runtime's access point is uid/gid 1000; both sides use umask `002`, so either side can change what the other wrote.
7. **Transport over `/invocations`.** AgentCore routes only `/invocations`, `/ping` and `/ws`, so the operation travels in the JSON body and the server forwards it to the unchanged chat transport handler. `watch` streams NDJSON; whether `InvokeAgentRuntime` streams a non-SSE body is to verify. Behind the ECS load balancer (or any proxy) the idle watch stays open only through the transport's heartbeat (`heartbeatMs`, default 15 s): keep the idle timeout at least twice the heartbeat (the template sets 120 s; the ALB default of 60 s also works) and see [Testing behind a proxy](../../examples/studio/README.md#testing-behind-a-proxy-headless).
8. **Models** through Pi AI's `amazon-bedrock` provider with an inference profile and VPC endpoints; the template has no NAT gateway, so the JWKS is passed inline (`OIDC_JWKS`).

## Implemented (offline)

- `@hachej/boring-execution/aws-code-interpreter`: `createCodeInterpreterEnv({ client, codeInterpreterIdentifier, session: { sessionId } | { start }, id, mount: { path, root }, cwd?, umask?, pollIntervalMs? })` returns `{ env, owned, sessionId(), lost(), renew(), stop(context) }`; `efsUserLayout({ userId, uid, gid?, runtimeMountPath?, runtimeAccessPointRoot?, interpreterMountPath? })` is pure. The SDK is an exact optional peer (`3.1146.0`).
- `examples/aws`: server, JWT check, fake Code Interpreter, offline journey, CloudFormation template (VPC endpoints, EFS with host and example user access points, Code Interpreter in VPC mode, least-privilege roles, AgentCore Runtime with JWT authorizer and lifecycle 900/28 800 s, or ECS Fargate ARM64 behind an HTTPS load balancer with a 120 s idle timeout and one task), Dockerfile, user provisioning printout.
- Studio variant `aws` (`STUDIO_AWS=fake`) and scenario `aws-shared-folder`.
- Evidence and its limits: [PARTIAL.md](../implementation/PARTIAL.md#aws-code-interpreter-environment-and-host-recipe-offline), [FEATURES.md](../implementation/FEATURES.md).

## Remaining

- **The live run** ([commands](../../examples/aws/README.md#live-run-pending-needs-an-aws-account)) and the acceptance journey below.
- A browser fetch adapter from `createRemoteChat` to `/invocations` (or `op` in the body as a transport option), and the deployed UI.
- Wake for pending background work after an idle stop; provisioning users (access point, `users.json`) as a host workflow (boring-factory) rather than a printout.

## Acceptance for the recipe

A journey (real browser, real model) against the deployed endpoint: chat with streaming and a tool call; create and
edit an artifact; run a shell command in the Code Interpreter; reload and see history; force a session stop
(`StopRuntimeSession`) and a runtime version update, then resume and see the same conversation, documents and
pending work recovered; a second user cannot read the first user's scope. Costs and limits recorded.

## Open questions (for the live run)

- `/ping` busy semantics and whether they hold a session past the idle timeout.
- Streaming of the NDJSON `watch` body through `InvokeAgentRuntime`; WebSocket session limits.
- Whether `RequestHeaderAllowlist: [Authorization]` passes the bearer to the container.
- `getTask` output shape (cumulative or incremental stdout, statuses on failure) and command length limits.
- Whether `StartCodeInterpreterSession` with `filesystemConfigurations` needs any EFS permission on the caller.
- SQLite latency on EFS with the network file system preset (rollback journal, exclusive lock), and whether EFS's NFSv4 advisory locks hold that lock across a client failover; per-user interpreter cold start; costs.

## Sources

- Code Interpreter file systems: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-filesystem-configurations.html
- StartCodeInterpreterSession: https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_StartCodeInterpreterSession.html
- InvokeCodeInterpreter: https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_InvokeCodeInterpreter.html
- Code Interpreter API examples: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-api-reference-examples.html
- AgentCore Runtime file systems: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-filesystem-configurations.html
- AgentCore Runtime HTTP contract: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html
- AgentCore lifecycle settings: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html
- Official Python client (relative file paths): https://github.com/aws/bedrock-agentcore-sdk-python/blob/main/src/bedrock_agentcore/tools/code_interpreter_client.py
- Cloudflare PiHarness (sibling recipe): https://developers.cloudflare.com/changelog/post/2026-10-02-pi-harness/
