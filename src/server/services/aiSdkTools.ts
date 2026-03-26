import { exec as execCallback, execSync } from 'node:child_process'
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { jsonSchema, tool } from 'ai'
import {
  CancelCommandSchema,
  GitDiffSchema,
  GitStatusSchema,
  ListDirSchema,
  ListTabsSchema,
  OpenFileSchema,
  ReadCommandOutputSchema,
  ReadFileSchema,
  RunCommandSchema,
  SearchFilesSchema,
  StartCommandSchema,
  WriteFileSchema,
} from '../../shared/toolSchemas.js'
import { execInSandbox } from '../adapters/bwrapImpl.js'
import { createWorkspaceTools } from '../agent/piTools.js'
import { startJob, readJob, cancelJob } from '../jobs/execJob.js'
import { createGitServiceImpl } from './gitImpl.js'
import {
  enqueueCommand,
  getLatestState,
  listOpenPanels,
  resolveClientId,
} from './uiStateImpl.js'

const execAsync = promisify(execCallback)
const MAX_OUTPUT_BYTES = 512 * 1024
const FLAG_INJECTION_RE = /^-/

function hasBwrap(): boolean {
  try {
    execSync('which bwrap', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function normalizeRelativePath(path: string | undefined, fallback = '.'): string {
  const trimmed = String(path || '').trim().replace(/^\/+/, '')
  return trimmed || fallback
}

function validateWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  const resolvedRoot = resolve(workspaceRoot)
  const resolvedPath = resolve(workspaceRoot, requestedPath)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path resolves outside workspace root')
  }
  return resolvedPath
}

async function assertRealPathWithinWorkspace(
  workspaceRoot: string,
  candidatePath: string,
): Promise<void> {
  const realRoot = await realpath(resolve(workspaceRoot))
  const realCandidate = await realpath(candidatePath)
  const rel = relative(realRoot, realCandidate)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path resolves outside workspace root')
  }
}

async function ensureExistingWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const absolutePath = validateWorkspacePath(workspaceRoot, requestedPath)
  await assertRealPathWithinWorkspace(workspaceRoot, absolutePath)
  return absolutePath
}

async function ensureWritableWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const absolutePath = validateWorkspacePath(workspaceRoot, requestedPath)
  const absoluteDir = dirname(absolutePath)

  let existingAncestor = absoluteDir
  while (existingAncestor !== workspaceRoot) {
    try {
      await stat(existingAncestor)
      break
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
      existingAncestor = dirname(existingAncestor)
    }
  }
  await assertRealPathWithinWorkspace(workspaceRoot, existingAncestor)

  await mkdir(absoluteDir, { recursive: true })
  await assertRealPathWithinWorkspace(workspaceRoot, absoluteDir)

  try {
    const stat = await lstat(absolutePath)
    if (stat.isSymbolicLink()) {
      throw new Error('path resolves outside workspace root')
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }

  return absolutePath
}

function truncateOutput(output: string): string {
  if (Buffer.byteLength(output) <= MAX_OUTPUT_BYTES) return output
  return output.slice(0, MAX_OUTPUT_BYTES) + '\n[truncated: output exceeded 512KB]'
}

function formatDirEntries(entries: Array<{ name: string; path: string; is_dir: boolean }>): string {
  if (entries.length === 0) return '(empty)'
  return entries
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => (entry.is_dir ? `${entry.path}/` : entry.path))
    .join('\n')
}

async function listDirRecursive(
  workspaceRoot: string,
  dirPath: string,
): Promise<Array<{ name: string; path: string; is_dir: boolean }>> {
  const absolute = await ensureExistingWorkspacePath(workspaceRoot, dirPath)
  const entries = await readdir(absolute, { withFileTypes: true })
  const results: Array<{ name: string; path: string; is_dir: boolean }> = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const relativePath = normalizeRelativePath(relative(workspaceRoot, resolve(absolute, entry.name)))
    if (entry.isDirectory()) {
      results.push({ name: entry.name, path: relativePath, is_dir: true })
      results.push(...await listDirRecursive(workspaceRoot, relativePath))
    } else {
      results.push({ name: entry.name, path: relativePath, is_dir: false })
    }
  }

  return results
}

async function searchFiles(
  workspaceRoot: string,
  pattern: string,
  startPath = '.',
): Promise<Array<{ name: string; path: string; dir: string }>> {
  const absolute = await ensureExistingWorkspacePath(workspaceRoot, startPath)
  const results: Array<{ name: string; path: string; dir: string }> = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      const relativePath = normalizeRelativePath(relative(workspaceRoot, fullPath))
      if (entry.name.includes(pattern) || relativePath.includes(pattern)) {
        results.push({
          name: entry.name,
          path: relativePath,
          dir: normalizeRelativePath(relative(workspaceRoot, dir)),
        })
      }
    }
  }

  await walk(absolute)
  return results
}

async function runCommand(
  workspaceRoot: string,
  command: string,
  cwd?: string,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; exit_code: number; duration_ms: number }> {
  const effectiveCwd = cwd
    ? await ensureExistingWorkspacePath(workspaceRoot, cwd)
    : await ensureExistingWorkspacePath(workspaceRoot, '.')
  const start = Date.now()

  if (hasBwrap()) {
    const result = await execInSandbox(workspaceRoot, command, {
      cwd: effectiveCwd,
      timeoutSeconds: Math.max(0.001, timeoutMs / 1000),
    })
    return {
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      exit_code: result.exit_code,
      duration_ms: Date.now() - start,
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: effectiveCwd,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { ...process.env, HOME: workspaceRoot },
    })
    return {
      stdout: truncateOutput(stdout || ''),
      stderr: truncateOutput(stderr || ''),
      exit_code: 0,
      duration_ms: Date.now() - start,
    }
  } catch (error: any) {
    return {
      stdout: truncateOutput(error?.stdout || ''),
      stderr: truncateOutput(error?.stderr || error?.message || ''),
      exit_code: typeof error?.code === 'number' ? error.code : 1,
      duration_ms: Date.now() - start,
    }
  }
}

function createStructuredWorkspaceTools(workspaceRoot: string) {
  const git = createGitServiceImpl(workspaceRoot)

  return {
    exec_bash: tool({
      description: 'Execute a bash command in the workspace using the sandboxed server runtime.',
      inputSchema: RunCommandSchema,
      execute: async ({ command, cwd, timeout_ms }) => {
        const result = await runCommand(
          workspaceRoot,
          command,
          cwd ? normalizeRelativePath(cwd) : undefined,
          timeout_ms,
        )
        const chunks = []
        if (result.stdout) chunks.push(result.stdout)
        if (result.stderr) chunks.push(`[stderr]\n${result.stderr}`)
        if (result.exit_code !== 0) chunks.push(`[exit_code] ${result.exit_code}`)
        return chunks.join('\n') || '(no output)'
      },
    }),

    read_file: tool({
      description: 'Read the contents of a file at a path relative to the workspace root.',
      inputSchema: ReadFileSchema,
      execute: async ({ path }) => {
        const relativePath = normalizeRelativePath(path, '')
        const absolutePath = await ensureExistingWorkspacePath(workspaceRoot, relativePath)
        const content = await readFile(absolutePath, 'utf-8')
        return { path: relativePath, content }
      },
    }),

    write_file: tool({
      description: 'Write content to a file at a path relative to the workspace root.',
      inputSchema: WriteFileSchema,
      execute: async ({ path, content }) => {
        const relativePath = normalizeRelativePath(path, '')
        const absolutePath = await ensureWritableWorkspacePath(workspaceRoot, relativePath)
        await writeFile(absolutePath, content, 'utf-8')
        return { path: relativePath, bytes_written: Buffer.byteLength(content, 'utf-8') }
      },
    }),

    list_dir: tool({
      description: 'List files and directories under a relative workspace path.',
      inputSchema: ListDirSchema,
      execute: async ({ path, recursive }) => {
        const relativePath = normalizeRelativePath(path)
        if (recursive) {
          const entries = await listDirRecursive(workspaceRoot, relativePath)
          return {
            path: relativePath,
            entries,
            text: formatDirEntries(entries),
          }
        }

        const absolutePath = await ensureExistingWorkspacePath(workspaceRoot, relativePath)
        const entries = (await readdir(absolutePath, { withFileTypes: true }))
          .filter((entry) => !entry.name.startsWith('.'))
          .map((entry) => ({
            name: entry.name,
            path: normalizeRelativePath(relative(workspaceRoot, resolve(absolutePath, entry.name))),
            is_dir: entry.isDirectory(),
          }))

        return {
          path: relativePath,
          entries,
          text: formatDirEntries(entries),
        }
      },
    }),

    search_files: tool({
      description: 'Search for files by pattern under a relative workspace path.',
      inputSchema: SearchFilesSchema,
      execute: async ({ pattern, path }) => {
        const relativePath = normalizeRelativePath(path)
        const results = await searchFiles(workspaceRoot, pattern, relativePath)
        return { pattern, path: relativePath, results }
      },
    }),

    git_status: tool({
      description: 'Show the current git working tree status.',
      inputSchema: GitStatusSchema,
      execute: async ({ path }) => {
        const status = await git.getStatus()
        const relativePath = path ? normalizeRelativePath(path, '') : ''
        if (!relativePath) return status
        validateWorkspacePath(workspaceRoot, relativePath)
        return {
          ...status,
          files: status.files.filter((entry) => (
            entry.path === relativePath || entry.path.startsWith(`${relativePath}/`)
          )),
        }
      },
    }),

    git_diff: tool({
      description: 'Show a git diff for an optional relative path.',
      inputSchema: GitDiffSchema,
      execute: async ({ path }) => git.getDiff(path ? normalizeRelativePath(path, '') : undefined),
    }),

    run_command: tool({
      description: 'Run a short-lived shell command in the workspace and wait for completion.',
      inputSchema: RunCommandSchema,
      execute: async ({ command, cwd, timeout_ms }) => runCommand(
        workspaceRoot,
        command,
        cwd ? normalizeRelativePath(cwd) : undefined,
        timeout_ms,
      ),
    }),

    start_command: tool({
      description: 'Start a long-running shell command as a background job.',
      inputSchema: StartCommandSchema,
      execute: async ({ command, cwd }) => {
        const safeCwd = cwd
          ? await ensureExistingWorkspacePath(workspaceRoot, normalizeRelativePath(cwd))
          : undefined
        return startJob(
          workspaceRoot,
          command,
          { cwd: safeCwd },
        )
      },
    }),

    read_command_output: tool({
      description: 'Read buffered output chunks from a long-running command job.',
      inputSchema: ReadCommandOutputSchema,
      execute: async ({ job_id, cursor }) => {
        const job = readJob(job_id, cursor)
        if (!job) {
          throw new Error(`job not found: ${job_id}`)
        }
        return job
      },
    }),

    cancel_command: tool({
      description: 'Cancel a running long-running command job.',
      inputSchema: CancelCommandSchema,
      execute: async ({ job_id }) => {
        const cancelled = cancelJob(job_id)
        if (!cancelled) {
          throw new Error(`job not found: ${job_id}`)
        }
        return { cancelled: true, job_id }
      },
    }),
  }
}

function normalizeLegacyToolOutput(value: unknown): unknown {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'content' in value && Array.isArray((value as any).content)) {
    const text = (value as any).content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  return value
}

function createLegacyAiSdkTools(context: { workspaceRoot?: string; backendUrl?: string; internalApiToken?: string }) {
  return Object.fromEntries(
    createWorkspaceTools(context)
      .filter((workspaceTool) => !FLAG_INJECTION_RE.test(String(workspaceTool?.name || '')))
      .map((workspaceTool) => [
        workspaceTool.name,
        tool({
          description: workspaceTool.description,
          inputSchema: jsonSchema(workspaceTool.parameters),
          execute: async (input) => normalizeLegacyToolOutput(await workspaceTool.execute('', input)),
        }),
      ]),
  )
}

function createUiStateTools(uiWorkspaceKey: string, workspaceRoot: string) {
  const emptyObjectSchema = ListTabsSchema

  return {
    list_panes: tool({
      description: 'List currently open UI panels and which one is active.',
      inputSchema: emptyObjectSchema,
      execute: async () => {
        const panes = listOpenPanels(uiWorkspaceKey)
        if (!panes) {
          return {
            client_id: null,
            active_panel_id: null,
            open_panels: [],
            count: 0,
            text: 'No panels open',
          }
        }
        const text = panes.open_panels.length === 0
          ? 'No panels open'
          : panes.open_panels
            .map((panel) => {
              const id = String(panel?.id || '')
              const component = String(panel?.component || '')
              const title = String(panel?.title || '')
              const marker = id && id === panes.active_panel_id ? ' (active)' : ''
              return `${component}: ${title || id}${marker}`
            })
            .join('\n')
        return {
          ...panes,
          text,
        }
      },
    }),

    get_ui_state: tool({
      description: 'Get the latest published UI snapshot for the active workspace.',
      inputSchema: emptyObjectSchema,
      execute: async () => {
        const state = getLatestState(uiWorkspaceKey)
        if (!state) {
          return {
            state: null,
            text: 'No UI state available',
          }
        }
        const openPanels = Array.isArray(state.open_panels) ? state.open_panels : []
        const parts = []
        if (state.active_panel_id) parts.push(`Active panel: ${state.active_panel_id}`)
        if (state.project_root) parts.push(`Project root: ${state.project_root}`)
        if (openPanels.length > 0) {
          parts.push(`Open panels (${openPanels.length}):`)
          for (const panel of openPanels) {
            const id = String(panel?.id || '')
            const component = String(panel?.component || '')
            const title = String(panel?.title || '')
            parts.push(`  ${component}: ${title || id}`)
          }
        }
        return {
          state,
          text: parts.join('\n') || 'No UI state available',
        }
      },
    }),

    open_file: tool({
      description: 'Open a file in the editor panel using a path relative to the workspace root.',
      inputSchema: OpenFileSchema,
      execute: async ({ path }) => {
        const normalizedPath = normalizeRelativePath(path, '')
        if (!normalizedPath) {
          throw new Error('path is required')
        }
        validateWorkspacePath(workspaceRoot, normalizedPath)
        const targetClientId = resolveClientId(uiWorkspaceKey)
        if (!targetClientId) {
          return {
            opened: false,
            path: normalizedPath,
            error: 'No frontend state client is available',
          }
        }
        const queued = enqueueCommand(uiWorkspaceKey, {
          kind: 'open_panel',
          panel_id: `editor-${normalizedPath}`,
          component: 'editor',
          title: basename(normalizedPath) || normalizedPath,
          params: { path: normalizedPath },
          prefer_existing: true,
        }, targetClientId)
        return {
          opened: Boolean(queued),
          client_id: targetClientId,
          path: normalizedPath,
          command_id: queued?.id || null,
          text: `Opening ${normalizedPath} in editor`,
        }
      },
    }),

    list_tabs: tool({
      description: 'List currently open editor tabs and which file is active.',
      inputSchema: emptyObjectSchema,
      execute: async () => {
        const panes = listOpenPanels(uiWorkspaceKey)
        if (!panes) {
          return {
            active_file: '',
            tabs: [],
            text: 'No editor tabs open',
          }
        }
        const tabs = panes.open_panels
          .filter((panel) => panel?.component === 'editor')
          .map((panel) => {
            const panelParams = (panel?.params && typeof panel.params === 'object')
              ? panel.params as Record<string, unknown>
              : {}
            const path = String(panelParams.path || panel?.title || panel?.id || '')
            return {
              path,
              active: String(panel?.id || '') === panes.active_panel_id,
            }
          })
          .filter((tab) => tab.path)
        const activeFile = tabs.find((tab) => tab.active)?.path || ''
        return {
          active_file: activeFile,
          tabs,
          text: tabs.length === 0
            ? 'No editor tabs open'
            : tabs.map((tab) => (tab.active ? `* ${tab.path}` : `  ${tab.path}`)).join('\n'),
        }
      },
    }),
  }
}

export function createAiSdkServerTools(
  context: {
    workspaceRoot?: string
    backendUrl?: string
    internalApiToken?: string
    uiWorkspaceKey?: string
  } = {},
) {
  const workspaceRoot = context.workspaceRoot || process.cwd()
  const uiWorkspaceKey = context.uiWorkspaceKey || `root:${workspaceRoot}`
  return {
    ...createLegacyAiSdkTools(context),
    ...createStructuredWorkspaceTools(workspaceRoot),
    ...createUiStateTools(uiWorkspaceKey, workspaceRoot),
  }
}
