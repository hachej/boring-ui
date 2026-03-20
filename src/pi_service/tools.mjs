import { Type } from '@sinclair/typebox'
import { exec as execCb } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { promisify } from 'node:util'

const execAsync = promisify(execCb)

const DEFAULT_WORKSPACE_ROOT = process.env.BORING_UI_WORKSPACE_ROOT || process.cwd()

const textResult = (text, details = {}) => ({
  content: [{ type: 'text', text }],
  details,
})

const formatExecOutput = (result) => {
  const chunks = []
  if (result.stdout) chunks.push(result.stdout)
  if (result.stderr) chunks.push(`[stderr]\n${result.stderr}`)
  if (result.exitCode !== null && result.exitCode !== 0) chunks.push(`[exit_code] ${result.exitCode}`)
  return chunks.join('\n') || '(no output)'
}

// --- Session context (kept for API compatibility with server.mjs) ---

const normalizeWorkspaceId = (value) => String(value || '').trim()

const bearerTokenFromHeader = (authorization) => {
  const raw = String(authorization || '').trim()
  if (!raw) return ''
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match ? String(match[1] || '').trim() : ''
}

const normalizeBaseUrl = (value) => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  return trimmed || 'http://127.0.0.1:8000'
}

export function resolveSessionContext(payload = {}, headers = {}, env = process.env) {
  const workspaceId = normalizeWorkspaceId(
    payload.workspace_id
    || payload.workspaceId
    || headers['x-workspace-id']
    || headers['X-Workspace-Id']
    || '',
  )
  const internalApiToken = String(
    payload.internal_api_token
    || payload.internalApiToken
    || bearerTokenFromHeader(headers.authorization || headers.Authorization)
    || headers['x-boring-internal-token']
    || headers['X-Boring-Internal-Token']
    || env.BORING_INTERNAL_TOKEN
    || env.BORING_INTERNAL_API_TOKEN
    || env.BORING_UI_INTERNAL_TOKEN
    || ''
  ).trim()
  const backendUrl = normalizeBaseUrl(
    payload.backend_url
    || payload.backendUrl
    || headers['x-boring-backend-url']
    || headers['X-Boring-Backend-Url']
    || env.BORING_BACKEND_URL
  )
  const workspaceRoot = String(
    payload.workspace_root
    || payload.workspaceRoot
    || headers['x-boring-workspace-root']
    || headers['X-Boring-Workspace-Root']
    || ''
  ).trim()

  return { workspaceId, internalApiToken, backendUrl, workspaceRoot }
}

export function getEffectiveWorkspaceRoot(context = {}) {
  return context.workspaceRoot || DEFAULT_WORKSPACE_ROOT
}

export function buildSessionSystemPrompt(basePrompt, context = {}) {
  const prompt = String(basePrompt || '').trim()
  const root = getEffectiveWorkspaceRoot(context)
  return [
    prompt,
    `Workspace root: ${root}.`,
    'You have full shell access via the exec_bash tool.',
    'Use exec_bash for ALL operations: file creation, reading, editing, git, python, etc.',
    'Always use exec_bash — do not respond with file contents in text, use the tool.',
  ].filter(Boolean).join(' ')
}

// --- Single tool: exec_bash ---

export function createWorkspaceTools(context = {}) {
  const wsRoot = getEffectiveWorkspaceRoot(context)
  return [
    {
      name: 'exec_bash',
      label: 'Execute Bash',
      description: 'Execute a bash command in the workspace. Use this for ALL operations: file read/write, git, python, package install, etc.',
      parameters: Type.Object({
        command: Type.String({ description: 'Bash command to execute' }),
        cwd: Type.Optional(Type.String({ description: 'Working directory relative to workspace root' })),
      }),
      execute: async (_toolCallId, params) => {
        const command = String(params?.command || '').trim()
        if (!command) throw new Error('command is required')
        const cwd = params?.cwd
          ? String(params.cwd).trim().replace(/^\/+/, '')
          : '.'
        const fullCwd = cwd === '.' ? wsRoot : `${wsRoot}/${cwd}`
        // Ensure workspace directory exists — during provisioning the volume
        // mount may not be ready yet, which causes ENOENT on exec.
        if (!existsSync(fullCwd)) {
          try { mkdirSync(fullCwd, { recursive: true }) } catch { /* best effort */ }
        }
        const start = Date.now()
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: fullCwd,
            timeout: 60_000,
            maxBuffer: 512 * 1024,
            env: { ...process.env, HOME: wsRoot },
          })
          return textResult(formatExecOutput({ stdout, stderr, exitCode: 0 }), {
            stdout, stderr, exitCode: 0, duration_ms: Date.now() - start,
          })
        } catch (err) {
          const result = {
            stdout: err.stdout || '',
            stderr: err.stderr || err.message || '',
            exitCode: typeof err.code === 'number' ? err.code : 1,
            duration_ms: Date.now() - start,
          }
          return textResult(formatExecOutput(result), result)
        }
      },
    },
  ]
}
