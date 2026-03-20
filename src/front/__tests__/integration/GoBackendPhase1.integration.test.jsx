import React from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'

import DataContext from '../../providers/data/DataContext'
import { createHttpProvider } from '../../providers/data'
import FileTree from '../../components/FileTree'
import EditorPanel from '../../panels/EditorPanel'
import UserSettingsPage from '../../pages/UserSettingsPage'
import WorkspaceSettingsPage from '../../pages/WorkspaceSettingsPage'
import { ThemeProvider } from '../../hooks/useTheme'

vi.mock('../../components/Editor', () => ({
  default: ({ content, onChange, onAutoSave }) => (
    <div>
      <div data-testid="editor-content">{content}</div>
      <button type="button" data-testid="editor-change" onClick={() => onChange?.('next content')}>
        change
      </button>
      <button type="button" data-testid="editor-autosave" onClick={() => onAutoSave?.('next content')}>
        autosave
      </button>
    </div>
  ),
}))

vi.mock('../../components/CodeEditor', () => ({
  default: () => <div data-testid="code-editor-stub" />,
}))

vi.mock('../../components/GitDiff', () => ({
  default: () => <div data-testid="git-diff-stub" />,
}))

const repoRoot = '/home/ubuntu/projects/boring-ui'
const defaultFileTreeProps = {
  onOpen: vi.fn(),
  onOpenToSide: vi.fn(),
  onFileDeleted: vi.fn(),
  onFileRenamed: vi.fn(),
  onFileMoved: vi.fn(),
  projectRoot: '/project',
  activeFile: null,
  creatingFile: false,
  onFileCreated: vi.fn(),
  onCancelCreate: vi.fn(),
}

const renderWithProvider = (ui, provider) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <DataContext.Provider value={provider}>{ui}</DataContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

const createApiStub = () => {
  let handler = null
  return {
    onDidParametersChange: vi.fn((nextHandler) => {
      handler = nextHandler
      return { dispose: vi.fn() }
    }),
    emitParametersChange: (params) => {
      if (handler) handler({ params })
    },
  }
}

const renderEditorPanel = (provider, params = {}) => {
  const api = createApiStub()
  return renderWithProvider(
    <EditorPanel api={api} params={{ path: 'README.md', initialContent: '', ...(params || {}) }} />,
    provider,
  )
}

const getFreePort = async () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    server.close((err) => {
      if (err) reject(err)
      else resolve(port)
    })
  })
})

const httpRequest = async (targetUrl, init = {}) => new Promise((resolve, reject) => {
  const url = new URL(targetUrl)
  const headers = new Headers(init.headers || {})
  const body = init.body || null
  const request = http.request(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: init.method || 'GET',
      headers: Object.fromEntries(headers.entries()),
    },
    (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        })
      })
    },
  )
  request.on('error', reject)
  if (body) request.write(body)
  request.end()
})

const responseHeaders = (rawHeaders = {}) => {
  const headers = new Headers()
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry)
      continue
    }
    if (value !== undefined) headers.set(key, String(value))
  }
  return headers
}

const fetchViaHttpRequest = async (input, init = {}, authCookie) => {
  const request = input instanceof Request ? input : new Request(input, init)
  const headers = new Headers(request.headers)
  headers.set('Cookie', authCookie)
  const method = init.method || request.method || 'GET'
  const body = init.body
    ?? (method !== 'GET' && method !== 'HEAD' ? await request.clone().text() : undefined)
  const response = await httpRequest(request.url, { method, headers, body })
  return new Response(response.text, {
    status: response.status,
    headers: responseHeaders(response.headers),
  })
}

const waitForHealth = async (baseUrl, serverProcess, readLogs) => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Go helper server exited early: ${readLogs()}`)
    }
    try {
      const response = await httpRequest(`${baseUrl}/health`)
      if (response.status >= 200 && response.status < 300) return
    } catch (_error) {
      // Ignore transient connection failures until the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`timed out waiting for ${baseUrl}/health: ${readLogs()}`)
}

const loginCookie = async (baseUrl) => {
  const response = await httpRequest(`${baseUrl}/auth/login?redirect_uri=/health`)
  const setCookie = Array.isArray(response.headers['set-cookie'])
    ? response.headers['set-cookie'][0]
    : response.headers['set-cookie'] || ''
  const cookie = setCookie.split(';', 1)[0]
  if (!cookie) {
    throw new Error(`missing auth cookie from ${baseUrl}/auth/login`)
  }
  return cookie
}

const authedFetchJson = async (baseUrl, authCookie, path, init = {}) => {
  const headers = new Headers(init.headers || {})
  headers.set('Cookie', authCookie)
  const response = await httpRequest(`${baseUrl}${path}`, { ...init, headers })
  const data = response.text ? JSON.parse(response.text) : {}
  return { response, data }
}

const createWorkspace = async (baseUrl, authCookie, name) => {
    const { response, data } = await authedFetchJson(baseUrl, authCookie, '/api/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`failed to create workspace: ${response.status} ${JSON.stringify(data)}`)
  }
  const workspace = data.workspace || data
  return workspace.workspace_id || workspace.id
}

describe.sequential('Go backend phase-1 live integration', () => {
  let workspaceRoot
  let baseUrl
  let authCookie
  let serverProcess
  let serverLogs

  beforeAll(async () => {
    if (process.env.BD16_GO_BACKEND_URL) {
      baseUrl = process.env.BD16_GO_BACKEND_URL
      authCookie = process.env.BD16_GO_BACKEND_COOKIE || ''
      if (!authCookie) {
        throw new Error('BD16_GO_BACKEND_COOKIE is required when BD16_GO_BACKEND_URL is set')
      }
      return
    }

    workspaceRoot = mkdtempSync(join(tmpdir(), 'bd16-front-'))
    serverLogs = ''
    writeFileSync(
      join(workspaceRoot, 'boring.app.toml'),
      `[app]
name = "boring-ui"
logo = "B"
id = "boring-ui"

[backend]
entry = "boring_ui.api.app:create_app"
port = 8000
routers = []

[frontend]
port = 5173

[frontend.branding]
name = "Boring UI"

[frontend.features]
agentRailMode = "all"

[frontend.data]
backend = "http"

[frontend.panels]

[auth]
provider = "local"
session_cookie = "boring_session"
session_ttl = 86400
`,
    )
    mkdirSync(join(workspaceRoot, 'docs'), { recursive: true })
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'README.md'), '# Hello\n')
    writeFileSync(join(workspaceRoot, 'docs', 'notes.md'), 'workspace notes\n')
    writeFileSync(join(workspaceRoot, 'src', 'App.jsx'), 'console.log("hello world")\n')

    spawnSync('git', ['init'], { cwd: workspaceRoot, stdio: 'ignore' })

    const port = await getFreePort()
    baseUrl = `http://127.0.0.1:${port}`

    const env = { ...process.env }
    delete env.DATABASE_URL
    env.DEV_AUTOLOGIN = '1'
    env.BORING_UI_SESSION_SECRET = 'test-secret'
    env.BORING_SESSION_SECRET = 'test-secret'
    env.BUI_APP_TOML = join(workspaceRoot, 'boring.app.toml')
    env.BORING_HOST = '127.0.0.1'
    env.BORING_PORT = String(port)

    serverProcess = spawn('go', ['run', './cmd/server'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    serverProcess.stdout?.on('data', (chunk) => {
      serverLogs += chunk.toString()
    })
    serverProcess.stderr?.on('data', (chunk) => {
      serverLogs += chunk.toString()
    })

    await waitForHealth(baseUrl, serverProcess, () => serverLogs)
    authCookie = await loginCookie(baseUrl)
  }, 90_000)

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', baseUrl)
    vi.stubGlobal('fetch', (input, init = {}) => fetchViaHttpRequest(input, init, authCookie))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterAll(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM')
    }
    if (workspaceRoot) {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('loads the file tree and returns search results from the Go backend', async () => {
    const onOpen = vi.fn()
    const provider = createHttpProvider()

    renderWithProvider(
      <FileTree {...defaultFileTreeProps} onOpen={onOpen} searchExpanded />,
      provider,
    )

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
      expect(screen.getByText('docs')).toBeInTheDocument()
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Search files...'), {
      target: { value: 'notes.md' },
    })

    await waitFor(() => {
      const result = document.querySelector('.search-result-item')
      expect(result?.textContent || '').toContain('notes.md')
    })
  }, 20_000)

  it('opens and saves editor content through the Go HTTP provider', async () => {
    const provider = createHttpProvider()

    renderEditorPanel(provider)

    await waitFor(() => {
      expect(screen.getByTestId('editor-content')).toHaveTextContent('# Hello')
    })

    fireEvent.click(screen.getByTestId('editor-change'))
    fireEvent.click(screen.getByTestId('editor-autosave'))

    await waitFor(async () => {
      const content = await createHttpProvider().files.read('README.md')
      expect(content).toBe('next content')
    })
  }, 20_000)

  it('loads and saves user settings through the live Go control-plane', async () => {
    const provider = createHttpProvider()

    renderWithProvider(<UserSettingsPage />, provider)

    const displayNameInput = await screen.findByPlaceholderText('Enter display name')
    fireEvent.change(displayNameInput, { target: { value: 'BlackBarn Live' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(screen.getByText('Settings saved')).toBeInTheDocument()
    })

    const { response, data } = await authedFetchJson(baseUrl, authCookie, '/api/v1/me/settings')
    expect(response.status).toBe(200)
    expect(data.settings?.display_name).toBe('BlackBarn Live')
  }, 20_000)

  it('loads workspace settings, renames the workspace, and shows GitHub status from the live Go backend', async () => {
    const workspaceId = await createWorkspace(baseUrl, authCookie, 'Go Live Settings')
    const provider = createHttpProvider()

    const seedSettings = await authedFetchJson(baseUrl, authCookie, `/api/v1/workspaces/${workspaceId}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    })
    expect(seedSettings.response.status).toBe(200)

    renderWithProvider(
      <WorkspaceSettingsPage
        workspaceId={workspaceId}
        capabilities={{ features: { github: true } }}
      />,
      provider,
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('Go Live Settings')).toBeInTheDocument()
      expect(screen.getByText('GitHub Integration')).toBeInTheDocument()
      expect(screen.getByText('theme')).toBeInTheDocument()
    })

    const nameInput = screen.getByDisplayValue('Go Live Settings')
    fireEvent.change(nameInput, { target: { value: 'Go Live Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Workspace name saved')).toBeInTheDocument()
    })

    const { response, data } = await authedFetchJson(baseUrl, authCookie, '/api/v1/workspaces')
    expect(response.status).toBe(200)
    expect((data.workspaces || []).some((workspace) => {
      const id = workspace.workspace_id || workspace.id
      return id === workspaceId && workspace.name === 'Go Live Renamed'
    })).toBe(true)

    const githubStatus = await authedFetchJson(
      baseUrl,
      authCookie,
      `/api/v1/auth/github/status?workspace_id=${encodeURIComponent(workspaceId)}`,
    )
    expect(githubStatus.response.status).toBe(200)

    await waitFor(() => {
      if (!githubStatus.data?.configured) {
        expect(screen.getByText('Not configured')).toBeInTheDocument()
        return
      }

      const installationConnected = Boolean(
        githubStatus.data?.installation_connected ?? githubStatus.data?.connected,
      )
      if (installationConnected) {
        expect(screen.getByText('Installed')).toBeInTheDocument()
        return
      }

      const accountLinked = Boolean(
        githubStatus.data?.account_linked ?? installationConnected,
      )
      expect(
        screen.getByText(accountLinked ? 'Workspace not linked' : 'Account not linked'),
      ).toBeInTheDocument()
    })
  }, 20_000)
})
