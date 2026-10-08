import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';
import { fixtureActor, PRIVATE_MARKERS } from './app.mjs';

export async function provisionFixtureDefinition({ directory, appId, instructions = PRIVATE_MARKERS[appId]?.definition,
  tools = ['prepare_report'], expected }) {
  if (!Object.hasOwn(PRIVATE_MARKERS, appId)) throw new TypeError('Unknown fictional app');
  mkdirSync(directory, { recursive: true });
  const actor = fixtureActor(appId);
  const installer = { scopeId: actor.scopeId, principalId: 'fictional-installer', initiatorId: 'fictional-setup', authorizationRef: actor.installationId };
  const target = { resource: { providerId: appId, path: 'agent.json' }, view: { kind: 'published' } };
  const provider = openSqliteWorkspaces({ filename: join(directory, 'resources.sqlite'), providerId: appId,
    authorize: (action, selected, access) => ['create', 'replace'].includes(action)
      && selected.resource.path === target.resource.path && Object.keys(installer).every(key => access[key] === installer[key]) });
  try {
    const bytes = new TextEncoder().encode(JSON.stringify({ format: 'boring.agent', version: 1, instructions, tools }));
    const published = await provider.publication.publish({ operationId: `fixture-definition:${randomUUID()}`, atomicity: 'all-or-nothing',
      changes: [expected ? { kind: 'replace', target: expected, bytes, mediaType: 'application/json' }
        : { kind: 'create', target, expected: { kind: 'absent' }, bytes, mediaType: 'application/json' }],
    }, installer);
    if (published.kind !== 'committed') throw new Error('Fictional definition provisioning failed');
    return published.receipt.changes[0].after;
  } finally { provider.close(); }
}
