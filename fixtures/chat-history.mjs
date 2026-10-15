import assert from 'node:assert/strict';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const fake = createFakeChatModel();
const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
const controller = createNativeChatController({ conversation, context,
  identity: { runtimeId: 'fictional-local', scopeId: 'fictional-history', principalId: 'fictional-person' } });
try {
  for (let index = 1; index <= 95; index++) await conversation.submit({ type: 'write', entry: {
    kind: 'fictional.note', model: [{ role: 'user', content: `Fictional historical note ${index}`, timestamp: 0 }],
  } }, context);
  await conversation.reset('Fictional current context', context);
  await controller.connect();
  controller.setText('Unsent draft remains current');
  const active = controller.getSnapshot().view.entries;
  const pages = [];
  for (;;) {
    await controller.loadEarlier();
    const history = controller.getSnapshot().history;
    assert.equal(history.kind, 'ready');
    assert.ok(history.entries.length <= 40);
    pages.push(history.entries.length);
    assert.equal(controller.getSnapshot().view.entries, active);
    if (!history.hasMore) break;
  }
  assert.deepEqual(pages, [40, 40, 16]);
  assert.equal(controller.getSnapshot().draft.text, 'Unsent draft remains current');
  assert.equal(fake.calls.length, 0);
  controller.clearHistory();
  assert.equal(controller.getSnapshot().history.kind, 'idle');
  console.log(JSON.stringify({ activeEntries: active.length, nativeHistoryPageSizes: pages, draft: controller.getSnapshot().draft.text }));
  console.log('Native history paged across reset; one page retained; no model request or task mutation from browsing.');
} finally { await controller.dispose(); await harness.close(context); }
