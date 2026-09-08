import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const scripts = resolve(import.meta.dirname, '..')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'changed-workspaces-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  function write(path, value) {
    mkdirSync(resolve(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), value)
  }
  const manifests = {
    'packages/store': { name: '@test/store', scripts: { build: 'build', test: 'test', typecheck: 'typecheck' } },
    'packages/core': { name: '@test/core', dependencies: { '@test/store': 'workspace:*' }, scripts: { build: 'build', test: 'test', typecheck: 'typecheck' } },
    'apps/full-app': { name: 'full-app', devDependencies: { '@test/core': 'workspace:*' }, scripts: { build: 'build', test: 'test', typecheck: 'typecheck' } },
    'packages/unrelated': { name: '@test/unrelated', scripts: { build: 'build', test: 'test', typecheck: 'typecheck' } },
  }
  write('package.json', '{"name":"root","private":true}')
  write('README.md', 'fixture\n')
  write('.gitignore', '.fixture/\nignored/\n')
  for (const [path, manifest] of Object.entries(manifests)) {
    write(`${path}/package.json`, JSON.stringify(manifest))
    write(`${path}/index.ts`, '// fixture\n')
  }
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'Runner Test')
  git('add', '.')
  git('commit', '-m', 'fixture')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  write('.fixture/workspaces.json', JSON.stringify([
    { name: 'root', path: root },
    ...Object.entries(manifests).map(([path, { name }]) => ({ name, path: join(root, path) })),
  ]))
  // Only the package-manager boundary is stubbed; discovery uses a real Git repo.
  write('.fixture/pnpm', `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.includes('list')) {
  process.stdout.write(readFileSync('.fixture/workspaces.json', 'utf8'))
} else {
  appendFileSync('.fixture/calls.jsonl', JSON.stringify(args) + '\\n')
  if (args.at(-1) === process.env.FAIL_SCRIPT) process.exit(17)
}
`)
  chmodSync(join(root, '.fixture/pnpm'), 0o755)
  write('.fixture/calls.jsonl', '')
  function removeWorkspace(path) {
    rmSync(join(root, path), { recursive: true, force: true })
    const listed = JSON.parse(readFileSync(join(root, '.fixture/workspaces.json'), 'utf8'))
    write('.fixture/workspaces.json', JSON.stringify(listed.filter((workspace) => workspace.path !== join(root, path))))
  }
  function run(script, env = {}) {
    const result = spawnSync(process.execPath, [join(scripts, `${script}-changed-workspaces.mjs`)], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TEST_BASE_REF: 'main', TYPECHECK_BASE_REF: 'main', WORKSPACE_CONCURRENCY: '2', PATH: `${join(root, '.fixture')}:${process.env.PATH}`, ...env },
    })
    const calls = readFileSync(join(root, '.fixture/calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    return { ...result, calls }
  }
  return { root, git, write, removeWorkspace, run }
}

for (const script of ['test', 'typecheck']) {
  test(`${script}: committed change checks dependents and prebuilds dependencies`, (t) => {
    const f = fixture(t)
    f.write('packages/core/e2e/invite.test.ts', '// replay must create one invite\n')
    f.git('add', '.')
    f.git('commit', '-m', 'invite regression')
    const result = f.run(script)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.calls, [
      ['-r', '--filter', '@test/core', '--filter', '@test/store', '--workspace-concurrency=2', 'run', 'build'],
      ['-r', '--filter', '@test/core', '--filter', 'full-app', '--workspace-concurrency=2', 'run', script],
    ])
  })

  for (const state of ['unstaged', 'staged', 'untracked']) {
    test(`${script}: includes ${state} edits before the first feature commit`, (t) => {
      const f = fixture(t)
      f.write(state === 'untracked' ? 'packages/core/e2e/invite ü\nreplay.test.ts' : 'packages/core/index.ts', '// changed\n')
      if (state === 'staged') f.git('add', '.')
      const result = f.run(script)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.calls.length, 2, result.stdout)
      assert.ok(result.calls[1].includes('@test/core'), result.stdout)
      assert.ok(result.calls[1].includes('full-app'), result.stdout)
      assert.ok(!result.calls[1].includes('@test/unrelated'), result.stdout)
    })
  }

  test(`${script}: checks both owners of a cross-package rename`, (t) => {
    const f = fixture(t)
    renameSync(join(f.root, 'packages/core/index.ts'), join(f.root, 'packages/unrelated/moved.ts'))
    f.git('add', '.')
    f.git('commit', '-m', 'move implementation')
    const result = f.run(script)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.calls.at(-1).includes('@test/core'))
    assert.ok(result.calls.at(-1).includes('@test/unrelated'))
  })

  test(`${script}: removed workspace runs the full check instead of skipping`, (t) => {
    const f = fixture(t)
    f.removeWorkspace('packages/store')
    const result = f.run(script)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.calls, [['run', script]])
    assert.match(result.stdout, /has no current owner/)
    assert.doesNotMatch(result.stdout, /skipping/)
  })

  test(`${script}: global change runs the full check exactly once`, (t) => {
    const f = fixture(t)
    f.write('pnpm-workspace.yaml', 'packages: [packages/*, apps/*]\n')
    f.write('packages/core/index.ts', '// changed\n')
    f.git('add', '.')
    f.git('commit', '-m', 'global and package inputs')
    const result = f.run(script)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.calls, [['run', script]])
    assert.doesNotMatch(result.stdout, /skipping/)
  })

  for (const config of ['package.json', '.npmrc']) {
    test(`${script}: root ${config} is a global verification input`, (t) => {
      const f = fixture(t)
      appendFileSync(join(f.root, config), config === '.npmrc' ? 'shamefully-hoist=true\n' : '\n')
      const result = f.run(script)
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(result.calls, [['run', script]])
    })
  }

  test(`${script}: docs-only changes and ignored output skip package checks`, (t) => {
    const f = fixture(t)
    f.write('README.md', 'documentation update\n')
    f.write('ignored/package.json', '{}')
    const result = f.run(script)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.calls, [])
    assert.match(result.stdout, /skipping/)
  })

  test(`${script}: build failures stop verification and retain the exit status`, (t) => {
    const f = fixture(t)
    f.write('packages/core/index.ts', '// changed\n')
    f.git('add', '.')
    f.git('commit', '-m', 'change core')
    const result = f.run(script, { FAIL_SCRIPT: 'build' })
    assert.equal(result.status, 17)
    assert.equal(result.calls.length, 1)
  })

  test(`${script}: missing base never reports a successful skip`, (t) => {
    const f = fixture(t)
    const result = f.run(script, { TEST_BASE_REF: 'missing', TYPECHECK_BASE_REF: 'missing' })
    assert.notEqual(result.status, 0)
    assert.deepEqual(result.calls, [])
    assert.doesNotMatch(result.stdout, /skipping/)
  })
}
