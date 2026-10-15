// Host code, not a package API: one SQLite database holding one workspace per scope. Each scope's files are rows of its own
// workspace (`openSqliteFileSystem`), served by its own workspace provider; the journal (receipts, intents, history) lives in the
// same database, keyed by each workspace's identity, so a multi-file save and its receipt commit in one transaction.
//
// Access control is at the workspace boundary and belongs to the host ([One place for files](../../docs/architecture/FILES-GIT-EXEC.md#one-place-for-files)):
// `authorize(action, target, access)` is the host's policy, checked here before a request reaches the scope's workspace. A
// refused write whose operation already committed reads `unknown`, and a lookup the policy no longer permits reads `unknown`,
// so a revoked caller never learns a receipt and never mistakes a committed operation for one that did not happen.
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { accessSnapshot, publicationSnapshot } from '@hachej/boring-files/publication';

/** `sqlite`: the connection's settings (`sqliteSettings.networkFilesystem` from `@hachej/boring-files/sqlite` on EFS); local disk by default. */
export function openSqliteWorkspaces({ filename, providerId, authorize = () => true, sqlite = {} }) {
  const connection = openNodeConnection(filename, sqlite);
  let journal;
  try { journal = createWorkspaceJournal(connection); } catch (error) { connection.close(); throw error; }
  const workspaces = new Map();
  let closed = false;

  /** The scope's workspace provider, opened on first use. */
  const workspace = scopeId => {
    if (closed) throw new Error('The workspaces are closed');
    let found = workspaces.get(scopeId);
    if (!found) {
      const fs = openSqliteFileSystem({ connection, workspace: scopeId, cwd: '/workspace' });
      found = createWorkspaceProvider({ identity: { providerId, instanceId: scopeId, incarnation: fs.incarnation, viewId: 'published' }, fs, journal });
      workspaces.set(scopeId, found);
    }
    return found;
  };
  const allowed = (action, target, access) => !access.signal?.aborted && authorize(action, structuredClone(target), { ...access }) === true && !access.signal?.aborted;
  const unknown = operationId => ({ kind: 'unknown', operationId, reason: 'Current access does not permit reconciliation of this operation' });

  return {
    providerId, workspace,
    read: async (request, access) => allowed('read', request.target, access)
      ? workspace(access.scopeId).read(request, access) : { kind: 'denied', reason: 'Read is not authorized' },
    publication: {
      publish: async (input, context) => {
        // Captured first, so the policy callback cannot change what is published or for whom.
        const request = publicationSnapshot(input), access = accessSnapshot(context);
        const permitted = (request.changes ?? []).every(change => allowed(change.kind, change.target, access))
          && (request.preconditions ?? []).every(item => allowed('read', item.target, access));
        if (permitted) return workspace(access.scopeId).publication.publish(request, access);
        const previous = await workspace(access.scopeId).reconciliation.lookup(request.operationId, access);
        return previous.kind === 'not-found' ? { kind: 'denied', reason: 'Publication is not authorized' } : unknown(request.operationId);
      },
    },
    reconciliation: {
      lookup: async (operationId, access) => {
        const found = await workspace(access.scopeId).reconciliation.lookup(operationId, access);
        return found.kind === 'committed' && found.receipt.changes.some(change => !allowed('lookup', change.after ?? change.before, access)) ? unknown(operationId) : found;
      },
    },
    capabilities: async (target, access) => {
      const capabilities = await workspace(access.scopeId).capabilities(target, access);
      return { ...capabilities, effective: capabilities.effective.filter(action => allowed(action, target, access)) };
    },
    close: () => { if (!closed) { closed = true; connection.close(); } },
  };
}
