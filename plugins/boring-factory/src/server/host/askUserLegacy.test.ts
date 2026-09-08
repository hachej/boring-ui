import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claimLegacyAskUserQuestions } from './askUserLegacy'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true, maxRetries: 5 }))) })

describe('claimLegacyAskUserQuestions', () => {
  it('stamps the hub scope on questions without a workspaceId and leaves the rest alone', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'factory-ask-user-legacy-'))
    roots.push(root)
    const path = resolve(root, 'ask-user.json')
    await writeFile(path, JSON.stringify({
      questions: {
        legacy: { questionId: 'legacy', status: 'ready', title: '[X] Merge approval' },
        scoped: { questionId: 'scoped', status: 'ready', workspaceId: 'other-scope' },
      },
      pendingBySession: {},
    }))
    expect(await claimLegacyAskUserQuestions(path, 'factory-hub')).toBe(1)
    const after = JSON.parse(await readFile(path, 'utf8')) as { questions: Record<string, { workspaceId?: string }> }
    expect(after.questions.legacy.workspaceId).toBe('factory-hub')
    expect(after.questions.scoped.workspaceId).toBe('other-scope')
    expect(await claimLegacyAskUserQuestions(path, 'factory-hub')).toBe(0)
  })

  it('is a no-op without a store file', async () => {
    expect(await claimLegacyAskUserQuestions(resolve(tmpdir(), `missing-${Date.now()}.json`), 'factory-hub')).toBe(0)
  })
})
