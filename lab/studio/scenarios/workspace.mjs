// Workspace and shell: Pi's native read, write, edit and bash run over the variant's ExecutionEnv; a file the agent makes is listed in
// the Files tab. Git: the workspace is also a repository the agent edits, commits and branches, and the Git tab follows it.
import assert from 'node:assert/strict';
import { CLUB_FILES } from '../fixtures/workspace-files.mjs';
import { call } from './_script.mjs';

const part = id => `(document.querySelector('.studio-panel [data-testid=${id}]')?.innerText ?? '')`;
const commits = `document.querySelectorAll('.studio-panel [data-testid=git-log] li').length`;

export default [
  {
    id: 'workspace-shell', smoke: true, group: 'Workspace and shell', title: 'Run a command', requires: ['shell'], panel: 'files',
    description: 'Pi\'s stock bash tool runs a command in the workspace and the file it creates is listed.',
    steps: [{ prompt: 'Use bash to run: echo "tide-$((6*7))" > tide.txt && cat tide.txt . Then reply with the exact output of the command.' }],
    script: { 0: [call('bash', { command: 'echo "tide-$((6*7))" > tide.txt && cat tide.txt' }), ctx => `The command printed: ${ctx.last.text.trim()}`] },
    expect: [{ toolResult: /tide-42/ }, { toolCalled: 'bash' }, { fileExists: 'tide.txt' }],
    async verify(t) {
      await t.browser.until('file listed', `[...document.querySelectorAll('.studio-panel li button')].some(b => b.textContent === 'tide.txt')`);
      await t.panelControls('files');
    },
  },
  {
    // just-bash's CPython (WebAssembly) in the same shell: it reads and writes the workspace's files like any other command.
    id: 'workspace-python', group: 'Workspace and shell', title: 'Run Python', requires: ['shell', 'python'], panel: 'files',
    description: 'python3 runs in the workspace shell, reads a file the shell wrote and writes one that the Files tab lists.',
    steps: [{ prompt: 'Use bash to run: printf "4 5 6" > tides.txt && python3 -c "n = sum(map(int, open(\'tides.txt\').read().split())); open(\'total.txt\', \'w\').write(str(n)); print(f\'total={n}\')" . Then reply with the exact output.' }],
    script: { 0: [call('bash', { command: 'printf "4 5 6" > tides.txt && python3 -c "n = sum(map(int, open(\'tides.txt\').read().split())); open(\'total.txt\', \'w\').write(str(n)); print(f\'total={n}\')"' }),
      ctx => `Python printed: ${ctx.last.text.trim()}`] },
    expect: [{ toolResult: /total=15/ }, { reply: /Python printed: total=15/ }, { fileExists: 'total.txt' }],
  },
  {
    id: 'workspace-write-file', group: 'Workspace and shell', title: 'Write a file', requires: ['workspace'], panel: 'files',
    description: 'The agent writes a Markdown file with the write tool; it is listed, and opens in the viewer.',
    steps: [{ prompt: 'Use the write tool to create notes/todo.md with a title "Todo" and three short fictional tasks as a bullet list. Reply with one sentence.' }],
    script: { 0: [call('write', { path: 'notes/todo.md', content: '# Todo\n\n- Wind the clock\n- Water the ferns\n- Mail the postcard\n' }), 'Saved notes/todo.md.'] },
    expect: [{ toolCalled: 'write' }, { fileExists: 'notes/todo.md' }, { fileContains: { path: 'notes/todo.md', text: /Todo/ } }],
    async verify(t) {
      const { browser } = t;
      await browser.until('file listed', `[...document.querySelectorAll('.studio-panel li button')].some(b => b.textContent === 'notes/todo.md')`);
      await browser.click(`[...document.querySelectorAll('.studio-panel li button')].find(b => b.textContent === 'notes/todo.md')`);
      await browser.until('opens in the Markdown viewer', `!!document.querySelector('[data-testid=file-viewer][data-path="/workspace/notes/todo.md"][data-kind=markdown]')`, 15000);
    },
  },
  {
    id: 'git-commit', group: 'Git', title: 'Edit a file and commit it', requires: ['git'], panel: 'git', seed: CLUB_FILES, seedCommit: 'Tidewater club notes',
    description: 'The agent edits a file and commits it; the commit appears in the Git tab without a reload.',
    steps: [{ prompt: 'Add a fourth step to trips/itinerary.md: "4. Visit the Fictional Lighthouse at dusk." Then commit that file with the exact message: Add lighthouse stop' }],
    script: { 0: [
      call('read', { path: 'trips/itinerary.md' }),
      call('edit', { path: 'trips/itinerary.md', edits: [{ oldText: '3. Lunch at the Invented Inn.', newText: '3. Lunch at the Invented Inn.\n4. Visit the Fictional Lighthouse at dusk.' }] }),
      call('working_git', { operation: 'add', path: 'trips/itinerary.md' }),
      call('working_git', { operation: 'commit', message: 'Add lighthouse stop' }),
      'Committed the new stop.',
    ] },
    expect: [{ toolCalled: 'working_git' }],
    async verify(t) {
      const { browser, q } = t;
      await browser.until('new commit in the panel', `/Add lighthouse stop/.test(${part('git-log')})`, 60000);
      assert.match(await browser.evaluate(part('git-branch')), /main/);
      assert.match(await browser.evaluate(part('git-log')), /Tidewater club notes/);
      await browser.until('the committed file is clean', `!/trips\\/itinerary\\.md/.test(${part('git-status')})`);
      await browser.click(`[...document.querySelectorAll('.studio-panel [data-testid=git-files] button')].find(b => b.textContent === 'trips/itinerary.md')`);
      await browser.until('committed text in the preview', `/Fictional Lighthouse/.test(document.querySelector('[data-testid=file-preview]')?.textContent ?? '')`);
      const used = await t.toolNames();
      assert.ok(used.some(name => name === 'working_git' || name === 'bash'), 'a git tool call is visible');
      assert.ok(used.some(name => ['edit', 'write', 'bash'].includes(name)), 'a file change tool call is visible');
      const log = await (await t.api('/api/variant/git/log')).json();
      assert.deepEqual(log.commits.slice(0, 2).map(commit => commit.message), ['Add lighthouse stop', 'Tidewater club notes']);
      await t.panelControls('git');
      await browser.screenshot('git.png');
      void q;
    },
  },
  {
    id: 'git-branch-restart', group: 'Git', title: 'A branch and an uncommitted edit survive a restart', requires: ['git'], panel: 'git', seed: CLUB_FILES, seedCommit: 'Tidewater club notes',
    description: 'The agent branches and leaves an uncommitted change; history, branch and the change come back after a full server restart.',
    steps: [{ prompt: 'Create a branch named draft and switch to it. Then append the bullet "- Spare bootlaces and a paper map" to packing-list.md. Do not stage or commit it.' }],
    script: { 0: [
      call('working_git', { operation: 'branch', ref: 'draft' }),
      call('working_git', { operation: 'checkout', ref: 'draft' }),
      call('read', { path: 'packing-list.md' }),
      call('edit', { path: 'packing-list.md', edits: [{ oldText: '- Flask of tea', newText: '- Flask of tea\n- Spare bootlaces and a paper map' }] }),
      'On branch draft with the bootlaces bullet added, not committed.',
    ] },
    expect: [{ toolCalled: 'working_git' }],
    async verify(t) {
      const { browser } = t;
      await browser.until('uncommitted change on the draft branch', `${part('git-branch')} === 'draft' && /packing-list\\.md\\s*modified/.test(${part('git-status')})`, 60000);
      const count = await browser.evaluate(commits);
      assert.ok(count >= 2, 'the history is shown');
      assert.equal(await browser.evaluate(`${part('git-log')}.includes('packing')`), false, 'nothing was committed for the edit');
      // A full server restart: history, branch and the uncommitted change come back from the data directory.
      await t.restartHost();
      await t.reload();
      await t.tab('git');
      await browser.until('repository restored', `${part('git-branch')} === 'draft' && ${commits} === ${count} && /packing-list\\.md\\s*modified/.test(${part('git-status')})`, 30000);
      await browser.until('transcript restored', `/bootlaces/.test(${t.logText})`, 30000);
    },
  },
];
