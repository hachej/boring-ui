import { useSuspenseQuery } from '@tanstack/react-query'

import type { CapabilitiesResponse } from '../../shared/types.js'
import { apiFetchJson } from '../utils.js'

const CAPABILITIES_QUERY_KEY = ['capabilities'] as const

export function useCapabilities(): CapabilitiesResponse {
  const query = useSuspenseQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: async () =>
      apiFetchJson<CapabilitiesResponse>('/api/v1/capabilities'),
  })

  return query.data
}
