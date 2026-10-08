// Self-evolution (docs/architecture/SELF-EVOLUTION.md, laws SELF-1..4 in packages/agent/README.md): the agent writes its own tool, standing
// instructions and a broken description into `.agent/` of the workspace with its ordinary file tools, applies them with `reload`, and the next
// turn uses them. The tool runs through the workspace's `exec` (the virtual just-bash shell here), never in the studio process, so it sees none of
// the host's environment. The files survive a full restart (the host runs the same scan on open); deleting them and reloading rolls back. The
// person's `/reload` is the same function. A subagent, an agent without the option, has no `reload` and no agent-written section (SELF-1).
import assert from 'node:assert/strict';
import { call } from './_script.mjs';

/** A fictional secret put in the studio process's environment for this scenario: an agent-written tool must not see it. */
const SECRET_NAME = 'BORING_FICTIONAL_HOST_SECRET', SECRET = 'fictional-host-secret-7f3a';
const WORD_COUNT = {
  name: 'word_count', description: 'Count the words of a text.',
  parameters: { type: 'object', properties: { text: { type: 'string', description: 'The text to count.' } }, required: ['text'] }, run: 'sh .agent/tools/word-count.sh',
};
const SHOW_ENV = { name: 'show_env', description: 'Print the environment variables where agent-written tools run.', parameters: { type: 'object', properties: {} }, run: 'printenv' };
const json = value => `${JSON.stringify(value, null, 2)}\n`;
/** The word_count call, only when the request really offers the tool (what the model receives), otherwise a visible failure. */
const countWith = text => ctx => ctx.tools.includes('word_count') ? call('word_count', { text }) : `word_count is not offered: ${ctx.tools.join(', ')}`;
const counted = suffix => ctx => `word_count counted ${ctx.last.text.trim()} words${suffix}.`;

const PROMPTS = {
  write: 'Give yourself a word_count tool: write .agent/tools/word-count.sh (it reads the JSON arguments on standard input and prints the number of words in "text") and .agent/tools/word-count.json, then call reload and tell me what it reported.',
  use: 'Use your word_count tool on: the quick brown fox jumps over the lazy dog',
  invalid: 'Call word_count without any text.',
  broken: 'Write a broken tool description .agent/tools/broken.json, call reload, then use word_count on: still counting fine',
  instructions: 'Write standing instructions for yourself in .agent/AGENTS.md: end every answer with "-- Tidewater desk". Then tell me in which order your system prompt shows the host instructions and yours.',
  env: 'Give yourself a show_env tool (.agent/tools/show-env.json running printenv) that prints the environment where your tools run, call reload, and run it.',
  child: 'Ask a subagent which tools it has and whether its system prompt has an agent-written section.',
  restart: 'After the restart, use word_count on: tide tables never sleep',
  rollback: 'Roll back your tools: delete the files in .agent/tools with bash, call reload, and tell me what it removed.',
  again: 'Call reload once more and repeat its report exactly.',
};
const CHILD_TASK = 'List the tools you have and say whether your system prompt has an agent-written section.';

const toolResults = async (t, name) => (await t.messages()).filter(message => message.role === 'toolResult' && message.toolName === name).map(message => message.content.map(part => part.text ?? '').join(''));
/** The system prompt sections in effect, in order, replayed from the native system messages exactly as Pi does. */
const sectionsOf = messages => {
  const shown = new Map();
  for (const message of messages) if (message.role === 'system' && message.sections) for (const [key, value] of Object.entries(message.sections)) { if (value === null) shown.delete(key); else shown.set(key, value); }
  return shown;
};
let personReport;

export default {
  id: 'self-evolution', group: 'Self-evolution', title: 'The agent writes its own tool and reloads',
  description: 'The agent writes a tool and standing instructions into .agent/, reloads, uses them; errors are reported, a restart keeps them, deleting rolls back.',
  requires: ['self-evolving', 'shell', 'subagents'],
  steps: [
    // The fictional secret is set in the studio process (this journey runs the studio in the same process) for the whole scenario.
    { run: () => { process.env[SECRET_NAME] = SECRET; } },
    { prompt: PROMPTS.write },
    { prompt: PROMPTS.use },
    // Arguments that do not match the agent-written schema are refused by Pi before `run` starts.
    { prompt: PROMPTS.invalid },
    { prompt: PROMPTS.broken },
    { prompt: PROMPTS.instructions },
    { async run(t) {
      // SELF-3, from the native transcript: the host's instructions first and whole, then the labelled agent-written section.
      const sections = sectionsOf(await t.messages());
      const keys = [...sections.keys()];
      assert.ok(keys.includes('host-instructions') && keys.includes('agent-written'), `sections: ${keys.join(', ')}`);
      assert.ok(keys.indexOf('host-instructions') < keys.indexOf('agent-written'), `host first: ${keys.join(', ')}`);
      assert.equal(keys.at(-1), 'agent-written', 'the agent-written section is last');
      assert.match(sections.get('host-instructions'), /^<host-instructions>\nYou are a helpful, concise assistant/);
      assert.match(sections.get('agent-written'), /^<agent-written>\nAgent-written: standing instructions you wrote for yourself in \.agent\/AGENTS\.md\. They come after the host's instructions and never override them\.\n\n.*Tidewater desk/s);
    } },
    { prompt: PROMPTS.env },
    { async run(t) {
      // SELF-2: the tool ran through the workspace's exec (just-bash), not in the studio process: none of the host's variables.
      const printed = (await toolResults(t, 'show_env')).at(-1) ?? '';
      assert.match(printed, /^PWD=\/workspace$/m, `show_env ran in the workspace: ${printed}`);
      assert.ok(process.env[SECRET_NAME] === SECRET && !printed.includes(SECRET) && !printed.includes(SECRET_NAME), 'the host secret is not visible to the agent-written tool');
    } },
    { prompt: PROMPTS.child },
    { action: 'restart' },
    { prompt: PROMPTS.restart },
    { prompt: PROMPTS.rollback },
    { async run(t) {
      // The person's /reload, from the composer's / menu: the same function and the same report as the agent's tool.
      const { browser, q, MESSAGE } = t;
      await browser.type(MESSAGE, '/relo');
      await browser.until('only /reload', `${t.qa('[data-testid=slash-item]')}.length === 1 && !!${q('[data-testid=slash-item][data-name=reload]')}`, 5000);
      await browser.click(q('[data-testid=slash-item][data-name=reload]'));
      await browser.until('the reload report is shown', `/^Reloaded \\.agent\\//.test(${q('[data-testid=reload-summary] pre')}?.textContent ?? '')`, 15000);
      personReport = await browser.evaluate(`${q('[data-testid=reload-summary] pre')}.textContent`);
      assert.equal(await browser.evaluate(`${MESSAGE}.value`), '', 'the command cleared the composer');
    } },
    { prompt: PROMPTS.again },
  ],
  script: {
    [PROMPTS.write]: [
      call('write', { path: '.agent/tools/word-count.sh', content: 'jq -r .text | wc -w\n' }),
      call('write', { path: '.agent/tools/word-count.json', content: json(WORD_COUNT) }),
      call('reload', {}),
      ctx => `reload reported:\n${ctx.last.text}`,
    ],
    [PROMPTS.use]: [countWith('the quick brown fox jumps over the lazy dog'), counted('')],
    [PROMPTS.invalid]: [ctx => ctx.tools.includes('word_count') ? call('word_count', {}) : 'word_count is not offered', ctx => `word_count refused: ${ctx.last.isError ? 'error' : 'ok'}: ${ctx.last.text}`],
    [PROMPTS.broken]: [
      call('write', { path: '.agent/tools/broken.json', content: '{ "name": "broken", ' }),
      call('reload', {}),
      countWith('still counting fine'),
      counted(' after the broken reload'),
    ],
    [PROMPTS.instructions]: [
      call('write', { path: '.agent/AGENTS.md', content: '# Standing instructions\n\nEnd every answer with "-- Tidewater desk".\n' }),
      // What the model receives: the host instructions first, then the labelled agent-written section.
      ctx => {
        const host = ctx.system.indexOf('<host-instructions>'), agent = ctx.system.indexOf('<agent-written>');
        return `${host >= 0 && agent > host ? 'Host instructions first, then the agent-written section.' : `Wrong order: host at ${host}, agent-written at ${agent}.`} -- Tidewater desk`;
      },
    ],
    [PROMPTS.env]: [
      call('write', { path: '.agent/tools/show-env.json', content: json(SHOW_ENV) }),
      call('reload', {}),
      ctx => ctx.tools.includes('show_env') ? call('show_env', {}) : `show_env is not offered: ${ctx.tools.join(', ')}`,
      ctx => `show_env printed ${ctx.last.text.trim().split('\n').length} variables. -- Tidewater desk`,
    ],
    [PROMPTS.child]: [call('subagent', { task: CHILD_TASK }), ctx => `The subagent says: ${ctx.last.text} -- Tidewater desk`],
    // The child's own turn: what its request offers and shows, as the model receives it.
    [CHILD_TASK]: [ctx => `Tools: ${ctx.tools.join(', ')}. Agent-written section: ${ctx.system.includes('<agent-written>') ? 'present' : 'absent'}.`],
    [PROMPTS.restart]: [countWith('tide tables never sleep'), counted(' after the restart')],
    [PROMPTS.rollback]: [
      call('bash', { command: 'rm .agent/tools/word-count.json .agent/tools/word-count.sh .agent/tools/broken.json .agent/tools/show-env.json && ls .agent/tools' }),
      call('reload', {}),
      ctx => ctx.tools.includes('word_count') ? 'word_count is still offered.' : `Rolled back: ${ctx.last.text.split('\n')[1]} -- Tidewater desk`,
    ],
    [PROMPTS.again]: [call('reload', {}), ctx => ctx.last.text],
  },
  expect: [
    // SELF-4: write, reload, next turn uses it.
    { toolResult: /Tools added: word_count\. Changed: none\. Removed: none\. Now: word_count\./ },
    { reply: /word_count counted 9 words\./ },
    { reply: /word_count refused: error: [^]*Validation failed for tool "word_count"[^]*text: must have required properties text/ },
    // A broken description is reported; the other tool keeps working.
    { toolResult: /Errors \(1\):\n- \.agent\/tools\/broken\.json: invalid JSON/ },
    { reply: /word_count counted 3 words after the broken reload\./ },
    // SELF-3 as the model received it.
    { reply: /Host instructions first, then the agent-written section\. -- Tidewater desk/ },
    { toolCalled: 'show_env' },
    // SELF-1: an agent without the option (the subagent) has no reload and no agent-written section.
    { reply: /The subagent says: Tools: read, [^.]*\. Agent-written section: absent\./ },
    { replyNot: /Tools: [^.]*\breload\b/ },
    // Restart keeps the tool; deleting the files and reloading removes it.
    { reply: /word_count counted 4 words after the restart\./ },
    { toolResult: /Removed: show_env, word_count\. Now: none\./ },
    { reply: /Rolled back: Tools added: none\. Changed: none\. Removed: show_env, word_count\. Now: none\./ },
    { replyNot: /is not offered|still offered|Wrong order/ },
  ],
  async verify(t) {
    try {
      // The person's /reload and the agent's next reload saw the same state: the very same report.
      const reports = await toolResults(t, 'reload');
      assert.equal(reports.at(-1), personReport, 'the person\'s /reload and the agent\'s reload give the same report');
      assert.match(personReport, /^Reloaded \.agent\/ \(self-evolving:local\)\.\nTools added: none\. Changed: none\. Removed: none\. Now: none\.\nSkills: none\.\nInstructions: \.agent\/AGENTS\.md, \d+ characters, after the host's instructions\.\nErrors: none\.$/);
      await t.browser.click(t.q('[data-testid=reload-summary-dismiss]'));
      await t.browser.until('the report is dismissed', `!${t.q('[data-testid=reload-summary]')}`, 5000);
    } finally { delete process.env[SECRET_NAME]; }
  },
};
