import { Type } from '@sinclair/typebox'

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000'

const textResult = (text, details = {}) => ({
  content: [{ type: 'text', text }],
  details,
})

const normalizeBaseUrl = (value) => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  return trimmed || DEFAULT_BACKEND_URL
}

const normalizeWorkspaceId = (value) => {
  const trimmed = String(value || '').trim()
  return trimmed || ''
}

const normalizePath = (value, fallback = '.') => {
  const trimmed = String(value || '').trim().replace(/^\/+/, '')
  return trimmed || fallback
}

const normalizeFilePath = (value) => normalizePath(value, '')

const formatDirEntries = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return '(empty)'
  return entries
    .slice()
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
    .map((entry) => {
      const name = String(entry?.name || entry?.path || '')
      return entry?.is_dir ? `${name}/` : name
    })
    .join('\n')
}

const formatExecOutput = (payload) => {
  if (typeof payload?.presented_output === 'string' && payload.presented_output.trim()) {
    return payload.presented_output
  }

  const stdout = typeof payload?.stdout === 'string' ? payload.stdout : ''
  const stderr = typeof payload?.stderr === 'string' ? payload.stderr : ''
  const exitCode = Number.isFinite(payload?.exit_code) ? Number(payload.exit_code) : null
  const chunks = []
  if (stdout) chunks.push(stdout)
  if (stderr) chunks.push(`[stderr]\n${stderr}`)
  if (exitCode !== null && exitCode !== 0) chunks.push(`[exit_code] ${exitCode}`)
  return chunks.join('\n') || '(no output)'
}

const formatGitStatus = (payload) => {
  if (payload?.available === false) return 'Git not available'
  if (payload?.is_repo === false) return 'Not a git repository'
  const files = Array.isArray(payload?.files) ? payload.files : []
  if (files.length === 0) return 'Clean working tree'
  return files
    .slice()
    .sort((a, b) => String(a?.path || '').localeCompare(String(b?.path || '')))
    .map((entry) => `${String(entry?.status || '').toUpperCase()} ${String(entry?.path || '')}`.trim())
    .filter(Boolean)
    .join('\n') || 'Clean working tree'
}

const bearerTokenFromHeader = (authorization) => {
  const raw = String(authorization || '').trim()
  if (!raw) return ''
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match ? String(match[1] || '').trim() : ''
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

  return {
    workspaceId,
    internalApiToken,
    backendUrl,
  }
}

export function buildSessionSystemPrompt(basePrompt, context = {}) {
  const prompt = String(basePrompt || '').trim()
  const sections = [prompt]
  if (context.workspaceId) {
    sections.push(`Active workspace: ${context.workspaceId}.`)
  }
  sections.push(
    'Use the available workspace tools for file reads/writes, directory listing, git inspection/commit, and sandboxed command execution.',
  )
  return sections.filter(Boolean).join(' ')
}

function requireWorkspaceId(context) {
  const workspaceId = normalizeWorkspaceId(context?.workspaceId)
  if (!workspaceId) {
    throw new Error('workspace_id is required for PI workspace tools')
  }
  return workspaceId
}

function buildHeaders(context, extraHeaders = {}) {
  const headers = {
    accept: 'application/json',
    ...extraHeaders,
  }

  if (context.workspaceId) {
    headers['x-workspace-id'] = context.workspaceId
  }
  if (context.internalApiToken) {
    headers.authorization = `Bearer ${context.internalApiToken}`
    headers['x-boring-internal-token'] = context.internalApiToken
  }

  return headers
}

async function requestJson(fetchImpl, context, method, routePath, { searchParams, body, signal } = {}) {
  const workspaceId = requireWorkspaceId(context)
  const url = new URL(
    `/w/${encodeURIComponent(workspaceId)}${routePath}`,
    normalizeBaseUrl(context.backendUrl),
  )
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetchImpl(url, {
    method,
    headers: buildHeaders(
      context,
      body === undefined ? {} : { 'content-type': 'application/json' },
    ),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

  const rawText = await response.text()
  let payload = {}
  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText)
    } catch {
      payload = { raw: rawText }
    }
  }

  if (!response.ok) {
    const detail = payload?.detail || payload?.error || `${response.status} ${response.statusText}`
    throw new Error(String(detail))
  }
  return payload
}

export function createWorkspaceTools(context, fetchImpl = fetch) {
  const tools = [
    {
      name: 'read_file',
      label: 'Read File',
      description: 'Read the contents of a file at a workspace-relative path.',
      parameters: Type.Object({
        path: Type.String({ description: 'Relative file path (e.g. README.md or src/main.py)' }),
      }),
      execute: async (_toolCallId, params, signal) => {
        const path = normalizeFilePath(params?.path)
        if (!path) throw new Error('path is required')
        const payload = await requestJson(fetchImpl, context, 'GET', '/api/v1/files/read', {
          searchParams: { path },
          signal,
        })
        return textResult(String(payload?.content || ''), { path })
      },
    },
    {
      name: 'write_file',
      label: 'Write File',
      description: 'Write content to a file at a workspace-relative path.',
      parameters: Type.Object({
        path: Type.String({ description: 'Relative file path' }),
        content: Type.String({ description: 'Content to write' }),
      }),
      execute: async (_toolCallId, params, signal) => {
        const path = normalizeFilePath(params?.path)
        if (!path) throw new Error('path is required')
        await requestJson(fetchImpl, context, 'PUT', '/api/v1/files/write', {
          searchParams: { path },
          body: { content: params?.content ?? '' },
          signal,
        })
        const content = String(params?.content ?? '')
        return textResult(`Wrote ${content.length} bytes to ${path}`, { path, size: content.length })
      },
    },
    {
      name: 'list_dir',
      label: 'List Directory',
      description: 'List files and directories at a workspace-relative path.',
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: 'Relative directory path (default: project root)' })),
      }),
      execute: async (_toolCallId, params, signal) => {
        const path = normalizePath(params?.path)
        const payload = await requestJson(fetchImpl, context, 'GET', '/api/v1/files/list', {
          searchParams: { path },
          signal,
        })
        return textResult(formatDirEntries(payload?.entries), { path, entries: payload?.entries || [] })
      },
    },
    {
      name: 'exec',
      label: 'Exec',
      description: 'Run a command inside the active workspace sandbox.',
      parameters: Type.Object({
        command: Type.String({ description: 'Command to execute' }),
        cwd: Type.Optional(Type.String({ description: 'Optional working directory (relative path)' })),
        timeout_seconds: Type.Optional(Type.Number({ description: 'Timeout in seconds', default: 60 })),
      }),
      execute: async (_toolCallId, params, signal) => {
        const command = String(params?.command || '').trim()
        if (!command) throw new Error('command is required')
        const payload = await requestJson(fetchImpl, context, 'POST', '/api/v1/sandbox/exec', {
          body: {
            command,
            cwd: normalizePath(params?.cwd),
            timeout_seconds: Number.isFinite(params?.timeout_seconds) ? Number(params.timeout_seconds) : 60,
          },
          signal,
        })
        return textResult(formatExecOutput(payload), payload)
      },
    },
    {
      name: 'git_status',
      label: 'Git Status',
      description: 'Show git working tree status using canonical status codes.',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, signal) => {
        const payload = await requestJson(fetchImpl, context, 'GET', '/api/v1/git/status', { signal })
        return textResult(formatGitStatus(payload), { files: payload?.files || [] })
      },
    },
    {
      name: 'git_diff',
      label: 'Git Diff',
      description: 'Show git diff for a workspace-relative file path.',
      parameters: Type.Object({
        path: Type.String({ description: 'Relative file path' }),
      }),
      execute: async (_toolCallId, params, signal) => {
        const path = normalizeFilePath(params?.path)
        if (!path) throw new Error('path is required')
        const payload = await requestJson(fetchImpl, context, 'GET', '/api/v1/git/diff', {
          searchParams: { path },
          signal,
        })
        return textResult(String(payload?.diff || '(no diff)'), { path })
      },
    },
    {
      name: 'git_commit',
      label: 'Git Commit',
      description: 'Create a git commit from the currently staged changes.',
      parameters: Type.Object({
        message: Type.String({ description: 'Commit message' }),
      }),
      execute: async (_toolCallId, params, signal) => {
        const message = String(params?.message || '').trim()
        if (!message) throw new Error('message is required')
        const payload = await requestJson(fetchImpl, context, 'POST', '/api/v1/git/commit', {
          body: { message },
          signal,
        })
        return textResult(`Committed: ${payload?.oid || '(ok)'}`, { oid: payload?.oid || null })
      },
    },
  ]

  return tools
}
