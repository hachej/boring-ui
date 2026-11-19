// Guard: the chat logic (draft, conversations, remote transport, placement) has one owner, `@hachej/boring-ui-kit/chat-react`
// (packages/ui/src/chat-react*.ts). registry/pi-chat/use-*.ts may only be thin deprecated re-exports of it, and no registry block
// may import them by path (blocks import the kit subpath, as every other block does).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const chatDir = join(root, 'registry/pi-chat');
const code = file => readFileSync(file, 'utf8').split('\n').filter(line => line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith("'use client'"));
const SHIMS = { 'use-chat-draft.ts': ['useChatDraft'], 'use-conversations.ts': ['useConversations', 'useConversationsClient'], 'use-remote-chat.ts': ['useChatPlacement', 'readChatPlacement', 'useRemoteChat'] };

test('registry/pi-chat/use-*.ts only re-export the kit (no logic copy)', () => {
  const hooks = readdirSync(chatDir).filter(name => /^use-.*\.tsx?$/.test(name));
  assert.deepEqual(hooks.sort(), Object.keys(SHIMS).sort(), 'a new use-* file in pi-chat is logic the kit should own: put it in packages/ui chat-react');
  for (const name of hooks) {
    const lines = code(join(chatDir, name));
    assert.ok(lines.length <= 4, `${name} has ${lines.length} code lines: a wrapper this size re-exports, it does not define logic`);
    for (const line of lines) assert.match(line, /^export (type )?\{[^}]*\} from '@hachej\/boring-ui-kit\/chat-react';$/, `${name}: only re-exports from the kit chat-react subpath are allowed, found: ${line}`);
  }
});

test('no registry file imports a pi-chat use-* shim by path', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && !(entry.name in SHIMS) && /from '(\.\/|\.\.\/pi-chat\/)use-(chat-draft|conversations|remote-chat)'/.test(readFileSync(path, 'utf8'))) offenders.push(path.slice(root.length));
    }
  };
  walk(join(root, 'registry'));
  assert.deepEqual(offenders, []);
});

test('the shims re-export names the kit really exports', () => {
  const kit = readdirSync(join(root, 'packages/ui/src')).filter(name => /^chat-react.*\.ts$/.test(name)).map(name => readFileSync(join(root, 'packages/ui/src', name), 'utf8')).join('\n');
  for (const [file, names] of Object.entries(SHIMS)) {
    const shim = readFileSync(join(chatDir, file), 'utf8');
    for (const name of names) { assert.ok(shim.includes(name), `${file} lists ${name}`); assert.ok(kit.includes(name), `chat-react defines ${name}`); }
  }
});
