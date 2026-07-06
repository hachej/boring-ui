import type { MemberRole } from '../../shared/types.js'

const ROLE_LEVELS: Record<MemberRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
}

export function isWorkspaceRoleAtLeast(role: MemberRole, minimumRole: MemberRole): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS[minimumRole]
}
