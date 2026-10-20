import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const registry = JSON.parse(readFileSync(resolve(root, 'registry.json'), 'utf8'));
const forbidden = /(?:from\s*|import\s*\()['"][^'"]*(?:shared-chat|channel-source|channel-error|channel-socket|fake-channel|(?:^|\/)shared(?:['".]|$))/;

test('the regular pi-chat registry has no multi-party implementation dependency', () => {
  for (const name of readdirSync(resolve(root, 'registry/pi-chat'))) {
    if (!/\.[cm]?[jt]sx?$/.test(name)) continue;
    assert.doesNotMatch(readFileSync(resolve(root, 'registry/pi-chat', name), 'utf8'), forbidden, name);
  }
  const regular = registry.items.find(item => item.name === 'pi-chat');
  assert.ok(regular.files.every(file => !/\/(?:shared|use-shared-chat)\./.test(file.path)));
  assert.ok(!regular.registryDependencies.some(dep => /shared-chat/.test(dep)));
});

test('shared-chat is an explicit optional registry item over pi-chat', () => {
  const item = registry.items.find(item => item.name === 'shared-chat');
  assert.ok(item);
  assert.ok(item.files.length > 0 && item.files.every(file => file.path.startsWith('registry/shared-chat/')));
  assert.ok(item.registryDependencies.some(dep => /(?:^|\/)pi-chat(?:\.json)?$/.test(dep)));
});

test('the headless kit root does not export channel runtime symbols', async () => {
  const kit = await import('@hachej/boring-ui-kit');
  for (const name of ['createSharedChat', 'createChannelSocket', 'createFakeChannelSource', 'ChannelRequestError', 'channelAvatarStates']) assert.equal(name in kit, false, name);
  assert.doesNotMatch(readFileSync(resolve(root, 'packages/ui/src/index.ts'), 'utf8'), /shared-chat|channel-/);
});
