import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-tools-test-'))
process.env.BORING_UI_WORKSPACE_ROOT = tmpDir

const { createWorkspaceTools, resolveSessionContext, buildSessionSystemPrompt, getEffectiveWorkspaceRoot } = await import('./tools.mjs')

describe('exec_bash tool', () => {
  const tools = createWorkspaceTools({})
  const exec = tools.find(t => t.name === 'exec_bash')

  it('has exactly one tool: exec_bash', () => {
    assert.equal(tools.length, 1)
    assert.equal(tools[0].name, 'exec_bash')
  })

  it('runs a command and returns stdout', async () => {
    const result = await exec.execute(null, { command: 'echo hello-test' })
    assert.ok(result.content[0].text.includes('hello-test'))
  })

  it('creates a file via echo', async () => {
    await exec.execute(null, { command: 'echo "file content" > test.txt' })
    assert.ok(fs.existsSync(path.join(tmpDir, 'test.txt')))
    assert.equal(fs.readFileSync(path.join(tmpDir, 'test.txt'), 'utf-8').trim(), 'file content')
  })

  it('reads a file via cat', async () => {
    const result = await exec.execute(null, { command: 'cat test.txt' })
    assert.ok(result.content[0].text.includes('file content'))
  })

  it('lists files via ls', async () => {
    const result = await exec.execute(null, { command: 'ls' })
    assert.ok(result.content[0].text.includes('test.txt'))
  })

  it('returns exit code for failing commands', async () => {
    const result = await exec.execute(null, { command: 'false' })
    assert.ok(result.details.exitCode !== 0)
  })

  it('runs python', async () => {
    const result = await exec.execute(null, { command: 'python3 -c "print(40+2)"' })
    assert.ok(result.content[0].text.includes('42'))
  })

  it('runs git', async () => {
    await exec.execute(null, { command: 'git init' })
    const result = await exec.execute(null, { command: 'git status' })
    assert.ok(result.content[0].text.length > 0)
  })

  it('supports cwd parameter', async () => {
    fs.mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'subdir', 'sub.txt'), 'in subdir')
    const result = await exec.execute(null, { command: 'cat sub.txt', cwd: 'subdir' })
    assert.ok(result.content[0].text.includes('in subdir'))
  })

  it('rejects empty command', async () => {
    await assert.rejects(() => exec.execute(null, { command: '' }), /command is required/)
  })
})

describe('resolveSessionContext', () => {
  it('reads workspace_id from payload', () => {
    const ctx = resolveSessionContext({ workspace_id: 'ws-1' })
    assert.equal(ctx.workspaceId, 'ws-1')
  })

  it('reads workspace_id from headers', () => {
    const ctx = resolveSessionContext({}, { 'x-workspace-id': 'ws-2' })
    assert.equal(ctx.workspaceId, 'ws-2')
  })

  it('defaults to empty string', () => {
    const ctx = resolveSessionContext()
    assert.equal(ctx.workspaceId, '')
  })

  it('reads workspaceRoot from payload workspace_root', () => {
    const ctx = resolveSessionContext({ workspace_root: '/data/ws-1' })
    assert.equal(ctx.workspaceRoot, '/data/ws-1')
  })

  it('reads workspaceRoot from payload workspaceRoot (camelCase)', () => {
    const ctx = resolveSessionContext({ workspaceRoot: '/data/ws-2' })
    assert.equal(ctx.workspaceRoot, '/data/ws-2')
  })

  it('reads workspaceRoot from x-boring-workspace-root header', () => {
    const ctx = resolveSessionContext({}, { 'x-boring-workspace-root': '/data/ws-3' })
    assert.equal(ctx.workspaceRoot, '/data/ws-3')
  })

  it('prefers payload workspace_root over header', () => {
    const ctx = resolveSessionContext(
      { workspace_root: '/from-payload' },
      { 'x-boring-workspace-root': '/from-header' },
    )
    assert.equal(ctx.workspaceRoot, '/from-payload')
  })

  it('defaults workspaceRoot to empty string when absent', () => {
    const ctx = resolveSessionContext()
    assert.equal(ctx.workspaceRoot, '')
  })
})

describe('buildSessionSystemPrompt', () => {
  it('includes default workspace root when no context', () => {
    const prompt = buildSessionSystemPrompt('Base prompt.')
    assert.ok(prompt.includes(tmpDir))
  })

  it('uses context workspaceRoot when provided', () => {
    const prompt = buildSessionSystemPrompt('Base prompt.', { workspaceRoot: '/custom/root' })
    assert.ok(prompt.includes('/custom/root'))
    assert.ok(!prompt.includes(tmpDir))
  })

  it('mentions exec_bash', () => {
    const prompt = buildSessionSystemPrompt('Base prompt.')
    assert.ok(prompt.includes('exec_bash'))
  })
})

describe('getEffectiveWorkspaceRoot', () => {
  it('returns context workspaceRoot when provided', () => {
    assert.equal(getEffectiveWorkspaceRoot({ workspaceRoot: '/ws/abc' }), '/ws/abc')
  })

  it('falls back to env/cwd default when empty', () => {
    assert.equal(getEffectiveWorkspaceRoot({}), tmpDir)
    assert.equal(getEffectiveWorkspaceRoot(), tmpDir)
  })
})

describe('createWorkspaceTools with workspace root', () => {
  it('uses context workspaceRoot for exec_bash cwd', async () => {
    const wsDir = path.join(tmpDir, 'ctx-root')
    fs.mkdirSync(wsDir, { recursive: true })
    fs.writeFileSync(path.join(wsDir, 'ctx-file.txt'), 'from-context')

    const tools = createWorkspaceTools({ workspaceRoot: wsDir })
    const exec = tools.find(t => t.name === 'exec_bash')
    const result = await exec.execute(null, { command: 'cat ctx-file.txt' })
    assert.ok(result.content[0].text.includes('from-context'))
  })

  it('falls back to default root when no context workspaceRoot', async () => {
    const tools = createWorkspaceTools({})
    const exec = tools.find(t => t.name === 'exec_bash')
    const result = await exec.execute(null, { command: 'pwd' })
    assert.ok(result.content[0].text.includes(tmpDir))
  })
})

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
