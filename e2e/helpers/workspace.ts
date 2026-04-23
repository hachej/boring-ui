import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface E2eWorkspace {
  root: string
  cleanup(): Promise<void>
}

export async function createE2eWorkspace(): Promise<E2eWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'boring-agent-e2e-'))

  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'README.md'),
    '# E2E Workspace\n\nseeded by Playwright fixtures\n',
    'utf8',
  )
  await writeFile(
    path.join(root, 'src', 'main.ts'),
    'export const hello = "from-e2e-workspace"\n',
    'utf8',
  )

  return {
    root,
    async cleanup() {
      await rm(root, { recursive: true, force: true })
    },
  }
}
