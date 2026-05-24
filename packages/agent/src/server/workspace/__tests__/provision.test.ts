import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { copyTemplate } from '../provision'
import { provisionRuntimeWorkspace } from '../provisionRuntime'

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

test('copyTemplate copies files without a legacy provision marker', async () => {
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

  await expect(readFile(join(workspaceRoot, '.boring-agent', 'provisioned'), 'utf-8')).rejects.toThrow()
})

test('copyTemplate preserves existing workspace files without a marker', async () => {
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

test('provisionRuntimeWorkspace rejects template targets outside the workspace', async () => {
  const templateRoot = await makeTempDir('boring-ui-runtime-template-')
  const workspaceRoot = await makeTempDir('boring-ui-runtime-workspace-')
  await writeFile(join(templateRoot, 'README.md'), '# seeded\n', 'utf-8')

  await expect(
    provisionRuntimeWorkspace({
      workspaceRoot,
      contributions: [
        {
          id: 'bad-template-target',
          provisioning: {
            templateDirs: [{ id: 'bad', path: templateRoot, target: '../outside' }],
          },
        },
      ],
      force: true,
    }),
  ).rejects.toThrow(/Unsafe runtime template target/)
})

test('provisionRuntimeWorkspace accepts relative template targets inside the workspace', async () => {
  const templateRoot = await makeTempDir('boring-ui-runtime-template-')
  const workspaceRoot = await makeTempDir('boring-ui-runtime-workspace-')
  await writeFile(join(templateRoot, 'README.md'), '# seeded\n', 'utf-8')

  await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [
      {
        id: 'good-template-target',
        provisioning: {
          templateDirs: [{ id: 'good', path: templateRoot, target: 'seeded/plugin' }],
        },
      },
    ],
    force: true,
  })

  await expect(readFile(join(workspaceRoot, 'seeded', 'plugin', 'README.md'), 'utf-8')).resolves.toBe('# seeded\n')
})
