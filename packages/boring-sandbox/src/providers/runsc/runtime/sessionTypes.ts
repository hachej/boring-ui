import type { DockerCommandRunner } from "./dockerRunner";
import type { RunscInvocationCredentialResolverV1 } from "./invocationCredentials";
import type { FixedProjectQuotaManagerV1 } from "./quota";
import type {
  CompositeRunscSessionRetirementV1,
  RunscSessionRetirementV1,
} from "./sessionRetirement";
import type { RunscSandboxRootLifecycleV1 } from "./sandboxRootLifecycle";
import type { TrustedWorkspaceMountSource } from "./dockerArgv";

export interface RunscSessionRuntimeOptionsV1 {
  readonly runner: DockerCommandRunner;
  readonly quota: Pick<FixedProjectQuotaManagerV1, "apply" | "check"> & {
    readonly workspaceRoot?: string;
  };
  readonly maxConcurrentCreates?: number;
  readonly maxConcurrentExecs?: number;
  readonly now?: () => number;
  readonly runtimeIdFactory?: () => string;
  readonly sandboxIdFactory?: () => string;
  readonly sandboxRoots?: RunscSandboxRootLifecycleV1;
  /** Set only after the worker profile has passed multi-root qualification. */
  readonly multiSandboxRootsAdmitted?: boolean;
  readonly invocationCredentials?: RunscInvocationCredentialResolverV1;
  readonly onRetire?: (
    retirement: RunscSessionRetirementV1,
  ) => void | Promise<void>;
  readonly onCompositeRetire?: (
    retirement: CompositeRunscSessionRetirementV1,
  ) => void | Promise<void>;
}

export interface CreateRunscSessionInputV1 {
  readonly sandboxId: string;
  readonly clientLeaseId: string;
  readonly workspaceId: string;
  readonly workspaceMountSource: TrustedWorkspaceMountSource;
  readonly image: string;
  readonly idleTtlMs?: number;
  readonly hardLifetimeMs?: number;
}

export interface CreateCompositeRunscSessionInputV1 {
  readonly sandboxId?: string;
  readonly clientLeaseId: string;
  readonly workspaceId: string;
  readonly image: string;
  readonly idleTtlMs?: number;
  readonly hardLifetimeMs?: number;
}

export interface RunscSessionLeaseV1 {
  readonly sandboxId: string;
  readonly leaseExpiresAtMs: number;
  readonly hardExpiresAtMs: number;
}

export interface CompositeRunscSessionLeaseV1 extends RunscSessionLeaseV1 {
  readonly newlyAllocated: boolean;
}
