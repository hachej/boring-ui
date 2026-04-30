import { useQuery } from '@tanstack/react-query'

import type { WorkspaceMember, User } from '../../shared/types.js'
import { apiFetchJson } from '../utils.js'

export type EnrichedMember = WorkspaceMember & {
  user: Pick<User, 'id' | 'email' | 'name' | 'image'>
}

export function useWorkspaceMembers(workspaceId: string) {
  return useQuery({
    queryKey: ['members', workspaceId],
    queryFn: async () => {
      const data = await apiFetchJson<{ members: EnrichedMember[] }>(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
      )
      return data.members
    },
    enabled: workspaceId.length > 0,
  })
}
