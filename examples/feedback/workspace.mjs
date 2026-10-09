// The feedback demo's workspace (host code, not a package API): one SQLite database holding the workspace's files
// (`openSqliteFileSystem`) and the provider's journal, so a write and its receipt commit together; one workspace provider over it
// (reports, tickets, `present`); and Pi's ExecutionEnv over the same files (just-bash, no network) for the builder's native file tools.
// `listFolder` is what the feedback store lists its reports with: the names of the files in one folder of the workspace.
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider, isTemporary } from '@hachej/boring-files/workspace';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

export const WORKSPACE_ROOT = '/workspace';

/**
 * Opens the workspace `scopeId` in `filename`, with the `folders` the agent writes into (Pi's `write` does not create a missing parent
 * folder in this environment). Returns `{ files, fs, env, root, listFolder, close }`: `files` is the workspace provider
 * (a `ResourceReader` with `publication`, `reconciliation` and `capabilities`), `env` the ExecutionEnv the agent's file tools use.
 */
export async function openFeedbackWorkspace({ filename, providerId, scopeId, folders = [] }) {
  const connection = openNodeConnection(filename);
  try {
    const journal = createWorkspaceJournal(connection);
    const fs = openSqliteFileSystem({ connection, workspace: scopeId, cwd: WORKSPACE_ROOT });
    const files = createWorkspaceProvider({ identity: { providerId, instanceId: scopeId, incarnation: fs.incarnation, viewId: 'published' }, fs, journal });
    for (const folder of folders) {
      const made = await fs.createDir(`${WORKSPACE_ROOT}/${folder.replace(/\/$/, '')}`, { recursive: true }, context);
      if (!made.ok) throw new Error(made.error.message);
    }
    const lease = await createVirtualWorkspace({ providerId, fs }).acquire({ operationId: `${providerId}-workspace`, input: { cwd: WORKSPACE_ROOT } }, context);
    const listFolder = async folder => {
      const listed = await fs.listDir(folder ? `${WORKSPACE_ROOT}/${folder.replace(/\/$/, '')}` : WORKSPACE_ROOT, context);
      if (!listed.ok) return listed.error.code === 'not_found' ? [] : { kind: 'unavailable', reason: listed.error.message };
      return listed.value.filter(entry => entry.kind === 'file' && !isTemporary(entry.name)).map(entry => entry.name);
    };
    return { files, fs, env: lease.environment, root: WORKSPACE_ROOT, listFolder, close: () => connection.close() };
  } catch (error) { connection.close(); throw error; }
}
