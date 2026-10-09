// A keyless scripted model for the journey (`?scripted` in the page URL). It plays a short coding session from what each
// request contains: write a page, check it with bash, measure it with run_code, commit it, then report. It also reads a
// fictional notes API and asks to change it (which the person must approve). It is also the OptChat summarizer, and answers
// questions about a dog only from what its request holds, so the journey can see what memory puts in front of a model.
import { createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

const MODEL = { id: 'scripted', name: 'Scripted', provider: 'scripted', api: 'scripted-api', baseUrl: 'https://fixture.invalid',
  input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const textOf = message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');

export const TODO_APP = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Todo</title>
<style>body{font:16px system-ui;margin:2rem auto;max-width:28rem}li{padding:.25rem 0}</style></head>
<body><h1>Todo</h1>
<form id="add"><input id="item" placeholder="Something to do" aria-label="New item"> <button>Add</button></form>
<ul id="list"><li>Water the fictional plants</li><li>Call the placeholder plumber</li></ul>
<script>document.getElementById('add').onsubmit = event => { event.preventDefault(); const input = document.getElementById('item');
if (!input.value.trim()) return; const li = document.createElement('li'); li.textContent = input.value; document.getElementById('list').append(li); input.value = ''; };</script>
</body></html>
`;

/** The note title a prompt asks for: the text inside the first pair of single quotes. */
const noteTitle = prompt => /'([^']+)'/.exec(prompt)?.[1] ?? 'Untitled';
const postNote = title => ({ tool: ['api_request', { method: 'POST', path: '/fixture/api/notes', body: { title } }] });

// What each turn does, chosen from the person's latest message. The model sees the whole transcript, so every step looks at
// the tool results of the current turn only (everything after that message).
function decide(messages, request) {
  // The OptChat summarizer (context block, then the step): keep what the person said.
  if (request.messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.startsWith('You write the memory of'))) {
    const step = messages[0].content.at(-1).text.split(/in at most \d+ bytes:\n/)[1] ?? '';
    const said = [...step.matchAll(/user: (.*?)(?= talk: | tool: | echo: |$)/gm)].map(match => match[1]).join(' | ');
    return { text: (said || step.replace(/\s+/g, ' ')).slice(0, 400) };
  }
  const start = messages.findLastIndex(message => message.role === 'user');
  // With OptChat memory on, the user message starts with the view: what the person just wrote comes after it.
  const prompt = textOf(messages[start]).split('</chat>').at(-1);
  const turn = messages.slice(start + 1);
  const last = turn.at(-1);
  const resultOf = name => turn.findLast(message => message.role === 'toolResult' && message.toolName === name);
  const everything = messages.map(textOf).join('\n');

  if (/^Remember:/.test(prompt.trim())) return { text: 'Noted.' };
  if (/what is my dog called/i.test(prompt)) {
    const dog = /dog is called (\w+)/.exec(everything)?.[1] ?? 'unknown';
    return { text: `Your dog is ${dog}. Request: ${messages.length} messages, ${messages.filter(message => message.role === 'assistant').length} assistant, view ${everything.includes('<chat>') ? 'yes' : 'no'}.` };
  }
  if (/use zoom/i.test(prompt)) {
    // Walk the line about the dog down to its message: each zoom opens one level.
    const line = (last?.role === 'toolResult' ? textOf(last) : everything).split('\n').filter(item => /^\d+\+\d+\|/.test(item) && /dog is called/.test(item)).at(-1);
    if (!line) return { text: 'No line about a dog.' };
    const [, id, n] = /^(\d+)\+(\d+)\|/.exec(line);
    return n === '0' ? { text: `Opened: ${line}` } : { tool: ['zoom', { id: Number(id), n: Number(n) }] };
  }

  // Repository persistence: change a file, delete one and leave an empty folder; a later turn reads the folder back after a reload.
  if (/tidy the repository/i.test(prompt)) {
    if (!last) return { tool: ['bash', { command: "mkdir -p notes/drafts && rm README.md && echo '<!-- tidied -->' >> index.html" }] };
    return { text: 'Tidied the repository.' };
  }
  if (/show the folders/i.test(prompt)) {
    if (!last) return { tool: ['bash', { command: 'ls notes' }] };
    return { text: `Folders in notes: ${textOf(last).trim()}` };
  }
  if (/api_get|list the notes/i.test(prompt)) {
    if (!last) return { tool: ['api_get', { path: '/fixture/api/notes' }] };
    return { text: `The fixture API returned: ${textOf(last).replace(/\s+/g, ' ').slice(0, 160)}` };
  }
  if (/run_code.*(note|post)/i.test(prompt)) {
    // A code-mode script has no way to change data: no fetch, and the sandbox tools are read-only.
    if (!last) return { tool: ['run_code', { code: `const outcome = {};
try { outcome.tool = typeof tools.api_request; } catch (error) { outcome.tool = String(error); }
try { await fetch('/fixture/api/notes', { method: 'POST', body: '{"title":"Sneaky"}' }); outcome.fetch = 'sent'; } catch (error) { outcome.fetch = String(error.message ?? error); }
try { await tools.api_request({ method: 'POST', path: '/fixture/api/notes', body: { title: 'Sneaky' } }); outcome.call = 'sent'; } catch (error) { outcome.call = String(error.message ?? error); }
return outcome;` }] };
    return { text: `The code sandbox could not change the site: ${textOf(last).replace(/\s+/g, ' ').slice(0, 900)}` };
  }
  if (/add the note|create the note/i.test(prompt)) {
    if (!last) return postNote(noteTitle(prompt));
    const text = textOf(last);
    return { text: /^Denied by the person/.test(text) ? `The change was denied, so I did not add '${noteTitle(prompt)}'.` : `Added the note: ${text.replace(/\s+/g, ' ').slice(0, 120)}` };
  }

  if (last?.role === 'toolResult') {
    const result = textOf(last);
    if (last.toolName === 'write') return { tool: ['bash', { command: 'ls && grep -c "<li>" index.html' }] };
    if (last.toolName === 'bash' && !/committed|\[main/.test(result) && !resultOf('run_code')) {
      return { tool: ['run_code', { code: 'const files = await tools.list_files({});\nconst html = await tools.read_file({ path: "index.html" });\nreturn { files: files.length, bytes: html.length, items: (html.match(/<li>/g) ?? []).length };' }] };
    }
    if (last.toolName === 'run_code') return { tool: ['bash', { command: 'git add index.html && git commit -m "Add a todo app" && git log' }] };
    const { bytes, items } = JSON.parse(textOf(resultOf('run_code')));
    return { text: `Built a todo app in index.html (${bytes} bytes, ${items} starter items), checked it with bash and run_code, and committed it.` };
  }
  if (/todo/i.test(prompt)) return { tool: ['write', { path: 'index.html', content: TODO_APP }] };
  return { text: 'Ready. Ask me to build something.' };
}

export function createScriptedProvider() {
  const stream = (_model, request) => {
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: Date.now(), stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    setTimeout(() => {
      events.push({ type: 'start', partial: message });
      const answer = decide(request.messages.filter(item => item.role !== 'system'), request);
      if (answer.tool) {
        const toolCall = { type: 'toolCall', id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: answer.tool[0], arguments: answer.tool[1] };
        message.content.push(toolCall); message.stopReason = 'toolUse';
        events.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
        events.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
        events.push({ type: 'done', reason: 'toolUse', message });
      } else {
        message.content.push({ type: 'text', text: answer.text });
        events.push({ type: 'text_start', contentIndex: 0, partial: message });
        events.push({ type: 'text_delta', contentIndex: 0, delta: answer.text, partial: message });
        events.push({ type: 'text_end', contentIndex: 0, content: answer.text, partial: message });
        events.push({ type: 'done', reason: 'stop', message });
      }
      events.end(message);
    }, 50);
    return events;
  };
  return createProvider({ id: MODEL.provider, models: [MODEL], auth: { apiKey: { name: 'keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } });
}
