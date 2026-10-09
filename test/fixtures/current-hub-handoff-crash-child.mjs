import assert from 'node:assert/strict';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor, fixtureRequest, openFixtureApp } from '../../examples/current-hub/app.mjs';
import { provisionFixtureDefinition } from '../../examples/current-hub/definition.mjs';
import { openFixtureChangePath } from '../../examples/current-hub/change-path.mjs';
import { openFixtureCompanion } from '../../examples/current-hub/companion.mjs';
import { admitDocumentTool, documentToolResult } from './native-document.mjs';

const [directory] = process.argv.slice(2);
assert.ok(directory);
const appId = 'amber', actor = fixtureActor(appId), requestId = 'crash-handoff';
const access = { scopeId: actor.scopeId, principalId: actor.principalId,
  initiatorId: actor.initiatorId, authorizationRef: actor.installationId };
const hold = new Promise(() => {});
const keepAlive = setInterval(() => {}, 1000);
const definitionRef = await provisionFixtureDefinition({ directory: join(directory, 'app'), appId });
const app = await openFixtureApp({ directory: join(directory, 'app'), appId, definitionRef });
const blueDefinition = await provisionFixtureDefinition({ directory: join(directory, 'blue'), appId: 'blue' });
const blue = await openFixtureApp({ directory: join(directory, 'blue'), appId: 'blue', definitionRef: blueDefinition });
let source, report, hubTask, path, companion;
try {
  report = await app.invoke(fixtureRequest(appId, 'handoff-context'), actor);
  assert.equal(report.kind, 'admitted');
  await app.local.harness.waitForTask(report.ref.delivery, context);
  path = await openFixtureChangePath({ directory: join(directory, 'change'), app,
    afterCommit: async issue => {
      const publication = await path.local.provider.reconciliation.lookup(issue.operationId, access);
      assert.equal(publication.kind, 'committed');
      const task = await companion.harness.getTask(hubTask, context);
      assert.notEqual(task.state.status, 'terminal');
      const ready = { phase: 'issue-committed-before-ack', source: source.source, report: report.ref,
        issue, receipt: publication.receipt, hubTask, taskStatus: task.state.status };
      writeFileSync(join(directory, 'ready.tmp'), JSON.stringify(ready));
      renameSync(join(directory, 'ready.tmp'), join(directory, 'ready.json'));
      await hold;
    },
  });
  source = await path.stage({ requestId, text: 'Fictional original handoff draft.' }, actor);
  assert.equal(source.kind, 'staged');
  companion = await openFixtureCompanion({ directory: join(directory, 'hub'), apps: { amber: app, blue },
    changePaths: { amber: path } });
  hubTask = await admitDocumentTool(companion.conversation,
    { requestId, source: source.source, context: report.ref }, 'request_change_amber');
  const result = await documentToolResult(companion.harness, companion.conversation, hubTask);
  writeFileSync(join(directory, 'acknowledged.json'), JSON.stringify(result.result));
  throw new Error('Handoff returned instead of holding after its commit');
} finally {
  clearInterval(keepAlive);
  if (companion) await companion.close();
  if (path) await path.close();
  await blue.close();
  await app.close();
}
