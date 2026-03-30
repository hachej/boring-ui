/**
 * useChatTransport — React hook that selects the correct ChatTransport
 * based on the current boring-ui mode (browser vs. hosted/server).
 *
 * Browser mode: PiAgentCoreTransport (pi-agent-core running in-browser,
 *   tools call boring-ui backend API for file/git/bash ops)
 *
 * Server mode: DefaultChatTransport (Vercel AI SDK default,
 *   hits /api/v1/agent/chat where pi-coding-agent runs server-side)
 */

import { useMemo, useRef } from 'react'
import { DefaultChatTransport } from 'ai'
import { PiAgentCoreTransport } from './piAgentCoreTransport'
import { createPiNativeTools } from './defaultTools'
import { useDataProvider } from '../data'
import { useQueryClient } from '@tanstack/react-query'
import { buildApiUrl } from '../../utils/apiBase'

/**
 * Determines whether the PI agent should run server-side (via backend API)
 * rather than in the browser.
 *
 * @param {Object|null|undefined} capabilities - Capabilities response from the server
 * @returns {boolean} true if the backend should handle the PI agent
 */
export function isPiBackendMode(capabilities) {
  if (!capabilities) return false
  if (capabilities.mode === 'hosted') return true
  if (capabilities.piBackend === true) return true
  return false
}

/**
 * React hook returning the correct ChatTransport for the current mode.
 *
 * The PiAgentCoreTransport instance is kept in a ref so it persists across
 * re-renders, preserving the Agent instance and its conversation state.
 *
 * @param {Object|null|undefined} capabilities - Capabilities response
 * @returns {ChatTransport} transport instance with sendMessages and reconnectToStream
 */
export function useChatTransport(capabilities) {
  const dataProvider = useDataProvider()
  const queryClient = useQueryClient()

  const tools = useMemo(
    () => createPiNativeTools(dataProvider, queryClient),
    [dataProvider, queryClient],
  )

  const transportRef = useRef(null)

  return useMemo(() => {
    if (isPiBackendMode(capabilities)) {
      // SERVER MODE: pi-coding-agent via backend
      return new DefaultChatTransport({
        api: buildApiUrl('/api/v1/agent/chat'),
        credentials: 'include',
      })
    }

    // BROWSER MODE: pi-agent-core in-browser
    if (!transportRef.current) {
      transportRef.current = new PiAgentCoreTransport({ tools })
    } else {
      // Update tools if they changed (provider reconnect, etc.)
      transportRef.current.updateTools(tools)
    }
    return transportRef.current
  }, [capabilities, tools])
}
