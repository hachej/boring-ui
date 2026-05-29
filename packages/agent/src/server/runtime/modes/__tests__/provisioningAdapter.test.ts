import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import { getBoringAgentRuntimePaths } from '../../../workspace/runtimeLayout'
import {
  createDirectProvisioningAdapter,
  createLocalProvisioningAdapter,
} from '../provisioningAdapter'

async function tempRoot(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

test('direct adapter workspaceFs copies files, URL sources, and directories recursively', async () => {
  const workspaceRoot = await tempRoot('boring-direct-workspace-')
  const sourceRoot = await tempRoot('boring-direct-source-')
  await mkdir(join(sourceRoot, 'dir', 'nested'), { recursive: true })
  await writeFile(join(sourceRoot, 'file.txt'), 'file\n')
  await writeFile(join(sourceRoot, 'url.txt'), 'url\n')
  await writeFile(join(sourceRoot, 'dir', 'nested', 'child.txt'), 'child\n')

  const adapter = createDirectProvisioningAdapter(getBoringAgentRuntimePaths(workspaceRoot))

  await adapter.workspaceFs.copyFromHost(join(sourceRoot, 'file.txt'), 'copied/file.txt')
  await adapter.workspaceFs.copyFromHost(new URL(`file://${join(sourceRoot, 'url.txt')}`), 'copied/url.txt')
  await adapter.workspaceFs.copyFromHost(join(sourceRoot, 'dir'), 'copied/dir')

  await expect(adapter.workspaceFs.readText('copied/file.txt')).resolves.toBe('file\n')
  await expect(adapter.workspaceFs.readText('copied/url.txt')).resolves.toBe('url\n')
  await expect(adapter.workspaceFs.readText('copied/dir/nested/child.txt')).resolves.toBe('child\n')
})

test('direct adapter workspaceFs handles missing rm, recursive mkdir, writeText, and readText null', async () => {
  const workspaceRoot = await tempRoot('boring-direct-workspace-')
  const adapter = createDirectProvisioningAdapter(getBoringAgentRuntimePaths(workspaceRoot))

  await expect(adapter.workspaceFs.rm('missing/path')).resolves.toBeUndefined()
  await adapter.workspaceFs.mkdir('a/b/c')
  await adapter.workspaceFs.writeText('a/b/c/file.txt', 'hello\n')

  await expect(adapter.workspaceFs.exists('a/b/c')).resolves.toBe(true)
  await expect(adapter.workspaceFs.readText('a/b/c/file.txt')).resolves.toBe('hello\n')
  await expect(adapter.workspaceFs.readText('a/b/c/missing.txt')).resolves.toBeNull()
})

test('direct adapter rejects lexically unsafe relative paths', async () => {
  const workspaceRoot = await tempRoot('boring-direct-workspace-')
  const adapter = createDirectProvisioningAdapter(getBoringAgentRuntimePaths(workspaceRoot))

  await expect(adapter.workspaceFs.exists('../escape')).rejects.toMatchObject({ reason: 'path-escape' })
  await expect(adapter.workspaceFs.exists('/absolute')).rejects.toMatchObject({ reason: 'absolute-path' })
  await expect(adapter.workspaceFs.exists('bad\0path')).rejects.toMatchObject({ reason: 'null-byte' })
})

test('direct adapter does not enforce realpath/symlink-escape (no sandbox boundary)', async () => {
  // Direct mode runs on the host without an OS-level sandbox, so a realpath
  // check on workspaceFs reads is pure ceremony — and it false-positives on
  // npm-created bin symlinks that point at the host's npm-global install
  // (e.g. boring-ui), aborting provisioning. The lexical validatePath() above
  // still rejects malicious relative inputs; we only drop the symlink-escape
  // probe. Sandbox modes (local/bwrap, vercel-sandbox) keep the strict check.
  const workspaceRoot = await tempRoot('boring-direct-workspace-')
  const outsideRoot = await tempRoot('boring-direct-outside-')
  await writeFile(join(outsideRoot, 'secret.txt'), 'secret\n')
  await symlink(join(outsideRoot, 'secret.txt'), join(workspaceRoot, 'link-out'))
  const adapter = createDirectProvisioningAdapter(getBoringAgentRuntimePaths(workspaceRoot))

  await expect(adapter.workspaceFs.readText('link-out')).resolves.toBe('secret\n')
})

test('direct adapter exec defaults cwd, merges env, and keeps args with spaces intact', async () => {
  const workspaceRoot = await tempRoot('boring-direct-exec-')
  const outputPath = join(workspaceRoot, 'exec-result.json')
  const adapter = createDirectProvisioningAdapter(getBoringAgentRuntimePaths(workspaceRoot))
  const script = `require('fs').writeFileSync(process.env.OUT, JSON.stringify({ cwd: process.cwd(), arg: process.argv[1], env: process.env.TEST_ENV }))`

  const result = await adapter.exec(process.execPath, ['-e', `${script}; process.stdout.write('ok')`, 'hello world'], {
    env: { OUT: outputPath, TEST_ENV: 'from-test' },
  })

  expect(result?.stdout).toBe('ok')

  await expect(readFile(outputPath, 'utf8').then(JSON.parse)).resolves.toEqual({
    cwd: workspaceRoot,
    arg: 'hello world',
    env: 'from-test',
  })
})

test('direct adapter resolveInstallSource returns runtime-visible local paths and cache root', async () => {
  const workspaceRoot = await tempRoot('boring-direct-resolve-')
  const sourceRoot = await tempRoot('boring-direct-package source-')
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const adapter = createDirectProvisioningAdapter(paths)

  await expect(adapter.resolveInstallSource(new URL(`file://${sourceRoot}/`), {
    kind: 'node',
    id: 'cli',
    fingerprint: 'sha256:abc',
  })).resolves.toBe(`${sourceRoot}/`)
  expect(adapter.getRuntimeCacheRoot()).toBe(paths.cache)
})

test('local adapter exists() treats an out-of-workspace bin symlink as present (no realpath-escape throw)', async () => {
  // Repro of the CLI-mode slow-load bug: provisioning's skip-vs-reinstall
  // probe (shouldInstallNodeRuntime) calls workspaceFs.exists() on expected
  // outputs, one of which is .bin/boring-ui — an npm-created shim that
  // realpath-resolves to the host's global @hachej/boring-ui-cli install,
  // outside the workspace. In local (bwrap) mode the realpath guard used to
  // throw symlink-escape here, breaking the fingerprint short-circuit and
  // crash-looping provisioning on every boot. exists() must report present.
  const workspaceRoot = await tempRoot('boring-local-exists-')
  const outsideRoot = await tempRoot('boring-local-outside-')
  await writeFile(join(outsideRoot, 'cli.js'), 'module.exports = {}\n')
  await mkdir(join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin'), { recursive: true })
  await symlink(
    join(outsideRoot, 'cli.js'),
    join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin', 'boring-ui'),
  )
  const adapter = createLocalProvisioningAdapter(getBoringAgentRuntimePaths(workspaceRoot))

  await expect(
    adapter.workspaceFs.exists('.boring-agent/node/node_modules/.bin/boring-ui'),
  ).resolves.toBe(true)
  await expect(adapter.workspaceFs.exists('.boring-agent/node/node_modules/.bin/missing')).resolves.toBe(false)
  // Lexical guard is still enforced — a ../ escape in the path argument rejects.
  await expect(adapter.workspaceFs.exists('../escape')).rejects.toMatchObject({ reason: 'path-escape' })
})

test('local adapter exists() reports a dangling out-of-workspace symlink as missing (self-heals reinstall)', async () => {
  // exists() follows the link (stat, not lstat): if the host's global CLI is
  // moved/uninstalled the in-workspace shim dangles, and the skip-vs-reinstall
  // probe must see it as missing so provisioning reinstalls instead of skipping
  // forever and bricking the workspace on a broken link.
  const workspaceRoot = await tempRoot('boring-local-dangling-')
  await mkdir(join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin'), { recursive: true })
  await symlink(
    join(workspaceRoot, 'does-not-exist', 'cli.js'),
    join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin', 'boring-ui'),
  )
  const adapter = createLocalProvisioningAdapter(getBoringAgentRuntimePaths(workspaceRoot))

  await expect(
    adapter.workspaceFs.exists('.boring-agent/node/node_modules/.bin/boring-ui'),
  ).resolves.toBe(false)
})

test('local adapter maps workspace-contained package roots to /workspace and copies external roots into writable workspace tmp', async () => {
  const workspaceRoot = await tempRoot('boring-local-workspace-')
  const externalRoot = await tempRoot('boring-local-external-')
  await mkdir(join(workspaceRoot, 'packages', 'plugin'), { recursive: true })
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const calls: Array<{ command: string; args: string[]; env: Record<string, string> }> = []
  const adapter = createLocalProvisioningAdapter(paths, async (command, args, opts) => {
    calls.push({ command, args, env: opts.env })
    return { stdout: 'local ok\n' }
  })

  await expect(adapter.resolveInstallSource(join(workspaceRoot, 'packages', 'plugin'), {
    kind: 'node',
    id: 'plugin',
    fingerprint: 'sha256:111',
  })).resolves.toBe('/workspace/packages/plugin')

  const externalInstallSource = await adapter.resolveInstallSource(externalRoot, {
    kind: 'python',
    id: 'macro sdk',
    fingerprint: 'sha256:abcdef',
  })
  expect(externalInstallSource).toBe('/workspace/.boring-agent/tmp/python-macro-sdk-abcdef-source')

  const execResult = await adapter.exec(join(paths.venvBin, 'python'), ['-c', 'print("hello world")', 'arg with spaces', paths.venv], {
    env: { VIRTUAL_ENV: paths.venv },
  })

  expect(execResult?.stdout).toBe('local ok\n')

  expect(calls).toHaveLength(1)
  expect(calls[0].command).toBe('bwrap')
  await expect(readFile(join(workspaceRoot, '.boring-agent', 'tmp', 'python-macro-sdk-abcdef-source'), 'utf8')).rejects.toThrow()
  expect(calls[0].args).not.toContain(externalRoot)
  expect(calls[0].args.slice(-5)).toEqual([
    '/workspace/.boring-agent/venv/bin/python',
    '-c',
    'print("hello world")',
    'arg with spaces',
    '/workspace/.boring-agent/venv',
  ])
  expect(calls[0].env.VIRTUAL_ENV).toBe('/workspace/.boring-agent/venv')
})
