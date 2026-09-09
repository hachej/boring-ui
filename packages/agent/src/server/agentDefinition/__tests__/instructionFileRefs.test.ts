import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, onTestFinished, test } from 'vitest'

import { resolveAgentInstructionFileRefs } from '../instructionFileRefs'
import { ErrorCode } from '../../../shared/error-codes'

const FIXTURE_ROOT = resolve(import.meta.dirname, 'fixtures', 'fleet')
const PERSONAS_DIR = resolve(FIXTURE_ROOT, 'personas')
const UNSAFE_SEAT_ROOT = resolve(import.meta.dirname, 'fixtures', 'unsafe-seat')
const UNSAFE_SEAT_PERSONAS_DIR = resolve(UNSAFE_SEAT_ROOT, 'personas')

function personaSource(absolutePath: string) {
  return [{ absolutePath, role: 'persona' as const }]
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'instruction-file-refs-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

describe('resolveAgentInstructionFileRefs', () => {
  test('addresses a source against the workspace root serving THIS request', async () => {
    const resolution = await resolveAgentInstructionFileRefs({
      sources: personaSource(resolve(PERSONAS_DIR, 'alpha', 'instructions.md')),
      workspaceRoot: FIXTURE_ROOT,
    })

    expect(resolution.refs).toEqual([
      { filesystem: 'user', path: 'personas/alpha/instructions.md', role: 'persona' },
    ])
    expect(resolution.withheld).toEqual([])
  })

  test('the SAME fleet spec publishes a different ref per served root', async () => {
    // This is the whole point of gh-1189: one shared fleet, many workspaces.
    // The CLI hub composes its seats once and serves a different root per
    // request, so the ref must be a function of the request, not of boot.
    const sources = personaSource(resolve(PERSONAS_DIR, 'alpha', 'instructions.md'))

    const atFixtureRoot = await resolveAgentInstructionFileRefs({ sources, workspaceRoot: FIXTURE_ROOT })
    const atPersonasRoot = await resolveAgentInstructionFileRefs({ sources, workspaceRoot: PERSONAS_DIR })

    expect(atFixtureRoot.refs[0]?.path).toBe('personas/alpha/instructions.md')
    expect(atPersonasRoot.refs[0]?.path).toBe('alpha/instructions.md')
  })

  test('withholds with the stable code when the source is outside the served root', async () => {
    const resolution = await resolveAgentInstructionFileRefs({
      sources: personaSource(resolve(PERSONAS_DIR, 'alpha', 'instructions.md')),
      workspaceRoot: resolve(FIXTURE_ROOT, 'factory'),
    })

    // A ref addressed against the wrong root is WELL-FORMED, so every path
    // guard downstream accepts it and the workbench silently opens nothing.
    expect(resolution.refs).toEqual([])
    expect(resolution.withheld).toEqual([expect.objectContaining({
      code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
    })])
  })

  test('withholds when the request resolved no workspace root at all', async () => {
    const resolution = await resolveAgentInstructionFileRefs({
      sources: personaSource(resolve(PERSONAS_DIR, 'alpha', 'instructions.md')),
      workspaceRoot: null,
    })

    expect(resolution.refs).toEqual([])
    expect(resolution.withheld).toEqual([expect.objectContaining({
      code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
    })])
  })

  test('withholds a composed path the client-side openable guard would reject', async () => {
    const resolution = await resolveAgentInstructionFileRefs({
      sources: [
        { absolutePath: resolve(UNSAFE_SEAT_PERSONAS_DIR, 'odd\\seat', 'instructions.md'), role: 'persona' },
        { absolutePath: resolve(UNSAFE_SEAT_PERSONAS_DIR, 'encoded%2eseat', 'instructions.md'), role: 'persona' },
      ],
      workspaceRoot: UNSAFE_SEAT_ROOT,
    })

    // A backslash or a percent-encoded dot cannot survive as a workspace-
    // relative path, so the link is withheld — but never silently.
    expect(resolution.refs).toEqual([])
    expect(resolution.withheld).toHaveLength(2)
    expect(resolution.withheld.every(
      (entry) => entry.code === ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
    )).toBe(true)
  })

  test('follows symlinks: a source that escapes the served root is withheld', async () => {
    // Dotfile managers (stow, chezmoi) make a symlinked `.agents` ordinary. A
    // LEXICAL containment check would call this "inside the workspace" and
    // publish a link the `user` filesystem cannot open.
    const root = await temporaryRoot()
    const workspaceRoot = join(root, 'workspace')
    const personasDir = join(workspaceRoot, 'personas')
    const outsidePersona = join(root, 'outside')
    await mkdir(personasDir, { recursive: true })
    await cp(join(PERSONAS_DIR, 'alpha'), outsidePersona, { recursive: true })
    await symlink(outsidePersona, join(personasDir, 'linked'), 'dir')

    const lexical = await resolveAgentInstructionFileRefs({
      sources: personaSource(join(personasDir, 'linked', 'instructions.md')),
      workspaceRoot,
    })
    expect(lexical.refs).toEqual([])
    expect(lexical.withheld).toHaveLength(1)

    // Same file, served from a root that really does contain it: published.
    const contained = await resolveAgentInstructionFileRefs({
      sources: personaSource(join(personasDir, 'linked', 'instructions.md')),
      workspaceRoot: await realpath(root),
    })
    expect(contained.refs).toEqual([
      { filesystem: 'user', path: 'outside/instructions.md', role: 'persona' },
    ])
  })

  test('withholds a source that no longer exists rather than publishing a dead link', async () => {
    const root = await temporaryRoot()
    const resolution = await resolveAgentInstructionFileRefs({
      sources: personaSource(join(root, 'gone', 'instructions.md')),
      workspaceRoot: root,
    })

    expect(resolution.refs).toEqual([])
    expect(resolution.withheld).toHaveLength(1)
  })

  test('no sources resolve to no refs and no diagnostics', async () => {
    await expect(resolveAgentInstructionFileRefs({ sources: undefined, workspaceRoot: FIXTURE_ROOT }))
      .resolves.toEqual({ refs: [], withheld: [] })
  })
})
