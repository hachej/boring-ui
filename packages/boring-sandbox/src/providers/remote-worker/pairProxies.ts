import type {
  Entry,
  ExecOptions,
  ExecResult,
  Stat,
  Workspace,
} from "@hachej/boring-agent/shared";

import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_RUNTIME_CWD,
  RemoteWorkerExecRequestSchemaV1,
  RemoteWorkerWorkspaceOperationSchemaV1,
  type RemoteWorkerWorkspaceOperationV1,
  type RemoteWorkerWorkspaceResultV1,
} from "../../shared/remoteWorkerProtocolV1";
import { SandboxProviderError } from "../../shared/providerV1";
import {
  parseRemoteWorkerRequestV1,
  type RemoteWorkerLeaseClientV1,
} from "./protocolClient";
import type { RemoteWorkerEventStreamV1 } from "./transport";

const EVENT_RECONNECT_DELAY_MS = 250;

type WorkspaceWatcher = ReturnType<NonNullable<Workspace["watch"]>>;
type WorkspaceChangeListener = Parameters<WorkspaceWatcher["subscribe"]>[0];
type WorkspaceWatchSubscribeOptions = Parameters<
  WorkspaceWatcher["subscribe"]
>[1];

function responseError(label: string): SandboxProviderError {
  return new SandboxProviderError(
    REMOTE_WORKER_ERROR_CODES_V1.responseInvalid,
    `remote-worker returned an invalid ${label} response`,
  );
}

function expectContent(result: RemoteWorkerWorkspaceResultV1): string {
  if ("content" in result && typeof result.content === "string")
    return result.content;
  throw responseError("content");
}

function expectBytes(result: RemoteWorkerWorkspaceResultV1): Uint8Array {
  if ("dataBase64" in result)
    return new Uint8Array(Buffer.from(result.dataBase64, "base64"));
  throw responseError("binary");
}

function expectStat(result: RemoteWorkerWorkspaceResultV1): Stat {
  if ("stat" in result) return result.stat;
  throw responseError("stat");
}

function expectEntries(result: RemoteWorkerWorkspaceResultV1): Entry[] {
  if ("entries" in result) return result.entries;
  throw responseError("readdir");
}

function isTerminalStreamError(error: unknown): boolean {
  return (
    error instanceof SandboxProviderError &&
    (error.code === REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound ||
      error.code === REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired ||
      error.code === REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed)
  );
}

export function createRemoteWorkspaceV1(options: {
  client: RemoteWorkerLeaseClientV1;
  leaseExpiresAtMs: () => number;
  now: () => number;
}): { workspace: Workspace; closeWatcher(): void } {
  let watcher: WorkspaceWatcher | undefined;
  let stream: RemoteWorkerEventStreamV1 | undefined;
  let opening: Promise<void> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let watcherClosed = false;
  const listeners = new Map<
    WorkspaceChangeListener,
    WorkspaceWatchSubscribeOptions
  >();

  const workspaceRequest = (
    operation: RemoteWorkerWorkspaceOperationV1,
  ): Promise<RemoteWorkerWorkspaceResultV1> =>
    options.client.fs(
      parseRemoteWorkerRequestV1(
        RemoteWorkerWorkspaceOperationSchemaV1,
        operation,
        "fs request",
      ),
    );

  const notifyResync = (): void => {
    for (const subscribeOptions of [...listeners.values()]) {
      try {
        subscribeOptions?.onControlEvent?.({
          type: "resync-required",
          reason: "remote_worker_stream_closed",
        });
      } catch {
        // A subscriber cannot break watcher lifecycle or later subscribers.
      }
    }
  };
  const scheduleReconnect = (): void => {
    if (
      watcherClosed ||
      listeners.size === 0 ||
      reconnectTimer ||
      options.leaseExpiresAtMs() <= options.now()
    )
      return;
    const delayMs = Math.min(
      EVENT_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
      30_000,
    );
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      ensureStream();
    }, delayMs);
  };
  const ensureStream = (): void => {
    if (stream || opening || watcherClosed || listeners.size === 0) return;
    if (options.leaseExpiresAtMs() <= options.now()) {
      notifyResync();
      return;
    }
    opening = (async () => {
      try {
        const opened = await options.client.openEvents(
          options.leaseExpiresAtMs(),
          ({ event }) => {
            reconnectAttempt = 0;
            for (const listener of [...listeners.keys()]) {
              try {
                listener(event);
              } catch {
                // A subscriber cannot break event fan-out.
              }
            }
          },
        );
        if (watcherClosed || listeners.size === 0) {
          opened.close();
          return;
        }
        stream = opened;
        const onClosed = (error?: unknown): void => {
          if (stream !== opened) return;
          stream = undefined;
          notifyResync();
          if (!isTerminalStreamError(error)) scheduleReconnect();
        };
        void opened.closed.then(
          () => onClosed(),
          (error) => onClosed(error),
        );
      } catch (error) {
        notifyResync();
        if (!isTerminalStreamError(error)) scheduleReconnect();
      } finally {
        opening = undefined;
      }
    })();
  };

  const workspace: Workspace = {
    root: REMOTE_WORKER_RUNTIME_CWD,
    runtimeContext: { runtimeCwd: REMOTE_WORKER_RUNTIME_CWD },
    fsCapability: "best-effort",
    watch() {
      watcher ??= {
        subscribe(listener, subscribeOptions) {
          if (watcherClosed) return () => {};
          listeners.set(listener, subscribeOptions);
          ensureStream();
          return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
              if (reconnectTimer) clearTimeout(reconnectTimer);
              reconnectTimer = undefined;
              stream?.close();
              stream = undefined;
            }
          };
        },
        close() {
          watcherClosed = true;
          listeners.clear();
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
          stream?.close();
          stream = undefined;
        },
      };
      return watcher;
    },
    async readFile(path) {
      return expectContent(await workspaceRequest({ op: "readFile", path }));
    },
    async readBinaryFile(path) {
      return expectBytes(
        await workspaceRequest({ op: "readBinaryFile", path }),
      );
    },
    async writeFile(path, data) {
      await workspaceRequest({ op: "writeFile", path, data });
    },
    async writeBinaryFile(path, data) {
      await workspaceRequest({
        op: "writeBinaryFile",
        path,
        dataBase64: Buffer.from(data).toString("base64"),
      });
    },
    async readFileWithStat(path) {
      const result = await workspaceRequest({ op: "readFileWithStat", path });
      if ("content" in result && "stat" in result) return result;
      throw responseError("content/stat");
    },
    async writeFileWithStat(path, data) {
      return expectStat(
        await workspaceRequest({ op: "writeFileWithStat", path, data }),
      );
    },
    async writeBinaryFileWithStat(path, data) {
      return expectStat(
        await workspaceRequest({
          op: "writeBinaryFileWithStat",
          path,
          dataBase64: Buffer.from(data).toString("base64"),
        }),
      );
    },
    async unlink(path) {
      await workspaceRequest({ op: "unlink", path });
    },
    async readdir(path) {
      return expectEntries(await workspaceRequest({ op: "readdir", path }));
    },
    async stat(path) {
      return expectStat(await workspaceRequest({ op: "stat", path }));
    },
    async mkdir(path, opts) {
      await workspaceRequest({ op: "mkdir", path, recursive: opts?.recursive });
    },
    async rename(from, to) {
      await workspaceRequest({ op: "rename", from, to });
    },
  };

  return { workspace, closeWatcher: () => watcher?.close() };
}

export function createRemoteSandboxV1(options: {
  client: RemoteWorkerLeaseClientV1;
  execTimeoutMs: number;
  maxOutputBytes: number;
  idFactory: () => string;
}) {
  return {
    id: options.client.sandboxId,
    placement: "remote" as const,
    provider: "remote-worker",
    capabilities: ["exec"] as const,
    runtimeContext: { runtimeCwd: REMOTE_WORKER_RUNTIME_CWD },
    async exec(
      command: string,
      execOptions: ExecOptions = {},
    ): Promise<ExecResult> {
      if (execOptions.env && Object.keys(execOptions.env).length > 0) {
        throw new SandboxProviderError(
          REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
          "remote-worker exec env requires trusted credential delivery",
        );
      }
      const body = parseRemoteWorkerRequestV1(
        RemoteWorkerExecRequestSchemaV1,
        {
          invocationId: options.idFactory(),
          command,
          cwd: execOptions.cwd,
          timeoutMs: execOptions.timeoutMs ?? options.execTimeoutMs,
          maxOutputBytes: execOptions.maxOutputBytes ?? options.maxOutputBytes,
        },
        "exec request",
      );
      const response = await options.client.exec(body, execOptions.signal);
      const stdout = new Uint8Array(
        Buffer.from(response.stdoutBase64, "base64"),
      );
      const stderr = new Uint8Array(
        Buffer.from(response.stderrBase64, "base64"),
      );
      if (stdout.byteLength + stderr.byteLength > body.maxOutputBytes) {
        throw responseError("exec output bound");
      }
      const result: ExecResult = { ...response, stdout, stderr };
      execOptions.onStdout?.(result.stdout);
      execOptions.onStderr?.(result.stderr);
      return result;
    },
  };
}
