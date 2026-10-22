// D-80's fictional Anthropic cache: four breakpoints, 20-block lookback, 1024-token minimum, writes on response.
import assert from 'node:assert/strict';
import { createModels } from '@earendil-works/pi-ai/models';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';

// pi-ai owns the provider wire format; this payload hook adds only OptChat's stable-prefix breakpoint.
export function chatCachePayload(payload) {
  if (!Array.isArray(payload?.messages)) return payload;
  let selected;
  for (const message of payload.messages) {
    if (!Array.isArray(message.content)) continue;
    for (let index = 0; index < message.content.length; index++) {
      const block = message.content[index];
      if (block.type !== 'text') continue;
      const match = /<chat>\n([\s\S]*?)\n<\/chat>/.exec(block.text);
      if (!match) continue;
      const lines = match[1] ? match[1].split('\n') : [];
      const whole = Math.floor(lines.length / 4) * 4;
      if (!whole) continue;
      const chunks = [];
      for (let line = 0; line < whole; line += 4) {
        chunks.push({ type: 'text', text: (line === 0 ? block.text.slice(0, match.index) + '<chat>\n' : '\n') + lines.slice(line, line + 4).join('\n') });
      }
      const end = match.index + '<chat>\n'.length + lines.slice(0, whole).join('\n').length;
      const tail = { ...block, text: block.text.slice(end) };
      message.content.splice(index, 1, ...chunks, tail);
      selected = chunks.at(-1);
      break;
    }
  }
  // Current Pi preserves OptChat's four-line blocks rather than combining them into one text block.
  if (!selected) for (const message of payload.messages) {
    let inChat = false;
    for (const block of message.content ?? []) {
      if (block.type !== 'text') continue;
      if (block.text.includes('<chat>\n')) inChat = true;
      if (block.text.includes('</chat>')) inChat = false;
      if (inChat && block.text !== '<chat>\n' && block.text.split('\n').length - 1 === 4) selected = block;
    }
  }
  if (!selected) return payload;
  selected.cache_control = { type: 'ephemeral' };
  // Anthropic permits four marks. Prefer pi-ai's system/tool/final-message marks, and only the last chat view.
  const blocks = [...(payload.system ?? []), ...(payload.tools ?? []), ...payload.messages.flatMap(m => Array.isArray(m.content) ? m.content : [])];
  let marked = blocks.filter(block => block.cache_control).length;
  for (const block of blocks) {
    if (marked <= 4) break;
    if (block.cache_control && block !== selected && !payload.system?.includes(block) && !payload.tools?.includes(block)) { delete block.cache_control; marked--; }
  }
  return payload;
}


export function optchatCacheModel({ answer, beforeReply = async () => {} } = {}) {
  const cached = new Set(), calls = [], errors = [];
  const fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const blocks = [...(payload.tools ?? []).map(block => ({ role: 'tool', block })), ...(payload.system ?? []).map(block => ({ role: 'system', block })), ...payload.messages.flatMap(m => m.content.map(block => ({ role: m.role, block })))];
    const marks = [];
    let prefix = '', tokens = 0;
    const prefixes = blocks.map(({ role, block }, index) => {
      const { cache_control, ...plain } = block;
      prefix += JSON.stringify([role, plain]);
      tokens += Math.ceil(JSON.stringify([role, plain]).length / 4);
      if (cache_control) marks.push(index);
      return { key: `${payload.model}:${prefix}`, tokens };
    });
    assert.ok(marks.length <= 4, 'Anthropic has at most four breakpoints');
    let read = 0;
    for (const index of marks) for (let at = index; at >= Math.max(0, index - 19); at--) {
      if (cached.has(prefixes[at].key)) read = Math.max(read, prefixes[at].tokens);
    }
    const writable = marks.map(i => prefixes[i]).filter(p => p.tokens >= 1024);
    const write = Math.max(0, ...writable.map(p => p.tokens - read));
    const compaction = (JSON.stringify(payload.system) ?? '').includes('write the memory');
    const call = { payload, input: tokens - read - write, cacheRead: read, cacheWrite: write, total: tokens, compaction };
    calls.push(call);
    // Overlapping requests cannot read each other's unfinished writes.
    await beforeReply(call);
    await new Promise(resolve => setTimeout(resolve, 5));
    const text = answer ? await answer(payload) : compaction ? 'user: Fictional recipe, lentils and carrots; the diary continues.' : 'Fictional recipe acknowledged.';
    for (const p of writable) cached.add(p.key);
    const events = [
      { type: 'message_start', message: { id: `fictional-${calls.length}`, type: 'message', role: 'assistant', model: payload.model, content: [], usage: { input_tokens: call.input, output_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: write } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: Math.ceil(text.length / 4) } },
      { type: 'message_stop' },
    ];
    return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  const base = anthropicProvider(), models = createModels();
  models.setProvider({ ...base,
    auth: { apiKey: { name: 'fictional', resolve: async () => ({ auth: { apiKey: 'fictional-key' } }) } },
    stream: (m, c, o) => base.stream(m, c, { ...o, onPayload: chatCachePayload, fetch: async (...args) => { try { return await fetch(...args); } catch (error) { errors.push(String(error)); throw error; } } }),
    streamSimple: (m, c, o) => base.streamSimple(m, c, { ...o, onPayload: chatCachePayload, fetch: async (...args) => { try { return await fetch(...args); } catch (error) { errors.push(String(error)); throw error; } } }),
  });
  return { models, calls, errors, ref: { provider: 'anthropic', modelId: 'claude-haiku-4-5' } };
}
