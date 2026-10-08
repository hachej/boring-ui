// The keyless scripted counterpart of the browser preview subagent (FEEDBACK.md, "Preview"), served by the model gateway's scripted
// upstream when the request declares the preview tools (model-gateway-route.mjs). Deterministic from the OpenAI-shaped transcript:
//   - a new instruction naming a colour ("make it green", "make the save button green"): set_style on the first usable pin with that
//     colour as background and border; "darker"/"lighter" alone: the darker or lighter shade of the last colour named;
//   - "bigger"/"smaller": the pin's font-size;
//   - after the tool result: one sentence (or the refusal the page tools gave);
//   - anything else: a sentence asking for a colour.
// Fictional content only.

const COLOURS = {
  green: ['#2f9e44', '#1b5e20', '#69db7c'], red: ['#e03131', '#a61e1e', '#ff8787'], blue: ['#1c7ed6', '#0b4f8a', '#74c0fc'],
  orange: ['#f08c00', '#a35c00', '#ffc078'], purple: ['#7048e8', '#432c9e', '#b197fc'], black: ['#212529', '#000000', '#495057'],
};
const COLOUR = new RegExp(`\\b(${Object.keys(COLOURS).join('|')})\\b`, 'i');

const textOf = message => typeof message.content === 'string' ? message.content
  : Array.isArray(message.content) ? message.content.map(part => part?.text ?? '').join('\n') : '';

/** The scripted step: `{ toolCalls }` or a string. `messages` are OpenAI chat messages (system, user, assistant, tool). */
export function previewScriptedStep(messages) {
  const users = messages.map((message, index) => ({ message, index })).filter(item => item.message.role === 'user');
  const last = users.at(-1);
  if (!last) return 'Tell me what to preview.';
  const after = messages.slice(last.index + 1).filter(message => message.role === 'tool');
  const brief = textOf(users[0].message);
  const pin = /^- (p\d+): (.+?)(?: \[source [^\]]+\])?$/m.exec(brief.split('\n').filter(line => !/not usable/.test(line)).join('\n'));
  if (after.length) {
    const result = textOf(after.at(-1));
    if (result.startsWith('Refused')) return `I could not preview that: ${result.replace(/^Refused:\s*/, '')}`;
    return `Previewed on ${pin ? pin[2] : 'the page'}: ${result.replace(/^p\d+:\s*/, '')}.`;
  }
  if (!pin) return 'No pinned element is on this page; pin the element first.';
  const said = textOf(last.message).replace(/^[\s\S]*?Preview this change:\s*/, '').split('\nPinned elements:')[0];
  const named = COLOUR.exec(said)?.[1]?.toLowerCase()
    ?? users.map(item => COLOUR.exec(textOf(item.message))?.[1]?.toLowerCase()).filter(Boolean).at(-1);
  const shade = /\bdarker\b/i.test(said) ? 1 : /\blighter\b/i.test(said) ? 2 : 0;
  if (named && (COLOUR.test(said) || shade)) {
    const css = `background-color: ${COLOURS[named][shade]}; border-color: ${COLOURS[named][Math.max(shade, 1)]}`;
    return { toolCalls: [{ name: 'set_style', arguments: { element: pin[1], css } }] };
  }
  if (/\b(bigger|larger)\b/i.test(said)) return { toolCalls: [{ name: 'set_style', arguments: { element: pin[1], css: 'font-size: 1.25rem' } }] };
  if (/\bsmaller\b/i.test(said)) return { toolCalls: [{ name: 'set_style', arguments: { element: pin[1], css: 'font-size: 0.85rem' } }] };
  return 'Name a colour (green, red, blue...), or say darker, lighter, bigger or smaller.';
}
