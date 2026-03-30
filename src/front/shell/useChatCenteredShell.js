/**
 * useChatCenteredShell — single entry point for deciding which shell to render.
 *
 * Reads the feature flag `features.chatCenteredShell` from app config.
 * Supports dev overrides via URL search params:
 *   ?shell=chat-centered  — force-enable the new shell
 *   ?shell=legacy          — force-disable (use old shell)
 *
 * Query params take precedence over config, enabling per-session testing
 * without changing the flag in the config.
 *
 * @returns {{ enabled: boolean }}
 */

import { useMemo } from 'react'
import { getConfig } from '../config/appConfig'

/**
 * @returns {{ enabled: boolean }}
 */
export function useChatCenteredShell() {
  return useMemo(() => {
    // 1. Check URL search params for dev override
    const params = new URLSearchParams(window.location.search)
    const shellParam = params.get('shell')

    if (shellParam === 'chat-centered') {
      return { enabled: true }
    }
    if (shellParam === 'legacy') {
      return { enabled: false }
    }

    // 2. Read from app config
    const config = getConfig()
    const enabled = config?.features?.chatCenteredShell === true

    return { enabled }
  }, [])
}
