import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-tools-test-'))
process.env.BORING_UI_WORKSPACE_ROOT = tmpDir

const { createWorkspaceTools, resolveSessionContext, buildSessionSystemPrompt } = await import('./tools.mjs')

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
})

describe('buildSessionSystemPrompt', () => {
  it('includes workspace root', () => {
    const prompt = buildSessionSystemPrompt('Base prompt.')
    assert.ok(prompt.includes(tmpDir))
  })

  it('mentions exec_bash', () => {
    const prompt = buildSessionSystemPrompt('Base prompt.')
    assert.ok(prompt.includes('exec_bash'))
  })
})

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
