import {
  SandboxProviderError,
  type SandboxProviderCreateContextV1,
} from "./providerV1";

/**
 * Environment mount contract (gh-1123, slice 1).
 *
 * An environment mount makes an already-authorized filesystem binding
 * physically visible to sandboxed commands at a logical path. Mounts are
 * inputs to the single `SandboxProviderV1.create` call — never a second
 * realization path — and only providers that declare
 * `ProviderCapabilities.mounts: true` may receive a non-empty list.
 *
 * `sourceRoot` is always an ordinary host directory. View mounts (the
 * Operations→FUSE bridge, later slice) hand providers a host mountpoint
 * directory through this same shape; providers never learn about FUSE.
 */
export interface SandboxEnvironmentMountV1 {
  /** Host directory realized inside the sandbox. Realpath-resolved once at create. */
  readonly sourceRoot: string;
  /**
   * Sandbox-visible path. Must live in the dedicated mount namespace
   * (`/mnt/<fsid>`), never under the primary `/workspace` root.
   */
  readonly logicalPath: string;
  readonly access: "ro" | "rw";
}

/** Sandbox-visible namespace that all environment mounts must live under. */
export const ENVIRONMENT_MOUNT_NAMESPACE = "/mnt";

/** Server-side flag gating mount realization (exec grants are policy-data). */
export const ENVIRONMENT_MOUNTS_FLAG = "BORING_ENV_MOUNTS";

export const ENVIRONMENT_MOUNT_ERROR_CODES = {
  unsupported: "SANDBOX_PROVIDER_MOUNTS_UNSUPPORTED",
  invalid: "SANDBOX_MOUNT_INVALID",
} as const;

export type EnvironmentMountErrorCode =
  (typeof ENVIRONMENT_MOUNT_ERROR_CODES)[keyof typeof ENVIRONMENT_MOUNT_ERROR_CODES];

export function isEnvironmentMountsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[ENVIRONMENT_MOUNTS_FLAG] === "1";
}

/**
 * Resolves the effective mount set for a provider create context. With
 * `BORING_ENV_MOUNTS` unset the resolution yields the empty set for every
 * context, making flag-off behavior byte-identical to the pre-mount contract.
 */
export function resolveContextMounts(
  context: Pick<SandboxProviderCreateContextV1, "mounts">,
  env?: Record<string, string | undefined>,
): readonly SandboxEnvironmentMountV1[] {
  if (!isEnvironmentMountsEnabled(env)) return [];
  return context.mounts ?? [];
}

/**
 * Fail-closed guard for providers without mount support: a non-empty
 * effective mount set is rejected with a stable error code instead of being
 * silently dropped (a dropped mount would be a grant the agent believes it
 * holds but does not have).
 */
export function assertNoEnvironmentMounts(
  providerId: string,
  context: Pick<SandboxProviderCreateContextV1, "mounts">,
  env?: Record<string, string | undefined>,
): void {
  const mounts = resolveContextMounts(context, env);
  if (mounts.length === 0) return;
  throw new SandboxProviderError(
    ENVIRONMENT_MOUNT_ERROR_CODES.unsupported,
    `sandbox provider "${providerId}" does not support environment mounts (requested ${mounts.length})`,
  );
}
