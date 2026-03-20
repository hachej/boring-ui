import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSessionSystemPrompt, createWorkspaceTools, resolveSessionContext } from './tools.mjs'


test('builds the expected seven tools', () => {
  const tools = createWorkspaceTools(
    { workspaceId: 'ws-123', internalApiToken: 'token', backendUrl: 'http://backend:8000' },
    async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  )

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['read_file', 'write_file', 'list_dir', 'exec', 'git_status', 'git_diff', 'git_commit'],
  )
})

test('routes read_file to workspace-scoped backend urls', async () => {
  const calls = []
  const fetchMock = async (url, options) => {
    calls.push([url, options])
    return new Response(JSON.stringify({ content: 'hello' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const tools = createWorkspaceTools(
    { workspaceId: 'ws-demo', internalApiToken: 'internal-token', backendUrl: 'http://backend:8000' },
    fetchMock,
  )

  const result = await tools.find((tool) => tool.name === 'read_file').execute('call-1', { path: 'README.md' })

  const [url, options] = calls[0]
  assert.equal(String(url), 'http://backend:8000/w/ws-demo/api/v1/files/read?path=README.md')
  assert.equal(options.method, 'GET')
  assert.equal(options.headers.authorization, 'Bearer internal-token')
  assert.equal(options.headers['x-boring-internal-token'], 'internal-token')
  assert.equal(options.headers['x-workspace-id'], 'ws-demo')
  assert.equal(result.content[0].text, 'hello')
})

test('uses presented_output for exec results and auth headers', async () => {
  const calls = []
  const fetchMock = async (url, options) => {
    calls.push([url, options])
    return new Response(JSON.stringify({
      exit_code: 0,
      stdout: 'raw stdout',
      stderr: '',
      duration_ms: 14,
      truncated: false,
      working_dir: '.',
      timed_out: false,
      presented_output: 'pretty output',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const tools = createWorkspaceTools(
    { workspaceId: 'ws-42', internalApiToken: 'workspace-jwt', backendUrl: 'http://127.0.0.1:8000' },
    fetchMock,
  )

  const result = await tools.find((tool) => tool.name === 'exec').execute('call-2', {
    command: 'git status',
    cwd: 'src',
    timeout_seconds: 12,
  })

  const [url, options] = calls[0]
  assert.equal(String(url), 'http://127.0.0.1:8000/w/ws-42/api/v1/sandbox/exec')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers.authorization, 'Bearer workspace-jwt')
  assert.equal(options.headers['x-boring-internal-token'], 'workspace-jwt')
  assert.deepEqual(JSON.parse(options.body), {
    command: 'git status',
    cwd: 'src',
    timeout_seconds: 12,
  })
  assert.equal(result.content[0].text, 'pretty output')
})

test('resolves session context from payload, headers, and env fallbacks', () => {
  const context = resolveSessionContext(
    { workspace_id: 'payload-ws' },
    { authorization: 'Bearer header-token' },
    { BORING_BACKEND_URL: 'http://backend:9000' },
  )

  assert.deepEqual(context, {
    workspaceId: 'payload-ws',
    internalApiToken: 'header-token',
    backendUrl: 'http://backend:9000',
  })
})

test('builds a system prompt that advertises workspace tools', () => {
  const prompt = buildSessionSystemPrompt('Base prompt.', { workspaceId: 'ws-docs' })
  assert.match(prompt, /Base prompt\./)
  assert.match(prompt, /Active workspace: ws-docs\./)
  assert.match(prompt, /workspace tools/)
})
