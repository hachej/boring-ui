import { describe, expect, it } from 'vitest'

import { assertContainersAbsent, parsePinnedImage, targetRunArgs, validateInspect } from '../../../../scripts/d1-docker-boundary-proof.js'

const digest = 'a'.repeat(64)
const image = `registry.example/full-app@sha256:${digest}`

describe('D1 Docker boundary proof contract', () => {
  it('requires an explicit immutable image reference', () => {
    expect(parsePinnedImage(['--image', image], {})).toBe(image)
    expect(parsePinnedImage(['--', '--image', image], {})).toBe(image)
    expect(parsePinnedImage([], { D1_DOCKER_PROOF_IMAGE: `sha256:${digest}` })).toBe(`sha256:${digest}`)
    for (const value of [[], ['--image', 'full-app:latest'], ['full-app:tag'], ['--image', image, 'extra']]) {
      expect(() => parsePinnedImage(value, {})).toThrow('image')
    }
  })

  it('runs the actual entrypoint with one read-only host mount and no user override', () => {
    const args = targetRunArgs(image, 'proof-name', '/dev/shm/proof/host-a')
    expect(args).toContain('--rm'); expect(args).not.toContain('--user'); expect(args).not.toContain('--entrypoint')
    expect(args.filter((value) => value === '--mount')).toHaveLength(1)
    expect(args).toContain('type=bind,src=/dev/shm/proof/host-a,dst=/run/boring/d1,readonly')
    expect(args).toContain('BORING_AGENT_WORKSPACE_ROOT=/tmp/proof-name-workspaces')
    expect(args).toContain('BORING_AGENT_SESSION_ROOT=/tmp/proof-name-sessions')
  })

  it('accepts only the exact redacted host mount outside the checkout', () => {
    const record = [{ Config: { Cmd: ['node'], Env: [], Labels: {} }, Mounts: [{ Type: 'bind', Source: '/dev/shm/proof/host-a', Destination: '/run/boring/d1', RW: false }] }]
    expect(() => validateInspect(JSON.stringify(record), '/dev/shm/proof/host-a', ['raw-canary', 'ref-canary'], '/repo')).not.toThrow()
    for (const invalid of [
      [{ ...record[0], Mounts: [{ ...record[0].Mounts[0], RW: true }] }],
      [{ ...record[0], Mounts: [...record[0].Mounts, record[0].Mounts[0]] }],
      [{ ...record[0], Config: { Cmd: ['raw-canary'] } }],
      [{ ...record[0], Config: { Env: ['REF=ref-canary'] } }],
      [{ ...record[0], Mounts: [{ ...record[0].Mounts[0], Source: '/dev/shm/proof/host-b' }] }],
      [{ ...record[0], Mounts: [{ ...record[0].Mounts[0], Destination: '/run/boring' }] }],
      [{ ...record[0], Mounts: [{ ...record[0].Mounts[0], Type: 'volume' }] }],
    ]) expect(() => validateInspect(JSON.stringify(invalid), '/dev/shm/proof/host-a', ['raw-canary', 'ref-canary'], '/repo')).toThrow()
    expect(() => validateInspect(JSON.stringify([{ ...record[0], Mounts: [{ ...record[0].Mounts[0], Source: '/repo/generated' }] }]), '/repo/generated', [], '/repo')).toThrow('repositoryMount')
  })

  it('cannot accept cleanup while an exact proof container survives', () => {
    expect(() => assertContainersAbsent(['proof'], () => ({ ok: true, stdout: '' }))).not.toThrow()
    expect(() => assertContainersAbsent(['proof'], () => ({ ok: true, stdout: 'proof\n' }))).toThrow('containerCleanup')
    expect(() => assertContainersAbsent(['proof'], () => ({ ok: false, stdout: '' }))).toThrow('containerCleanup')
  })
})
