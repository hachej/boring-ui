// The companion's editable self: a persona and sandboxed abilities kept as files under /workspace/self, deployed as
// numbered versions. Deploying is host code: it reads the files, validates them and installs a replacement native
// extension under the same name, so the next request of the same durable conversation uses the new self.
// Generated content stays data or sandboxed code: the persona becomes a prompt section and every ability is the body
// of an async function that runs only inside the upstream pi-codemode QuickJS sandbox, never as native code.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { CodemodeSandbox } from '@earendil-works/pi-codemode';

export const SELF_DIR = '/workspace/self';
export const LIMITS = Object.freeze({ timeoutMs: 20_000, memoryLimitBytes: 32 * 1024 * 1024, codeChars: 20_000, outputChars: 8_000, nestedCalls: 200, persona: 8_000, abilities: 24, abilityChars: 6_000 });
const ABILITY = /^[a-z][a-z0-9_]{0,39}$/;

export const SELF_SEED = {
  [`${SELF_DIR}/persona.md`]: `# Who I am

I am Juniper, a warm, brief and practical personal assistant in a fictional demo.
I remember everything we have talked about and use it without being asked.
I answer in two or three sentences unless the person asks for more.

## About the person

(Nothing yet. I keep this section up to date when I learn durable facts: name, people, preferences, routines.)
`,
  [`${SELF_DIR}/abilities/days_until.js`]: `// description: Whole days from today until an ISO date (negative if it has passed).
// args: { date: string }
const target = Date.parse(args.date + 'T00:00:00Z');
if (Number.isNaN(target)) throw new Error('date must look like 2026-12-24');
const today = Date.parse((await tools.today({})).date + 'T00:00:00Z');
return Math.round((target - today) / 86400000);
`,
  [`${SELF_DIR}/README.md`]: `# My self

- persona.md: who I am and what I know about the person. It becomes part of my system prompt when deployed.
- abilities/<name>.js: an async function body with \`args\`, \`tools\` and the other \`abilities\` in scope. First lines:
  \`// description: ...\` and \`// args: { ... }\`. Abilities run only inside the run_code sandbox.

Edit these files, then call redeploy. The next request of this same conversation uses the new version.
`,
};

/** Parse one ability file: `// description:` and `// args:` header lines, then the body. */
export function parseAbility(name, source) {
  if (!ABILITY.test(name)) throw new Error(`Ability name "${name}" must be lower_snake_case`);
  if (source.length > LIMITS.abilityChars) throw new Error(`Ability ${name} exceeds ${LIMITS.abilityChars} characters`);
  const description = /^\/\/\s*description:\s*(.+)$/m.exec(source)?.[1]?.trim();
  const args = /^\/\/\s*args:\s*(.+)$/m.exec(source)?.[1]?.trim() ?? '{}';
  if (!description) throw new Error(`Ability ${name} needs a "// description: ..." line`);
  return { name, description, args, body: source };
}

const prelude = abilities => abilities.length
  ? `const abilities = {\n${abilities.map(ability => `  ${ability.name}: async (args = {}) => {\n${ability.body}\n  },`).join('\n')}\n};\n`
  : 'const abilities = {};\n';

/** Prompt text describing the sandbox API: host tools first, then this version's abilities. */
export function declarations(hostTools, abilities) {
  const tools = hostTools.map(tool => `  tools.${tool.name}(${tool.args}): ${tool.description}`).join('\n');
  const own = abilities.length ? abilities.map(ability => `  abilities.${ability.name}(${ability.args}): ${ability.description}`).join('\n') : '  (none yet)';
  return `Host tools:\n${tools}\nYour abilities (files in ${SELF_DIR}/abilities):\n${own}`;
}

/** Run a script with this version's abilities in a fresh sandbox. Never throws for script failures. */
export async function runSandboxed(code, abilities, tools, signal) {
  if (typeof code !== 'string' || !code.trim()) return { text: 'script: code is empty', isError: true, calls: 0 };
  if (code.length > LIMITS.codeChars) return { text: `script: code exceeds ${LIMITS.codeChars} characters`, isError: true, calls: 0 };
  let calls = 0;
  const count = () => { if (++calls > LIMITS.nestedCalls) throw new Error(`One execution is limited to ${LIMITS.nestedCalls} tool calls`); };
  const sandbox = new CodemodeSandbox({ timeoutMs: LIMITS.timeoutMs, memoryLimitBytes: LIMITS.memoryLimitBytes,
    tools: tools.map(tool => ({ ...tool, execute: async args => { count(); return tool.execute(args); } })) });
  try {
    const result = await sandbox.execute(`${prelude(abilities)}${code}`, { signal });
    const lines = result.output.filter(item => item.type === 'text').map(item => item.text);
    if (result.ok && result.value !== undefined) lines.push(typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
    if (!result.ok) lines.push(`${result.error.kind}: ${result.error.message}`);
    let text = lines.join('\n') || 'Code finished without output. Use text(value) or return a value.';
    if (text.length > LIMITS.outputChars) text = `${text.slice(0, LIMITS.outputChars)}\n[output truncated at ${LIMITS.outputChars} characters]`;
    return { text, isError: !result.ok, calls };
  } finally {
    await sandbox.close();
  }
}

/** Every ability must at least compile inside the sandbox before a version is deployed. */
export async function checkAbilities(abilities) {
  const problems = [];
  for (const ability of abilities) {
    const result = await runSandboxed('return "ok";', [ability], [], AbortSignal.timeout(5_000));
    if (result.isError) problems.push(`${ability.name}: ${result.text}`);
  }
  return problems;
}

/** Deploy history in one JSON file: the host's record, outside anything the agent can write. */
export function openDeploys(path) {
  let state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { versions: [] };
  const save = () => { writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 1)); renameSync(`${path}.tmp`, path); };
  return {
    get current() { return state.versions.at(-1); },
    get versions() { return state.versions; },
    find: version => state.versions.find(entry => entry.version === version),
    append(snapshot) {
      const entry = { version: (state.versions.at(-1)?.version ?? 0) + 1, at: new Date().toISOString(), ...snapshot };
      state = { versions: [...state.versions, entry] }; save();
      return entry;
    },
  };
}

/** What a deploy changed, in a few words, for the history and the tool result. */
export function describeChange(before, after) {
  if (!before) return 'first version';
  const changes = [];
  if (before.persona !== after.persona) changes.push('persona');
  const names = list => new Map(list.map(ability => [ability.name, ability.body]));
  const old = names(before.abilities), now = names(after.abilities);
  for (const [name, body] of now) if (!old.has(name)) changes.push(`+${name}`); else if (old.get(name) !== body) changes.push(`~${name}`);
  for (const name of old.keys()) if (!now.has(name)) changes.push(`-${name}`);
  return changes.join(', ') || 'no change';
}
