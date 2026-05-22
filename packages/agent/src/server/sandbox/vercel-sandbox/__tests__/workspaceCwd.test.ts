import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { expect, test } from 'vitest'

function runProbe(cwd: string, env: Record<string, string> = {}) {
  const script = [
    'printf "pwd=%s\\n" "$(pwd)"',
    'printf "PWD=%s\\n" "$PWD"',
    `${JSON.stringify(process.execPath)} -e 'process.stdout.write("nodeCwd=" + process.cwd() + "\\n")'`,
    'printf ok > rel.txt',
    'printf "rel=%s\\n" "$(cat rel.txt)"',
  ].join('\n')

  const result = spawnSync('sh', ['-c', script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  })

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

test('real workspace directory gives shell and process an actual matching cwd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boring-workspace-cwd-real-'))
  const workspace = join(root, 'workspace')

  try {
    await mkdir(workspace)

    const result = runProbe(workspace, {
      PWD: workspace,
      BORING_AGENT_WORKSPACE_ROOT: workspace,
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(`pwd=${workspace}\n`)
    expect(result.stdout).toContain(`PWD=${workspace}\n`)
    expect(result.stdout).toContain(`nodeCwd=${workspace}\n`)
    expect(result.stdout).toContain('rel=ok\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('symlink alias is not an actual cwd even if PWD makes shell pwd logical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boring-workspace-cwd-symlink-'))
  const storage = join(root, 'vercel-sandbox')
  const workspaceAlias = join(root, 'workspace')

  try {
    await mkdir(storage)
    await symlink(storage, workspaceAlias)

    const result = runProbe(workspaceAlias, {
      PWD: workspaceAlias,
      BORING_AGENT_WORKSPACE_ROOT: workspaceAlias,
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(`pwd=${workspaceAlias}\n`)
    expect(result.stdout).toContain(`PWD=${workspaceAlias}\n`)
    expect(result.stdout).toContain(`nodeCwd=${storage}\n`)
    expect(result.stdout).toContain('rel=ok\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
