import { describe, expect, it } from 'vitest'
import { FULL_APP_FRONT_PLUGINS } from '../../front/plugins'
import { FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS } from '../plugins'

describe('full-app default plugin composition', () => {
  it('wires every server-side default package into the authenticated front shell', () => {
    expect(FULL_APP_FRONT_PLUGINS.map((plugin) => plugin.pluginId).sort()).toEqual(
      FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS.map((plugin) => plugin.id).sort(),
    )
  })
})
