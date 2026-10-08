// The one standard agent. The studio (Node) and the Cloudflare recipe (Workers) both import this file, so it has no Node-only
// imports and knows nothing about where it runs: a host passes the pieces that depend on infrastructure.
//
//   core, always:  ask_user, skills (/skill menu)
//   parts, when the host has what they need (each is `{ capabilities: [...], tools?: [...], extensions?: [...] }`):
//     workspace (Pi's read, write and edit over the host's ExecutionEnv, through the file guard of @hachej/boring-agent/file-guard, the workspace
//     resolved per call like the env (@hachej/boring-agent/workspaces: one agent definition can serve a workspace per person),
//     plus `present` and the shared notes.md), canvas (board.tldraw), shell (bash; with python when its shell has python3), git (working_git),
//     subagents (foreground and background), codemode (run_code over a fictional ledger), mcp (a host's MCP tools, ./mcp-tools.mjs)
//   A host without a workspace has neither file tools nor `present`: there is one tool set for files, and it needs a workspace.
//   self-evolving, when the host names the workspace (`selfEvolving`): the agent keeps its own instructions, skills and tools in `.agent/` and
//     applies them with `reload` (docs/architecture/SELF-EVOLUTION.md); its tools run through the same ExecutionEnv `exec` as bash.
//
// The system prompt is assembled from one section per capability, so an agent without a shell is never told about bash and the
// full agent reads as one document. A host lists the capabilities it ended up with (`capabilities`) for the UI.
import { defineAgent, parseSkill } from '@hachej/boring-agent/agents';
import { createPresentTool } from '@hachej/boring-agent/artifacts';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { createAskUserTool } from '@hachej/boring-agent/ask-user';

/** What an agent that writes HTML pages is told about where they run (the sandboxed preview). */
export const HTML_RUNTIME_NOTE = `HTML pages are shown running in a sandbox (the preview): your inline <script> and <style> work, and you may load a library with a <script src> only from https://cdnjs.cloudflare.com or https://cdn.jsdelivr.net, with an exact pinned version in the URL (for example https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js). The page has no network access (fetch, XHR and WebSocket fail), no cookies or storage, cannot open windows or submit forms, and cannot read images from the web: draw with SVG, canvas or CSS and embed small images as data: URIs. Make the page self-contained, responsive to the frame's size and working without any user account.`;

/** Skills the agent loads on demand (`/letter-style` in the composer, or by itself when a task matches). */
export const SKILLS = [
  parseSkill(`---
name: letter-style
description: House style for fictional clinic letters. Load before writing or revising any letter.
---
- Start with "Dear colleague," and end with "Kind regards," then "Fictional Clinic".
- Three short paragraphs at most: reason for referral, relevant findings, the request.
- Plain language, no abbreviations, no invented findings: use only what the notes say.
- Save letters as Markdown under letters/ with a short kebab-case file name.
`),
  parseSkill(`---
name: plain-language
description: Rewrite clinical wording in plain language a patient would understand.
---
- Replace jargon with everyday words and keep each sentence under 20 words.
- Never change a finding, date or number; only the wording.
- Keep the original structure and the sign-off.
`),
  parseSkill(`---
name: letter-review
description: Checklist for reviewing a fictional clinic letter against its source notes. Load before asking anyone to review a letter.
---
Review checklist, to be given to the reviewer in full:
1. Every finding in the letter appears in the notes. Name any that does not.
2. The letter follows the house style: greeting "Dear colleague,", at most three short paragraphs, sign-off "Kind regards," then "Fictional Clinic".
3. Nothing is abbreviated or in jargon.
Answer with at most three short bullet points, each starting with OK or FIX.
`),
];

const SECTIONS = {
  intro: () => `You are a helpful, concise assistant in a fictional demo. Everything you write is fictional. Answer in plain Markdown. After using a tool, reply with one or two short sentences and never repeat what the tool produced.`,
  // When and how to present is in the present tool's own description (@hachej/boring-agent/artifacts); this host adds what its HTML preview allows.
  present: () => HTML_RUNTIME_NOTE,
  notes: () => `Shared document: notes.md in the workspace is a Markdown document that you and the person both edit. Read it with read before changing it, change it with edit (or create it with write when it is missing), and never discard lines you were not asked to change.`,
  canvas: () => `Canvas: draw diagrams, boxes and arrows on the one shared tldraw canvas that the person sees and edits (not as an SVG artifact, unless an SVG image is asked for). Always call read_canvas first, then add_canvas_shapes or remove_canvas_shapes (a canvas that is not saved yet is created by the first add). Lay shapes out on a tidy grid: boxes about 180 wide and 90 high, at least 80 apart, never on top of shapes you read. Connect shapes with arrows by id, adding shapes and their arrows in one call. Never remove or redraw shapes you were not asked to change. If a call is refused because the canvas changed, call read_canvas again and retry once.`,
  workspace: () => `Workspace: you also have a workspace of files (your working directory; use paths relative to it). Use read, list_files, write and edit to inspect and change files instead of guessing. Read a file before you change it: a change to a file you have not read, or that the person changed since you read it, is refused; then read it again and redo the change on top of what is there. Files the person attaches are saved under uploads/. A message may already contain the content of files the person attached or @mentioned: use it directly instead of reading the file again.`,
  shell: () => `Use bash to run commands in the workspace. Report real command output; never invent it.`,
  python: () => `The shell also runs python3 (CPython 3.13 with its standard library only: no pip, packages or network).`,
  git: () => `Git: the workspace is a git repository. Use working_git for version control: status, add (one path per call), commit (with a message), log, branches, branch (create), checkout (switch) and diff. Add each changed file before committing; there is no "commit -a". There is no remote: push, pull, fetch, merge, rebase and reset do not exist. Only stage or commit when asked.`,
  subagents: () => `Delegating: you cannot always read everything yourself. Use subagent with a short self-contained task that names the file paths; it waits and returns the subagent's answer, and you give the person the concrete facts it returned (not just that it finished). With background true it returns at once with a number and you reply with one short sentence naming it; never wait for it and never poll list_subagents in a loop. A message starting with "[Background subagent #N finished]" is that subagent's report, not something the person wrote: tell the person in one or two sentences what it found, without repeating the bracketed marker. Use list_subagents and stop_subagent only when asked.`,
  codemode: () => `Code: run_code runs JavaScript in a sandbox over a ledger of fictional records (id, status, region, amount in whole fictional credits). The ledger is paginated, so never read it one page per tool call: write ONE script that loops over every page with tools.list_records, filters and aggregates in code, and returns only the small final result. Aim for a single run_code call per question. Never estimate numbers: report exactly what the code returned, as plain digits without thousands separators.`,
  mcp: () => `Connected services: tools named <service>_<tool> call an external service through MCP. One that changes something asks the person first; when they deny it, say so and do not retry.`,
  'self-evolving': () => `Improving yourself: you may keep standing instructions, skills and tools of your own in the .agent/ folder of the workspace (the reload tool describes the format). Change them when the person asks, write them with your ordinary file tools, then call reload and report what it says, errors included. Your tools run in the workspace like bash, never in the host.`,
  ask: () => `Asking: when a choice is the person's to make, or you need a detail that changes the result, call ask_user and wait for the answer, one question per call. Offer a few short options when they fit and allow free text when they do not.`,
};
// The order the sections read in: what the agent produces, then where it works, then how it coordinates.
const ORDER = ['intro', 'present', 'notes', 'canvas', 'workspace', 'shell', 'python', 'git', 'subagents', 'codemode', 'mcp', 'self-evolving', 'ask'];
const ALWAYS = new Set(['intro', 'ask']);

/**
 * @param {object} options
 * @param {string} [options.id]
 * @param {{ provider: string, modelId: string }} options.model
 * @param {string} [options.cwd] directory within the host's ExecutionEnv, for hosts that have one
 * @param {'env' | Function | { files: object, root: string, access?: object }} [options.workspace] the workspace of each call, resolved like Pi's
 *   env (`@hachej/boring-agent/workspaces`): `'env'` (the first-class way: the workspace attached to the env the host's `HarnessOptions.env` gave the
 *   call, `withWorkspace` or a `createWorkspaceCache` entry, so the host wires one function), a resolver `(target, context) => binding`, or one
 *   binding for a host with a single workspace. A binding's
 *   `files` is the workspace provider (`@hachej/boring-files/workspace`; the guard serialises with its queue and `present` keeps revisions in it),
 *   `root` the workspace root as the ExecutionEnv names it, `access` the agent's principal for it. Needed with a workspace part.
 * @param {object} [options.files] shorthand for one workspace: `{ files, root, access }` become `workspace`
 * @param {string} [options.root]
 * @param {object} [options.access]
 * @param {{ capabilities: string[], tools?: object[], extensions?: object[] }[]} [options.parts]
 * @param {string | true} [options.selfEvolving] the workspace instance id: the agent keeps its own instructions, skills and tools in that
 *   workspace's `.agent/` and applies them with `reload` (docs/architecture/SELF-EVOLUTION.md). Off when absent. Its tools run through the
 *   host's `exec`. `true`: a workspace per conversation (one harness, a workspace per person): the host creates each conversation with
 *   `agent.inWorkspace(<workspace>)`, which selects that workspace's own `self-evolving:<workspace>` extension only.
 */
export function defineStandardAgent({ id = 'standard', model, cwd, root, thinkingLevel = 'medium', files, access, workspace = files ? { files, root, access } : undefined, parts = [], selfEvolving }) {
  const guarded = Boolean(workspace) && parts.some(part => part.capabilities.includes('workspace'));
  if (guarded && typeof workspace === 'object' && !workspace.root) throw new TypeError('A workspace needs its root for the file guard');
  // 'env': the tools take the workspace attached to their call's env (no `workspace` option).
  const source = workspace === 'env' ? undefined : workspace;
  const capabilities = [...(guarded ? ['present', 'notes'] : []), 'ask', 'skills', ...parts.flatMap(part => part.capabilities), ...(selfEvolving ? ['self-evolving'] : [])];
  const tools = [
    ...(guarded ? [createPresentTool({ workspace: source })] : []),
    createAskUserTool(),
    ...parts.flatMap(part => part.tools ?? []),
  ];
  // The guard wraps Pi's own read, write and edit, so it is selected after the extensions that register them.
  const extensions = [...parts.flatMap(part => part.extensions ?? []), ...(guarded ? [createFileGuard({ workspace: source, name: `boring.files.guard.${id}` })] : [])];
  const instructions = ORDER.filter(key => ALWAYS.has(key) || capabilities.includes(key)).map(key => SECTIONS[key]()).join('\n\n');
  const agent = defineAgent({ id, model, thinkingLevel, instructions, tools, extensions, skills: SKILLS, ...(cwd ? { cwd } : {}),
    ...(selfEvolving ? { selfEvolving: true, ...(typeof selfEvolving === 'string' ? { workspace: selfEvolving } : {}) } : {}) });
  return { agent, capabilities };
}
