// Spike server: serves public/ and three model endpoints. The model key comes from the
// environment (OPENROUTER_API_KEY) and never leaves this process.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apps } from './public/data.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number(process.env.PORT || 5480);
const model = process.env.MODEL || 'google/gemini-2.5-flash';
const key = process.env.OPENROUTER_API_KEY;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const SHADER_CONTRACT = `A material is WGSL: exactly one function "fn shade(uv: vec2f, px: vec2f) -> vec4f" returning straight (not premultiplied) rgba.
uv is 0..1 (y up), px is pixel position. Available: u.res (vec2f pixels), u.mouse (vec2f 0..1), u.time (f32 seconds), u.energy (f32 0..1),
u.c1 and u.c2 (vec4f palette colours), helpers hash(vec2f)->f32, noise(vec2f)->f32, fbm(vec2f)->f32, datum(i32)->f32 (8 data values 0..1).
Rules: WGSL only, no other functions or declarations, use "let"/"var", float literals with a dot (1.0), vec3f/vec4f constructors, keep it under 30 lines, keep text readable on top (dark and calm, contrast < 0.5 brightness).`;

const SCREEN = `You design screens for a person, from their words and their data. Return JSON only:
{"title": str, "subtitle": str, "palette": {"c1": "#hex", "c2": "#hex"}, "background": {"material": "aura"|"glass"|"heat"} or {"wgsl": str},
 "blocks": [ one of
  {"type":"stat","label":str,"value":str,"hint":str,"glow":0..1},
  {"type":"board","columns":[{"title":str,"cards":[{"title":str,"meta":str,"glow":0..1}]}]},
  {"type":"table","columns":[str],"rows":[[str]],"glowRows":[int]},
  {"type":"chart","label":str,"labels":[str],"values":[number]} (max 8 values),
  {"type":"text","body":str}
  each block may add "span": 1|2|3 (grid of 3) ] }
"glow" marks what deserves attention (0 none, 1 urgent): it renders as a living light behind the item.
Prefer a custom "wgsl" background that expresses the mood the person asked for. ${SHADER_CONTRACT}
Use only the data given; do not invent records.`;

const SOUFFLEUR = `You are a souffleur: you whisper to a person writing a document, using what their other apps know.
Return JSON only: {"ghost": str, "cards": [{"app":"crm"|"invoices","title":str,"body":str,"figure":str,"insert":str}]}
"ghost" continues the person's last sentence in their voice and language (max 18 words, may be empty).
"cards": at most 3, only about companies or people the text mentions or clearly implies; "insert" is one sentence they could drop into the text.
Use only the data given; never invent figures.`;

const REMIX = `You turn an artifact into another view of the same content. Return JSON only, the same screen schema as this:
{"title": str, "subtitle": str, "palette": {...}, "background": {"material": "aura"|"glass"|"heat"} or {"wgsl": str}, "blocks": [...] }
Block types: stat, board, table, chart (max 8 values), text, as in: ${SCREEN.split('"blocks": [')[1]}`;

async function ask(system, user) {
  if (!key) throw Object.assign(new Error('no model configured'), { status: 503 });
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0.7, max_tokens: 4000, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw Object.assign(new Error(`model ${res.status}`), { status: 502 });
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? '';
  return JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
}

const data = () => "All amounts are in euros (write them like 7,600 €). " + JSON.stringify({ crm: { contacts: apps.crm.contacts, deals: apps.crm.deals }, invoices: apps.invoices.invoices });

const routes = {
  '/api/generate': ({ prompt }) => ask(SCREEN, `Data:\n${data()}\n\nThe person asks: ${String(prompt).slice(0, 600)}`),
  '/api/souffleur': ({ text }) => ask(SOUFFLEUR, `Apps:\n${data()}\n\nDocument so far:\n${String(text).slice(-2500)}`),
  '/api/remix': ({ artifact, as }) => ask(REMIX, `Artifact:\n${JSON.stringify(artifact).slice(0, 6000)}\n\nShow it as: ${String(as).slice(0, 200)}`),
  '/api/shader': ({ prompt }) => ask(`Write a material. Return JSON {"wgsl": str, "c1": "#hex", "c2": "#hex"}. ${SHADER_CONTRACT}`, String(prompt).slice(0, 400)),
};

createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/status') return send(200, { live: Boolean(key), model: key ? model : null });
    if (routes[url.pathname] && req.method === 'POST') {
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > 64000) return send(413, { error: 'too large' }); }
      const t0 = Date.now();
      const out = await routes[url.pathname](JSON.parse(raw || '{}'));
      console.log(url.pathname, `${Date.now() - t0}ms`);
      return send(200, out);
    }
    const path = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!path.startsWith(root)) return send(403, { error: 'forbidden' });
    send(200, await readFile(path), types[extname(path)] ?? 'application/octet-stream');
  } catch (e) {
    console.log(req.url, e.message);
    send(e.code === 'ENOENT' ? 404 : e.status ?? 500, { error: e.message });
  }
}).listen(port, '127.0.0.1', () => console.log(`shader-ui on http://127.0.0.1:${port} model=${key ? model : 'canned only'}`));
