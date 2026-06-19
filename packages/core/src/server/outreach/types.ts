export type OutreachProvisioningMode = 'clone_per_lead' | 'shared_readonly' | 'existing_workspace_viewer'
export type OutreachLeadStatus = 'anonymous' | 'claimed' | 'blocked'
export type OutreachProvisioningStatus = 'pending' | 'provisioning' | 'provisioned' | 'failed'

export interface OutreachExperience {
  id: string
  appId: string
  name: string
  provisioningMode: OutreachProvisioningMode
  templateWorkspaceId: string | null
  defaultTargetPath: string
  anonymousCapabilityProfile: string
  config: Record<string, unknown>
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface OutreachLink {
  id: string
  appId: string
  experienceId: string
  campaignId: string | null
  tokenHash: string
  recipientHint: string | null
  expiresAt: string
  revokedAt: string | null
  maxLeads: number | null
  initialCreditMicros: number
  leadCount: number
  firstOpenedAt: string | null
  lastOpenedAt: string | null
  createdBy: string | null
  createdAt: string
}

export interface OutreachLead {
  id: string
  appId: string
  outreachLinkId: string
  userId: string
  provisionedWorkspaceId: string | null
  provisionedTargetPath: string | null
  provisionResult: Record<string, unknown>
  provisioningStatus: OutreachProvisioningStatus
  provisioningErrorCode: string | null
  status: OutreachLeadStatus
}

export interface ProvisionedExperience {
  workspaceId: string
  targetPath: string
}

export interface ExperienceProvisioner {
  provisionLeadExperience(input: {
    appId: string
    experienceId: string
    leadId: string
    userId: string
  }): Promise<ProvisionedExperience>
}
