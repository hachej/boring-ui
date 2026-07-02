/** Logical filesystem identity used by tools, UI, and runtime bindings. */
export type FilesystemId = "user" | "company_context" | (string & {});

/** Access granted for a prepared runtime filesystem binding. */
export type FilesystemAccess = "readonly" | "readwrite";

/** Provider-declared projection mode for a bound filesystem. */
export type FilesystemProjection =
  /** Contains only resources allowed for this actor/session. */
  | "policy-filtered"
  /** Broader management view; still policy-granted by the host app/provider. */
  | "management";

/** Policy-resolved filesystem binding requested for one runtime/session. */
export interface FilesystemBinding {
  filesystem: FilesystemId;
  access: FilesystemAccess;
  mountPath: string;
  projection: FilesystemProjection;
}

/** Actor/session identity supplied when resolving or invalidating bindings. */
export interface BoundFilesystemContext {
  humanUserId: string;
  agentId: string;
  sessionId: string;
  workspaceId: string;
  requestId: string;
}

/** Resolves policy-granted filesystem bindings for one actor/session. */
export interface FilesystemBindingResolver {
  resolveBindings(ctx: BoundFilesystemContext): Promise<FilesystemBinding[]>;
}

/** Provider/runtime-prepared binding with an opaque mount/projection handle. */
export interface PreparedFilesystemBinding {
  binding: FilesystemBinding;
  handle: unknown;
}

/** Provider lifecycle seam for preparing, disposing, and invalidating bindings. */
export interface FilesystemBindingProvider {
  prepareBinding(
    ctx: BoundFilesystemContext,
    binding: FilesystemBinding,
  ): Promise<PreparedFilesystemBinding>;
  disposeBinding?(prepared: PreparedFilesystemBinding): Promise<void>;
  invalidateBinding?(
    ctx: BoundFilesystemContext,
    filesystem: FilesystemId,
  ): Promise<void>;
}

/** Bindings prepared for this one runtime/session. */
export interface RuntimeBindingPlan {
  bindings: PreparedFilesystemBinding[];
}
