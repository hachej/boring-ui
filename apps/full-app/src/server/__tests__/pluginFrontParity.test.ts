import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS } from '../plugins'

const frontEntrySource = readFileSync(
  fileURLToPath(new URL('../../front/main.tsx', import.meta.url)),
  'utf8',
)

describe('full-app default plugin composition', () => {
  it('registers every server-side default package directly in the authenticated front shell', () => {
    expect(FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS.map((plugin) => plugin.id)).toContain('boring-automation')
    expect(frontEntrySource).toContain("import boringAutomationPlugin from '@hachej/boring-automation/front'")
    expect(frontEntrySource).toContain('const fullAppFrontPlugins = [boringAutomationPlugin]')
    expect(frontEntrySource).toContain('plugins={fullAppFrontPlugins}')
    expect(frontEntrySource).toContain('agentTypeId="default"')
  })
})
