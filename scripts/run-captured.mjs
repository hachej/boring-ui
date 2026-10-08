import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Verification children use file descriptors without synchronous pipes. Output limits are checked after exit. */
export function runCaptured(command, args, options = {}) {
  const maxBuffer = options.maxBuffer ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 0) throw new TypeError('maxBuffer must be a nonnegative safe integer');
  const directory = mkdtempSync(join(tmpdir(), 'boring-verification-'));
  const descriptors = [];
  try {
    const stdout = join(directory, 'stdout'), stderr = join(directory, 'stderr');
    descriptors.push(openSync(stdout, 'w+'));
    descriptors.push(openSync(stderr, 'w+'));
    const env = { ...(options.env ?? process.env), npm_config_cache: options.env?.npm_config_cache ?? join(directory, 'npm-cache') };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(command, args, { timeout: 60000, ...options, stdio: ['ignore', ...descriptors],
      env });
    const output = descriptors.map(descriptor => {
      const size = fstatSync(descriptor).size;
      const buffer = Buffer.alloc(Math.min(size, maxBuffer));
      const length = readSync(descriptor, buffer, 0, buffer.length, 0);
      return { text: buffer.subarray(0, length).toString('utf8'), oversized: size > maxBuffer };
    });
    if (output.some(value => value.oversized)) {
      const error = new Error('Verification output exceeded maxBuffer');
      error.code = 'ENOBUFS';
      return { ...result, status: null, error, stdout: output[0].text, stderr: output[1].text };
    }
    return { ...result, stdout: output[0].text, stderr: output[1].text };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}
