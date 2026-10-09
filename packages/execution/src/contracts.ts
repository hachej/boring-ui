import type { Context } from '@earendil-works/chord';
import type { FileSystem, Shell, ExecutionEnv } from '@earendil-works/pi-durable/env';

export interface WorkspaceIdentity {
  readonly providerId: string;
  readonly instanceId: string;
  readonly incarnation: string;
  readonly viewId: string;
}

/** A provider can expose files, shell, or both. Native Shell-only capability
 * must not force a dummy filesystem. Pi's env factory still requires its
 * complete ExecutionEnv when used; a shell-only tool closes over Shell.
 *
 * Reuse a native environment for compatible, stable cwd/view/scope bindings;
 * fresh allocation per invocation is not required. Do not mutate one shared
 * cwd across concurrent incompatible calls. Identity is not permission.
 */
export interface WorkspaceLease<Environment extends FileSystem | Shell = FileSystem> {
  readonly identity: WorkspaceIdentity;
  readonly environment: Environment;
  readonly ownership: 'owned' | 'borrowed';
  /** Release this lease, not other owners. Host supplies a usable cleanup
   * Context. Idempotent release cannot count twice or destroy another lease.
   * Native cleanup on a borrowed per-call facade is not provider disposal.
   */
  readonly release: (context: Context) => Promise<void>;
}

export type CodingWorkspaceLease = WorkspaceLease<ExecutionEnv>;

export interface WorkspaceRequest<Input> {
  readonly operationId: string;
  readonly input: Input;
}

export interface WorkspaceProvider<Input, Environment extends FileSystem | Shell = FileSystem> {
  readonly providerId: string;
  readonly acquire: (request: WorkspaceRequest<Input>, context: Context) => Promise<WorkspaceLease<Environment>>;
}

export type Reattachment<Environment extends FileSystem | Shell> =
  | { readonly kind: 'available'; readonly lease: WorkspaceLease<Environment> }
  | { readonly kind: 'missing' | 'expired' | 'unavailable'; readonly reason: string };

export interface RecoverableWorkspaceProvider<Input, Environment extends FileSystem | Shell = FileSystem> extends WorkspaceProvider<Input, Environment> {
  readonly reattach: (identity: WorkspaceIdentity, context: Context) => Promise<Reattachment<Environment>>;
}
