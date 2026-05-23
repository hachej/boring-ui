import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

test('provisionRuntimeWorkspace no-ops when node package source is already materialized target', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-runtime-workspace-')
  const packageRoot = join(workspaceRoot, 'node_modules', '@hachej', 'boring-workspace')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), '{"name":"@hachej/boring-workspace"}\n', 'utf-8')
  await writeFile(join(packageRoot, 'dist', 'index.js'), 'export {}\n', 'utf-8')

  await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [
      {
        id: 'same-package-target',
        provisioning: {
          nodePackages: [
            {
              id: 'workspace',
              packageName: '@hachej/boring-workspace',
              packageRoot,
            },
          ],
        },
      },
    ],
    force: true,
  })

  await expect(readFile(join(packageRoot, 'package.json'), 'utf-8')).resolves.toBe(
    '{"name":"@hachej/boring-workspace"}\n',
  )
})

test('provisionRuntimeWorkspace no-ops when node package target is a symlink to source', async () => {
  const sourceRoot = await makeTempDir('boring-ui-runtime-package-')
  const workspaceRoot = await makeTempDir('boring-ui-runtime-workspace-')
  const targetRoot = join(workspaceRoot, 'node_modules', '@hachej', 'boring-workspace')
  await mkdir(join(sourceRoot, 'dist'), { recursive: true })
  await mkdir(join(workspaceRoot, 'node_modules', '@hachej'), { recursive: true })
  await writeFile(join(sourceRoot, 'package.json'), '{"name":"@hachej/boring-workspace"}\n', 'utf-8')
  await writeFile(join(sourceRoot, 'dist', 'index.js'), 'export {}\n', 'utf-8')
  await symlink(sourceRoot, targetRoot, 'dir')

  await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [
      {
        id: 'symlinked-package-target',
        provisioning: {
          nodePackages: [
            {
              id: 'workspace',
              packageName: '@hachej/boring-workspace',
              packageRoot: sourceRoot,
            },
          ],
        },
      },
    ],
    force: true,
  })

  await expect(readFile(join(targetRoot, 'package.json'), 'utf-8')).resolves.toBe(
    '{"name":"@hachej/boring-workspace"}\n',
  )
})
