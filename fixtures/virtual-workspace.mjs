import { createGitRepository } from '@hachej/boring-files/git';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { installVirtualGitCommand, createVirtualGitFs } from '@hachej/boring-execution/virtual-git';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { getOrThrow } from '@earendil-works/pi-durable/env';

const workspace = createVirtualWorkspace({ providerId: 'fictional-demo', files: { '/repo/notes.md': '# Fictional notes\n' } });
const lease = await workspace.acquire({ operationId: 'demo', input: { cwd: '/repo' } }, context);
try {
  const shell = workspace.createBash({ cwd: lease.environment.cwd });
  installVirtualGitCommand({ bash: shell, repository: createGitRepository({ fs: createVirtualGitFs(workspace.filesystem), directory: lease.environment.cwd, author: { name: 'Fictional author', email: 'demo@example.invalid' }, authorize: () => true }) });
  getOrThrow(await lease.environment.appendFile('notes.md', '\nWritten through the native filesystem.\n', context));
  for (const command of ['cat notes.md', 'git init', 'git add notes.md', 'git commit -m "Fictional workspace"', 'git log']) {
    const result = await shell.exec(command);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    console.log(command, result.stdout.trim());
  }
  // Symlinks keep their type through commit and checkout, a same-size edit right after `git add` is seen, and a bad cwd fails.
  for (const command of ['ln -sT notes.md alias.md', 'git add alias.md', 'git commit -m "Add alias"', 'git branch side']) {
    const result = await shell.exec(command);
    if (result.exitCode !== 0) throw new Error(command + ': ' + result.stderr);
  }
  const files = createVirtualGitFs(workspace.filesystem).promises;
  await shell.exec('git rm --cached alias.md');
  await shell.exec('git commit -m "Drop alias"');
  await shell.exec('git checkout side');
  if (!(await files.lstat('/repo/alias.md')).isSymbolicLink()) throw new Error('symlink came back as a regular file');
  await shell.exec('echo aaaa > same.txt'); await shell.exec('git add same.txt'); await shell.exec('echo bbbb > same.txt');
  if (!/\["same.txt",0,2,\d\]/.test((await shell.exec('git status')).stdout)) throw new Error('same-size edit after add was missed');
  const missing = await lease.environment.exec('pwd', { cwd: '/no/such/dir' }, context);
  if (missing.ok || await workspace.filesystem.exists('/no')) throw new Error('nonexistent cwd must fail without being created');
  console.log('Storage is ephemeral; no publication or restart durability is claimed.');
} finally { await lease.release(context); workspace.dispose(); }
