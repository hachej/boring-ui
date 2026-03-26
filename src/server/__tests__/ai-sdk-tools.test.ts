import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createGitServiceImpl } from '../services/gitImpl.js'
import { createAiSdkServerTools } from '../services/aiSdkTools.js'
import { popNextCommand, upsertState } from '../services/uiStateImpl.js'

async function createWorkspace() {
  return mkdtemp(join(tmpdir(), 'ai-sdk-tools-'))
}

async function waitForJob(tools: any, jobId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await tools.read_command_output.execute({ job_id: jobId })
    if (result.done) return result
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`job did not finish: ${jobId}`)
}

describe('createAiSdkServerTools', () => {
  it('exposes the legacy and structured server-side tools together', async () => {
    const workspaceRoot = await createWorkspace()
    const tools = createAiSdkServerTools({ workspaceRoot }) as Record<string, any>

    expect(Object.keys(tools)).toEqual(expect.arrayContaining([
      'exec_bash',
      'read_file',
      'write_file',
      'list_dir',
      'search_files',
      'git_status',
      'git_diff',
      'run_command',
      'start_command',
      'read_command_output',
      'cancel_command',
    ]))
  })

  it('supports read/write/list/search file workflows', async () => {
    const workspaceRoot = await createWorkspace()
    const tools = createAiSdkServerTools({ workspaceRoot }) as Record<string, any>

    const writeResult = await tools.write_file.execute({
      path: 'notes/todo.txt',
      content: 'alpha\nbeta\n',
    })
    expect(writeResult).toMatchObject({
      path: 'notes/todo.txt',
      bytes_written: 11,
    })

    const readResult = await tools.read_file.execute({ path: 'notes/todo.txt' })
    expect(readResult).toEqual({
      path: 'notes/todo.txt',
      content: 'alpha\nbeta\n',
    })

    const listResult = await tools.list_dir.execute({ path: 'notes', recursive: false })
    expect(listResult.text).toContain('notes/todo.txt')

    const searchResult = await tools.search_files.execute({ pattern: 'todo', path: '.' })
    expect(searchResult.results).toEqual([
      expect.objectContaining({ path: 'notes/todo.txt' }),
    ])
  })

  it('rejects symlink escapes for read_file and write_file', async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await createWorkspace()
    const outsideFile = join(outsideRoot, 'outside.txt')
    const writeEscape = join(outsideRoot, 'write-target.txt')
    const tools = createAiSdkServerTools({ workspaceRoot }) as Record<string, any>

    await writeFile(outsideFile, 'outside-data\n', 'utf-8')
    await writeFile(writeEscape, 'before\n', 'utf-8')
    await symlink(outsideFile, join(workspaceRoot, 'read-escape.txt'))
    await symlink(writeEscape, join(workspaceRoot, 'write-escape.txt'))

    await expect(tools.read_file.execute({ path: 'read-escape.txt' })).rejects.toThrow(
      /outside workspace root/i,
    )
    await expect(
      tools.write_file.execute({ path: 'write-escape.txt', content: 'after\n' }),
    ).rejects.toThrow(/outside workspace root/i)
    await expect(readFile(writeEscape, 'utf-8')).resolves.toBe('before\n')
  })

  it('rejects write_file when a parent directory is a symlink escape', async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await createWorkspace()
    const tools = createAiSdkServerTools({ workspaceRoot }) as Record<string, any>

    await symlink(outsideRoot, join(workspaceRoot, 'dir-escape'))

    await expect(
      tools.write_file.execute({ path: 'dir-escape/nested/file.txt', content: 'after\n' }),
    ).rejects.toThrow(/outside workspace root/i)
    await expect(readFile(join(outsideRoot, 'nested/file.txt'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('supports command execution and long-running job lifecycle', async () => {
    const workspaceRoot = await createWorkspace()
    const tools = createAiSdkServerTools({ workspaceRoot }) as Record<string, any>

    const legacyResult = await tools.exec_bash.execute({
      command: "printf 'hello-from-exec-bash'",
    })
    expect(legacyResult).toContain('hello-from-exec-bash')

    const runResult = await tools.run_command.execute({
      command: "printf 'hello-from-run-command'",
    })
    expect(runResult.stdout).toContain('hello-from-run-command')
    expect(runResult.exit_code).toBe(0)

    const started = await tools.start_command.execute({
      command: "printf 'job-output'",
    })
    const finished = await waitForJob(tools, started.job_id)
    expect(finished.chunks.join('')).toContain('job-output')
    const noRepeat = await tools.read_command_output.execute({
      job_id: started.job_id,
      cursor: finished.cursor,
    })
    expect(noRepeat.chunks).toEqual([])
    expect(noRepeat.cursor).toBe(finished.cursor)

    const sleepJob = await tools.start_command.execute({
      command: 'sleep 30',
    })
    const cancelled = await tools.cancel_command.execute({
      job_id: sleepJob.job_id,
    })
    expect(cancelled).toEqual({
      cancelled: true,
      job_id: sleepJob.job_id,
    })
  })

  it('rejects symlink escapes for command cwd', async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await createWorkspace()
    const tools = createAiSdkServerTools({ workspaceRoot }) as Record<string, any>

    await symlink(outsideRoot, join(workspaceRoot, 'cwd-escape'))

    await expect(
      tools.run_command.execute({ command: 'pwd', cwd: 'cwd-escape' }),
    ).rejects.toThrow(/outside workspace root/i)
    await expect(
      tools.exec_bash.execute({ command: 'pwd', cwd: 'cwd-escape' }),
    ).rejects.toThrow(/outside workspace root/i)
    await expect(
      tools.start_command.execute({ command: 'pwd', cwd: 'cwd-escape' }),
    ).rejects.toThrow(/outside workspace root/i)
  })

  it('honors run_command timeout_ms', async () => {
    const workspaceRoot = await createWorkspace()
    const tools = createAiSdkServerTools({ workspaceRoot }) as Record<string, any>

    const timedOut = await tools.run_command.execute({
      command: 'sleep 5',
      timeout_ms: 25,
    })

    expect(timedOut.exit_code).not.toBe(0)
    expect(timedOut.duration_ms).toBeLessThan(900)
  })

  it('supports git status and diff workflows', async () => {
    const workspaceRoot = await createWorkspace()
    const git = createGitServiceImpl(workspaceRoot)
    const tools = createAiSdkServerTools({ workspaceRoot }) as Record<string, any>

    await git.initRepo()
    await writeFile(join(workspaceRoot, 'tracked.txt'), 'first\n', 'utf-8')
    await writeFile(join(workspaceRoot, 'nested.txt'), 'second\n', 'utf-8')
    await git.addFiles(['tracked.txt'])
    await git.commit('initial')
    await writeFile(join(workspaceRoot, 'tracked.txt'), 'first\nsecond\n', 'utf-8')
    await writeFile(join(workspaceRoot, 'nested.txt'), 'third\n', 'utf-8')

    const status = await tools.git_status.execute({})
    expect(status.is_repo).toBe(true)
    expect(status.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tracked.txt' }),
      expect.objectContaining({ path: 'nested.txt' }),
    ]))

    const filteredStatus = await tools.git_status.execute({ path: 'tracked.txt' })
    expect(filteredStatus.files).toEqual([
      expect.objectContaining({ path: 'tracked.txt' }),
    ])

    const diff = await tools.git_diff.execute({ path: 'tracked.txt' })
    expect(diff.diff).toContain('+second')
  })

  it('exposes workspace-scoped UI helper tools', async () => {
    const workspaceRoot = await createWorkspace()
    const uiWorkspaceKey = `root:${workspaceRoot}`
    upsertState(uiWorkspaceKey, {
      client_id: 'client-ui',
      active_panel_id: 'editor-README.md',
      open_panels: [
        { id: 'editor-README.md', component: 'editor', title: 'README.md', params: { path: 'README.md' } },
        { id: 'review-1', component: 'review', title: 'Review' },
      ],
      project_root: workspaceRoot,
      meta: {},
    })

    const tools = createAiSdkServerTools({ workspaceRoot, uiWorkspaceKey }) as Record<string, any>

    const panes = await tools.list_panes.execute({})
    expect(panes).toMatchObject({
      client_id: 'client-ui',
      active_panel_id: 'editor-README.md',
      count: 2,
    })
    expect(panes.text).toContain('editor: README.md (active)')

    const uiState = await tools.get_ui_state.execute({})
    expect(uiState.state).toMatchObject({
      client_id: 'client-ui',
      active_panel_id: 'editor-README.md',
    })

    const tabs = await tools.list_tabs.execute({})
    expect(tabs).toMatchObject({
      active_file: 'README.md',
      tabs: [
        { path: 'README.md', active: true },
      ],
    })

    const opened = await tools.open_file.execute({ path: '/src/index.ts' })
    expect(opened).toMatchObject({
      opened: true,
      client_id: 'client-ui',
      path: 'src/index.ts',
    })

    const queued = popNextCommand(uiWorkspaceKey, 'client-ui')
    expect(queued).toMatchObject({
      client_id: 'client-ui',
      command: {
        kind: 'open_panel',
        panel_id: 'editor-src/index.ts',
        component: 'editor',
      },
    })

    await expect(
      tools.open_file.execute({ path: '../escape.ts' }),
    ).rejects.toThrow(/outside workspace root/i)
  })
})
