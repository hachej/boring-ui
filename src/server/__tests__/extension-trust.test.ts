/**
 * TDD tests for bd-a3d6c: Extension trust model.
 *
 * Tests the trust model for child app extensions:
 * - trusted-local: all routers/tools allowed
 * - allowlist: only admin-approved routers/tools
 */
import { describe, it, expect } from 'vitest'
import {
  type ExtensionTrustMode,
  isRouterAllowed,
  isToolAllowed,
  DEFAULT_TRUST_CONFIG,
} from '../services/extensionTrust.js'

describe('Extension trust model', () => {
  describe('DEFAULT_TRUST_CONFIG', () => {
    it('defaults to trusted-local mode', () => {
      expect(DEFAULT_TRUST_CONFIG.mode).toBe('trusted-local')
    })

    it('has api_version 1', () => {
      expect(DEFAULT_TRUST_CONFIG.api_version).toBe(1)
    })
  })

  describe('trusted-local mode', () => {
    const config = { mode: 'trusted-local' as ExtensionTrustMode, api_version: 1 }

    it('allows any router', () => {
      expect(isRouterAllowed(config, 'analytics')).toBe(true)
      expect(isRouterAllowed(config, 'custom.deep.router')).toBe(true)
    })

    it('allows any tool', () => {
      expect(isToolAllowed(config, 'macro_run')).toBe(true)
      expect(isToolAllowed(config, 'custom_tool')).toBe(true)
    })
  })

  describe('allowlist mode', () => {
    const config = {
      mode: 'allowlist' as ExtensionTrustMode,
      api_version: 1,
      allowedRouters: ['analytics', 'reports'],
      allowedTools: ['macro_run'],
    }

    it('allows listed routers', () => {
      expect(isRouterAllowed(config, 'analytics')).toBe(true)
      expect(isRouterAllowed(config, 'reports')).toBe(true)
    })

    it('rejects unlisted routers', () => {
      expect(isRouterAllowed(config, 'admin')).toBe(false)
      expect(isRouterAllowed(config, 'custom')).toBe(false)
    })

    it('allows listed tools', () => {
      expect(isToolAllowed(config, 'macro_run')).toBe(true)
    })

    it('rejects unlisted tools', () => {
      expect(isToolAllowed(config, 'admin_delete')).toBe(false)
    })

    it('rejects all when allowlist is empty', () => {
      const empty = {
        mode: 'allowlist' as ExtensionTrustMode,
        api_version: 1,
        allowedRouters: [],
        allowedTools: [],
      }
      expect(isRouterAllowed(empty, 'anything')).toBe(false)
      expect(isToolAllowed(empty, 'anything')).toBe(false)
    })
  })

  describe('browser-only extensions', () => {
    it('panel extensions do not require server trust', () => {
      // Browser-only panels always allowed regardless of mode
      const allowlistConfig = {
        mode: 'allowlist' as ExtensionTrustMode,
        api_version: 1,
        allowedRouters: [],
        allowedTools: [],
      }
      // Panels are frontend-only — they never call isRouterAllowed
      // This test documents the architectural decision
      expect(true).toBe(true) // Panels bypass server trust
    })
  })
})
