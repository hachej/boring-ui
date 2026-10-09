// A small Claude-Code-style coding agent: Pi's native read/write/edit/bash tools over the browser repository, and
// `run_code` (upstream pi-codemode, QuickJS in a nested Web Worker) for multi-step work whose intermediate results
// should stay out of the transcript. All of it runs in the agent worker.
//
// It also reads and changes a website's data through the page's own origin: `api_get` is free, `api_request` (anything
// but GET) is wrapped with `requireApproval`, so each call waits for the person's click before it runs. `run_code` gets
// the read tools only (`api_get`, never `api_request`); a change always goes through the gated native tool.
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { createBashTool, createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { Type } from '@earendil-works/pi-ai';
import { CodemodeSandbox, renderDeclarations } from '@earendil-works/pi-codemode';
import { requireApproval } from '@hachej/boring-agent/approval';

export const ROOT = '/repo';
/** Files of the new repository, relative to ROOT. */
export const SEED = {
  'README.md': '# Scratch project\n\nA fictional project that lives entirely in this browser tab. Ask the agent to build something.\n',
  'index.html': '<!doctype html>\n<title>Hello</title>\n<h1>Hello from the browser workspace</h1>\n',
};

const LIMITS = { timeoutMs: 60_000, memoryLimitBytes: 64 * 1024 * 1024, nestedCalls: 300, outputChars: 12_000 };

export const INSTRUCTIONS = `You are a coding agent working in a git repository at ${ROOT}, inside the user's browser tab. Everything (files, shell, git, code execution) is sandboxed and local to the tab.
Work like a careful senior engineer: explore before editing (ls, cat, grep through bash or read), make focused changes with edit or write, then verify (read back, grep, run a quick script with run_code).
The shell is a POSIX-like bash with coreutils, grep, sed, awk, jq and a small git: status | add <one path> | commit -m "<message>" | log | branch [<name>] | checkout <name> | diff [--cached]. There is no node, npm, python, network or package installation.
Use run_code for anything multi-step (loops over files, counting, checking output). Commit when a requested change is complete, one "git add <path>" per file. Keep replies short: what you changed and how you checked it.
The page's own site has a JSON API on this origin, for example GET /fixture/api/notes. Read it with api_get. To change anything (POST, PUT, PATCH, DELETE) call api_request: the person is asked to approve each call first, and a denied call changes nothing, so do not retry it.
Web pages you build are previewed from index.html in the repository root; keep CSS and JavaScript inline or in files referenced with relative paths.`;

const API_BODY_LIMIT = 6000;
const apiPath = Type.String({ description: 'Absolute path on this site, such as /fixture/api/notes.', pattern: '^/(?!/)' });

/** One request to the site this tab was loaded from. Same-origin only: the path cannot name another host. */
async function callApi(method, path, body, signal) {
  if (typeof path !== 'string' || !/^\/(?!\/)/.test(path)) throw new Error('path must start with a single "/"');
  const response = await fetch(path, { method, signal, headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text: text.length > API_BODY_LIMIT ? `${text.slice(0, API_BODY_LIMIT)}\n[truncated]` : text };
}
const apiResult = ({ ok, status, text }) => ({ content: [{ type: 'text', text: `HTTP ${status}\n${text}` }], isError: !ok });

/** Run one command in the repository through Pi's native env (its bash has git) and capture the output. */
export async function shell(env, command, context) {
  let output = '';
  const result = await env.exec(command, { onOutput: text => { output += text; } }, context);
  if (!result.ok) throw result.error;
  return { output, exitCode: result.value.exitCode };
}
/** Every file in the repository outside .git, `{ path, size }` relative to ROOT, from the same native env. */
export async function listFiles(env, context, directory = '.') {
  const files = [];
  for (const entry of value(await env.listDir(directory, context)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = directory === '.' ? entry.name : `${directory}/${entry.name}`;
    if (entry.kind === 'directory' && path !== '.git') files.push(...await listFiles(env, context, path));
    else if (entry.kind === 'file') files.push({ path, size: entry.size });
  }
  return files;
}
const value = result => { if (!result.ok) throw result.error; return result.value; };

/** The tools a run_code script can call: host code over Pi's native env, and no tool that changes site data. */
function sandboxTools(env, context) {
  const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
  const path = { type: 'string', description: `Path relative to ${ROOT}.` };
  return [
    { name: 'list_files', description: 'Every file in the repository (excluding .git) with its size.', inputSchema: object({}), execute: () => listFiles(env, context) },
    { name: 'read_file', description: 'Read a text file.', inputSchema: object({ path }), execute: async ({ path: file }) => value(await env.readTextFile(file, context)) },
    { name: 'write_file', description: 'Write a text file (creates directories).', inputSchema: object({ path, text: { type: 'string' } }),
      execute: async ({ path: file, text }) => {
        if (file.includes('/')) value(await env.createDir(file.slice(0, file.lastIndexOf('/')), { recursive: true }, context));
        value(await env.writeFile(file, String(text), context));
        return `wrote ${file}`;
      } },
    { name: 'api_get', description: 'GET a path on this site (a JSON API); returns { ok, status, text }. Read-only.', inputSchema: object({ path }),
      execute: ({ path: apiPathValue }) => callApi('GET', apiPathValue, undefined, context.abortSignal) },
    { name: 'bash', description: 'Run one shell command in the repository root; returns { output, exitCode }.', inputSchema: object({ command: { type: 'string' } }),
      execute: ({ command }) => shell(env, command, context) },
  ];
}

export function createCodingAgent({ workspace, codemode }) {
  const declarations = renderDeclarations({ tools: sandboxTools(workspace.env) });
  const runs = { executions: 0, failed: 0 };
  const runCode = defineTool({
    name: 'run_code',
    description: `Run JavaScript in an isolated QuickJS sandbox in this browser. The code is an async function body: await and return work.
Call the tools as \`await tools.<name>(args)\`. Print with text(value) or return a value; only that output comes back to you.
No fetch, DOM, timers or imports. Limits: ${LIMITS.timeoutMs / 1000} s, ${LIMITS.nestedCalls} tool calls, ${LIMITS.outputChars} output characters.

${declarations}`,
    parameters: Type.Object({ code: Type.String({ description: 'JavaScript async function body.' }) }, { additionalProperties: false }),
    execute: async ({ code }, _api, context) => {
      let calls = 0;
      const tools = sandboxTools(workspace.env, context).map(tool => ({ ...tool, execute: async args => {
        if (++calls > LIMITS.nestedCalls) throw new Error(`One execution is limited to ${LIMITS.nestedCalls} tool calls`);
        return tool.execute(args);
      } }));
      const sandbox = new CodemodeSandbox({ ...codemode, timeoutMs: LIMITS.timeoutMs, memoryLimitBytes: LIMITS.memoryLimitBytes, tools });
      try {
        const result = await sandbox.execute(code, { signal: context.abortSignal });
        const lines = result.output.filter(item => item.type === 'text').map(item => item.text);
        if (result.ok && result.value !== undefined) lines.push(typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
        if (!result.ok) lines.push(`${result.error.kind}: ${result.error.message}`);
        let text = lines.join('\n') || 'Code finished without output. Use text(value) or return a value.';
        if (text.length > LIMITS.outputChars) text = `${text.slice(0, LIMITS.outputChars)}\n[output truncated]`;
        runs.executions++; if (!result.ok) runs.failed++;
        return { content: [{ type: 'text', text }], isError: !result.ok };
      } finally { await sandbox.close(); }
    },
  });
  const apiGet = defineTool({
    name: 'api_get',
    description: 'GET a path on this site (a JSON API) and return its status and body. Read-only and free to use.',
    parameters: Type.Object({ path: apiPath }, { additionalProperties: false }),
    replay: 'safe',
    execute: async ({ path }, _api, context) => apiResult(await callApi('GET', path, undefined, context.abortSignal)),
  });
  const apiRequest = requireApproval(defineTool({
    name: 'api_request',
    description: 'Change data on this site with POST, PUT, PATCH or DELETE (JSON body). The person must approve each call; if they deny it nothing happens. Use api_get to read.',
    parameters: Type.Object({
      method: Type.Union([Type.Literal('POST'), Type.Literal('PUT'), Type.Literal('PATCH'), Type.Literal('DELETE')]),
      path: apiPath,
      body: Type.Optional(Type.Any({ description: 'JSON body.' })),
    }, { additionalProperties: false }),
    execute: async ({ method, path, body }, _api, context) => apiResult(await callApi(method, path, body, context.abortSignal)),
  }), { summarize: ({ method, path, body }) => `Send ${method} ${path}${body === undefined ? '' : ` with ${JSON.stringify(body).slice(0, 300)}`}` });
  const extension = defineExtension({
    name: 'browser.coding',
    tools: [createReadTool(), createWriteTool(), createEditTool(), createBashTool(), apiGet, apiRequest, runCode],
  });
  return { extension, runs };
}
