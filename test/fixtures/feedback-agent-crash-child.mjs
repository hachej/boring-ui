import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFeedbackCapability } from '@hachej/boring-feedback/agent';
import { appElementResolution } from '@hachej/boring-feedback/page';
import { admitDocumentTool, documentToolResult } from './native-document.mjs';
import { agent, openFeedbackStore, seed } from './feedback-agent.mjs';

// The child of the feedback agent crash test (the SIGKILL pattern of document-crash-child.mjs). `commit-and-hold` seeds a
// report, admits a native `feedback` resolve ToolTask, lets the store commit, records the result and hangs until killed
// before Pi records the tool result. `recover` and `changed-binding` reopen the same native and resource databases and
// wait for the same task, which Pi replays because the tool is replay-safe.
const [directory, mode] = process.argv.slice(2);
const { resources, store } = await openFeedbackStore(join(directory, 'feedback.sqlite'));
const caller = mode === 'changed-binding' ? { ...agent, initiatorId: 'p_fictional_someone_else' } : agent;
const capability = createFeedbackCapability({ store, resolutions: { 'app.element@1': appElementResolution }, resolveAccess: () => caller, operationNamespace: 'fictional-feedback-agent-crash' });
const native = capability.extension.tools[0];
const tool = defineTool({ ...native, execute: async (args, api, ctx) => {
  const result = await native.execute(args, api, ctx);
  if (mode === 'commit-and-hold') {
    writeFileSync(join(directory, 'committed.json'), JSON.stringify({ taskId: api.taskId, result: JSON.parse(result.content[0].text) }));
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  return result;
} });
const registry = createRegistry();
registry.install(defineExtension({ name: 'fixture.feedback', tools: [tool] }));
const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
const conversation = await harness.root(context);
let taskId;
if (mode === 'commit-and-hold') {
  const created = await seed(store);
  writeFileSync(join(directory, 'seeded.json'), JSON.stringify({ id: created.report.id, revision: created.revision }));
  taskId = await admitDocumentTool(conversation, { action: 'resolve', id: created.report.id, expectedRevision: created.revision, note: 'Made the Save button green.' }, 'feedback');
} else taskId = JSON.parse(readFileSync(join(directory, 'committed.json'), 'utf8')).taskId;
const recovered = await documentToolResult(harness, conversation, taskId);
writeFileSync(join(directory, 'recovered.json'), JSON.stringify({ result: recovered.result }));
await harness.close(context);
resources.close();
