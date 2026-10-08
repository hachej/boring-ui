# @hachej/boring-execution

Optional working environments use Pi's public `FileSystem`, `Shell` and `ExecutionEnv` contracts. `/native` re-exports those contracts. `/contracts` adds acquisition and lease identity without requiring recovery, a shell or a Boring resource reference.

## Disposable virtual workspace

`/virtual` provides `createVirtualWorkspace`. Install the exact optional peer `just-bash@3.6.0` alongside the declared native peers. Seed absolute paths, acquire a native environment with an absolute cwd, or create a public upstream Bash instance.

```js
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';

const workspace = createVirtualWorkspace({
  providerId: 'scratch',
  files: { '/repo/note.txt': 'hello\n' },
});
const lease = await workspace.acquire({
  operationId: 'open-scratch', input: { cwd: '/repo' },
}, BACKGROUND_CONTEXT);
console.log(await workspace.createBash({ cwd: '/repo' }).exec('cat note.txt'));
await lease.release(BACKGROUND_CONTEXT);
workspace.dispose();
```

One upstream `InMemoryFs` stores all bytes. Public mutation adapters resolve aliases consistently for native access, Bash and Git. Leases share namespace identity and have independent cwd and cleanup. Releasing a lease closes only its native facade. Disposing the workspace prevents new acquisitions/Bash instances and closes native facades. Already returned raw filesystem and Bash handles remain trusted host-owned handles; disposal does not revoke them or terminate their commands.

Native read/write/append, directory access, symlinks and exclusive temporary files are exercised by public tests. Native rename, truncate and durable flush return `not_supported`. The backing refuses move and recursive directory copy. These refusals precede mutation. Hard links refuse with ENOTSUP. Virtual Bash refuses hard-link arguments before stock `ln -f` can remove an existing destination; symbolic links retain the stock command context. Concurrent structural changes to paths remain unqualified; this disposable adapter is not an authoritative publication provider or a POSIX filesystem qualification.

The native shell runs Pi's stock bash tool with buffered output: `onOutput` receives the combined stdout and stderr once when the command ends (never as a live stream), spill thresholds are accepted but nothing is spilled to a file, and `timeout` (seconds) aborts the command and returns `timeout`. Use public Bash `exec` for separate buffered stdout/stderr. Host Bash options select upstream limits and explicit network/custom commands. No native executable fallback or network transport is added. Host callbacks are trusted code.

Errors are bounded in one place (`boundedMessage` in `src/bounded-error.ts`, also used by the AWS Code Interpreter environment below): every error the native environment, the `git` command or a `fs` backing passes on toward a tool result is its message only, with stack-frame lines dropped even when a backing put them in the message, and at most `MAX_ERROR_CHARS` (2,000, exported from `/virtual`) characters. The whole error stays on `cause` for host logs. Command output itself is bounded by Pi's bash tool (its tail, 50 KB or 2,000 lines).

### Python (opt-in, Node only)

`createVirtualWorkspace({ providerId, python: true })` adds `python3` and `python` to every shell of the workspace (the native `exec`'s included): just-bash's CPython 3.13 compiled to WebAssembly, with the standard library, reading and writing the same files as the shell. It is off by default and is the only way to turn it on (shell options cannot). Limits: Node only, so it throws a clear `TypeError` in a browser or its workers; the runtime (about 10 MB, shipped inside `just-bash`) loads on the first call (about a second here; later calls about half a second); its memory is not contained by the shell's execution limits, so a script can grow the host process; there is no pip, package installation or network. A Python traceback is the script's own output and passes through unchanged.

## Optional local Git

`/virtual-git` requires `isomorphic-git@1.42.6` and `@hachej/boring-files/git`. `createVirtualGitFs(workspace.filesystem)` supplies its public promise filesystem. The host creates one `createGitRepository({ fs, directory, author, authorize })`, then calls `installVirtualGitCommand({ bash, repository })`. Installation verifies the actual public `bash.fs` identity. Each command requires the selected root cwd. Native tools receive the same repository instance.

The command supports local `init`, matrix `status`, single-path `add`, index-only `rm --cached`, `commit -m`, bounded `log`, `branch`, `checkout`, and binary-content JSON `diff` or `diff --cached`. Other argument forms return exit 126. [The files guide](../files/README.md) owns authorization, serialization and diff semantics. No remote transport, durable recovery or publication transaction is claimed. Raw `.git` writes remain subject to the selected filesystem's host policy.

Run `node examples/virtual-workspace.mjs` after building for a fictional shared native/Bash/Git example. `test/packages/execution.test.mjs` exercises public output and actual native ToolTasks. `npm run test:virtual-consumer` installs the tarball and exact registry dependency closure outside the repository, checks declarations and repeats those tests. Set `npm_config_cache` to a writable cache containing the pinned archives.

## Borrowed remote Shell

`/remote-shell` exports paired `createRemoteShellHandler` and `createRemoteShellLease` Fetch adapters over native Pi `Shell`. This subpath needs only the pinned native peers. It does not load virtual Bash, Git, Boring files or an agent implementation. The host authenticates each POST, enforces origin/CSRF policy, selects an already acquired workspace, and provides its native Shell, Context, exact identity, revocation signal and command authorization callback. Authorization must return `true` and runs before execution and terminal disclosure. Abort the revocation signal when access or workspace identity changes, including during silent commands.

The client takes that expected identity, a fixed HTTP(S) endpoint and an explicit authenticated Fetch function. The transport must honor `redirect: 'error'` and must not retry command requests. Both ends bind provider, instance, incarnation and selected view. The server checks identity before effects. The client checks identity before delivering output, validates ordered request-bound frames and requires exactly one terminal result followed by EOF. A lost or malformed acknowledgement returns native `ExecutionError('unknown')`; the client never replays the command. A request identifier correlates frames, not a durable idempotency or recovery record.

Command strings, cwd, environment and native exit/error results pass through. Output callbacks receive live combined text and the caller's Context. Exit-only calls do not request output frames. Positive fractional timeout values use native **seconds**, with the provider responsible for its additional limits. Hosts explicitly qualify timeout and spill support; unsupported requested features refuse before execution. Spill paths remain in the remote workspace and need a separately authorized file capability to retrieve them. No dummy filesystem is supplied.

Transport defaults are 64 KiB per request, 1 MiB per frame and 4 MiB of queued server frames. Oversized output or an overfull queue interrupts observation rather than reporting truncated success. These bounds do not cap native output production or Fetch/provider peak memory. Host native execution limits remain necessary. Local cancellation, callback failure or lease release requests remote cancellation and reports unconfirmed termination; prior effects can remain. Each borrowed lease owns only its active transports, and never calls the shared provider's cleanup.

Run `node examples/remote-shell.mjs` for an actual native command through in-process Request/Response streaming. `npm run test:remote-shell-consumer` installs only the execution tarball and pinned native registry closure, checks strict declarations and repeats public native tests without the virtual/Git/Boring UI/agent peers. The handler reads request bodies through `@hachej/boring-files/request-guard`, so install `@hachej/boring-files` (an optional peer) with this subpath; the consumer installs its archive. This establishes the paired Fetch protocol and selected native behavior. Socket deployment, vendor provisioning/reattachment, durable command admission/recovery, independent file grants, protected builds and process-tree termination remain separate qualifications.

## Borrowed remote FileSystem

`/remote-files` exports `createRemoteFileSystemHandler` and `createRemoteFileSystemLease` over native Pi `FileSystem`. Install the exact optional peer `zod@4.6.5` with the declared native peers. This entry does not require a shell, virtual Bash, Git, Boring files, UI or an agent implementation.

The host authenticates each POST and selects an already acquired workspace. Its `bindFileSystem(cwd, context)` returns a `WorkspaceLease<FileSystem>` over that namespace with the requested cwd. The adapter checks the actual lease identity, native filesystem ID and cwd before execution and disclosure. Bind distinct facades for concurrent incompatible cwd values. Binding must not provision or silently recreate a workspace. The handler releases each bound lease after its operation, or after closing its native line reader. It never invokes shared provider cleanup.

`authorize(call, cwd)` receives a discriminated native method/argument tuple and must return literal `true`. The handler checks authorization before and after each operation and stream read. Abort the host revocation signal when authorization or workspace identity changes, including while a reader is idle. Authentication, origin/CSRF policy, path and symlink confinement, deadlines and provider limits remain host responsibilities. Native temporary-file operations retain provider semantics, which can place files outside cwd. A cwd check alone is not a path grant.

The client captures cwd and arguments for each invocation. Native path, binary, metadata, text and mutation results pass through validated request-bound envelopes. Native errors retain their code, message and optional path. A lost, malformed or post-dispatch cancelled acknowledgement returns `FileError('unknown')` and can follow prior effects. There is no automatic retry, rollback or durable deduplication. The request ID correlates the response only. Authoritative published resources use their separate conditional publication contract.

`openTextLineReader` retains one streamed native reader. Frames preserve strict LF splitting and each line's `terminated` flag. A cancelled `readLine` wait leaves its pending frame available for the next call. Cancelling the original open context after successful opening does not close the reader. Concurrent reads refuse. Explicit close or lease release cancels local observation; server cleanup closes the reader before releasing its facade. Client close does not wait for a remote cleanup acknowledgement or prove remote termination.

Defaults are 1 MiB per request, 4 MiB per normal JSON response and 1 MiB per stream frame. Binary values travel as canonical base64 text (protocol version 2; version 1 byte arrays are refused). Server backpressure queues at most one frame and reads on demand, with a read possibly in flight. These limits bound accepted transport data, not native reader allocation, JSON expansion, Fetch allocation or provider production. Oversized data refuses instead of reporting truncated success.

Run `node examples/remote-files.mjs` after building to write and stream a fictional native file without a shell capability. `npm run test:remote-files-consumer` installs the execution and files tarballs (this subpath reads bodies through `@hachej/boring-files/request-guard`) and pinned registry dependencies, checks strict declarations and exercises actual native files, a native ToolTask and reader lifetime races. Its pinned `buffer` fixture dependency keeps undici's bare type import inside the isolated installation when the temporary directory has a parent workspace. In-process Fetch evidence does not qualify deployed sockets, vendor lifecycle, acquisition recovery, protected builds or complete exposure policy.

## Virtual repository saved in SQLite

`createVirtualWorkspace({ providerId, fs })` keeps the files in a Pi `FileSystem` instead of memory, for example the SQLite workspace backend `openSqliteFileSystem` of `@hachej/boring-files/sqlite-filesystem`: the shell, isomorphic-git and the native environment then work on the very rows a workspace provider over the same `fs` reads and writes (one view, no copy). That backend has regular files and directories only: `ln` is refused, `chmod` changes nothing (files report 0644, directories 0755) and `touch` sets the modification time to now.

`@hachej/boring-execution/virtual-sqlite` is a git repository on such a file system: `openVirtualRepository({ fs, root?, seed?, seedMessage?, author?, context, providerId? })` returns `{ root, env, repository, close() }`. `fs` is the SQLite file system over `openBrowserSqliteConnection` (`@hachej/boring-browser/sqlite`) in a browser tab, or over `openNodeConnection` (`@hachej/boring-files/sqlite`) in Node. It composes the pieces above and adds no file or shell API of its own (BORING-PI-6): read, list, write and run commands through `env`, Pi's native `ExecutionEnv`, whose `exec` shell has the `git` command bound to `repository` (`@hachej/boring-files/git`) on the same files (the stock virtual environment creates a shell without it). Every write lands in SQLite as it happens; there is nothing to save, and `close()` only releases the workspace. When `root` has no `.git` yet it is filled from `seed` (paths relative to `root`) and committed; otherwise the files and history are the stored ones.

## AWS Code Interpreter environment

`@hachej/boring-execution/aws-code-interpreter` needs the exact optional peer `@aws-sdk/client-bedrock-agentcore@3.1146.0`; the host passes its own `BedrockAgentCoreClient` (region, credentials, retries). It makes no AWS call except the session start, the command tools and `stop()`, and creates no AWS resource. The recipe that uses it is [examples/aws](../../examples/aws/README.md); the decisions are in [HOST-RECIPE-AWS.md](../../docs/architecture/HOST-RECIPE-AWS.md).

`createCodeInterpreterEnv({ client, codeInterpreterIdentifier, session, id, mount, cwd?, umask?, pollIntervalMs? })` returns `{ env, owned, sessionId(), lost(), renew(), stop(context) }`. `env` is one native Pi `ExecutionEnv` over one folder that both this host and the Code Interpreter session mount (an EFS access point): `mount.path` is where the session sees it (`/mnt/<name>`), `mount.root` where this host does. Tool paths are session paths, so commands and file tools name the same file.

- **Commands** run through `startCommandExecution`, then `getTask` every `pollIntervalMs` (500 ms by default) until a terminal status. The cwd, environment (`env`, or `env -i` for `inheritEnv: false`) and `umask` (default `002`) are prefixed to the command, which runs under `bash -c`. `onOutput` receives the new part of stdout, then of stderr, after each poll; spill thresholds are accepted and nothing is spilled. `timeout` (seconds) and an aborted context call `stopTask` and return `timeout`/`aborted`, termination unconfirmed. A `failed` status with an exit code is a normal result.
- **Files** run on this host's mount through Pi's `NodeExecutionEnv`: no bytes cross the API. A path outside `mount.path`, or one whose resolution (symbolic links included, dangling ones followed by hand) leaves `mount.root`, returns `FileError('permission_denied')`; operations that do not follow a final link (`fileInfo`, `exists`, `remove`, `renameFile`) check its directory. Paths in results and errors are session paths. `createTempDir`/`createTempFile` return `not_supported` (a temporary file here would be invisible to the session). The check and the use are separate steps: a link changed in between by a concurrent command is not caught.
- **Session**: `{ sessionId }` borrows a running session, which `stop()` never ends; `{ start: { name?, sessionTimeoutSeconds?, filesystemConfigurations? } }` starts one on the first command and `stop()` ends it once. `env.cleanup()` never stops a session. When the service reports the session gone (`ResourceNotFoundException`), the running and every later command return `shell_unavailable` and `lost()` is true; files stay. `renew()` (started sessions only) lets the next command start a new session. Service and file errors map to `ExecutionError`/`FileError` with messages bounded by the same `boundedMessage` (no stack frames, at most `MAX_ERROR_CHARS`).

`efsUserLayout({ userId, uid, gid?, runtimeMountPath?, runtimeAccessPointRoot?, interpreterMountPath? })` is pure: for a user id (`[a-z0-9][a-z0-9_-]{0,63}`, never a path) and a host-allocated uid it returns the access point to create (root `/boring/users/<id>`, POSIX user `uid:1000`, setgid `2770`, a `boring:user` tag), the session mount (`/mnt/workspace`), this host's folder (`/mnt/efs/users/<id>`), the state directory outside it (`/mnt/efs/state/<id>`, with `journal.sqlite` and `harnessFile(key)`), the namespace id and the `filesystemConfigurations` entry.

`test/packages/execution.test.mjs` drives the real SDK client against `examples/aws/fake-code-interpreter.mjs` (the wire format, without AWS): shared files, output, exit codes, cwd and environment, timeout and abort through `stopTask`, a lost session and `renew`, borrowed versus owned stop, and two users who never see each other's folders (`..`, absolute paths, links and dangling links made by a command). Nothing has run against the real service; see the open questions in HOST-RECIPE-AWS.md.

