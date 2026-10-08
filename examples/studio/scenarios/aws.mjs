// AWS: the file tools and the viewer read the user's EFS folder on the runtime side, commands run in the Code Interpreter
// session that mounts the same folder. Runs only on the aws variant (STUDIO_AWS=fake: the offline fake behind the real AWS SDK).
import assert from 'node:assert/strict';
import { call } from './_script.mjs';
import { viewerKit } from './_viewers.mjs';

const PATH = 'notes/aws-plan.md';

export default {
  id: 'aws-shared-folder', group: 'Remote sandbox', title: 'One folder, two sides', variants: ['aws'], requires: ['workspace', 'shell'], panel: 'files',
  description: 'The write tool saves a file on the user\'s EFS folder, a command in the Code Interpreter session changes it, and the viewer shows the change.',
  steps: [{ prompt: `Use the write tool to create ${PATH} with the line "- status: draft", then in bash replace draft with "reviewed in the interpreter", print the file and the working directory. Reply with the output.` }],
  script: { 0: [
    call('write', { path: PATH, content: '# Harbour plan\n\n- status: draft\n' }),
    call('bash', { command: `sed -i 's/draft/reviewed in the interpreter/' ${PATH} && cat ${PATH} && pwd` }),
    ctx => `Interpreter output:\n${ctx.last.text.trim()}`,
  ] },
  expect: [{ toolCalled: 'write' }, { toolResult: /status: reviewed in the interpreter/ }, { toolResult: /\/mnt\/workspace/ }, { fileContains: { path: PATH, text: /status: reviewed in the interpreter/ } }],
  async verify(t) {
    const k = viewerKit(t);
    await k.openFile(PATH, 'markdown');
    await t.browser.until('the viewer shows the change made in the interpreter', `${k.editorText(PATH)}.includes('reviewed in the interpreter')`, 20000);
    assert.ok((await t.toolNames()).includes('bash'));
    await t.browser.screenshot('aws-shared-folder.png');
  },
};
