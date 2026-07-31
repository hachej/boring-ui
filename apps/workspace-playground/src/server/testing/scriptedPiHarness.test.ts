import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScriptedPiHarness } from './scriptedPiHarness'

const runContext = (workdir: string) => ({
  abortSignal: new AbortController().signal,
  workdir,
  workspaceId: 'workspace-a',
  requestId: 'request-a',
})

describe('scripted Pi browser harness persistence', () => {
  it('hydrates canonical sessions and transcript messages after process-like recreation', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-workspace-'))
    const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-sessions-'))
    const input = { cwd: workspaceRoot, sessionRoot }
    const sessionCtx = {
      workspaceId: 'workspace-a',
      runtimeScopeIdentity: 'runtime-a',
    } as { workspaceId: string; runtimeScopeIdentity: string }

    const first = createScriptedPiHarness(input)
    const created = await first.sessions!.create(sessionCtx)
    const firstAdapter = await first.getPiSessionAdapter(
      { sessionId: created.id, ctx: sessionCtx },
      runContext(workspaceRoot),
    )
    await firstAdapter.prompt('persist me')

    const sessionFile = join(sessionRoot, `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`, `${created.id}.jsonl`)
    expect(await readFile(sessionFile, 'utf8')).toContain('"runtimeScopeIdentity":"runtime-a"')

    const restarted = createScriptedPiHarness(input)
    await expect(restarted.sessions!.list(sessionCtx)).resolves.toEqual([
      expect.objectContaining({ id: created.id, turnCount: 1 }),
    ])
    const restartedAdapter = await restarted.getPiSessionAdapter(
      { sessionId: created.id, ctx: sessionCtx },
      runContext(workspaceRoot),
    )
    expect(restartedAdapter.readSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant' }),
    ]))
  })
})
