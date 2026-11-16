// The local disk workspace: Pi's `NodeExecutionEnv` for the shell, with every file operation on one host folder going
// through the no-follow walk (D-2087), so a link inside the folder can never lead a read, a write or a listing outside it.
import { posix } from 'node:path';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { createMountedFiles } from './mounted-files.js';

export interface FolderEnvOptions {
  /** The workspace folder (absolute). */
  readonly cwd: string;
  readonly shellPath?: string;
  readonly shellEnv?: NodeJS.ProcessEnv;
}

/**
 * An `ExecutionEnv` over one folder of this host, for `createWorkspaceProvider` and the agent's tools alike. Files walk the
 * folder by directory fds with O_NOFOLLOW, linking out of it is refused, and `exec` and temporary files are Pi's own.
 * Linux only (`/proc/self/fd`): elsewhere every file operation fails closed.
 */
export function createFolderEnv(options: FolderEnvOptions): ExecutionEnv {
  const root = posix.resolve(options.cwd);
  const node = new NodeExecutionEnv({ cwd: root, ...(options.shellPath === undefined ? {} : { shellPath: options.shellPath }), ...(options.shellEnv === undefined ? {} : { shellEnv: options.shellEnv }) });
  const mounted = createMountedFiles({ root, mountPath: root, cwd: () => env.cwd });
  const env: ExecutionEnv = {
    ...mounted.files,
    id: node.id,
    cwd: root,
    exec: (command, execOptions, context) => node.exec(command, execOptions, context),
    createTempDir: (prefix, context) => node.createTempDir(prefix, context),
    createTempFile: (tempOptions, context) => node.createTempFile(tempOptions, context),
    cleanup: async context => { await mounted.close(); await node.cleanup(context); },
  };
  return env;
}
