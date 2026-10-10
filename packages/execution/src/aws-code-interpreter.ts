import { posix } from 'node:path';
import { lstat, readlink, realpath } from 'node:fs/promises';
import { InvokeCodeInterpreterCommand, StartCodeInterpreterSessionCommand, StopCodeInterpreterSessionCommand } from '@aws-sdk/client-bedrock-agentcore';
import type { BedrockAgentCoreClient, CodeInterpreterResult, ToolArguments, ToolName, ToolsFileSystemConfiguration } from '@aws-sdk/client-bedrock-agentcore';
import type { Context } from '@earendil-works/chord';
import { ExecutionError, FileError, err, ok } from '@earendil-works/pi-durable/env';
import type { ExecutionEnv, FileInfo, Result, ShellExecOptions, ShellExecResult, WatchTarget } from '@earendil-works/pi-durable/env';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { boundedMessage } from './bounded-error.js';
import { shellCommand } from './fs-readers.js';

/** What the adapter sends: the host's own `BedrockAgentCoreClient` (it owns region, credentials and retries). */
export type CodeInterpreterClient = Pick<BedrockAgentCoreClient, 'send'>;

/** Options of a session the adapter starts on the first command, and stops only through `stop()`. */
export interface CodeInterpreterStart {
  readonly name?: string;
  /** Session time to live in seconds: AgentCore default 900, maximum 28 800. */
  readonly sessionTimeoutSeconds?: number;
  /** The per-user EFS access point (`efsUserLayout(...).filesystemConfiguration(...)`); mounts at session start. */
  readonly filesystemConfigurations?: readonly ToolsFileSystemConfiguration[];
}

export interface CodeInterpreterEnvOptions {
  readonly client: CodeInterpreterClient;
  /** A custom Code Interpreter in VPC network mode (an EFS mount needs it). */
  readonly codeInterpreterIdentifier: string;
  /** Borrow a running session (`{ sessionId }`: never stopped here) or own one (`{ start }`: started on the first command). */
  readonly session: { readonly sessionId: string } | { readonly start: CodeInterpreterStart };
  /** The file namespace id: equal ids see the same files (for example `efsUserLayout(...).namespaceId`). */
  readonly id: string;
  /**
   * The one folder both sides see: `path` is where the interpreter session mounts it (`/mnt/<name>`), `root` is the same
   * folder on this host (the runtime's own mount of the file system). Tool paths are interpreter paths; file operations
   * run on `root`, refusing any path or symbolic link that leaves it.
   */
  readonly mount: { readonly path: string; readonly root: string };
  /** Working directory, an interpreter path inside `mount.path` (default `mount.path`). */
  readonly cwd?: string;
  /** Prefixed to every command: `umask 002` keeps files group-writable for the runtime (see efsUserLayout). */
  readonly umask?: string;
  /** Delay between `getTask` polls while a command runs (default 500 ms). */
  readonly pollIntervalMs?: number;
  /**
   * What happens after a started session is lost or nearly expired. `'auto'` (default for `{ start }`): the failing
   * command still returns `shell_unavailable` (it is never replayed: it may have had side effects) and the NEXT command
   * starts a new session; a session older than `sessionTimeoutSeconds - rotateMarginSeconds` is replaced before the next
   * command, never while a command runs. `'manual'`: only `renew()` starts a new session. A borrowed session is always manual.
   */
  readonly renew?: 'auto' | 'manual';
  /** Seconds before the session time to live at which `'auto'` rotates (default 60; at most half the time to live). */
  readonly rotateMarginSeconds?: number;
}

export interface CodeInterpreterEnv {
  /** Pi's native environment: files on the shared mount, commands in the interpreter session. */
  readonly env: ExecutionEnv;
  /** Whether `stop()` ends the session (a started session) or leaves it to its owner (a borrowed one). */
  readonly owned: boolean;
  /** The session commands run in, once known. */
  sessionId(): string | undefined;
  /** True once the service reported the session gone (expired or stopped); commands then fail with `shell_unavailable`. */
  lost(): boolean;
  /** A started session only: after a loss, the next command starts a new session. Returns false for a borrowed session. */
  renew(): boolean;
  /** Stops a started session (idempotent). A borrowed session is left running. `env.cleanup` never stops a session. */
  stop(context: Context): Promise<void>;
}

const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
const MOUNT_PATH = /^\/mnt\/[A-Za-z0-9._-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const within = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
const errorName = (error: unknown): string => typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : 'Error';
const errorText = (error: unknown): string => boundedMessage(error);
const sleep = (ms: number, signal: AbortSignal | undefined): Promise<void> => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

/**
 * Error names and messages, besides `ResourceNotFoundException`, taken to mean "the session ended".
 * UNVERIFIED against the real AgentCore service (open question in HOST-RECIPE-AWS.md): they are the likely shapes of an
 * expired or terminated session. `AccessDeniedException` is deliberately NOT here: it is a permissions problem and
 * renewing would not fix it. Matching needs both a listed name and a message pattern.
 */
export const SESSION_ENDED_ERRORS: readonly { readonly name: string; readonly message: RegExp }[] = [
  { name: 'ValidationException', message: /session.*(terminat|expir|not (found|active|running)|no longer|ended|stopped)|(terminat|expir|stopped).*session/i },
  { name: 'ConflictException', message: /session.*(terminat|expir|stopped|ended)/i },
];
const sessionEnded = (error: unknown): boolean => {
  const name = errorName(error);
  if (name === 'ResourceNotFoundException') return true;
  const message = typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
  return SESSION_ENDED_ERRORS.some(entry => entry.name === name && entry.message.test(message));
};

/** A stream error member of `InvokeCodeInterpreter` (the service reports some failures inside the stream). */
const STREAM_ERRORS = ['accessDeniedException', 'conflictException', 'internalServerException', 'resourceNotFoundException', 'serviceQuotaExceededException', 'throttlingException', 'validationException'] as const;

class ServiceError extends Error {
  constructor(name: string, message: string) { super(message); this.name = name; }
}

/**
 * A native Pi `ExecutionEnv` over an AgentCore Code Interpreter session whose sandbox mounts the same folder this host
 * mounts. Commands run in the session through the task API (`startCommandExecution`, `getTask`, `stopTask`); file
 * operations run on this host's mount of the folder, so the agent's file tools, the workspace provider and the commands
 * see the same bytes without copying them through the API. Nothing here creates AWS resources or credentials.
 */
export function createCodeInterpreterEnv(options: CodeInterpreterEnvOptions): CodeInterpreterEnv {
  const { client, codeInterpreterIdentifier } = options;
  const mountPath = posix.normalize(options.mount.path), root = posix.resolve(options.mount.root);
  if (!MOUNT_PATH.test(mountPath) || mountPath === '/mnt/.' || mountPath === '/mnt/..') throw new TypeError('mount.path must be /mnt/<name>, as AgentCore requires');
  if (!options.id) throw new TypeError('A file namespace id is required');
  const cwd = posix.resolve(mountPath, options.cwd ?? mountPath);
  if (!within(cwd, mountPath)) throw new TypeError('cwd must be inside mount.path');
  const umask = options.umask ?? '002';
  if (!/^[0-7]{3,4}$/.test(umask)) throw new TypeError('umask must be octal');
  const pollMs = options.pollIntervalMs ?? 500;
  const borrowed = 'sessionId' in options.session ? options.session.sessionId : undefined;
  const start = 'start' in options.session ? options.session.start : undefined;
  const auto = start !== undefined && (options.renew ?? 'auto') === 'auto';
  const ttlMs = (start?.sessionTimeoutSeconds ?? 900) * 1000;
  const marginMs = Math.min((options.rotateMarginSeconds ?? 60) * 1000, ttlMs / 2);
  let sessionId = borrowed, starting: Promise<string> | undefined, lost = false, stopped = false, incarnation = 0, startedAt = 0;
  // Rotation: the old session stays `sessionId` until the new one is up; a failed Start backs off instead of retrying on every command.
  let rotating: Promise<void> | undefined, rotateRetryAt = 0;
  const retired = new Set<string>();
  // Holds per session: a command pinned to it, or a remote task started there whose end is not confirmed (a transport
  // failure leaves the task running). A session with holds is never rotated away from and never stopped proactively.
  const holds = new Map<string, number>();
  const hold = (id: string): void => { holds.set(id, (holds.get(id) ?? 0) + 1); };
  const release = (id: string): void => {
    const left = (holds.get(id) ?? 1) - 1;
    if (left > 0) holds.set(id, left); else holds.delete(id);
    if (left <= 0 && retired.delete(id)) void stopSession(id).catch(() => {});
  };
  const stopSession = async (id: string, signal?: AbortSignal): Promise<void> => {
    try { await client.send(new StopCodeInterpreterSessionCommand({ codeInterpreterIdentifier, sessionId: id }), signal ? { abortSignal: signal } : {}); }
    catch (error) { if (errorName(error) !== 'ResourceNotFoundException') throw error; }
  };
  const local = new NodeExecutionEnv({ cwd: root });

  // ---- Session: borrowed or owned, started lazily, reported lost instead of silently replaced.
  // The start is never cancelled half way: an abandoned start could leave a session nobody stops.
  async function session(): Promise<string> {
    if (lost) throw new ServiceError('SessionLost', 'The Code Interpreter session is gone (expired or stopped); files on the mount remain');
    if (stopped) throw new ServiceError('SessionStopped', 'The Code Interpreter session was stopped by its owner');
    if (sessionId) return sessionId;
    if (!start) throw new ServiceError('SessionMissing', 'No Code Interpreter session');
    return begin();
  }

  async function startRaw(): Promise<string> {
    if (!start) throw new ServiceError('SessionMissing', 'No Code Interpreter session');
    const response = await client.send(new StartCodeInterpreterSessionCommand({
      codeInterpreterIdentifier,
      ...(start.name === undefined ? {} : { name: start.name }),
      ...(start.sessionTimeoutSeconds === undefined ? {} : { sessionTimeoutSeconds: start.sessionTimeoutSeconds }),
      ...(start.filesystemConfigurations === undefined ? {} : { filesystemConfigurations: [...start.filesystemConfigurations] }),
    }));
    if (!response.sessionId) throw new ServiceError('SessionMissing', 'StartCodeInterpreterSession returned no session id');
    return response.sessionId;
  }

  function begin(): Promise<string> {
    if (!start) throw new ServiceError('SessionMissing', 'No Code Interpreter session');
    const attempt = incarnation;
    return starting ??= (async () => {
      const id = await startRaw();
      if (attempt === incarnation) { sessionId = id; startedAt = Date.now(); }
      return id;
    })().finally(() => { starting = undefined; });
  }

  /**
   * Before a command (`'auto'` only): a lost session is replaced, and one near its time to live is rotated when it has
   * no holds (no pinned command, no task whose end is unconfirmed). The old session stays current until the new one is
   * up, so a failed Start leaves everything working on the old one and backs off; once replaced, the old one is stopped
   * when its last hold ends.
   */
  async function prepare(): Promise<void> {
    if (!auto || stopped) return;
    if (lost) { lost = false; sessionId = undefined; incarnation++; return; }
    const current = sessionId;
    if (!current || starting || rotating || holds.has(current) || Date.now() < rotateRetryAt || Date.now() - startedAt <= ttlMs - marginMs) return;
    const attempt = incarnation;
    rotating = (async () => {
      try {
        const id = await startRaw();
        if (attempt !== incarnation) { void stopSession(id).catch(() => {}); return; }
        sessionId = id; startedAt = Date.now(); lost = false;
        retired.add(current);
        if (!holds.has(current)) { retired.delete(current); void stopSession(current).catch(() => {}); }
      } catch { rotateRetryAt = Date.now() + Math.max(1000, marginMs / 4); }
    })().finally(() => { rotating = undefined; });
    await rotating;
  }

  /** One tool call; the streamed result, or a ServiceError for an exception (thrown or streamed). */
  async function invoke(name: ToolName, args: ToolArguments, context: Context | undefined, pinned?: string): Promise<CodeInterpreterResult> {
    const id = pinned ?? await session();
    try {
      const response = await client.send(new InvokeCodeInterpreterCommand({ codeInterpreterIdentifier, sessionId: id, name, arguments: args }),
        context?.abortSignal ? { abortSignal: context.abortSignal } : {});
      let result: CodeInterpreterResult | undefined;
      for await (const event of response.stream ?? []) {
        if (event.result) { result = event.result; continue; }
        for (const key of STREAM_ERRORS) {
          const failure = (event as unknown as Record<string, { message?: string } | undefined>)[key];
          if (failure) throw new ServiceError(`${key[0]!.toUpperCase()}${key.slice(1)}`, failure.message ?? key);
        }
      }
      if (!result) throw new ServiceError('EmptyResult', `${name} returned no result`);
      return result;
    } catch (error) {
      if (sessionEnded(error) && id === sessionId) lost = true;
      throw error;
    }
  }

  const failure = (error: unknown, fallback: ExecutionError['code']): ExecutionError => {
    const name = errorName(error);
    if (name === 'SessionLost' || name === 'SessionStopped' || name === 'SessionMissing' || name === 'AccessDeniedException' || sessionEnded(error)) {
      return new ExecutionError('shell_unavailable', boundedMessage(`${name}: ${errorText(error)}`));
    }
    if (name === 'AbortError') return new ExecutionError('aborted', 'Command aborted');
    return new ExecutionError(fallback, boundedMessage(`${name}: ${errorText(error)}`));
  };
  const text = (result: CodeInterpreterResult): string => (result.content ?? []).map(block => block.text ?? '').join('');

  const TERMINAL = new Set(['completed', 'failed', 'canceled']);
  const gone = (error: unknown): boolean => sessionEnded(error) || ['SessionLost', 'SessionStopped', 'SessionMissing'].includes(errorName(error));
  /** Asks the service to stop the task; true only when it is confirmed over (or its session is gone). */
  async function stopTask(taskId: string, id: string): Promise<boolean> {
    try { const stopped = await invoke('stopTask', { taskId }, undefined, id); return TERMINAL.has(stopped.structuredContent?.taskStatus ?? ''); }
    catch (error) { return gone(error); /* otherwise reported as unconfirmed termination */ }
  }

  async function exec(command: string, execOptions: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>> {
    if (context.abortSignal?.aborted) return err(new ExecutionError('aborted', 'Command aborted before dispatch'));
    const directory = posix.resolve(env.cwd, execOptions?.cwd ?? '.');
    const variables = Object.entries(execOptions?.env ?? {});
    const invalid = variables.find(([name]) => !ENV_NAME.test(name));
    if (invalid) return err(new ExecutionError('spawn_error', boundedMessage(`Invalid environment variable name: ${invalid[0]}`)));
    const assignments = variables.map(([name, value]) => `${name}=${quote(value)}`).join(' ');
    // The task API takes one command string: cwd, environment and umask become part of it.
    const runner = execOptions?.inheritEnv === false ? `env -i ${assignments} bash -c` : `${assignments ? `env ${assignments} ` : ''}bash -c`;
    const script = `umask ${umask} && cd ${quote(directory)} && ${runner} ${quote(shellCommand(command))}`;
    return dispatch(script, execOptions, context);
  }

  async function dispatch(script: string, execOptions: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>> {
    let taskId: string | undefined, pinned: string;
    try {
      await prepare();
      // Every call of this command goes to the session it started in, even if another command renews meanwhile.
      pinned = await session();
    } catch (error) { return err(failure(error, 'spawn_error')); }
    hold(pinned);
    let settled = false;
    const settle = (): void => { if (!settled) { settled = true; release(pinned); } };
    try {
      const started = await invoke('startCommandExecution', { command: script }, context, pinned);
      taskId = started.structuredContent?.taskId;
      if (!taskId) { settle(); return err(new ExecutionError('spawn_error', boundedMessage(`Code Interpreter did not start the command: ${text(started) || 'no task id'}`))); }
    } catch (error) { if (gone(error)) settle(); return err(failure(error, 'spawn_error')); }

    const deadline = execOptions?.timeout && execOptions.timeout > 0 ? Date.now() + execOptions.timeout * 1000 : undefined;
    const seen = { stdout: '', stderr: '' };
    // getTask reports the output so far; a value that does not extend what was seen is treated as new output.
    const deliver = (stream: 'stdout' | 'stderr', value: string | undefined): void => {
      if (!value) return;
      const delta = value.startsWith(seen[stream]) ? value.slice(seen[stream].length) : value;
      seen[stream] = value.startsWith(seen[stream]) ? value : seen[stream] + value;
      if (delta) execOptions?.onOutput?.(delta, context, { stream });
    };
    for (;;) {
      if (context.abortSignal?.aborted) { if (await stopTask(taskId, pinned)) settle(); return err(new ExecutionError('aborted', 'Command aborted; stopTask was requested, termination is not confirmed')); }
      if (deadline !== undefined && Date.now() >= deadline) { if (await stopTask(taskId, pinned)) settle(); return err(new ExecutionError('timeout', `Command exceeded ${execOptions?.timeout} s; stopTask was requested, termination is not confirmed`)); }
      let status;
      try {
        const polled = await invoke('getTask', { taskId }, context, pinned);
        status = polled.structuredContent;
        try { deliver('stdout', status?.stdout); deliver('stderr', status?.stderr); }
        catch (error) { if (await stopTask(taskId, pinned)) settle(); return err(new ExecutionError('callback_error', boundedMessage(`Output callback failed: ${errorText(error)}`))); }
        if (!status?.taskStatus) return err(new ExecutionError('unknown', boundedMessage(`getTask returned no task status: ${text(polled)}`)));
      } catch (error) {
        if (context.abortSignal?.aborted) continue;
        if (gone(error)) settle(); // otherwise the task may still run: the session stays held
        return err(failure(error, 'unknown'));
      }
      if (TERMINAL.has(status.taskStatus)) settle();
      if (status.taskStatus === 'completed' || (status.taskStatus === 'failed' && typeof status.exitCode === 'number')) return ok({ exitCode: status.exitCode ?? 0 });
      if (status.taskStatus === 'failed') return err(new ExecutionError('unknown', 'The command failed without an exit code'));
      if (status.taskStatus === 'canceled') return err(new ExecutionError('aborted', 'The command was canceled in the Code Interpreter'));
      await sleep(pollMs, context.abortSignal);
    }
  }

  // ---- Files: interpreter paths mapped onto this host's mount of the same folder, confined to it.
  let realRoot: Promise<string> | undefined;
  const namespace = (path: string): string => posix.resolve(env.cwd, path);
  const toLocal = (path: string): string | undefined => {
    const absolute = namespace(path);
    return within(absolute, mountPath) ? posix.join(root, absolute.slice(mountPath.length)) : undefined;
  };
  const fromLocal = (path: string, base = root): string => within(path, base) ? posix.join(mountPath, path.slice(base.length)) : mountPath;
  const outside = (path: string): FileError => new FileError('permission_denied', boundedMessage(`Outside the workspace: ${namespace(path)}`), namespace(path));
  /** Whether `local` stays in the folder; `follow` also resolves a final symbolic link (dangling ones included). */
  async function confined(local: string, follow: boolean): Promise<boolean> {
    const base = await (realRoot ??= realpath(root));
    let target = follow ? local : posix.dirname(local);
    for (let hops = 0; hops < 40; hops++) {
      let probe = target;
      for (;;) {
        try { await lstat(probe); break; } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && code !== 'ENOTDIR') return false;
          const up = posix.dirname(probe); if (up === probe) return false; probe = up;
        }
      }
      try { return within(await realpath(probe), base); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
        // The probe exists but does not resolve: a dangling symbolic link. Follow it by hand.
        try { target = posix.join(posix.resolve(posix.dirname(probe), await readlink(probe)), target.slice(probe.length)); } catch { return false; }
      }
    }
    return false;
  }
  const mapError = (error: FileError): FileError => new FileError(error.code, boundedMessage(error.message.split(root).join(mountPath)),
    error.path !== undefined && within(error.path, root) ? fromLocal(error.path) : error.path, error);
  const mapInfo = (info: FileInfo): FileInfo => ({ ...info, path: fromLocal(info.path) });
  async function guarded<T>(paths: readonly (readonly [string, boolean])[], run: (...locals: string[]) => Promise<Result<T, FileError>>): Promise<Result<T, FileError>> {
    const locals: string[] = [];
    for (const [path, follow] of paths) {
      const mapped = toLocal(path);
      if (mapped === undefined) return err(outside(path));
      try { if (!await confined(mapped, follow)) return err(outside(path)); } catch (error) { return err(new FileError('unknown', errorText(error), namespace(path))); }
      locals.push(mapped);
    }
    const result = await run(...locals);
    return result.ok ? result : err(mapError(result.error));
  }
  const notSupported = (what: string): Result<string, FileError> => err(new FileError('not_supported', `${what} is not available on the shared workspace mount`));

  const env: ExecutionEnv = {
    id: options.id,
    cwd,
    absolutePath: async path => ok(namespace(path)),
    joinPath: async parts => ok(posix.join(...parts)),
    readTextFile: (path, context) => guarded([[path, true]], file => local.readTextFile(file, context)),
    readBinaryFile: (path, context) => guarded([[path, true]], file => local.readBinaryFile(file, context)),
    readTextLines: (path, lines, context) => guarded([[path, true]], file => local.readTextLines(file, lines, context)),
    openTextLineReader: (path, context) => guarded([[path, true]], file => local.openTextLineReader(file, context)),
    openBinaryReader: (path, readerOptions, context) => guarded([[path, !readerOptions?.noFollow]], file => local.openBinaryReader(file, readerOptions, context)),
    openDirReader: (path, context) => guarded([[path, true]], directory => local.openDirReader(directory, context)),
    // The mount's own watcher, with its paths reported in the workspace's namespace.
    watch: async (targets, onChange, context) => {
      const mapped: WatchTarget[] = [];
      for (const target of targets) {
        const path = toLocal(target.path);
        if (path === undefined) return err(outside(target.path));
        mapped.push({ ...target, path });
      }
      const watcher = await local.watch(mapped, change => onChange('paths' in change ? { paths: change.paths.map(path => fromLocal(path)) } : 'error' in change ? { error: mapError(change.error) } : change), context);
      return watcher.ok ? watcher : err(mapError(watcher.error));
    },
    writeFile: (path, content, context) => guarded([[path, true]], file => local.writeFile(file, content, context)),
    appendFile: (path, content, context) => guarded([[path, true]], file => local.appendFile(file, content, context)),
    truncateFile: (path, size, context) => guarded([[path, true]], file => local.truncateFile(file, size, context)),
    flushFile: (path, context) => guarded([[path, true]], file => local.flushFile(file, context)),
    renameFile: (source, destination, context) => guarded([[source, false], [destination, false]], (from, to) => local.renameFile(from!, to!, context)),
    fileInfo: async (path, context) => { const info = await guarded([[path, false]], file => local.fileInfo(file, context)); return info.ok ? ok(mapInfo(info.value)) : info; },
    listDir: async (path, context) => { const list = await guarded([[path, true]], directory => local.listDir(directory, context)); return list.ok ? ok(list.value.map(mapInfo)) : list; },
    canonicalPath: async (path, context) => {
      const resolved = await guarded([[path, true]], file => local.canonicalPath(file, context));
      if (!resolved.ok) return resolved;
      const base = await (realRoot ??= realpath(root));
      return within(resolved.value, base) ? ok(fromLocal(resolved.value, base)) : err(outside(path));
    },
    exists: (path, context) => guarded([[path, false]], file => local.exists(file, context)),
    createDir: (path, directory, context) => guarded([[path, true]], file => local.createDir(file, directory, context)),
    remove: (path, removal, context) => guarded([[path, false]], file => local.remove(file, removal, context)),
    // A temporary file on this host would not be visible to the interpreter, and one in the folder would show in the workspace.
    createTempDir: async () => notSupported('createTempDir'),
    createTempFile: async () => notSupported('createTempFile'),
    // Releasing a consumer's view never ends the session: only the owner's stop() does.
    cleanup: async () => {},
    exec,
  };

  return {
    env, owned: start !== undefined,
    sessionId: () => sessionId,
    lost: () => lost,
    renew: () => {
      if (!start || stopped) return false;
      if (lost) { lost = false; sessionId = undefined; incarnation++; }
      return true;
    },
    stop: async context => {
      if (!start || stopped) return;
      stopped = true;
      // Let a start or rotation in flight finish, then dispose every session this env still owns.
      await Promise.allSettled([starting, rotating]);
      const ids = new Set<string>(retired);
      if (sessionId && !lost) ids.add(sessionId);
      retired.clear();
      const results = await Promise.allSettled([...ids].map(id => stopSession(id, context.abortSignal)));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
  };
}

// ---- Per-user EFS layout: pure values, no AWS call.

export interface EfsUserLayoutOptions {
  /** The host's user id: lowercase letters, digits, `-` and `_`, at most 64 characters (never a path). */
  readonly userId: string;
  /** The user's POSIX uid, allocated by the host (1001..2147483646, unique per user). */
  readonly uid: number;
  /** The group shared by the runtime and every user's access point (default 1000): files stay writable by both. */
  readonly gid?: number;
  /** Where this host mounts the runtime's access point (default `/mnt/efs`; AgentCore Runtime requires `/mnt/<name>`). */
  readonly runtimeMountPath?: string;
  /** The runtime access point's root directory in the file system (default `/boring`): user folders are below it. */
  readonly runtimeAccessPointRoot?: string;
  /** Where each interpreter session mounts the user's access point (default `/mnt/workspace`). */
  readonly interpreterMountPath?: string;
}

export interface EfsUserLayout {
  readonly userId: string;
  /** The file namespace id for `createCodeInterpreterEnv`. */
  readonly namespaceId: string;
  /** The user's access point, as `elasticfilesystem:CreateAccessPoint` takes it (the host creates it once per user). */
  readonly accessPoint: {
    readonly rootDirectory: string;
    readonly posixUser: { readonly uid: number; readonly gid: number };
    readonly creationInfo: { readonly ownerUid: number; readonly ownerGid: number; readonly permissions: string };
    readonly tags: readonly { readonly key: string; readonly value: string }[];
  };
  /** The interpreter's view: the user's folder is the whole mount. */
  readonly interpreter: { readonly mountPath: string; readonly cwd: string };
  /** The runtime's view of the same folder, and the user's state directory outside it (harness and journal SQLite files). */
  readonly runtime: { readonly root: string; readonly state: string; readonly journal: string };
  /** The single-writer harness file of one conversation key (`[a-z0-9_-]{1,64}`). */
  harnessFile(conversationKey: string): string;
  /** `filesystemConfigurations` entry for StartCodeInterpreterSession. */
  filesystemConfiguration(arns: { readonly accessPointArn: string; readonly fileSystemArn: string }): ToolsFileSystemConfiguration;
}

const USER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * One EFS file system, one folder per user below the runtime's access point (root `/boring`, mounted at `/mnt/efs`):
 * `users/<id>` (the interpreter's whole view, through the user's own access point rooted there) and `state/<id>` (the
 * runtime's SQLite files, which no interpreter can reach). The runtime confines itself to the user's folders; the
 * interpreter is confined by the access point itself.
 */
export function efsUserLayout(options: EfsUserLayoutOptions): EfsUserLayout {
  const { userId, uid } = options, gid = options.gid ?? 1000;
  if (typeof userId !== 'string' || !USER_ID.test(userId)) throw new TypeError('userId must match [a-z0-9][a-z0-9_-]{0,63}');
  if (!Number.isInteger(uid) || uid < 1001 || uid > 2_147_483_646) throw new TypeError('uid must be an integer in 1001..2147483646');
  if (!Number.isInteger(gid) || gid < 1 || gid > 2_147_483_646) throw new TypeError('gid must be a positive integer');
  const runtimeMount = posix.normalize(options.runtimeMountPath ?? '/mnt/efs'), interpreterMount = posix.normalize(options.interpreterMountPath ?? '/mnt/workspace');
  if (!MOUNT_PATH.test(interpreterMount) || interpreterMount === '/mnt/.' || interpreterMount === '/mnt/..') throw new TypeError(`The interpreter mount path must be /mnt/<name>: ${interpreterMount}`);
  // AgentCore Runtime also requires /mnt/<name>; an ECS task or a test may mount the file system elsewhere.
  if (!posix.isAbsolute(runtimeMount) || runtimeMount === '/') throw new TypeError(`The runtime mount path must be an absolute directory: ${runtimeMount}`);
  const base = posix.normalize(options.runtimeAccessPointRoot ?? '/boring');
  if (!posix.isAbsolute(base) || base.split('/').includes('..')) throw new TypeError(`The runtime access point root must be an absolute path: ${base}`);
  const state = posix.join(runtimeMount, 'state', userId);
  return {
    userId,
    namespaceId: `efs:${posix.join(base, 'users', userId)}`,
    accessPoint: {
      rootDirectory: posix.join(base, 'users', userId),
      posixUser: { uid, gid },
      // setgid directory: new entries keep the shared group.
      creationInfo: { ownerUid: uid, ownerGid: gid, permissions: '2770' },
      tags: [{ key: 'boring:user', value: userId }],
    },
    interpreter: { mountPath: interpreterMount, cwd: interpreterMount },
    runtime: { root: posix.join(runtimeMount, 'users', userId), state, journal: posix.join(state, 'journal.sqlite') },
    harnessFile: key => {
      if (!/^[a-z0-9_-]{1,64}$/.test(key)) throw new TypeError('A conversation key matches [a-z0-9_-]{1,64}');
      return posix.join(state, `${key}.pi.sqlite`);
    },
    filesystemConfiguration: ({ accessPointArn, fileSystemArn }) => ({ efsConfiguration: { accessPointArn, fileSystemArn, mountPath: interpreterMount } }),
  };
}
