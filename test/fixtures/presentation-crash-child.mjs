import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, AssistantEntry, ToolTask, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createPresentationTool } from '@hachej/boring-agent/presentation';

const [directory, phase] = process.argv.slice(2);
const tool = createPresentationTool({ name: 'viewer_effect', description: 'Fictional mounted viewer effect', parameters: Type.Object({}),
  target: { instanceId: 'viewer', epoch: 'mount', subject: null }, prepareInput: args => args, authorize: () => true,
  command: { name: 'effect', input: { parse: value => value }, invoke: async () => {
    appendFileSync(join(directory, 'effects'), 'effect\n');
    if (phase === 'hold') { writeFileSync(join(directory, 'ready'), 'ready'); await new Promise(() => {}); }
    return { kind: 'applied', value: undefined };
  } }, formatResult: result => ({ content: [{ type: 'text', text: result.kind }] }),
});
const keepAlive = setInterval(() => {}, 1000);
const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.presentation.crash', tools: [tool] }));
const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
const conversation = await harness.root(context);
let taskId;
if (phase === 'hold') {
  taskId = await conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, conversation.id, { model: [{ role: 'assistant',
      content: [{ type: 'toolCall', id: 'call', name: 'viewer_effect', arguments: {} }], api: 'fixture', provider: 'fixture', model: 'fictional-no-model', timestamp: 1, stopReason: 'toolUse',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }] });
    return tx.createTask(ToolTask, { assistant: entry.id, callId: 'call' }, { ownership: { kind: 'conversation' } });
  }, context);
  writeFileSync(join(directory, 'task.json'), JSON.stringify(taskId));
} else taskId = JSON.parse(readFileSync(join(directory, 'task.json'), 'utf8'));
const terminal = await harness.waitForTask(taskId, context);
writeFileSync(join(directory, 'recovered.json'), JSON.stringify(terminal));
await harness.close(context); clearInterval(keepAlive);
