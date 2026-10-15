// Variant `vercel`: the same agent, with native Pi file and shell tools executed in a Vercel Sandbox microVM instead of the
// local workspace. Available only when VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID are set; otherwise the selector lists
// it as unavailable with that reason. The sandbox is created on first use, stopped when the studio closes, and expires on its
// own after SANDBOX_TIMEOUT_MS. Resources use the same SQLite files as `local`; there is no virtual git here, so the agent has
// no working_git tool (it can still run git in the sandbox's own shell if the image has it).
import { posix } from 'node:path';
import { ExecutionError, FileError, err, ok } from '@earendil-works/pi-durable/env';

const ROOT = '/vercel/sandbox/workspace', SANDBOX_TIMEOUT_MS = 10 * 60_000;
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

/** A native ExecutionEnv whose every operation runs inside one lazily created Vercel Sandbox. */
function createVercelEnv(credentials, state) {
  let pending;
  const sandbox = () => (pending ??= (async () => {
    const { Sandbox } = await import('@vercel/sandbox');
    const created = await Sandbox.create({ ...credentials, timeout: SANDBOX_TIMEOUT_MS });
    await created.runCommand({ cmd: 'mkdir', args: ['-p', ROOT] });
    Object.assign(state, { status: 'running', name: created.name, startedAt: new Date().toISOString() });
    return created;
  })().catch(error => { pending = undefined; state.status = 'failed'; state.error = String(error?.message ?? error); throw error; }));
  const sh = async (script, cwd = ROOT) => {
    const run = await (await sandbox()).runCommand({ cmd: 'bash', args: ['-lc', script], cwd });
    return { exitCode: run.exitCode, stdout: await run.stdout(), stderr: await run.stderr() };
  };
  const failure = (path, stderr) => new FileError(/No such file/.test(stderr) ? 'not_found' : /Permission denied/.test(stderr) ? 'permission_denied'
    : /Not a directory/.test(stderr) ? 'not_directory' : /Is a directory/.test(stderr) ? 'is_directory' : 'unknown', stderr.trim() || 'Remote file operation failed', path);
  const guard = async (path, run) => { try { return await run(); } catch (error) { return err(error instanceof FileError ? error : new FileError('unknown', String(error?.message ?? error), path)); } };
  const command = (path, script) => guard(path, async () => { const result = await sh(script); return result.exitCode === 0 ? ok(result.stdout) : err(failure(path, result.stderr)); });
  const done = async result => { const value = await result; return value.ok ? ok(undefined) : value; };
  const kind = letter => letter === 'd' || letter === 'directory' ? 'directory' : letter === 'l' || letter === 'symbolic link' ? 'symlink' : 'file';
  const env = {
    id: 'vercel-sandbox', cwd: ROOT,
    absolutePath: async path => ok(posix.resolve(env.cwd, path)),
    joinPath: async parts => ok(posix.join(...parts)),
    readBinaryFile: (path, _context) => guard(path, async () => {
      const absolute = posix.resolve(env.cwd, path);
      const bytes = await (await sandbox()).readFileToBuffer({ path: absolute });
      return bytes ? ok(new Uint8Array(bytes)) : err(new FileError('not_found', `No such file: ${absolute}`, absolute));
    }),
    readTextFile: async (path, context) => { const read = await env.readBinaryFile(path, context); return read.ok ? ok(new TextDecoder().decode(read.value)) : read; },
    readTextLines: async (path, options, context) => {
      const read = await env.readTextFile(path, context);
      if (!read.ok) return read;
      const lines = read.value.split('\n'); if (lines.at(-1) === '') lines.pop();
      return ok(options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines));
    },
    openTextLineReader: async (path, context) => {
      const read = await env.readTextFile(path, context);
      if (!read.ok) return read;
      const parts = read.value.split('\n'); let index = 0;
      return ok({ close: async () => {}, readLine: async () => {
        if (index >= parts.length || (index === parts.length - 1 && parts[index] === '')) return ok(undefined);
        const terminated = index < parts.length - 1; return ok({ text: parts[index++], terminated });
      } });
    },
    writeFile: (path, content) => guard(path, async () => {
      const absolute = posix.resolve(env.cwd, path);
      const made = await sh(`mkdir -p ${quote(posix.dirname(absolute))}`);
      if (made.exitCode !== 0) return err(failure(absolute, made.stderr));
      await (await sandbox()).writeFiles([{ path: absolute, content: Buffer.from(typeof content === 'string' ? new TextEncoder().encode(content) : content) }]);
      return ok(undefined);
    }),
    appendFile: async (path, content, context) => {
      const existing = await env.readBinaryFile(path, context);
      if (!existing.ok && existing.error.code !== 'not_found') return existing;
      const addition = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      return env.writeFile(path, Buffer.concat([existing.ok ? existing.value : new Uint8Array(), addition]), context);
    },
    truncateFile: (path, size) => done(command(path, `truncate -s ${Number(size)} ${quote(posix.resolve(env.cwd, path))}`)),
    flushFile: async () => ok(undefined),
    renameFile: (source, destination) => done(command(source, `mv ${quote(posix.resolve(env.cwd, source))} ${quote(posix.resolve(env.cwd, destination))}`)),
    fileInfo: async path => {
      const absolute = posix.resolve(env.cwd, path);
      const result = await command(absolute, `stat -c '%F|%s|%Y' ${quote(absolute)}`);
      if (!result.ok) return result;
      const [type, size, seconds] = result.value.trim().split('|');
      return ok({ name: posix.basename(absolute), path: absolute, kind: kind(type), size: Number(size), mtimeMs: Number(seconds) * 1000 });
    },
    listDir: async path => {
      const absolute = posix.resolve(env.cwd, path);
      const result = await command(absolute, `find ${quote(absolute)} -mindepth 1 -maxdepth 1 -printf '%y|%s|%T@|%f\\n'`);
      if (!result.ok) return result;
      return ok(result.value.split('\n').filter(Boolean).map(line => {
        const [type, size, seconds, ...name] = line.split('|');
        return { name: name.join('|'), path: posix.join(absolute, name.join('|')), kind: kind(type), size: Number(size), mtimeMs: Number(seconds) * 1000 };
      }));
    },
    canonicalPath: async path => { const result = await command(path, `realpath -m ${quote(posix.resolve(env.cwd, path))}`); return result.ok ? ok(result.value.trim()) : result; },
    exists: path => guard(path, async () => ok((await sh(`[ -e ${quote(posix.resolve(env.cwd, path))} ] || [ -L ${quote(posix.resolve(env.cwd, path))} ]`)).exitCode === 0)),
    createDir: (path, options) => done(command(path, `mkdir ${options?.recursive === false ? '' : '-p'} ${quote(posix.resolve(env.cwd, path))}`)),
    remove: (path, options) => done(command(path, `rm ${options?.recursive ? '-r' : ''} ${options?.force ? '-f' : ''} ${quote(posix.resolve(env.cwd, path))}`)),
    createTempDir: async prefix => { const result = await command('/tmp', `mktemp -d -t ${quote(`${prefix ?? 'tmp'}.XXXXXX`)}`); return result.ok ? ok(result.value.trim()) : result; },
    createTempFile: async options => { const result = await command('/tmp', `mktemp -t ${quote(`${options?.prefix ?? 'tmp'}.XXXXXX${options?.suffix ?? ''}`)}`); return result.ok ? ok(result.value.trim()) : result; },
    cleanup: async () => {},
    /** Output is delivered when the command ends; there is no live stream or mid-command cancellation in this adapter. */
    exec: async (script, options, context) => {
      try {
        const cwd = options?.cwd ? posix.resolve(env.cwd, options.cwd) : env.cwd;
        const exported = Object.entries(options?.env ?? {}).map(([key, value]) => `export ${key}=${quote(value)}; `).join('');
        const running = sh(`${exported}${script}`, cwd);
        const result = options?.timeout ? await Promise.race([running, new Promise(resolve => setTimeout(() => resolve('timeout'), options.timeout * 1000))]) : await running;
        if (result === 'timeout') return err(new ExecutionError('timeout', `Remote command exceeded ${options.timeout} s; it may still be running in the sandbox`));
        state.commands += 1;
        options?.onOutput?.(result.stdout + result.stderr, context);
        return ok({ exitCode: result.exitCode });
      } catch (error) { return err(new ExecutionError('spawn_error', String(error?.message ?? error))); }
    },
  };
  return { env, stop: async () => { const active = pending; pending = undefined; if (active) await (await active.catch(() => undefined))?.stop(); state.status = 'stopped'; } };
}

const CREDENTIALS = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'];

export default host => {
  const missing = CREDENTIALS.filter(name => !process.env[name]);
  return {
    id: 'vercel', title: 'Vercel Sandbox', order: 20,
    description: 'The same tools executed in a Vercel Sandbox microVM: a real Linux shell with Node.js.',
    available: missing.length === 0 ? true : { reason: `Set ${missing.join(', ')} to enable it.` },
    capabilities: ['workspace', 'shell', 'sandbox'],
    async open() {
      const credentials = { token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID, projectId: process.env.VERCEL_PROJECT_ID };
      const state = { status: 'not started', commands: 0 };
      const remote = createVercelEnv(credentials, state);
      return {
        env: remote.env, root: ROOT, close: remote.stop,
        routes: async (request, url) => {
          if (request.method !== 'GET' || url.pathname !== '/api/variant/status') return undefined;
          let files = [];
          if (state.status === 'running') { const listed = await remote.env.listDir(ROOT, host.context); if (listed.ok) files = listed.value.map(entry => ({ name: entry.name, kind: entry.kind, size: entry.size })).sort((a, b) => a.name.localeCompare(b.name)); }
          return Response.json({ ...state, root: ROOT, files });
        },
      };
    },
  };
};
