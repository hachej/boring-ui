import assert from 'node:assert/strict';
import test from 'node:test';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { defineCommand } from 'just-bash';

function fixture(t) {
  const workspace = createVirtualWorkspace({ providerId: 'fictional-links', files: { '/repo/original': 'original bytes', '/repo/existing': 'destination bytes' } });
  t.after(() => workspace.dispose());
  return workspace;
}

test('direct hard links refuse before creating or replacing any path', async t => {
  const workspace = fixture(t), fs = workspace.filesystem;
  const before = await fs.readdir('/repo');
  await assert.rejects(fs.link('/repo/original', '/repo/alias'), /ENOTSUP.*hard link/i);
  assert.deepEqual(await fs.readdir('/repo'), before);
  assert.equal(await fs.readFile('/repo/original'), 'original bytes');
  await assert.rejects(fs.link('/repo/original', '/repo/existing'), /ENOTSUP.*hard link/i);
  assert.equal(await fs.readFile('/repo/existing'), 'destination bytes');
  assert.equal(await fs.readFile('/repo/original'), 'original bytes');
});

test('Bash hard-link creation refuses without changing file bytes or paths', async t => {
  const workspace = fixture(t), fs = workspace.filesystem;
  const bash = workspace.createBash({ cwd: '/repo' });
  const before = await fs.readdir('/repo');
  const result = await bash.exec('ln original alias');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /ENOTSUP.*hard link/i);
  assert.deepEqual(await fs.readdir('/repo'), before);
  assert.equal(await fs.readFile('/repo/original'), 'original bytes');
  assert.equal(await fs.readFile('/repo/existing'), 'destination bytes');
});

test('forced, literal-operand and nested Bash hard links refuse before removing any destination', async t => {
  for (const command of [
    'ln -f original existing', 'ln -fv original existing', 'ln --force original existing',
    'ln -- -s alias', "bash -c 'ln -f original existing'", 'ln -f missing existing', 'ln -f original original',
  ]) {
    const workspace = fixture(t), fs = workspace.filesystem;
    await fs.writeFile('/repo/-s', 'literal operand');
    const before = await fs.readdir('/repo');
    const result = await workspace.createBash({ cwd: '/repo' }).exec(command);
    assert.notEqual(result.exitCode, 0, command);
    assert.match(result.stderr, /ENOTSUP.*hard link/i, command);
    assert.deepEqual(await fs.readdir('/repo'), before, command);
    assert.equal(await fs.readFile('/repo/existing'), 'destination bytes', command);
    assert.equal(await fs.readFile('/repo/original'), 'original bytes', command);
    assert.equal(await fs.readFile('/repo/-s'), 'literal operand', command);
  }
});

test('native execution environment refuses forced hard links before any filesystem effects', async t => {
  const workspace = fixture(t), fs = workspace.filesystem;
  const lease = await workspace.acquire({ operationId: 'native-links', input: { cwd: '/repo' } }, context);
  t.after(() => lease.release(context));
  const before = await fs.readdir('/repo');
  const result = getOrThrow(await lease.environment.exec('ln -f original existing', undefined, context));
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(await fs.readdir('/repo'), before);
  assert.equal(await fs.readFile('/repo/existing'), 'destination bytes');
  assert.equal(await fs.readFile('/repo/original'), 'original bytes');
});

test('link refusal preserves the host command whitelist and explicit custom ln command', async t => {
  const workspace = fixture(t);
  const omitted = await workspace.createBash({ cwd: '/repo', commands: ['echo'] }).exec('ln -s original alias');
  assert.equal(omitted.exitCode, 127);
  assert.equal(await workspace.filesystem.exists('/repo/alias'), false);
  const custom = defineCommand('ln', async args => ({ stdout: JSON.stringify(args), stderr: '', exitCode: 0 }));
  const result = await workspace.createBash({ cwd: '/repo', customCommands: [custom] }).exec('ln original alias');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), ['original', 'alias']);
  assert.equal(await workspace.filesystem.exists('/repo/alias'), false);
});

test('direct and Bash symbolic links remain supported and writes update the original target', async t => {
  const workspace = fixture(t), fs = workspace.filesystem;
  await fs.symlink('original', '/repo/direct-symbolic');
  assert.equal((await fs.lstat('/repo/direct-symbolic')).isSymbolicLink, true);
  assert.equal(await fs.readlink('/repo/direct-symbolic'), 'original');
  await fs.writeFile('/repo/direct-symbolic', 'changed through direct symlink');
  assert.equal(await fs.readFile('/repo/original'), 'changed through direct symlink');
  const bash = workspace.createBash({ cwd: '/repo' });
  assert.equal((await bash.exec('ln -s original shell-symbolic')).exitCode, 0);
  assert.equal((await fs.lstat('/repo/shell-symbolic')).isSymbolicLink, true);
  assert.equal((await bash.exec('printf "shell bytes" > shell-symbolic')).exitCode, 0);
  assert.equal(await fs.readFile('/repo/original'), 'shell bytes');
  assert.equal(await fs.readFile('/repo/direct-symbolic'), 'shell bytes');
  assert.equal(await fs.readlink('/repo/shell-symbolic'), 'original');
  for (const command of ['ln -sf original existing', 'ln --symbolic --force original existing']) {
    const result = await bash.exec(command);
    assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
    assert.equal((await fs.lstat('/repo/existing')).isSymbolicLink, true);
    assert.equal(await fs.readlink('/repo/existing'), 'original');
    assert.equal(await fs.readFile('/repo/existing'), 'shell bytes');
    assert.equal(await fs.readFile('/repo/original'), 'shell bytes');
  }
  const literalTarget = 'original; printf injected > /repo/injected';
  const literal = await bash.exec('ln', { args: ['-s', literalTarget, '/repo/literal-symbolic'] });
  assert.equal(literal.exitCode, 0);
  assert.equal(await fs.readlink('/repo/literal-symbolic'), literalTarget);
  assert.equal(await fs.exists('/repo/injected'), false);
});
