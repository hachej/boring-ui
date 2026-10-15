// Remote sandbox: the same native tools executed in a Vercel Sandbox microVM. Runs only on the vercel variant.
import assert from 'node:assert/strict';
import { call } from './_script.mjs';

export default {
  id: 'sandbox-node', group: 'Remote sandbox', title: 'Run a script in a real sandbox', variants: ['vercel'], requires: ['sandbox'], panel: 'sandbox',
  description: 'The tools write and run a Node script inside a Vercel Sandbox microVM; the Sandbox tab shows its status, files and commands.',
  steps: [{ prompt: 'Use the write tool to create the file sum.js in the workspace (not an artifact), which prints the sum of the integers 1 to 100 with the prefix "SUM=", run it with node, and also run `uname -s`. Then reply with both outputs, exactly as printed.' }],
  // Needs a real Vercel Sandbox, so it only runs on that variant (never in the keyless blocking layer); the script keeps it runnable with STUDIO_MODEL=scripted there.
  script: { 0: [
    call('write', { path: 'sum.js', content: 'let sum = 0; for (let n = 1; n <= 100; n++) sum += n; console.log(`SUM=${sum}`);\n' }),
    call('bash', { command: 'node sum.js && uname -s' }),
    ctx => `Output:\n${ctx.last.text.trim()}`,
  ] },
  expect: [{ toolResult: /SUM=5050/ }, { toolResult: /Linux/ }, { toolCalled: 'bash' }],
  async verify(t) {
    await t.browser.until('panel shows the running sandbox, the file and the command count', `document.querySelector('[data-testid=sandbox-status]')?.textContent === 'running' && /sum\\.js/.test(document.querySelector('[data-testid=sandbox-files]')?.textContent ?? '') && Number(document.querySelector('[data-testid=sandbox-commands]')?.textContent) >= 1`, 30000);
    assert.ok((await t.toolNames()).includes('bash'));
    await t.browser.screenshot('vercel.png');
  },
};
