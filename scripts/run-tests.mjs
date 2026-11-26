import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Test symlink is not auditable: ${entry.name}`);
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith('.test.mjs') ? [path] : [];
  }).sort();
}

/** Shard `index` of `total` (1-based). Files go heaviest first to the lightest shard (weights: seconds by file name, 1.5 when unknown), ties by order,
 *  so the shards are balanced and together run each file exactly once; every shard computes the same split from the same inputs. */
export function shardOf(files, index, total, weights = {}) {
  const weight = file => weights[basename(file).replace(/\.test\.mjs$/, '')] ?? 1.5;
  const load = Array.from({ length: total }, () => 0), mine = new Set();
  for (const file of files.map((file, order) => ({ file, order })).sort((a, b) => weight(b.file) - weight(a.file) || a.order - b.order).map(entry => entry.file)) {
    const target = load.indexOf(Math.min(...load));
    load[target] += weight(file);
    if (target === index - 1) mine.add(file);
  }
  return files.filter(file => mine.has(file));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const shardArg = args.find(arg => arg.startsWith('--shard='));
  const shard = shardArg?.match(/^--shard=([1-9]\d*)\/([1-9]\d*)$/);
  if (shardArg && (!shard || Number(shard[1]) > Number(shard[2]))) throw new Error(`Bad --shard (want i/n with 1 <= i <= n): ${shardArg}`);
  const jobsArg = args.find(arg => arg.startsWith('--jobs='));
  const jobs = jobsArg ? Number(jobsArg.slice('--jobs='.length)) : 1;
  if (jobsArg && !/^--jobs=[1-9]\d*$/.test(jobsArg)) throw new Error(`Bad --jobs (want a positive integer): ${jobsArg}`);
  if (args.some(arg => arg !== '--exclude-registered' && arg !== shardArg && arg !== jobsArg)) throw new Error(`Unknown test runner argument: ${args.join(' ')}`);
  const root = fileURLToPath(new URL('../', import.meta.url));
  let files = testFiles(resolve(root, 'test'));
  if (args.includes('--exclude-registered')) {
    const { loadBoundary } = await import('./check-pi-boundary.mjs');
    const boundary = loadBoundary(root);
    if (boundary.errors.length) throw new Error(boundary.errors.join('\n'));
    // CI's release gate executes these files with the stricter registered-evidence checks.
    const registered = new Set([
      ...[...Object.values(boundary.registry.invariants), ...Object.values(boundary.registry.features ?? {})].flatMap(rule => rule.verifiers.filter(proof => proof.kind === 'command').flatMap(proof => proof.command.slice(2))),
      ...boundary.implementationProofs.flatMap(proof => proof.command.slice(2)),
    ].map(path => resolve(root, path)));
    for (const path of registered) if (!files.includes(path)) throw new Error(`Registered test not discovered: ${path}`);
    files = files.filter(path => !registered.has(path));
  }
  const weights = shard || jobs > 1 ? JSON.parse(readFileSync(resolve(root, 'scripts/test-shard-weights.json'), 'utf8')) : {};
  if (shard) files = shardOf(files, Number(shard[1]), Number(shard[2]), weights);
  if (!files.length) throw new Error('No tests discovered');
  if (shard) console.log(`Shard ${shard[1]} of ${shard[2]}: ${files.length} test files`);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  // `--jobs=n` runs the files as n balanced node --test processes at once (a runner has 4 cores and one process uses one); each file still runs exactly once.
  // Output is printed per process when it ends, so the TAP of two processes never interleaves. The exit code fails if any process failed.
  const groups = Array.from({ length: Math.min(jobs, files.length) }, (_, index) => shardOf(files, index + 1, Math.min(jobs, files.length), weights));
  const statuses = await Promise.all(groups.map((group, index) => new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./css-stub-register.mjs', import.meta.url)), '--test', '--experimental-test-isolation=none', ...group], { stdio: groups.length === 1 ? 'inherit' : ['ignore', 'pipe', 'pipe'], env });
    const chunks = [];
    child.stdout?.on('data', chunk => chunks.push(chunk));
    child.stderr?.on('data', chunk => chunks.push(chunk));
    child.on('error', fail);
    child.on('close', status => {
      if (groups.length > 1) {
        process.stdout.write(`::group::test process ${index + 1} of ${groups.length}: ${group.length} files, exit ${status}\n`);
        process.stdout.write(Buffer.concat(chunks));
        process.stdout.write('::endgroup::\n');
      }
      done(status ?? 1);
    });
  })));
  process.exitCode = statuses.some(status => status !== 0) ? 1 : 0;
}
