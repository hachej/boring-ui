// Scenarios are data: ux/scenarios/*.json, one per target (`layout:bar`, `component:message-field`...). This loads and checks them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './build.mjs';

export const dir = join(root, 'ux/scenarios');
export const slug = target => target.replace(':', '-');
const VERBS = ['tap', 'click', 'type', 'focus', 'press', 'hold', 'release', 'scroll', 'drag', 'swipe', 'drop', 'attach', 'wait', 'back', 'reload', 'fixture'];

export function loadAll() {
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => validate(JSON.parse(readFileSync(join(dir, f), 'utf8')), f));
}
export function select(list, { target, level }) {
  return list.filter(s => (!target || s.target === target) && (!level || s.target.startsWith(`${level}:`)));
}
function validate(s, file) {
  const fail = message => { throw new Error(`${file}: ${message}`); };
  if (!/^(layout|component):[\w-]+$/.test(s.target ?? '')) fail('target must look like layout:bar or component:file-preview');
  for (const key of ['title', 'purpose']) if (!s[key]) fail(`${key} is missing`);
  if (!s.fixture?.entry) fail('fixture.entry is missing');
  if (!Array.isArray(s.viewports) || !s.viewports.length) fail('viewports is missing');
  for (const f of s.flows ?? []) for (const step of f.steps) if (!VERBS.includes(step.do)) fail(`flow ${f.id}: unknown gesture "${step.do}"`);
  for (const st of s.states ?? []) for (const step of st.steps ?? []) if (!VERBS.includes(step.do)) fail(`state ${st.id}: unknown gesture "${step.do}"`);
  return { watch: [], thresholds: {}, states: [], flows: [], themes: ['light'], ...s, file };
}
export const level = s => s.target.split(':')[0];
