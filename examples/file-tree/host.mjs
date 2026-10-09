import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';

/** Fictional auth and workspace selection; a real host uses its OAuth session here. */
export async function openFileTreeHost({ filename }) {
  const storage = openSqliteWorkspaces({ filename, providerId: 'fictional-files' });
  const access = scopeId => ({ principalId: 'fictional-person', scopeId, initiatorId: 'fictional-browser' });
  const target = path => ({ resource: { providerId: 'fictional-files', path }, view: { kind: 'published' } });
  const publish = (scope, operationId, changes) => storage.workspace(scope).publication.publish({ operationId, atomicity: 'all-or-nothing', changes }, access(scope));
  try {
    for (const scope of ['first', 'second']) {
      for (const [path, text] of Object.entries({ 'docs/notes.md': `# ${scope} workspace\n`, 'first.html': '<p>First file</p>', 'second.html': '<p>Second file</p>', '.gitignore': '*.log\n', 'debug.log': 'fictional ignored log', 'node_modules/hidden.txt': 'fictional dependency', 'dist/hidden.txt': 'fictional build output' })) {
        const result = await publish(scope, `seed-${scope}-${path}`, [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes: new TextEncoder().encode(text), mediaType: path.endsWith('.html') ? 'text/html' : path.endsWith('.md') ? 'text/markdown' : 'text/plain' }]);
        if (result.kind !== 'committed') throw new Error(`Fixture seed failed: ${result.kind}`);
      }
    }
  } catch (error) { storage.close(); throw error; }
  const handler = createRevisionHandler({ resolve: async request => {
    if (request.headers.get('authorization') !== 'Bearer fictional-file-tree') return null;
    const scope = request.headers.get('x-fictional-workspace');
    if (scope !== 'first' && scope !== 'second') return null;
    return { provider: storage.workspace(scope), access: access(scope) };
  } });
  return { handler, storage, access, target, publish, close: storage.close };
}
