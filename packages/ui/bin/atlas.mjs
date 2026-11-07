// The Atlas manifest (web/src/atlas.json): its validation, `boring-ui-blocks atlas <dir> --check`. The shape is atlas.schema.json (published
// beside this file); this module is the hand-written validator for it (no JSON Schema dependency) plus what a schema cannot say: duplicate
// ids, the step grammar and the fixture files an app has. test/atlas.test.mjs holds the two in agreement.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
const SYNTHETIC = /^[^/\\\s]+\.synthetic\.[^/\\\s]+$/;
const STATE_KEYS = ['id', 'page', 'title', 'given', 'flow', 'after'];
const VERBS = ['open', 'upload', 'click', 'fill', 'wait'];
const nonEmpty = v => typeof v === 'string' && v.trim() !== '';
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
// The step grammar is boring-factory's, copied: templates/app/test/examples-core.ts (QUOTES line 13, token 16-25, phrase 28, parseStep 32-43).
// A phrase is quoted "like this", 'like this', « like this » or “like this” (the quotes come off, the inside is trimmed); an unquoted
// single-argument step takes the rest of the line; `fill` takes a label (one word or quoted) then the rest as its value. Only stricter
// than Factory in one place: a phrase that opens a quote and never closes it is a finding (Factory reads it as a plain word).
const QUOTES = { '"': '"', "'": "'", '«': '»', '“': '”' };

/** The first word or quoted phrase of `text` and what follows it (examples-core.ts `token`), or `{ error }` for an unclosed quote. */
function token(text) {
  const s = text.trim();
  if (!s) return null;
  const close = QUOTES[s[0]];
  if (close) {
    const end = s.indexOf(close, 1);
    if (end > 0) return { value: s.slice(1, end).trim(), rest: s.slice(end + 1).trim() };
    return { error: `unbalanced quote: close the ${s[0]} with ${close}` };
  }
  const space = s.search(/\s/);
  return space < 0 ? { value: s, rest: '' } : { value: s.slice(0, space), rest: s.slice(space).trim() };
}
/** A whole phrase, one pair of quotes taken off (examples-core.ts `phrase`). */
function phrase(text) {
  const t = token(text);
  if (t?.error) return t;
  return { value: t && !t.rest ? t.value : text.trim() };
}

/** Reads a step: `{ verb, args }`, or `{ error }`. `open <screen>`, `upload [<fixture>]`, `click <label>`, `fill <label> <value>`, `wait <text>`. */
export function parseStep(step) {
  if (typeof step !== 'string') return { error: 'a step is a string' };
  const text = step.trim();
  const verb = /^\S+/.exec(text)?.[0] ?? '';
  if (!VERBS.includes(verb)) return { error: `unknown step verb "${verb}" (${VERBS.join(', ')})` };
  const rest = text.slice(verb.length).trim();
  if (!rest) return verb === 'upload' ? { verb, args: [] } : { error: `${verb} needs ${verb === 'fill' ? 'a label and a value' : 'an argument'}` };
  if (verb !== 'fill') { const p = phrase(rest); return p.error ? p : { verb, args: [p.value] }; }
  const label = token(rest);
  if (label.error) return label;
  if (!label.rest) return { error: 'fill needs a label and a value' };
  const value = phrase(label.rest);
  return value.error ? value : { verb, args: [label.value, value.value] };
}

/** Findings `{ id?, path, message }` for a parsed manifest; `fixtures` (file names the app has) makes a missing file an error. */
export function checkAtlas(manifest, { fixtures } = {}) {
  const found = [];
  const add = (path, message, id) => found.push(id ? { id, path, message } : { path, message });
  if (!isObject(manifest)) { add('', 'the manifest is an object with a states array'); return found; }
  for (const key of Object.keys(manifest)) if (key !== '$schema' && key !== 'states') add(key, `unknown field "${key}"`);
  if ('$schema' in manifest && typeof manifest.$schema !== 'string') add('$schema', '$schema is a string');
  if (!Array.isArray(manifest.states)) { add('states', 'states is an array'); return found; }
  const seen = new Map();
  manifest.states.forEach((state, n) => {
    const at = `states[${n}]`;
    if (!isObject(state)) { add(at, 'a state is an object'); return; }
    const id = typeof state.id === 'string' ? state.id : undefined;
    for (const key of Object.keys(state)) if (!STATE_KEYS.includes(key)) add(`${at}.${key}`, `unknown field "${key}"`, id);
    for (const key of ['id', 'page', 'title', 'given']) if (!(key in state)) add(`${at}.${key}`, `${key} is required`, id);
    if ('id' in state) {
      if (typeof state.id !== 'string' || !ID.test(state.id)) add(`${at}.id`, 'id is lowercase words joined by "." or "-", e.g. ecritures.empty', id);
      else if (seen.has(state.id)) add(`${at}.id`, `duplicate id "${state.id}" (first at states[${seen.get(state.id)}])`, id);
      else seen.set(state.id, n);
    }
    if ('page' in state && (typeof state.page !== 'string' || !state.page.startsWith('/'))) add(`${at}.page`, 'page is a route starting with /', id);
    if ('title' in state && !nonEmpty(state.title)) add(`${at}.title`, 'title is the non-empty text a person sees', id);
    const fixtureFile = (path, name) => {
      if (fixtures && !fixtures.includes(name)) add(path, `fixture "${name}" is not a file in the fixtures directory`, id);
    };
    if ('given' in state) {
      const given = state.given, g = `${at}.given`;
      if (!isObject(given)) add(g, 'given is an object with a fixture and optional steps', id);
      else {
        for (const key of Object.keys(given)) if (key !== 'fixture' && key !== 'steps') add(`${g}.${key}`, `unknown field "${key}"`, id);
        if (!('fixture' in given)) add(`${g}.fixture`, 'fixture is required', id);
        else if (typeof given.fixture !== 'string' || !SYNTHETIC.test(given.fixture)) add(`${g}.fixture`, `fixture "${given.fixture}" must be a *.synthetic.* file name: invented data only`, id);
        else fixtureFile(`${g}.fixture`, given.fixture);
        if ('steps' in given) {
          if (!Array.isArray(given.steps)) add(`${g}.steps`, 'steps is an array of strings', id);
          else given.steps.forEach((step, s) => {
            const r = parseStep(step);
            if (r.error) add(`${g}.steps[${s}]`, r.error, id);
            else if (r.verb === 'upload' && r.args[0]) {
              if (!SYNTHETIC.test(r.args[0])) add(`${g}.steps[${s}]`, `upload "${r.args[0]}" must be a *.synthetic.* file name`, id);
              else fixtureFile(`${g}.steps[${s}]`, r.args[0]);
            }
          });
        }
      }
    }
    for (const key of ['flow', 'after']) if (key in state && !nonEmpty(state[key])) add(`${at}.${key}`, `${key} is a non-empty string`, id);
    if ('after' in state && !('flow' in state)) add(`${at}.after`, 'after needs flow: it labels the arrow inside a flow', id);
  });
  return found;
}

export const ATLAS_USAGE = 'usage: boring-ui-blocks atlas <dir> --check [--fixtures <dir>] [--json]';

/** The `atlas` command. `<dir>/atlas.json` is read; exit 1 on any finding, 2 for a use error or for shooting (next slice). */
export function atlasMain(args, cwd, log, error) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') flags.check = true;
    else if (args[i] === '--json') flags.json = true;
    else if (args[i] === '--fixtures') { flags.fixtures = args[++i]; if (!flags.fixtures) { error(ATLAS_USAGE); return 2; } }
    else if (args[i].startsWith('--')) { error(`unknown option ${args[i]}\n${ATLAS_USAGE}`); return 2; }
    else positional.push(args[i]);
  }
  if (positional.length !== 1) { error(ATLAS_USAGE); return 2; }
  if (!flags.check) { error('atlas: shooting lands in the next slice; for now only `atlas <dir> --check` runs'); return 2; }
  const file = resolve(cwd, positional[0], 'atlas.json');
  const report = list => { if (flags.json) log(JSON.stringify(list, null, 2)); else for (const f of list) log(`${file}: ${f.path || '(root)'}: ${f.message}`); return list.length ? 1 : 0; };
  let fixtures;
  if (flags.fixtures) {
    const dir = resolve(cwd, flags.fixtures);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) { error(`${flags.fixtures}: --fixtures is the directory of the app's fixture files`); return 2; }
    fixtures = readdirSync(dir).filter(name => { try { return statSync(join(dir, name)).isFile(); } catch { return false; } });
  }
  if (!existsSync(file)) return report([{ path: '', message: 'atlas.json not found' }]);
  let manifest;
  try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return report([{ path: '', message: `atlas.json is not valid JSON: ${e.message}` }]); }
  const findings = checkAtlas(manifest, { fixtures });
  const code = report(findings);
  if (!flags.json) log(code ? `atlas: ${findings.length} finding(s)` : `atlas: ${manifest.states.length} state(s) ok`);
  return code;
}
