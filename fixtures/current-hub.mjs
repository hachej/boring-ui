import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openFixtureApp, fixtureActor, fixtureRequest } from './current-hub/app.mjs';
import { provisionFixtureDefinition } from './current-hub/definition.mjs';
import { openFixtureCompanion } from './current-hub/companion.mjs';
import { openFixtureChangePath } from './current-hub/change-path.mjs';
import { admitDocumentTool, documentToolResult } from '../test/fixtures/native-document.mjs';

const directory = mkdtempSync(join(tmpdir(), 'fictional-current-hub-'));
const opened = [];
try {
  const apps = {};
  for (const appId of ['amber', 'blue']) {
    const appDirectory = join(directory, appId);
    const definitionRef = await provisionFixtureDefinition({ directory: appDirectory, appId });
    apps[appId] = await openFixtureApp({ directory: appDirectory, appId, definitionRef });
    opened.push(apps[appId]);
  }
  const changePath = openFixtureChangePath({ directory: join(directory, 'amber-changes'), app: apps.amber });
  opened.push(changePath);
  const hub = await openFixtureCompanion({ directory: join(directory, 'hub'), apps, changePaths: { amber: changePath } });
  let amberContext;
  opened.push(hub);
  for (const appId of ['amber', 'blue']) {
    const task = await admitDocumentTool(hub.conversation, fixtureRequest(appId), `invoke_${appId}`);
    const { result } = await documentToolResult(hub.harness, hub.conversation, task);
    if (result.kind !== 'admitted') throw new Error('Fictional invocation was not admitted');
    await apps[appId].local.harness.waitForTask(result.ref.delivery, context);
    const observation = await apps[appId].observe(result.ref, fixtureActor(appId));
    if (observation.publication !== 'committed') throw new Error('Fictional document was not published');
    console.log(JSON.stringify(observation));
    if (appId === 'amber') amberContext = result.ref;
  }
  const actor = fixtureActor('amber');
  const staged = await changePath.stage({ requestId: 'demo-change', text: 'Please clarify the fictional report headings.' }, actor);
  if (staged.kind !== 'staged') throw new Error('Fictional request text was not staged');
  const task = await admitDocumentTool(hub.conversation, { requestId: 'demo-change', source: staged.source, context: amberContext }, 'request_change_amber');
  const { result } = await documentToolResult(hub.harness, hub.conversation, task);
  if (result.kind !== 'filed') throw new Error('Fictional change request was not filed');
  const issue = await changePath.readIssue(result.ref, actor);
  if (issue.kind !== 'observed' || issue.status !== 'open') throw new Error('Fictional issue was not observed');
  console.log(JSON.stringify(issue));
} finally {
  for (const resource of opened.reverse()) await resource.close();
  rmSync(directory, { recursive: true, force: true });
}
