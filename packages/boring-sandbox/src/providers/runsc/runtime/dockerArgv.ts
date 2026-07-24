import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../shared/remoteWorkerProtocolV1";

import { runscRuntimeError } from "./errors";

export const RUNSC_RUNTIME_DOCKER_LABELS_V1 = Object.freeze({
  owner: "com.hachej.boring.runsc-runtime",
  profile: "com.hachej.boring.runsc-profile",
} as const);

export const RUNSC_RUNTIME_HELPER_PATH =
  "/opt/boring/bin/boring-runtime" as const;

declare const trustedWorkspaceMountSourceBrand: unique symbol;
export type TrustedWorkspaceMountSource = string & {
  readonly [trustedWorkspaceMountSourceBrand]: true;
};

const runtimeIdPattern = /^[a-f0-9]{32}$/;
const workspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageDigestPattern =
  /^(?:[a-z0-9.-]+(?::[0-9]{1,5})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[a-f0-9]{64}$/;

function invalidDockerInput(label: string): never {
  throw runscRuntimeError(
    REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
    `remote-worker ${label} is invalid`,
  );
}

export function trustedWorkspaceMountSource(
  workspaceRoot: string,
  workspaceId: string,
): TrustedWorkspaceMountSource {
  if (
    !workspaceRoot.startsWith("/") ||
    workspaceRoot === "/" ||
    workspaceRoot.endsWith("/") ||
    workspaceRoot.length > 4000 ||
    workspaceRoot.includes("\0") ||
    workspaceRoot.includes(",") ||
    /[\r\n]/.test(workspaceRoot) ||
    workspaceRoot.split("/").some((component) => component === ".." || component === ".")
  ) {
    invalidDockerInput("workspace root");
  }
  if (!workspaceIdPattern.test(workspaceId)) invalidDockerInput("workspace id");
  const source = `${workspaceRoot}/${workspaceId.toLowerCase()}`;
  if (source.length > 4096) invalidDockerInput("workspace mount source");
  return source as TrustedWorkspaceMountSource;
}

export interface DockerRunProfileV1 {
  readonly runtimeId: string;
  readonly workspaceMountSource: TrustedWorkspaceMountSource;
  readonly workspaceReadOnly?: boolean;
  readonly image: string;
}

export function dockerContainerNameV1(runtimeId: string): string {
  if (!runtimeIdPattern.test(runtimeId)) invalidDockerInput("runtime id");
  return `boring-sbx-${runtimeId}`;
}

export function buildDockerRunArgv(
  profile: DockerRunProfileV1,
): readonly string[] {
  const containerName = dockerContainerNameV1(profile.runtimeId);
  if (!imageDigestPattern.test(profile.image)) invalidDockerInput("image digest");
  return Object.freeze([
    "run",
    "-d",
    "--name",
    containerName,
    "--runtime=runsc",
    "--user",
    "65532:65532",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--cpus",
    "0.5",
    "--memory",
    "128m",
    "--pids-limit",
    "64",
    "--network",
    "none",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=16m",
    "--ulimit",
    "nofile=1024:1024",
    "--ulimit",
    "fsize=1073741824:1073741824",
    "--mount",
    `type=bind,src=${profile.workspaceMountSource},dst=/workspace,readonly=${profile.workspaceReadOnly === true}`,
    "--label",
    `${RUNSC_RUNTIME_DOCKER_LABELS_V1.owner}=true`,
    "--label",
    `${RUNSC_RUNTIME_DOCKER_LABELS_V1.profile}=v1`,
    profile.image,
    RUNSC_RUNTIME_HELPER_PATH,
    "supervise",
  ]);
}

export type DockerExecHelperModeV1 = "invoke" | "workspace" | "baseline";

export function buildDockerExecArgv(
  runtimeId: string,
  mode: DockerExecHelperModeV1,
): readonly string[] {
  return Object.freeze([
    "exec",
    "--interactive",
    "--user",
    "65532:65532",
    dockerContainerNameV1(runtimeId),
    RUNSC_RUNTIME_HELPER_PATH,
    mode,
  ]);
}

export function buildDockerRemoveArgv(runtimeId: string): readonly string[] {
  return Object.freeze(["rm", "--force", dockerContainerNameV1(runtimeId)]);
}

export function buildDockerRemoveOwnedIdArgv(
  containerId: string,
): readonly string[] {
  if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
    invalidDockerInput("owned container id");
  }
  return Object.freeze(["rm", "--force", containerId]);
}

export function buildDockerInspectArgv(runtimeId: string): readonly string[] {
  return Object.freeze([
    "inspect",
    "--format",
    "{{.State.Running}}",
    dockerContainerNameV1(runtimeId),
  ]);
}

export function buildDockerOwnedContainerListArgv(): readonly string[] {
  return Object.freeze([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=${RUNSC_RUNTIME_DOCKER_LABELS_V1.owner}=true`,
  ]);
}
