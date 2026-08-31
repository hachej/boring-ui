import { describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '@hachej/boring-agent/shared'

import {
  applyRuntimePiExtensionIsolation,
  composeAddressedAgentRuntimeScope,
  normalizeAgentPiCapabilityOptions,
} from '../addressedAgentRuntimeScope.js'

const runtime = {
  identity: 'base-semantic-v1',
  physicalBindingIdentity: 'base-physical',
  resourceInputDigest: 'sha256:base',
  sessionNamespace: 'workspace',
  pi: { additionalSkillPaths: ['/base-skill'] },
  extraTools: [],
}

function tool(description: string): AgentTool {
  return {
    name: 'addressed_tool',
    description,
    parameters: { type: 'object', properties: {} },
    execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
  }
}

describe('addressed Agent runtime composition', () => {
  it('keeps the physical slot stable across empty, tool, and Pi grant revisions', () => {
    const empty = composeAddressedAgentRuntimeScope({
      runtime,
      agentTypeId: 'macro',
      agentTools: [],
    })
    const withTool = composeAddressedAgentRuntimeScope({
      runtime,
      agentTypeId: 'macro',
      agentTools: [tool('v1')],
    })
    const revisedTool = composeAddressedAgentRuntimeScope({
      runtime,
      agentTypeId: 'macro',
      agentTools: [tool('v2')],
    })
    const withPi = composeAddressedAgentRuntimeScope({
      runtime,
      agentTypeId: 'macro',
      agentTools: [tool('v2')],
      addressedPi: { additionalSkillPaths: ['/addressed-skill'] },
      addressedPiResourceInputDigest: 'sha256:addressed',
    })

    expect(new Set([
      empty.physicalBindingIdentity,
      withTool.physicalBindingIdentity,
      revisedTool.physicalBindingIdentity,
      withPi.physicalBindingIdentity,
    ]).size).toBe(1)
    expect(new Set([empty.identity, withTool.identity, revisedTool.identity, withPi.identity]).size).toBe(4)
    expect(new Set([
      empty.resourceInputDigest,
      withTool.resourceInputDigest,
      revisedTool.resourceInputDigest,
      withPi.resourceInputDigest,
    ]).size).toBe(4)
  })

  it('normalizes empty Pi grants away without changing the addressed slot model', () => {
    expect(normalizeAgentPiCapabilityOptions({
      additionalSkillPaths: [],
      packages: [],
      extensionPaths: [],
    }, 'direct')).toBeUndefined()
  })

  it('canonicalizes object key order in addressed Pi identity inputs', () => {
    const left = composeAddressedAgentRuntimeScope({
      runtime,
      agentTypeId: 'macro',
      agentTools: [],
      addressedPi: {
        packages: [{ source: 'npm:macro', skills: ['skills/macro'], extensions: ['extensions/macro.ts'] }],
      },
    })
    const right = composeAddressedAgentRuntimeScope({
      runtime,
      agentTypeId: 'macro',
      agentTools: [],
      addressedPi: {
        packages: [{ extensions: ['extensions/macro.ts'], skills: ['skills/macro'], source: 'npm:macro' }],
      },
    })

    expect(right.identity).toBe(left.identity)
  })

  it.each(['vercel-sandbox', 'blaxel', 'remote-worker', 'runsc-remote'] as const)(
    'rejects static and hot host extensions in %s mode',
    (runtimeMode) => {
      expect(() => applyRuntimePiExtensionIsolation({
        extensionPaths: ['/host/static-extension.ts'],
      }, runtimeMode)).toThrow(expect.objectContaining({
        message: `Pi options cannot grant host Pi extensions in ${runtimeMode} mode`,
        code: 'CONFIG_INVALID',
        statusCode: 500,
      }))

      const isolated = applyRuntimePiExtensionIsolation({
        getHotReloadableResources: () => ({ extensionPaths: ['/host/hot-extension.ts'] }),
      }, runtimeMode)
      expect(isolated.noExtensions).toBe(true)
      expect(() => isolated.getHotReloadableResources?.())
        .toThrow(`cannot grant host Pi extensions in ${runtimeMode} mode`)
    },
  )

  it.each(['vercel-sandbox', 'blaxel', 'remote-worker', 'runsc-remote'] as const)(
    'admits absolute extensions from addressed trusted app composition in %s mode',
    (runtimeMode) => {
      const pluginExtensionPath = '/app/plugins/trusted-loop/index.ts'
      expect(normalizeAgentPiCapabilityOptions({ extensionPaths: [pluginExtensionPath] }, runtimeMode)).toEqual({
        additionalSkillPaths: [],
        packages: [],
        extensionPaths: [pluginExtensionPath],
      })
      expect(() => normalizeAgentPiCapabilityOptions({
        extensionPaths: ['plugins/trusted-loop/index.ts'],
      }, runtimeMode)).toThrow(`getAgentPi must grant absolute trusted app extension paths in ${runtimeMode} mode`)

      // The same app plugin remains forbidden in static/ambient composition.
      // Only the addressed trusted-host callback may admit it.
      expect(() => applyRuntimePiExtensionIsolation({ extensionPaths: [pluginExtensionPath] }, runtimeMode))
        .toThrow(`Pi options cannot grant host Pi extensions in ${runtimeMode} mode`)
    },
  )

  it.each(['direct', 'local'] as const)('preserves explicit trusted extensions in %s mode', (runtimeMode) => {
    const pi = { extensionPaths: ['/host/trusted-extension.ts'] }
    expect(applyRuntimePiExtensionIsolation(pi, runtimeMode)).toBe(pi)
  })
})
