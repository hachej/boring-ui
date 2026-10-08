# @hachej/boring-testing

What an app built on boring-ui v4 needs to test its agent and UI without a real model: a scripted keyless model, a headless-Chromium
driver and network faults. Node only, no dependency beyond `@earendil-works/pi-ai` (peer). The studio, the other examples and the
repository's own tests use exactly these modules.

## The whole thing in 30 lines

An app's agent answered by the scripted model, driven in headless Chromium, behind an idle-closing proxy
(`CHROMIUM=/path/to/chrome-headless-shell node journey.mjs`; `npm run test:testing-consumer` runs this very block in an isolated install).

```js
import { createServer } from 'node:http';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createScriptedModel, launch, q, startIdleProxy } from '@hachej/boring-testing';

const scripted = createScriptedModel({ script: { 'Plan a picnic': ['Bring a blanket and a thermos.'] } });
const agent = defineAgent({ id: 'planner', model: scripted.model });
const registry = createRegistry(); agent.install(registry);
const harness = await Harness.open(new MemoryStorage(), { registry, models: scripted.models }, context);
const app = createServer(async (request, response) => {
  const prompt = new URL(request.url, 'http://app').searchParams.get('q');
  let answer = '';
  if (prompt) {
    const conversation = await agent.createConversation(harness, context);
    await (await conversation.submit({ type: 'input', requestId: 'ask', content: prompt }, context)).wait(context);
    answer = (await conversation.context(context)).entries.flatMap(entry => entry.model ?? []).at(-1).content[0].text;
  }
  response.setHeader('content-type', 'text/html');
  response.end(`<form><input name=q value="Plan a picnic"><button>Ask</button></form><output>${answer}</output>`);
});
await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
const proxy = await startIdleProxy({ target: `http://127.0.0.1:${app.address().port}`, idleMs: 2000 });
const browser = await launch(proxy.url);
try {
  await browser.click(q('button'));
  await browser.until('the agent answered', `${q('output')}?.textContent === 'Bring a blanket and a thermos.'`);
  if (scripted.misses.length) throw new Error(scripted.misses.join('\n'));
  console.log('PASS: scripted answer shown through the proxy', proxy.stats);
} finally { await browser.close(); await proxy.close(); app.closeAllConnections(); app.close(); await harness.close(context); }
```

## Scripted model (`@hachej/boring-testing/model`)

`createScriptedModel({ script?, sources?, generic?, fallback?, models?, provider?, api?, misses? })` returns `{ models, model, definitions, misses }`:
a pi-ai `Models` collection with one keyless provider (pass `models` to `Harness.open`, `model` to `defineAgent`). Its messages are built
with pi-ai's faux builders and `createFauxCore` normalizes the model definitions (`FauxModelDefinition`; `cost` prices usage). For a fixed
queue of answers use pi-ai's `fauxProvider` directly; this adds answers chosen by the prompt they reply to, explicit chunks and pacing,
abortable delays, priced usage, failures and turns a test drives by hand.

- `script: { 'text in the user message': turns }`, or `sources: [{ name, entries: [{ match, turns }] }]` when several scripts share one
  model (the source answering most of the conversation's user messages is chosen; the earliest, then longest, match in the last user
  message picks the entry).
- The turns answer that message in order: a user message starts turn 0 and every tool result starts the next one. A turn is `'text'`;
  `{ text, reasoning, tools: [{ name, args, id?, ms? }], delay, hold, usage: { input, output }, error }` (a tool's `ms` streams its arguments' JSON in
  small chunks that far apart, so the live call holds partial arguments as with a real provider); `{ text: { chunks, ms } }` (streamed in
  those chunks, `ms` apart, abortable; `chunks` may be an async iterable); or `ctx => turn`, where `ctx` has `user`, `input`, `results`,
  `last` (each `{ name, args, text, json, isError, details }`), `history`, `messages`, `tools`, `system`, `context` and `signal`.
- `generic` rules answer prompts no script answers (default `GENERIC_RULES`: "Reply with exactly: X" and the streamed number essay;
  `answeredGenerically(prompt)` tells whether one applies). `fallback(ctx)` answers everything else. Otherwise a message nothing answers is
  a miss: the model says so in the transcript and `misses` records it, so a journey ends with `assert.deepEqual(misses, [])`.
- `createFakeChatModel({ cost? })` is the hand-driven variant: `await nextCall()` gives `{ transcript, signal, aborted, append(text),
  respond(text, usage?) }` for each model call, and the stream advances only when the test appends or responds.

## Headless browser (`@hachej/boring-testing/browser`)

`launch(url, { chromium?, evidence?, args? })` starts Chromium (default `CHROMIUM`) with a throwaway profile over the DevTools protocol, no
other dependency. Expressions are page JavaScript: `q(selector)` and `qa(selector)` build them. It returns `evaluate`, `until(label,
expression, timeout?)` (waits for what the page shows, then fails with the page text and its errors), real input (`click`, `tap`, `type`,
`press`, `drag`, `hover`, `wheel`, `attachFiles`), `emulate('phone' | 'tablet' | 'desktop')` (390x844 touch phone), `screenshot(name)` into
`evidence`, `openTab(url, { hidden? })` (same profile, background-tab visibility), `frameEvaluate` for sandboxed iframes, `reload`,
`problems` (uncaught exceptions and `console.error`) and `close`. `insecureUrl(url)` swaps `127.0.0.1` for `insecure.test`, which the
browser reaches but treats as an insecure context (no `crypto.randomUUID`, clipboard or share), like a plain-HTTP deployment.

## Network faults (`@hachej/boring-testing/network`)

- `startIdleProxy({ target, idleMs?, port? })` is a TCP proxy that closes every connection silent for `idleMs` (an AWS ALB does after
  60 s), with `stats`, `cut()` (drop everything, like a proxy restart) and `close()`. Put the app behind it to prove streams survive
  through heartbeats and reconnect when dropped.
- `withSubmitFaults(handler, { delayMs?, refuse?, message?, isSubmit? })` wraps any web handler: it returns `{ handler, faults }`, and
  while `faults.refuse` > 0 a submit is answered 402 `submission-refused` without reaching the handler; `faults.delayMs` holds every
  submit's answer after the handler handled it. A submit is `?op=submit` (the `@hachej/boring-agent/chat-transport` protocol) unless `isSubmit`
  says otherwise. Change `faults` at run time from the journey.
