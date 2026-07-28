import { describe, expect, it } from 'vitest'
import { FullAppWorkspaceAgentFront } from '../../front/FullAppWorkspaceAgentFront'
import { FULL_APP_AGENT_COMPOSITION } from '../../front/plugins'
import { FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS } from '../plugins'

describe('full-app default plugin composition', () => {
  it('wires the canonical agent and every server-side default package into the authenticated front shell', () => {
    const shell = FullAppWorkspaceAgentFront({ agentTypeId: 'legacy-override' })
    expect(shell.props.agentTypeId).toBe('default')
    expect(shell.props.plugins).toBe(FULL_APP_AGENT_COMPOSITION.plugins)
    expect(FULL_APP_AGENT_COMPOSITION.plugins.map((plugin) => plugin.pluginId).sort()).toEqual(
      FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS.map((plugin) => plugin.id).sort(),
    )
  })
})
