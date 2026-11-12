// The demo's assistant: SCRIPTED, deterministic, no model and no network. The script is data (ux/scenarios/scripts/*.json):
//   { "fallback": "one plain sentence", "turns": [ { "match": "regex on what the person typed", "steps": [ ... ] } ] }
// A step is one of:
//   { "tool": "read", "path": "uploads/x.pdf", "progress": "12 lignes sur 40", "ms": 800 }   the agent works: the tool's words show, then it finishes
//   { "think": true, "ms": 600 }                                                             the agent works with no tool running
//   { "text": "the answer, \n for lines, @path cites a file", "stream": true }               the answer; streamed word by word when `stream`
//   { "ask": { "question": "...", "questions": [ { "question": "...", "options": ["a", "b"] } ] }, "then": [ steps ] }   a question; `then` plays after the answer
//   { "present": "uploads/x.csv", "ms": 1500 }                                              the agent shows a file (the `present` tool): the call waits for the page's
//                                                                                           acknowledgement (`presented()`), at most `ms`, then its result carries the file
// Pace: `pace` is 1 for the live demo and the videos (steps wait their `ms`, text streams); 0.15 for check mode (steps last a fifth of their time, at least 200 ms, no streaming).
// A message that matches no turn gets `fallback`: never an error, never a blank.
const assistant = (content, stopReason) => ({ role: 'assistant', content, api: 'scripted', provider: 'scripted', model: 'scripted', usage: {}, stopReason, timestamp: 2 });
let counter = 1000;
const entry = (model, byTaskId = 7) => ({ id: ++counter, kind: 'message', byTaskId, model: [model] });
const wait = ms => new Promise(done => setTimeout(done, ms));

export function createScriptedAgent({ script, pace = 1, entries, show }) {
  let run = 0, pendingAsk, pendingPresent;
  const live = tools => ({ 'pi.live': { run: { taskId: 7 }, ...(tools ? { tools } : {}) } });
  const sleep = ms => wait(Math.max(ms * pace, 200));
  const cancelled = token => token !== run;

  async function play(steps, base, token, id = 0) {
    let list = base;
    for (const step of steps) {
      if (cancelled(token)) return list;
      if (step.tool) {
        const call = `c${++id}`;
        const asked = entry(assistant([{ type: 'toolCall', id: call, name: step.tool, arguments: { path: step.path } }], 'toolUse'));
        show([...list, asked], live([{ callId: call, taskId: 8, status: 'running', details: { progress: step.progress } }]));
        await sleep(step.ms ?? 800);
        const result = { id: ++counter, kind: 'message', byTaskId: 8, model: [{ role: 'toolResult', toolCallId: call, toolName: step.tool, content: [{ type: 'text', text: step.result ?? 'terminé' }], isError: false, timestamp: 3 }] };
        list = [...list, asked, result]; show(list, live());
      } else if (step.think) { show(list, live()); await sleep(step.ms ?? 600);
      } else if (step.text !== undefined) {
        const words = step.text.split(/(?<=\s)/), message = entry(assistant([{ type: 'text', text: '' }], 'stop'));
        const partial = text => ({ ...message, model: [assistant([{ type: 'text', text }], 'stop')] });
        if (step.stream && pace >= 1) for (let i = 4; i <= words.length + 3 && !cancelled(token); i += 4) { show([...list, partial(words.slice(0, i).join(''))], live()); await wait(70); }
        if (cancelled(token)) return list;
        list = [...list, partial(step.text)]; show(list, {});
      } else if (step.present) {
        const call = `p${++id}`, path = step.present, name = path.split('/').at(-1);
        const asked = entry(assistant([{ type: 'toolCall', id: call, name: 'present', arguments: { path } }], 'toolUse'));
        show([...list, asked], live());
        await Promise.race([new Promise(resolve => { pendingPresent = resolve; }), wait(step.ms ?? 1500)]);
        pendingPresent = undefined;
        if (cancelled(token)) return list;
        const mediaType = { csv: 'text/csv', md: 'text/markdown', pdf: 'application/pdf', png: 'image/png' }[name.split('.').pop()] ?? 'text/plain';
        const artifact = { schema: 'boring.artifact', version: 1, title: name, type: name.endsWith('.md') ? 'markdown' : 'code', mediaType, target: { resource: { providerId: 'demo', path }, view: { kind: 'published' } }, revision: 'r1' };
        const result = { id: ++counter, kind: 'message', byTaskId: 8, model: [{ role: 'toolResult', toolCallId: call, toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact }) }], isError: false, timestamp: 3 }] };
        list = [...list, asked, result]; show(list, live());
      } else if (step.ask) {
        const asked = entry(assistant([{ type: 'toolCall', id: `q${++id}`, name: 'ask_user', arguments: step.ask }], 'toolUse'));
        list = [...list, asked]; show(list, live());
        await new Promise(resolve => { pendingAsk = resolve; });
        pendingAsk = undefined;
        if (cancelled(token)) return list;
        list = await play(step.then ?? [], list, token, id);
        return list;
      }
    }
    return list;
  }

  return {
    // The person's message: play the nearest turn (the first whose regex matches), else the fallback.
    async say(text) {
      if (pendingAsk) { pendingAsk(text); return; }
      const token = ++run;
      const turn = script.turns.find(t => new RegExp(t.match, 'i').test(text));
      await play(turn ? turn.steps : [{ think: true, ms: 500 }, { text: script.fallback, stream: true }], entries(), token);
    },
    // The page acknowledged the file the agent presented (or refused it).
    presented() { pendingPresent?.(); },
    // The person answered the agent's question (a choice, or free text typed in the field).
    answer(text) { pendingAsk?.(text); },
    // Stop: the current run ends where it is.
    stop() { run++; pendingAsk?.(); show(entries(), {}); },
  };
}
