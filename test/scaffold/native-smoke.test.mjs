import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { CodingTools } from '@earendil-works/pi-durable/tools';

// No providers or credentials installed and no model submitted. This verifies
// published native package interoperability, NOT a Boring attachment/runtime.
test('published native packages create/configure a file-free conversation', async () => {
  const registry = createRegistry();
  const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, BACKGROUND_CONTEXT);
  try {
    const conversation = await harness.root(BACKGROUND_CONTEXT);
    await conversation.configure({ instructions: 'Fictional scaffold test; no external actions.' }, BACKGROUND_CONTEXT);
    const resolved = await conversation.agent(BACKGROUND_CONTEXT);
    assert.ok(resolved);
    const again = await harness.root(BACKGROUND_CONTEXT);
    assert.equal(again.id, conversation.id);
    registry.install(CodingTools);
    assert.ok(CodingTools);
  } finally { await harness.close(BACKGROUND_CONTEXT); }
});
