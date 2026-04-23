import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { copyTemplate } from '../provision'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

test('copyTemplate copies files and writes provision marker on first call', async () => {
  const templateRoot = await makeTempDir('boring-ui-template-')
  const workspaceRoot = await makeTempDir('boring-ui-workspace-')

  await mkdir(join(templateRoot, 'nested'), { recursive: true })
  await writeFile(join(templateRoot, 'README.md'), '# seeded\n', 'utf-8')
  await writeFile(join(templateRoot, 'nested', 'config.json'), '{"seeded":true}\n', 'utf-8')

  await copyTemplate(templateRoot, workspaceRoot)

  await expect(readFile(join(workspaceRoot, 'README.md'), 'utf-8')).resolves.toBe('# seeded\n')
  await expect(readFile(join(workspaceRoot, 'nested', 'config.json'), 'utf-8')).resolves.toBe(
    '{"seeded":true}\n',
  )

  const marker = await readFile(join(workspaceRoot, '.boring-agent', 'provisioned'), 'utf-8')
  expect(Number.isNaN(Date.parse(marker))).toBe(false)
})

test('copyTemplate no-ops when provision marker already exists', async () => {
  const templateRoot = await makeTempDir('boring-ui-template-')
  const workspaceRoot = await makeTempDir('boring-ui-workspace-')

  await writeFile(join(templateRoot, 'README.md'), 'v1\n', 'utf-8')
  await copyTemplate(templateRoot, workspaceRoot)

  await writeFile(join(templateRoot, 'README.md'), 'v2\n', 'utf-8')
  await copyTemplate(templateRoot, workspaceRoot)

  await expect(readFile(join(workspaceRoot, 'README.md'), 'utf-8')).resolves.toBe('v1\n')
})

test('copyTemplate throws clearly when source template does not exist', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-workspace-')
  const missingTemplate = join(workspaceRoot, 'missing-template')

  await expect(copyTemplate(missingTemplate, workspaceRoot)).rejects.toThrow(
    `Failed to copy template from "${missingTemplate}"`,
  )
})
