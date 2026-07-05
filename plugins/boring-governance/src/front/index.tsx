"use client"

import type {
  CompanyAdminStatus,
  LoadCompanyAdminStatus,
  RenderCompanyAdminContent,
} from '@hachej/boring-core/front'
import { GovernanceAdminView, type GovernanceMeResponse } from './GovernanceAdminView.js'

export interface CreateGovernanceCompanyAdminOptions {
  fetchImpl?: typeof fetch
}

export interface GovernanceCompanyAdminProvider {
  loadStatus: LoadCompanyAdminStatus
  renderContent: RenderCompanyAdminContent
}

export function createGovernanceCompanyAdmin({ fetchImpl = fetch }: CreateGovernanceCompanyAdminOptions = {}): GovernanceCompanyAdminProvider {
  const loadStatus: LoadCompanyAdminStatus = async () => {
    const response = await fetchImpl('/api/v1/governance/me', { credentials: 'include' })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Company admin status failed: HTTP ${response.status}`)
    const body = await response.json() as GovernanceMeResponse
    if (body.policyStatus?.state === 'invalid') {
      throw new Error(body.policyStatus.message ?? 'Governance policy is invalid')
    }
    return {
      enabled: body.enabled,
      admin: body.admin,
      role: body.role,
      details: body,
    }
  }

  const renderContent = (status: CompanyAdminStatus) => (
    <GovernanceAdminView status={status.details as GovernanceMeResponse} />
  )

  return { loadStatus, renderContent }
}

type GovernanceFrontPlugin = ((api: unknown) => void) & { pluginId: string; pluginLabel?: string }

const governanceFrontPlugin = ((() => undefined) as unknown as GovernanceFrontPlugin)
Object.defineProperty(governanceFrontPlugin, 'pluginId', { value: 'boring-governance', enumerable: true })
Object.defineProperty(governanceFrontPlugin, 'pluginLabel', { value: 'Governance', enumerable: true })

export default governanceFrontPlugin
export { GovernanceAdminView }
export type { GovernanceMeResponse, GovernancePolicyStatus } from './GovernanceAdminView.js'
