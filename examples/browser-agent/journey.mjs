// End-to-end journey for the in-browser coding agent in headless Chromium.
//   CHROMIUM=/path/to/chrome-headless-shell npm run browser-agent:journey
// With the keyless scripted model (`?scripted`), the agent builds a todo app: it writes index.html with Pi's write
// tool, checks it in just-bash, measures it with run_code (pi-codemode's QuickJS in a nested worker) and commits it
// with git, all inside the tab. The journey then checks the preview, the git log, that the server saw no /api request,
// and that a reload restores the conversation and the repository from SQLite in the browser.
// It then drives the approval gate against a fictional same-origin notes API: reads are free; a POST shows an approval
// card and waits; Deny changes nothing and tells the model; Approve runs it; a pending approval survives a page reload;
// and code mode (run_code) cannot make the change at all. Then OptChat memory: switched on for the root conversation from
// the chat header, a request carries one message (the view plus the current one) and no earlier turn, a fact told earlier
// is recalled from the view, the model zooms a view line down to the exact message, and switching it off sends the plain
// transcript again. Finally the model-access popover saves an API key and starts the ChatGPT device-code sign-in (a code from
// a local stand-in for OpenAI's sign-in endpoints, never completed; no production service is contacted). A second tab of the same profile gets the one-tab message, the approval card
// shows the stored summary with the raw arguments collapsed, and the repository (changed and deleted files, an empty
// folder) is restored from SQLite after a reload.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '@hachej/boring-testing/browser';
import { serveBrowserAgent } from './serve.mjs';

const evidence = process.env.BROWSER_AGENT_EVIDENCE ?? '.cache/evidence/browser-agent';
mkdirSync(evidence, { recursive: true });
const app = await serveBrowserAgent();
const steps = [];
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

const MESSAGE = `document.querySelector('[data-testid=composer-input]')`;
const SUBMIT = `document.querySelector('[data-testid=composer-submit]')`;
const idle = `${SUBMIT}?.dataset.state === 'send'`;
const logText = `(document.querySelector('[data-testid=transcript]')?.innerText ?? '')`;
const tab = name => `document.querySelector('[data-tab="${name}"]')`;
const connected = `document.querySelector('[data-testid=connection]')?.dataset.state === 'connected'`;

let browser;
try {
  browser = await launch(`${app.url}?scripted`, { evidence });
  await browser.until('agent started in the tab', connected, 60000);

  await step('browser agent: the tab is cross-origin isolated and stores the session in SQLite on OPFS', async () => {
    await browser.click(tab('Settings'));
    await browser.until('settings', `/SQLite in this browser \\(OPFS\\)/.test(document.querySelector('.ba-settings')?.innerText ?? '') && /cross-origin isolated: true/.test(document.querySelector('.ba-settings')?.innerText ?? '')`);
    assert.equal(await browser.evaluate('crossOriginIsolated'), true);
  });

  await step('browser agent: a second tab gets a readable one-tab message and the first tab keeps working', async () => {
    const second = await browser.openTab(`${app.url}?scripted`);
    try {
      await second.until('one-tab message in the second tab', `Boolean(document.querySelector('[data-testid=ba-locked]'))`, 60000);
      const message = await second.evaluate(`document.querySelector('[data-testid=ba-locked]').innerText`);
      assert.match(message, /already open in another tab/i);
      assert.doesNotMatch(message, /NoModificationAllowed|Error:|\n\s+at /, 'a sentence for the person, not a stack');
      assert.equal(await second.evaluate(`Boolean(document.querySelector('[data-testid=composer-input]'))`), false, 'the second tab does not start a second agent');
    } finally { await second.close(); }
    assert.equal(await browser.evaluate(connected), true, 'the first tab is unaffected');
  });

  await step('browser agent: builds, checks, measures and commits a todo app with native tools, bash, code mode and git', async () => {
    await browser.type(MESSAGE, 'Build a small todo app in index.html, check it, and commit it.');
    await browser.click(SUBMIT);
    await browser.until('finished', `${idle} && /Built a todo app in index.html \\(\\d+ bytes, 2 starter items\\)/.test(${logText})`, 60000);
    const tools = await browser.evaluate(`[...document.querySelectorAll('[data-testid=transcript] [data-testid=tool-name]')].map(e => e.textContent.trim())`);
    for (const name of ['write', 'bash', 'run_code']) assert.ok(tools.some(tool => tool.includes(name)), `tool card ${name} in ${tools.join(', ')}`);
    await browser.click(tab('Git'));
    await browser.until('commit in git log', `/Add a todo app/.test(document.querySelector('[data-testid=ba-git-log]')?.innerText ?? '')`);
    await browser.click(tab('Preview'));
    await browser.until('preview shows the app', `/Water the fictional plants/.test(document.querySelector('[data-testid=ba-preview]')?.getAttribute('srcdoc') ?? '')`);
    await new Promise(resolve => setTimeout(resolve, 500));
    await browser.screenshot('browser-agent-built.png');
  });

  await step('browser agent: the page (UI) bundle carries no kernel; Pi, models, SQLite, code mode and the workspace are only in the agent worker (BORING-PI-5)', async () => {
    assert.ok(app.pageInputs.length > 100, 'the page bundle inputs are known');
    const kernel = app.pageInputs.filter(path => /@earendil-works\/(pi-durable|pi-codemode|pi-ai\/(?!dist\/types))|@sqlite\.org|just-bash|isomorphic-git|packages\/(agent|execution)\/|packages\/browser\/(dist|src)\/(?!transport)/.test(path));
    assert.deepEqual(kernel, [], 'no kernel or worker-only module in the UI bundle');
  });

  await step('browser agent: the server only served static files; the agent made no request to it', async () => {
    const dynamic = app.requests.filter(request => !/^GET \/(|index\.html|app\.js|agent-worker\.js|codemode-worker\.js|sqlite3-opfs-async-proxy\.js|styles\.css|vendor\/(sqlite3|quickjs)\.wasm|favicon\.ico)$/.test(request));
    assert.deepEqual(dynamic, []);
  });

  await step('browser agent: a reload restores the conversation and the repository from SQLite in the browser', async () => {
    await browser.evaluate('location.reload()');
    await browser.until('agent restarted', connected, 60000);
    await browser.until('transcript restored', `/Built a todo app/.test(${logText})`);
    await browser.click(tab('Files'));
    await browser.until('files restored', `[...document.querySelectorAll('[data-testid=ba-files] button')].map(b => b.textContent).join(',') === 'README.md,index.html'`);
    await browser.click(`[...document.querySelectorAll('[data-testid=ba-files] button')].find(b => b.textContent === 'index.html')`);
    await browser.until('file text', `/Call the placeholder plumber/.test(document.querySelector('[data-testid=ba-file-text]')?.textContent ?? '')`);
    await browser.click(tab('Git'));
    await browser.until('git restored', `/Add a todo app/.test(document.querySelector('[data-testid=ba-git-log]')?.innerText ?? '')`);
  });

  const prompt = async text => { await browser.type(MESSAGE, text); await browser.click(SUBMIT); };
  await step('browser repository: a changed file, a deleted file and an empty folder are SQLite rows as soon as they are written and are back after a reload', async () => {
    await prompt('Tidy the repository.');
    await browser.until('tidied', `${idle} && /Tidied the repository\\./.test(${logText})`, 60000);
    await browser.evaluate('location.reload()');
    await browser.until('agent restarted', connected, 60000);
    await browser.click(tab('Files'));
    await browser.until('README.md deleted, index.html kept', `[...document.querySelectorAll('[data-testid=ba-files] button')].map(b => b.textContent).join(',') === 'index.html'`);
    await browser.click(`[...document.querySelectorAll('[data-testid=ba-files] button')].find(b => b.textContent === 'index.html')`);
    await browser.until('changed file restored', `/<!-- tidied -->/.test(document.querySelector('[data-testid=ba-file-text]')?.textContent ?? '')`);
    await prompt('Show the folders in notes.');
    await browser.until('empty folder restored', `${idle} && /Folders in notes: drafts/.test(${logText})`, 60000);
    await browser.click(tab('Git'));
    await browser.until('history restored', `/Add a todo app/.test(document.querySelector('[data-testid=ba-git-log]')?.innerText ?? '')`);
  });
  const cards = `[...document.querySelectorAll('[data-testid=approval-card]')]`;
  const lastCard = `${cards}.at(-1)`;
  const notes = () => app.fixture.notes.map(note => note.title);
  const posts = () => app.requests.filter(request => request === 'POST /fixture/api/notes').length;
  const FIXTURE_TITLES = ['Water the fictional plants', 'Call the placeholder plumber'];

  await step('approval gate: reading the site API is free and shows no approval card', async () => {
    await prompt('List the notes in the fixture API.');
    await browser.until('notes listed', `${idle} && /The fixture API returned: .*Call the placeholder plumber/.test(${logText})`, 60000);
    assert.equal(await browser.evaluate(`${cards}.length`), 0);
    const tools = await browser.evaluate(`[...document.querySelectorAll('[data-testid=transcript] [data-testid=tool-name]')].map(e => e.textContent.trim())`);
    assert.ok(tools.some(tool => tool.includes('api_get')), `api_get card in ${tools.join(', ')}`);
    assert.equal(app.requests.filter(request => request === 'GET /fixture/api/notes').length, 1);
    assert.equal(posts(), 0);
  });

  await step('approval gate: a POST waits behind an approval card, and Deny leaves the data unchanged and tells the model', async () => {
    await prompt("Add the note 'Deny me' to the fixture API.");
    await browser.until('approval card pending', `${lastCard}?.dataset.state === 'pending'`, 60000);
    assert.match(await browser.evaluate(`${lastCard}.innerText`), /api_request/);
    assert.match(await browser.evaluate(`${lastCard}.innerText`), /Deny me/, 'the card shows the real arguments');
    assert.equal(await browser.evaluate(`${lastCard}.querySelector('[data-testid=approval-summary]')?.innerText`), 'Send POST /fixture/api/notes with {"title":"Deny me"}', 'the summary requireApproval stored is the card headline');
    assert.equal(await browser.evaluate(`${lastCard}.querySelector('[data-testid=approval-details]').open`), false, 'the raw arguments are collapsed under it');
    await browser.click(`${lastCard}.querySelector('[data-testid=approval-details] summary')`);
    await browser.until('raw arguments open', `${lastCard}.querySelector('[data-testid=approval-details]').open && /Deny me/.test(${lastCard}.querySelector('[data-testid=approval-args]').innerText)`);
    await browser.screenshot('browser-agent-approval-pending.png');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual(notes(), FIXTURE_TITLES, 'nothing changed while the card is pending');
    assert.equal(posts(), 0);
    await browser.click(`${lastCard}.querySelector('[data-testid=approval-deny]')`);
    await browser.until('model told of the denial', `${idle} && /The change was denied, so I did not add 'Deny me'/.test(${logText})`, 60000);
    assert.equal(await browser.evaluate(`${lastCard}.dataset.state`), 'denied');
    assert.deepEqual(notes(), FIXTURE_TITLES);
    assert.equal(posts(), 0, 'the server never saw the POST');
    const listed = await (await fetch(new URL('/fixture/api/notes', app.url))).json();
    assert.deepEqual(listed.map(note => note.title), FIXTURE_TITLES);
  });

  await step('approval gate: a second POST approved from the card creates the note', async () => {
    await prompt("Add the note 'Approve me' to the fixture API.");
    await browser.until('second approval card pending', `${cards}.length === 2 && ${lastCard}.dataset.state === 'pending'`, 60000);
    assert.deepEqual(notes(), FIXTURE_TITLES);
    await browser.click(`${lastCard}.querySelector('[data-testid=approval-approve]')`);
    await browser.until('note created', `${idle} && /Added the note: HTTP 201/.test(${logText})`, 60000);
    assert.equal(await browser.evaluate(`${lastCard}.dataset.state`), 'approved');
    assert.equal(await browser.evaluate(`${lastCard}.querySelector('[data-testid=approval-summary]')?.innerText`), 'Send POST /fixture/api/notes with {"title":"Approve me"}', 'the summary stays on the decided card');
    const listed = await (await fetch(new URL('/fixture/api/notes', app.url))).json();
    assert.deepEqual(listed.map(note => note.title), [...FIXTURE_TITLES, 'Approve me']);
    assert.equal(posts(), 1);
    await browser.screenshot('browser-agent-approval-approved.png');
  });

  await step('approval gate: a pending approval survives a page reload and can still be answered', async () => {
    await prompt("Add the note 'After reload' to the fixture API.");
    await browser.until('third approval card pending', `${cards}.length === 3 && ${lastCard}.dataset.state === 'pending'`, 60000);
    const callId = await browser.evaluate(`${lastCard}.dataset.callId`);
    await browser.evaluate('location.reload()');
    await browser.until('agent restarted', connected, 60000);
    await browser.until('the same card is still pending', `${cards}.length === 3 && ${lastCard}.dataset.state === 'pending' && ${lastCard}.dataset.callId === ${JSON.stringify(callId)}`, 60000);
    assert.equal(notes().includes('After reload'), false, 'the change did not run on recovery');
    assert.equal(posts(), 1);
    await browser.click(`${lastCard}.querySelector('[data-testid=approval-approve]')`);
    await browser.until('note created after reload', `${idle} && /Added the note: HTTP 201.*After reload/.test(${logText})`, 60000);
    assert.deepEqual(notes(), [...FIXTURE_TITLES, 'Approve me', 'After reload']);
    assert.equal(posts(), 2, 'exactly one more POST');
  });

  await step('approval gate: run_code cannot make the change, and asks nothing', async () => {
    const before = notes().length;
    await prompt("Use run_code to add the note 'Sneaky' to the fixture API.");
    await browser.until('code mode answered', `${idle} && /The code sandbox could not change the site/.test(${logText})`, 60000);
    assert.equal(await browser.evaluate(`${cards}.length`), 3, 'no new approval card: the script never reached a gated tool');
    assert.equal(notes().length, before);
    assert.equal(notes().includes('Sneaky'), false);
    assert.equal(posts(), 2);
    const outcome = (await browser.evaluate(`${logText}`)).split('The code sandbox').at(-1);
    assert.match(outcome, /api_request does not exist\. Available: list_files, read_file, write_file, api_get, bash/, 'run_code lists the read tools only, not the gated one');
    assert.match(outcome, /"fetch":"[^"]*(not defined|not a function)/i, 'and has no fetch');
    assert.match(outcome, /"call":"[^"]*does not exist/, 'calling the gated tool from code fails');
  });

  const toggle = `document.querySelector('[data-testid=ba-memory-toggle]')`;
  await step('OptChat memory: off by default, switched on from the chat header for the root conversation', async () => {
    assert.equal(await browser.evaluate(`${toggle}.checked`), false);
    await browser.click(tab('Memory'));
    await browser.until('memory off notice', `Boolean(document.querySelector('[data-testid=ba-memory-off]'))`);
    await browser.click(toggle);
    await browser.until('memory on', `${toggle}.checked && Boolean(document.querySelector('[data-testid=ba-memory]'))`);
    await prompt('Remember: my dog is called Biscuit.');
    await browser.until('noted', `${idle} && /Noted\\./.test(${logText})`, 60000);
    await prompt('Remember: the Q4 launch is codenamed Lantern.');
    await browser.until('noted again', `${idle} && (${logText}.match(/Noted\\./g) ?? []).length >= 2`, 60000);
  });

  await step('OptChat memory: the request holds the view and the current message only, and a fact from an earlier turn comes back through the view', async () => {
    await prompt('What is my dog called? Describe your request.');
    await browser.until('answered from the view', `${idle} && /Your dog is Biscuit\\. Request: 1 messages, 0 assistant, view yes\\./.test(${logText})`, 60000);
    await browser.until('view and summaries in the panel', `document.querySelectorAll('[data-testid=ba-view] li').length > 0 && /[1-9]\\d* summaries/.test(document.querySelector('[data-testid=ba-memory-stats]')?.textContent ?? '')`, 30000);
    const shown = await browser.evaluate(`document.querySelector('[data-testid=ba-view]').innerText`);
    assert.match(shown, /Water the fictional plants|todo/i, 'the todo-app turns from before memory was switched on are in the view');
    assert.match(shown, /my dog is called Biscuit/);
    assert.match(shown, /Used write|Added the note/i, 'the long tool and answer messages are summarized, not dropped');
    await browser.screenshot('browser-agent-memory.png');
  });

  await step('OptChat memory: the model zooms a view line down to the exact original message', async () => {
    await prompt('Use zoom to reopen the message about my dog.');
    await browser.until('zoomed to the message', `${idle} && /Opened: \\d+\\+0\\|user: Remember: my dog is called Biscuit\\./.test(${logText})`, 60000);
    const tools = await browser.evaluate(`[...document.querySelectorAll('[data-testid=transcript] [data-testid=tool-name]')].map(e => e.textContent.trim())`);
    assert.ok(tools.some(tool => tool.includes('zoom')), `zoom card in ${tools.join(', ')}`);
  });

  await step('OptChat memory: it survives a reload, and switching it off sends the plain transcript again', async () => {
    await browser.evaluate('location.reload()');
    await browser.until('agent restarted', connected, 60000);
    await browser.until('still on after reload', `${toggle}?.checked === true`, 30000);
    await browser.click(toggle);
    await browser.until('memory off', `${toggle}.checked === false`, 30000);
    await prompt('What is my dog called? Describe your request.');
    await browser.until('plain transcript', `${idle} && /Your dog is Biscuit\\. Request: (\\d+) messages, [1-9]\\d* assistant, view no\\./.test(${logText})`, 60000);
    assert.ok(Number(/Request: (\d+) messages, \d+ assistant, view no/.exec(await browser.evaluate(logText))[1]) > 20, 'the whole transcript, tool steps included');
    await browser.click(tab('Memory'));
    await browser.until('off notice', `Boolean(document.querySelector('[data-testid=ba-memory-off]'))`);
  });

  await step('browser agent: the model-access popover saves an API key, selects that provider and lists every registered provider; the gateway refuses other hosts', async () => {
    await browser.click(`document.querySelector('[data-testid=provider-setup-trigger]')`);
    await browser.until('popover open', `Boolean(document.querySelector('[data-testid=provider-setup-panel]'))`);
    const options = await browser.evaluate(`[...document.querySelectorAll('[data-testid=provider-select] option')].map(option => option.value)`);
    for (const id of ['scripted', 'openai', 'anthropic', 'openai-codex']) assert.ok(options.includes(id), `${id} in ${options.join(',')}`);
    await browser.evaluate(`(() => { const select = document.querySelector('[data-testid=provider-select]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(select, 'openai'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.until('openai models listed', `document.querySelector('[data-testid=model-select]')?.value === 'gpt-6-sol' && !document.querySelector('[data-testid=key-saved]')`);
    await browser.type(`document.querySelector('[data-testid=api-key-input]')`, 'sk-fictional-not-a-real-key');
    await browser.click(`document.querySelector('[data-testid=provider-save]')`);
    await browser.until('openai selected and key saved', `document.querySelector('[data-testid=ba-model]')?.textContent === 'openai/gpt-6-sol' && Boolean(document.querySelector('[data-testid=key-saved]')) && document.querySelector('[data-testid=api-key-input]').value === ''`);
    // The ChatGPT subscription provider is listed with a gateway note.
    await browser.evaluate(`(() => { const select = document.querySelector('[data-testid=provider-select]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(select, 'openai-codex'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.until('login offered with the gateway note', `Boolean(document.querySelector('[data-testid=provider-login]')) && /web page/.test(document.querySelector('[data-testid=gateway-note]')?.innerText ?? '')`);
    const refused = await fetch(new URL('/gateway/example.com/', app.url));
    assert.equal(refused.status, 403);
    await browser.screenshot('browser-agent-settings.png');
  });

  await step('browser agent: "Sign in with ChatGPT" runs pi-ai\'s bundled device-code flow in the worker and shows the code (fixture endpoint, no production call)', async () => {
    // pi-ai loads its OAuth flows through an import a bundler cannot follow; openBrowserModels registers them. In the journey
    // (scripted mode) the worker sends OpenAI's sign-in endpoints to the dev server's fixture, so no production service is used.
    const before = app.requests.length;
    await browser.click(`document.querySelector('[data-testid=provider-login]')`);
    const outcome = await browser.until('a device code, or a failure', `(() => {
      const code = document.querySelector('[data-testid=device-code]')?.textContent;
      const failed = document.querySelector('[data-testid=login-failed]')?.textContent;
      return code ? { code, uri: document.querySelector('[data-testid=login-pending] a')?.href } : failed ? { failed } : null; })()`, 60000);
    assert.equal(outcome.failed, undefined, `ChatGPT sign-in failed: ${outcome.failed}`);
    assert.equal(outcome.code, 'FIXT-0001', 'the code issued by the fixture');
    assert.equal(new URL(outcome.uri).host, 'auth.openai.com', 'the page the person would open is pi-ai\'s own verification URL');
    assert.ok(app.requests.slice(before).includes('POST /fixture/openai-auth/api/accounts/deviceauth/usercode'), 'the bundled flow made its request, to the fixture');
    await browser.screenshot('browser-agent-device-code.png');
  });

  assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource|ERR_CONNECTION|net::|network error/i.test(problem)), []);
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify({ steps, requests: app.requests }, null, 2));
  console.log(JSON.stringify({ steps }, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) { await browser.screenshot('last.png').catch(() => {}); await browser.close(); }
  await app.close();
  process.exit(process.exitCode ?? 0);
}
