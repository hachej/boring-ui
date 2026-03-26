import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildBwrapArgs,
  buildSandboxEnv,
  execInSandbox,
  BWRAP_TIMEOUT_SECONDS,
} from '../adapters/bwrapImpl.js'

const TEST_WORKSPACE = join(tmpdir(), `bwrap-test-${Date.now()}`)

beforeAll(() => {
  mkdirSync(TEST_WORKSPACE, { recursive: true })
})

afterAll(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true })
})

describe('buildBwrapArgs', () => {
  it('includes tmpfs / as root', () => {
    const args = buildBwrapArgs(TEST_WORKSPACE, '/workspace')
    expect(args).toContain('--tmpfs')
    expect(args[args.indexOf('--tmpfs') + 1]).toBe('/')
  })

  it('includes --proc /proc', () => {
    const args = buildBwrapArgs(TEST_WORKSPACE, '/workspace')
    const procIdx = args.indexOf('--proc')
    expect(procIdx).toBeGreaterThan(-1)
    expect(args[procIdx + 1]).toBe('/proc')
  })

  it('includes --dev /dev', () => {
    const args = buildBwrapArgs(TEST_WORKSPACE, '/workspace')
    const devIdx = args.indexOf('--dev')
    expect(devIdx).toBeGreaterThan(-1)
    expect(args[devIdx + 1]).toBe('/dev')
  })

  it('includes workspace bind mount', () => {
    const args = buildBwrapArgs(TEST_WORKSPACE, '/workspace')
    const bindIdx = args.indexOf('--bind')
    expect(bindIdx).toBeGreaterThan(-1)
    expect(args[bindIdx + 1]).toBe(TEST_WORKSPACE)
    expect(args[bindIdx + 2]).toBe('/workspace')
  })

  it('includes ro-bind for system dirs', () => {
    const args = buildBwrapArgs(TEST_WORKSPACE, '/workspace')
    const roBind = args.filter((a, i) => a === '--ro-bind' && args[i + 1] === '/usr')
    expect(roBind.length).toBeGreaterThan(0)
  })

  it('ends with -- separator', () => {
    const args = buildBwrapArgs(TEST_WORKSPACE, '/workspace')
    expect(args).toContain('--')
  })
})

describe('buildSandboxEnv', () => {
  it('sets HOME to /workspace', () => {
    const env = buildSandboxEnv('/workspace')
    expect(env.HOME).toBe('/workspace')
  })

  it('includes PATH with venv bin', () => {
    const env = buildSandboxEnv('/workspace')
    expect(env.PATH).toContain('.venv/bin')
  })

  it('sets VIRTUAL_ENV', () => {
    const env = buildSandboxEnv('/workspace')
    expect(env.VIRTUAL_ENV).toBe('/workspace/.venv')
  })
})

describe('execInSandbox', () => {
  it('runs echo and captures stdout', async () => {
    const result = await execInSandbox(TEST_WORKSPACE, 'echo hello')
    expect(result.stdout.trim()).toBe('hello')
    expect(result.exit_code).toBe(0)
  })

  it('captures stderr', async () => {
    const result = await execInSandbox(TEST_WORKSPACE, 'echo error >&2')
    expect(result.stderr.trim()).toBe('error')
  })

  it('returns non-zero exit code on failure', async () => {
    const result = await execInSandbox(TEST_WORKSPACE, 'exit 42')
    expect(result.exit_code).toBe(42)
  })

  it('can write files in workspace', async () => {
    await execInSandbox(TEST_WORKSPACE, 'echo test > /workspace/test.txt')
    const content = readFileSync(join(TEST_WORKSPACE, 'test.txt'), 'utf-8')
    expect(content.trim()).toBe('test')
  })

  it('cannot read /etc/shadow (filesystem isolation)', async () => {
    const result = await execInSandbox(TEST_WORKSPACE, 'cat /etc/shadow 2>&1 || true')
    // Should fail — /etc is ro-bind, shadow is root-only
    expect(result.stdout + result.stderr).not.toContain('root:')
  })

  it('has correct HOME inside sandbox', async () => {
    const result = await execInSandbox(TEST_WORKSPACE, 'echo $HOME')
    expect(result.stdout.trim()).toBe('/workspace')
  })

  it('terminates the whole sandbox process group on timeout', async () => {
    const startedAt = Date.now()
    const result = await execInSandbox(TEST_WORKSPACE, 'sleep 5', {
      timeoutSeconds: 0.05,
    })

    expect(result.exit_code).toBe(-1)
    expect(result.stderr).toContain('[killed: timeout after 0.05s]')
    expect(Date.now() - startedAt).toBeLessThan(4000)
  })
})

describe('BWRAP_TIMEOUT_SECONDS', () => {
  it('is 60', () => {
    expect(BWRAP_TIMEOUT_SECONDS).toBe(60)
  })
})
