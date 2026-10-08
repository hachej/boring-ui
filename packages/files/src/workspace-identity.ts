/** The host's identity of the workspace (the same shape as `WorkspaceIdentity` in `@hachej/boring-execution`). Pi's environment `id` is only a namespace. */
export interface WorkspaceKey {
  readonly providerId: string;
  readonly instanceId: string;
  readonly incarnation: string;
  readonly viewId: string;
}

