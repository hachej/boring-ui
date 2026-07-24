import { spawn } from "node:child_process";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";
import { SandboxProviderError } from "../../../shared/providerV1";

import { runscRuntimeError } from "./errors";
import { RUNSC_RUNTIME_LIMITS_V1, boundedPositiveInteger } from "./limits";

export const DOCKER_BINARY_PATH = "/usr/bin/docker" as const;

export interface DockerCommandInput {
  readonly argv: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  /** Owned by the runner and zeroed after it is written. */
  readonly stdin?: Uint8Array;
  readonly signal?: AbortSignal;
}

export interface DockerCommandResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly aborted?: boolean;
}

export interface DockerCommandRunner {
  run(input: DockerCommandInput): Promise<DockerCommandResult>;
}

function appendBounded(
  chunks: Uint8Array[],
  chunk: Uint8Array,
  state: { bytes: number; truncated: boolean },
  maximum: number,
): void {
  const remaining = maximum - state.bytes;
  if (remaining <= 0) {
    state.truncated = true;
    return;
  }
  const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
  chunks.push(accepted);
  state.bytes += accepted.byteLength;
  if (accepted.byteLength !== chunk.byteLength) state.truncated = true;
}

function concatChunks(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export class DockerCliCommandRunner implements DockerCommandRunner {
  async run(input: DockerCommandInput): Promise<DockerCommandResult> {
    const timeoutMs = boundedPositiveInteger(
      input.timeoutMs,
      RUNSC_RUNTIME_LIMITS_V1.maxInvocationTimeoutMs +
        RUNSC_RUNTIME_LIMITS_V1.dockerCommandTimeoutMs,
      "Docker command timeout",
    );
    const maximum = boundedPositiveInteger(
      input.maxOutputBytes ?? RUNSC_RUNTIME_LIMITS_V1.maxCombinedOutputBytes,
      16 * 1024 * 1024,
      "Docker command output limit",
    );
    if (
      input.argv.length === 0 ||
      input.argv.length > 128 ||
      input.argv.some(
        (arg) =>
          typeof arg !== "string" ||
          arg.length === 0 ||
          arg.length > 8192 ||
          arg.includes("\0"),
      )
    ) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker Docker argv is invalid",
      );
    }

    return await new Promise<DockerCommandResult>((resolve, reject) => {
      const child = spawn(DOCKER_BINARY_PATH, [...input.argv], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const outputState = { bytes: 0, truncated: false };
      let timedOut = false;
      let aborted = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      const abort = (): void => {
        aborted = true;
        child.kill("SIGKILL");
      };
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Uint8Array) =>
        appendBounded(stdout, chunk, outputState, maximum),
      );
      child.stderr.on("data", (chunk: Uint8Array) =>
        appendBounded(stderr, chunk, outputState, maximum),
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        input.stdin?.fill(0);
        reject(
          runscRuntimeError(
            REMOTE_WORKER_ERROR_CODES_V1.dockerCommandFailed,
            "remote-worker Docker command could not start",
            error,
          ),
        );
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        input.stdin?.fill(0);
        resolve({
          exitCode: code ?? -1,
          stdout: concatChunks(stdout, stdout.reduce((n, c) => n + c.byteLength, 0)),
          stderr: concatChunks(stderr, stderr.reduce((n, c) => n + c.byteLength, 0)),
          timedOut,
          truncated: outputState.truncated,
          aborted,
        });
      });
      if (input.stdin) child.stdin.end(input.stdin);
      else child.stdin.end();
    });
  }
}

export async function runDockerChecked(
  runner: DockerCommandRunner,
  input: DockerCommandInput,
): Promise<DockerCommandResult> {
  let result: DockerCommandResult;
  try {
    result = await runner.run(input);
  } catch (error) {
    if (error instanceof SandboxProviderError) {
      throw error;
    }
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.dockerCommandFailed,
      "remote-worker Docker command failed",
      error,
    );
  }
  if (result.timedOut) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.timeout,
      "remote-worker Docker command timed out",
    );
  }
  if (result.exitCode !== 0) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.dockerCommandFailed,
      "remote-worker Docker command failed",
    );
  }
  return result;
}
