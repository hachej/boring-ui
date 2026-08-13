import { mkdir, mkdtemp, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ErrorCode } from '../../shared/error-codes'
import {
  assertPiResourcePathsAuthorized,
  digestPiResourceInputs,
  type PiResourceDigestInput,
} from '../piResourceDigest'

const fsHooks = vi.hoisted(() => ({
  beforeOpen: undefined as ((path: Parameters<typeof import('node:fs/promises').open>[0]) => Promise<void>) | undefined,
  beforeOpendir: undefined as ((path: Parameters<typeof import('node:fs/promises').opendir>[0]) => Promise<void>) | undefined,
  afterOpendir: undefined as ((path: Parameters<typeof import('node:fs/promises').opendir>[0]) => Promise<void>) | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      await fsHooks.beforeOpen?.(args[0])
      return actual.open(...args)
    },
    opendir: async (...args: Parameters<typeof actual.opendir>) => {
      await fsHooks.beforeOpendir?.(args[0])
      const directory = await actual.opendir(...args)
      await fsHooks.afterOpendir?.(args[0])
      return directory
    },
  }
})

function digestInput(root: string, skillPath: string): PiResourceDigestInput {
  return {
    piCwd: root,
    piAgentDir: join(root, '.pi-agent'),
    piUserHome: root,
    noSkills: true,
    additionalSkillPaths: [skillPath],
    authorizedRoots: [root],
    allowInternalSymlinks: true,
  }
}

describe('digestPiResourceInputs symlink containment', () => {
  afterEach(() => {
    fsHooks.beforeOpen = undefined
    fsHooks.beforeOpendir = undefined
    fsHooks.afterOpendir = undefined
  })

  test('allows a symlink whose target remains inside an authorized root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-contained-link-'))
    const target = join(root, 'targets', 'skill')
    const linked = join(root, 'linked-skill')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '# linked skill\n', 'utf8')
    await symlink(target, linked, 'dir')

    await expect(digestPiResourceInputs(digestInput(root, linked))).resolves.toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test('allows a contained symlink nested inside a resource tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-nested-contained-link-'))
    const skill = join(root, 'skill')
    const target = join(root, 'shared')
    await mkdir(skill, { recursive: true })
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'detail.md'), 'contained\n', 'utf8')
    await symlink('../shared', join(skill, 'shared'), 'dir')

    await expect(digestPiResourceInputs(digestInput(root, skill))).resolves.toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test.each([undefined, false])('rejects a contained symlink unless the caller opts in (allowInternalSymlinks=%s)', async (allowInternalSymlinks) => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-contained-link-policy-'))
    const target = join(root, 'targets', 'skill')
    const linked = join(root, 'linked-skill')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '# linked skill\n', 'utf8')
    await symlink(target, linked, 'dir')

    const input = { ...digestInput(root, linked), allowInternalSymlinks }
    await expect(digestPiResourceInputs(input)).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      statusCode: 403,
      message: expect.stringMatching(new RegExp(`${linked}.*authorized root ${root}.*allowInternalSymlinks: true`)),
    })
  })

  test('rejects a symlink whose target escapes every authorized root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-escape-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'boring-pi-digest-outside-'))
    const linked = join(root, 'linked-skill')
    await writeFile(join(outside, 'SKILL.md'), '# outside skill\n', 'utf8')
    await symlink(outside, linked, 'dir')

    await expect(digestPiResourceInputs(digestInput(root, linked))).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      statusCode: 403,
      message: expect.stringContaining(`resolves to ${outside}, which escapes authorized root ${root}`),
    })
  })

  test('does not let a resource symlink authorize its own escaping target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-self-authority-'))
    const outside = await mkdtemp(join(tmpdir(), 'boring-pi-digest-self-authority-outside-'))
    const linked = join(root, 'linked-skill')
    await writeFile(join(outside, 'SKILL.md'), '# outside skill\n', 'utf8')
    await symlink(outside, linked, 'dir')

    await expect(digestPiResourceInputs({
      ...digestInput(root, linked),
      authorizedRoots: [root, linked],
    })).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      statusCode: 403,
      message: expect.stringContaining('escapes authorized root'),
    })
  })

  test('does not let a resource below a symlinked ancestor authorize the escaping target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-ancestor-authority-'))
    const outside = await mkdtemp(join(tmpdir(), 'boring-pi-digest-ancestor-authority-outside-'))
    const outsideSkill = join(outside, 'skill')
    const linkedParent = join(root, 'linked-packages')
    const linkedSkill = join(linkedParent, 'skill')
    await mkdir(outsideSkill, { recursive: true })
    await writeFile(join(outsideSkill, 'SKILL.md'), '# outside skill\n', 'utf8')
    await symlink(outside, linkedParent, 'dir')

    await expect(digestPiResourceInputs({
      ...digestInput(root, linkedSkill),
      authorizedRoots: [root, linkedSkill],
    })).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      statusCode: 403,
      message: expect.stringContaining('escapes authorized root'),
    })
  })

  test('rejects a dangling symlink with the path, authorized root, and repair actions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-dangling-link-'))
    const linked = join(root, 'linked-skill')
    await symlink(join(root, 'missing-target'), linked, 'dir')

    await expect(digestPiResourceInputs(digestInput(root, linked))).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      statusCode: 403,
      message: expect.stringMatching(new RegExp(`${linked}.*authorized root ${root}.*Restore the symlink target`)),
    })
  })

  test('rejects a missing resource beneath a symlink that escapes an authorized root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-missing-escape-'))
    const outside = await mkdtemp(join(tmpdir(), 'boring-pi-digest-missing-outside-'))
    const linked = join(root, 'linked-skill')
    await symlink(outside, linked, 'dir')

    await expect(digestPiResourceInputs(digestInput(root, join(linked, 'missing')))).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      statusCode: 403,
    })
  })

  test('rejects a symlink swapped between containment validation and open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-swap-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'boring-pi-digest-swap-outside-'))
    const target = join(root, 'targets', 'skill')
    const linked = join(root, 'linked-skill')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '# allowed before swap\n', 'utf8')
    await writeFile(join(outside, 'SKILL.md'), '# outside after swap\n', 'utf8')
    await symlink(target, linked, 'dir')
    fsHooks.beforeOpen = async (path) => {
      const openedPath = String(path)
      if (!openedPath.includes('/proc/self/fd/') || !openedPath.endsWith('/SKILL.md')) return
      fsHooks.beforeOpen = undefined
      await unlink(linked)
      await symlink(outside, linked, 'dir')
    }

    await expect(digestPiResourceInputs(digestInput(root, linked))).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
      statusCode: 409,
      retryable: true,
    })
  })

  test('rejects an authorized root swapped while its descriptor is established', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-root-swap-'))
    const outside = await mkdtemp(join(tmpdir(), 'boring-pi-digest-root-swap-outside-'))
    const parked = `${root}-parked`
    const skill = join(root, 'skill')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), '# before root swap\n', 'utf8')
    fsHooks.beforeOpen = async (path) => {
      if (!String(path).endsWith(`/${root.split('/').at(-1)}`)) return
      fsHooks.beforeOpen = undefined
      await rename(root, parked)
      await symlink(outside, root, 'dir')
    }

    await expect(digestPiResourceInputs(digestInput(root, skill))).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
      statusCode: 409,
      retryable: true,
    })
  })

  test('keeps the digest stable when the same logical path becomes an in-root symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-stable-link-'))
    const skill = join(root, 'skill')
    const target = join(root, 'targets', 'skill')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), '# stable skill\n', 'utf8')
    const input = digestInput(root, skill)
    const directDigest = await digestPiResourceInputs(input)

    await mkdir(join(root, 'targets'), { recursive: true })
    await rename(skill, target)
    await symlink(target, skill, 'dir')

    await expect(digestPiResourceInputs(input)).resolves.toBe(directDigest)
  })

  test('accepts the normal .pi/skills link into the workspace-owned skill directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-workspace-skill-link-'))
    const target = join(root, '.agents', 'skills', 'exec')
    const linked = join(root, '.pi', 'skills', 'exec')
    await mkdir(target, { recursive: true })
    await mkdir(join(root, '.pi', 'skills'), { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '# exec\n', 'utf8')
    await symlink('../../.agents/skills/exec', linked, 'dir')

    await expect(digestPiResourceInputs(digestInput(root, linked))).resolves.toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test('does not discover ambient user skills when noSkills is true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-no-ambient-skills-'))
    const configured = join(root, 'configured')
    const ambientTarget = join(root, 'ambient-target')
    const ambientLink = join(root, '.agents', 'skills', 'ambient')
    await mkdir(configured, { recursive: true })
    await writeFile(join(configured, 'SKILL.md'), '# configured\n', 'utf8')
    const input = digestInput(root, configured)
    const before = await digestPiResourceInputs(input)
    await mkdir(ambientTarget, { recursive: true })
    await mkdir(join(root, '.agents', 'skills'), { recursive: true })
    await writeFile(join(ambientTarget, 'SKILL.md'), '# ambient\n', 'utf8')
    await symlink(ambientTarget, ambientLink, 'dir')

    await expect(digestPiResourceInputs(input)).resolves.toBe(before)
  })

  test('rejects a direct resource outside host-owned authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-authorized-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'boring-pi-direct-outside-'))

    await expect(assertPiResourcePathsAuthorized({
      paths: [outside],
      authorizedRoots: [root],
      allowInternalSymlinks: true,
    })).rejects.toMatchObject({
      code: ErrorCode.enum.PATH_ESCAPE,
      statusCode: 403,
      message: expect.stringContaining(outside),
    })
  })

  test.runIf(process.platform === 'linux' || process.platform === 'darwin')(
    'binds directory enumeration to the verified directory when its pathname is transiently swapped',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'boring-pi-digest-directory-swap-'))
      const outside = await mkdtemp(join(tmpdir(), 'boring-pi-digest-directory-swap-outside-'))
      const target = join(root, 'targets', 'skill')
      const parked = join(root, 'targets', 'parked-skill')
      const linked = join(root, 'linked-skill')
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'SKILL.md'), '# directory identity stays pinned\n', 'utf8')
      await symlink(target, linked, 'dir')
      const input = digestInput(root, linked)
      fsHooks.beforeOpendir = async (path) => {
        if (!String(path).includes('/fd/')) return
        fsHooks.beforeOpendir = undefined
        await rename(target, parked)
        await symlink(outside, target, 'dir')
      }
      fsHooks.afterOpendir = async (path) => {
        if (!String(path).includes('/fd/')) return
        fsHooks.afterOpendir = undefined
        await unlink(target)
        await rename(parked, target)
      }

      await expect(digestPiResourceInputs(input)).rejects.toMatchObject({
        code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
        statusCode: 409,
        retryable: true,
      })
    },
  )
})
