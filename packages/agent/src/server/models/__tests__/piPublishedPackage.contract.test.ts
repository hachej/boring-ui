import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@mariozechner/pi-coding-agent'
import { describe, expect, it } from 'vitest'

const TESTED_PI_VERSION = '0.84.4'

function resolvedPackageManifest(specifier: string): { name: string; version: string } {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'node_modules', specifier, 'package.json'), 'utf8'),
  ) as { name: string; version: string }
}

describe('published coordinated Pi contract', () => {
  it('runs against the exact published coding-agent and pi-ai baseline', () => {
    expect(resolvedPackageManifest('@mariozechner/pi-coding-agent')).toMatchObject({
      name: '@earendil-works/pi-coding-agent',
      version: TESTED_PI_VERSION,
    })
    expect(resolvedPackageManifest('@earendil-works/pi-ai')).toMatchObject({
      name: '@earendil-works/pi-ai',
      version: TESTED_PI_VERSION,
    })
  })

  it('preserves modify(undefined) and accepts the tested Codex OAuth shape through ModelRuntime', async () => {
    const credentials = new InMemoryCredentialStore()
    const original = {
      type: 'oauth' as const,
      access: 'synthetic-access',
      refresh: 'synthetic-refresh',
      expires: Date.now() + 60_000,
      accountId: 'synthetic-account',
    }
    await credentials.modify('openai-codex', async () => original)
    await expect(credentials.modify('openai-codex', async () => undefined)).resolves.toEqual(original)
    await expect(credentials.read('openai-codex')).resolves.toEqual(original)

    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false })
    expect(runtime.getProvider('openai-codex')).toBeDefined()
    await expect(runtime.checkAuth('openai-codex')).resolves.toMatchObject({ type: 'oauth' })
  })
})
