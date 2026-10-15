// Scenarios are data: the one standard agent is shown, taught and tested by listing what a person can ask of it. The browser
// lists them (grouped, in the empty chat) and the journey (../journey.mjs) executes the very same files through the real UI.
// Every *.mjs in this folder (except this file and files starting with `_`) is discovered; each default-exports one scenario
// or an array of them. No shared file needs editing.
//
//   {
//     id: 'artifact-markdown',                 // unique, kebab-case: also the screenshot name and a STUDIO_ONLY selector
//     group: 'Artifacts',                      // one of GROUPS below
//     title, description,                      // what the list shows (one line)
//     smoke?: true,                            // one of the few that also run against the real model in `npm run studio:smoke` (non-blocking)
//     script?: { 0: [turns], 'text in a message': [turns] },   // the scripted model's side, for the blocking layer (see ../scripted-model.mjs)
//     variants?: ['local', 'vercel'],          // where it makes sense (default: every variant)
//     requires?: ['shell', 'git'],             // capabilities the variant must offer; otherwise listed disabled with the reason
//     seed?: { 'notes/a.md': 'text' | Uint8Array },   // workspace files put there (only the missing ones) when the scenario starts
//     seedCommit?: 'message',                  // commit the seeded files (variants with git), so the tree starts clean
//     panel?: 'files' | 'git' | 'tasks' | 'sandbox',  // open this Workspace tab when the scenario starts
//     viewport?: 'phone' | 'tablet',           // the journey emulates this device for the scenario
//     steps: [                                  // what a person does, in order
//       { prompt: '...' },                      // type (or click the suggested) prompt, send, wait until the agent is idle
//       { prompt, wait: false },                // the same, but go on while it works (stop it, queue messages, reload)
//       { prompt, mention: 'notes/a.md' },      // the same with an @mention of a workspace file at the start
//       { prompt, upload: { name, content, mimeType? } },   // attach this file with the paperclip first
//       { prompt, answers: ['option:1', 'free text'] },     // answers to ask_user questions, in the order they are asked; 'approve' or 'deny' answers an approval card
//       { run: async t => {} },                 // custom driving or checks at this point of the sequence (the escape hatch inside the steps)
//       { action: 'stop' | 'reload' | 'restart' | 'idle' | 'streaming' | 'openPanel' | 'closePanel' },
//     ],
//     expect: [                                 // declarative checks, evaluated after the last step (see ../journey-expect.mjs)
//       { reply: /regex/ },                     // some assistant message matches; { toolResult: /regex/ } the real output of tool calls (native messages)
//       { toolCalled: 'present' }, { toolNotCalled: 'bash' }, { toolCalls: { name: 'run_code', min: 1, max: 2 } },
//       { artifact: { type: 'html', frameHas: 'svg', count: 1 } },
//       { panelOpen: true }, { fileExists: 'notes/todo.md' }, { fileContains: { path, text } },
//       { question: { answered: 2 } }, { userMessages: 3 }, { nativeInputHasFile: 'uploads/' },
//     ],
//     verify?: async t => {},                   // the escape hatch, for the few that need custom driving
//   }
import { readdirSync } from 'node:fs';
import { answeredGenerically } from '../scripted-model.mjs';

export const GROUPS = ['Chat basics', 'Ask the user', 'Attachments and mentions', 'Artifacts', 'Documents and files', 'Canvas', 'Workspace and shell', 'Git',
  'Subagents', 'Code mode', 'MCP tools', 'Remote sandbox', 'Specialised team', 'Self-evolution', 'Phone layout', 'Share links'];
const ACTIONS = new Set(['stop', 'reload', 'restart', 'idle', 'streaming', 'openPanel', 'closePanel']);

export async function loadScenarios() {
  const files = readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.mjs') && name !== 'index.mjs' && !name.startsWith('_')).sort();
  const loaded = [];
  for (const name of files) loaded.push(...[(await import(new URL(name, import.meta.url))).default].flat().filter(Boolean));
  const ids = loaded.map(scenario => scenario.id);
  if (new Set(ids).size !== ids.length) throw new Error(`Scenario ids must be unique: ${ids.filter((id, at) => ids.indexOf(id) !== at).join(', ')}`);
  for (const scenario of loaded) {
    const where = `Scenario ${scenario.id}`;
    if (!/^[a-z0-9-]+$/.test(scenario.id) || !GROUPS.includes(scenario.group) || !scenario.title || !scenario.description) throw new Error(`${where}: needs a kebab-case id, a known group, a title and a description`);
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) throw new Error(`${where}: needs steps`);
    for (const step of scenario.steps) if (!step.prompt && typeof step.run !== 'function' && !ACTIONS.has(step.action)) throw new Error(`${where}: a step is a prompt, a run function or one of the actions ${[...ACTIONS].join(', ')}`);
    if (scenario.steps.filter(step => step.prompt).length === 0 && !scenario.panel) throw new Error(`${where}: a scenario without a prompt opens a panel`);
    if (!Array.isArray(scenario.expect ?? []) ) throw new Error(`${where}: expect is a list`);
    if (scenario.steps.some(step => step.prompt) && !scenario.script && scenario.steps.some(step => step.prompt && !answeredGenerically(step.prompt))) throw new Error(`${where}: a scenario that prompts the model needs a \`script\` for the scripted layer (only "Reply with exactly: X" and number-essay prompts are answered without one)`);
  }
  return loaded.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
}

/** What the browser needs of a scenario: no functions, no file contents. */
export function describeScenario(scenario) {
  return {
    id: scenario.id, group: scenario.group, title: scenario.title, description: scenario.description,
    variants: scenario.variants ?? null, requires: scenario.requires ?? [], panel: scenario.panel ?? null, seeds: Object.keys(scenario.seed ?? {}),
    // Only the steps a person types matter to the list; `index` says which fixture an upload is.
    steps: scenario.steps.flatMap((step, index) => step.prompt ? [{ index, prompt: step.prompt, ...(step.mention ? { mention: step.mention } : {}), ...(step.upload ? { upload: { name: step.upload.name } } : {}) }] : []),
  };
}
