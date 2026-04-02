/**
 * useAgentTransport — Config-driven agent transport selection.
 *
 * Two independent controls:
 *
 *   chat = 'pi' | 'vercel-sdk'          — which transport interface
 *     'pi'         → PiAgentCoreTransport (pi-agent-core in browser,
 *                    tools call dataProvider which can be HTTP or LightningFS)
 *     'vercel-sdk' → DefaultChatTransport (POST to server, agent runs server-side)
 *
 *   agent_mode = 'frontend' | 'backend' — where the agent harness runs
 *     (currently derived: pi → frontend, vercel-sdk → backend,
 *      but pi works with backend data providers too)
 *
 * Both transports implement ChatTransport, consumed by useChat().
 *
 * @module providers/agent/useAgentTransport
 */

import { useMemo, useEffect, useCallback, useState } from 'react'
import { DefaultChatTransport } from 'ai'
import { PiAgentCoreTransport } from '../pi/piAgentCoreTransport'
import { createPiNativeTools, mergePiTools } from '../pi/defaultTools'
import { getPiAgentConfig } from '../pi/agentConfig'
import { useDataProvider } from '../data/DataContext'
import { useQueryClient } from '@tanstack/react-query'
import { buildApiUrl } from '../../utils/apiBase'
import { getConfig, getDefaultConfig } from '../../config/appConfig'
import { getWorkspaceIdFromPathname } from '../../utils/controlPlane'
import { getEnvApiKey } from '../pi/envApiKeys.browser'

// Session-scoped API key store (in-memory, not persisted)
const sessionApiKeys = new Map()

/** Store an API key for this browser session. */
export function setSessionApiKey(provider, key) {
  if (key) {
    sessionApiKeys.set(provider, key)
  } else {
    sessionApiKeys.delete(provider)
  }
}

/** Resolve API key: env vars first, then session store. */
function resolveApiKey(provider) {
  return getEnvApiKey(provider) || sessionApiKeys.get(provider) || ''
}

/**
 * Resolve which chat interface to use.
 *
 * URL: ?chat=pi  or  ?chat=vercel-sdk
 * Fallback: derived from agent_mode (frontend → pi, backend → vercel-sdk)
 *
 * @returns {'pi'|'vercel-sdk'}
 */
export function resolveChatInterface() {
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('chat')
    if (param === 'pi' || param === 'vercel-sdk') return param
  }

  // Derive from agent mode when not explicitly set
  return resolveAgentMode() === 'backend' ? 'vercel-sdk' : 'pi'
}

/**
 * Resolve agent mode from URL params (dev override) then config.
 *
 * URL: ?agent_mode=backend  or  ?agent_mode=frontend
 * Config: config.agents.mode
 *
 * @returns {'frontend'|'backend'}
 */
export function resolveAgentMode() {
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('agent_mode')
    if (param === 'backend' || param === 'frontend') return param
  }

  const config = getConfig() || getDefaultConfig()
  const mode = String(config?.agents?.mode || 'frontend').trim().toLowerCase()
  return mode === 'backend' ? 'backend' : 'frontend'
}

function getWorkspaceId() {
  if (typeof window === 'undefined') return ''
  return getWorkspaceIdFromPathname(window.location.pathname)
}

/**
 * React hook that returns the correct ChatTransport based on the
 * chat interface selection (pi or vercel-sdk).
 *
 * @returns {{ transport, mode, chatInterface, thinkingLevel, setThinkingLevel, selectedModel, setModel, availableModels }}
 */
export function useAgentTransport() {
  const chatInterface = resolveChatInterface()
  const mode = resolveAgentMode()
  const dataProvider = useDataProvider()
  const queryClient = useQueryClient()
  const workspaceId = getWorkspaceId()

  const usePi = chatInterface === 'pi'

  // Build tools for PI mode (agent runs in browser, tools use dataProvider)
  const tools = useMemo(() => {
    if (!usePi) return []
    const defaultTools = createPiNativeTools(dataProvider, queryClient)
    const { tools: configuredTools } = getPiAgentConfig()
    if (configuredTools.length > 0) {
      return mergePiTools(defaultTools, configuredTools)
    }
    return defaultTools
  }, [usePi, dataProvider, queryClient])

  // PI transport held in state (not ref) to satisfy react-hooks/refs lint rule.
  // useState with lazy init ensures the Agent instance is created once and
  // preserved across re-renders.
  const [piTransport] = useState(() =>
    new PiAgentCoreTransport({ tools: [], getApiKey: resolveApiKey }),
  )

  // Update PI transport tools when they change
  useEffect(() => {
    if (usePi) piTransport.updateTools(tools)
  }, [usePi, piTransport, tools])

  const transport = useMemo(() => {
    if (!usePi) {
      return new DefaultChatTransport({
        api: buildApiUrl('/api/v1/agent/chat'),
        credentials: 'include',
        body: workspaceId ? { workspace_id: workspaceId } : undefined,
      })
    }
    return piTransport
  }, [usePi, piTransport, workspaceId])

  const [thinkingLevel, setThinkingLevelState] = useState('off')
  const [selectedModel, setSelectedModelState] = useState(null)
  const [availableModels, setAvailableModels] = useState([])

  const setThinkingLevel = useCallback((level) => {
    setThinkingLevelState(level)
    if (usePi && piTransport?.setThinkingLevel) {
      piTransport.setThinkingLevel(level)
    }
  }, [usePi])

  const setModel = useCallback((provider, modelId) => {
    const value = provider && modelId ? { provider, modelId } : null
    setSelectedModelState(value)
    if (usePi && piTransport?.setModel) {
      piTransport.setModel(provider, modelId)
    }
  }, [usePi])

  // Load available models for PI mode
  useMemo(() => {
    if (!usePi) return
    const t = piTransport
    if (t?.getAvailableModels) {
      t.getAvailableModels().then(setAvailableModels).catch(() => {})
    }
  }, [usePi, transport])

  return {
    transport,
    mode,
    chatInterface,
    thinkingLevel,
    setThinkingLevel,
    selectedModel,
    setModel,
    availableModels,
  }
}
