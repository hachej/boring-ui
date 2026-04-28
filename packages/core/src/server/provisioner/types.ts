export interface WorkspaceProvisioner {
  provision(ctx: ProvisionContext): Promise<ProvisionResult>
  destroy(workspaceId: string): Promise<void>
}

export interface ProvisionContext {
  workspaceId: string
  workspaceName: string
  ownerId: string
  appId: string
}

export interface ProvisionResult {
  volumePath: string
}
