import type {
  ErrorCode,
  Sandbox,
  TelemetrySink,
  Workspace,
} from "@hachej/boring-agent/shared";

import type { ProviderCapabilities } from "./capability";
import { PROVIDER_CONTRACT_VERSION } from "./providerMatrix";

export type ExtractedSandboxProviderIdV1 =
  | "direct"
  | "bwrap"
  | "vercel-sandbox"
  | "remote-worker";

export type SandboxRuntimeModeIdV1 =
  | "direct"
  | "local"
  | "vercel-sandbox"
  | "remote-worker";

export type SandboxProvisioningRuntimeModeIdV1 = Exclude<
  SandboxRuntimeModeIdV1,
  "remote-worker"
>;

export interface SandboxProviderCreateContextV1 {
  workspaceRoot: string;
  sessionId: string;
  workspaceId?: string;
  templatePath?: string;
  requestId?: string;
  telemetry?: TelemetrySink;
}

export interface SandboxProviderInvalidateContextV1 {
  workspaceId: string;
}

export type SandboxPairHealthV1 =
  | Readonly<{ state: "ok" }>
  | Readonly<{ state: "recreate"; message?: string; error?: unknown }>;

export interface SandboxProvisioningExecResultV1 {
  stdout?: string;
  stderr?: string;
}

export interface SandboxProvisioningInstallSourceOptionsV1 {
  kind: "node" | "python";
  id: string;
  fingerprint: string;
}

export interface SandboxProvisioningWorkspaceFsV1 {
  exists(workspaceRelativePath: string): Promise<boolean>;
  rm(workspaceRelativePath: string): Promise<void>;
  mkdir(workspaceRelativePath: string): Promise<void>;
  writeText(workspaceRelativePath: string, content: string): Promise<void>;
  readText(workspaceRelativePath: string): Promise<string | null>;
  copyFromHost(
    hostSourcePath: string | URL,
    workspaceRelativeTarget: string,
  ): Promise<void>;
}

export interface SandboxProvisioningOperationsV1 {
  readonly mode: SandboxProvisioningRuntimeModeIdV1;
  exec(
    command: string,
    args: string[],
    opts?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<SandboxProvisioningExecResultV1 | void>;
  resolveInstallSource(
    source: string | URL,
    opts: SandboxProvisioningInstallSourceOptionsV1,
  ): Promise<string>;
  readonly workspaceFs: SandboxProvisioningWorkspaceFsV1;
  getRuntimeCacheRoot(): string;
}

export type WorkspaceSandboxPairV1 = Readonly<{
  workspace: Workspace;
  sandbox: Sandbox;
  provisioning?: SandboxProvisioningOperationsV1;
  checkHealth?(): Promise<SandboxPairHealthV1>;
  dispose(): Promise<void>;
}>;

export interface SandboxProviderV1 {
  readonly contractVersion: typeof PROVIDER_CONTRACT_VERSION;
  readonly providerId: ExtractedSandboxProviderIdV1;
  readonly capabilities: ProviderCapabilities;
  resolveRuntimeRoot(context: SandboxProviderCreateContextV1): string;
  create(
    context: SandboxProviderCreateContextV1,
  ): Promise<WorkspaceSandboxPairV1>;
  invalidate?(
    context: SandboxProviderInvalidateContextV1,
  ): Promise<void> | void;
  close?(): Promise<void>;
}

export class SandboxProviderError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxProviderError";
    this.code = code;
  }
}
