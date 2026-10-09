// Code mode of the standard agent: one native tool, `run_code`, backed by upstream pi-codemode. The model writes JavaScript
// that runs in a QuickJS sandbox whose only capability is calling the data tools injected below, so pagination, filtering
// and aggregation happen in code and only the script's final output enters the transcript.
// The data tools are deliberately NOT registered as native tools: the model can reach them only through code.
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { CodemodeSandbox, renderDeclarations } from '@earendil-works/pi-codemode';

// Fictional ledger: 120 invented records from a fixed seed, so every run and the journey see the same numbers.
export const STATUSES = ['open', 'paid', 'overdue', 'cancelled'];
export const REGIONS = ['north', 'south', 'east', 'west'];
export const PAGE_SIZE = 10;
function ledger(count = 120) {
  let seed = 20261003;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const pick = (list, weights) => { let roll = next() * weights.reduce((a, b) => a + b, 0); return list[weights.findIndex(weight => (roll -= weight) < 0)]; };
  return Array.from({ length: count }, (_, index) => Object.freeze({
    id: `REC-${String(index + 1).padStart(4, '0')}`, status: pick(STATUSES, [5, 8, 3, 2]), region: pick(REGIONS, [3, 2, 4, 3]), amount: 25 + Math.floor(next() * 4975),
  }));
}
export const RECORDS = Object.freeze(ledger());

/** Exact aggregates, computed the plain way, for the panel and the journey to check the agent's numbers. */
export function summarize(records = RECORDS) {
  const group = key => Object.fromEntries((key === 'status' ? STATUSES : REGIONS).map(value => {
    const rows = records.filter(record => record[key] === value);
    return [value, { count: rows.length, amount: rows.reduce((sum, record) => sum + record.amount, 0) }];
  }));
  return { total: records.length, pages: Math.ceil(records.length / PAGE_SIZE), amount: records.reduce((sum, record) => sum + record.amount, 0), byStatus: group('status'), byRegion: group('region') };
}

export const LIMITS = { timeoutMs: 20_000, memoryLimitBytes: 32 * 1024 * 1024, codeChars: 20_000, outputChars: 8_000, nestedCalls: 200 };
const RECORD = { type: 'object', properties: { id: { type: 'string' }, status: { enum: STATUSES }, region: { enum: REGIONS }, amount: { type: 'integer' } }, required: ['id', 'status', 'region', 'amount'] };

/** The tools the sandbox injects. `count` bounds how many nested calls one execution may make. */
function dataTools(count = () => {}) {
  return [
    { name: 'list_records', description: `One page of the ledger, ${PAGE_SIZE} records per page. Pages start at 1; read \`pages\` from the first response.`,
      inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1 } }, required: ['page'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { page: { type: 'integer' }, pages: { type: 'integer' }, total: { type: 'integer' }, records: { type: 'array', items: RECORD } }, required: ['page', 'pages', 'total', 'records'] },
      execute: args => {
        count();
        const pages = Math.ceil(RECORDS.length / PAGE_SIZE), page = args?.page;
        if (!Number.isInteger(page) || page < 1 || page > pages) throw new Error(`page must be an integer from 1 to ${pages}`);
        return { page, pages, total: RECORDS.length, records: RECORDS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
      } },
    { name: 'get_record', description: 'One ledger record by id, for example REC-0042.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, outputSchema: RECORD,
      execute: args => {
        count();
        const found = RECORDS.find(record => record.id === args?.id);
        if (!found) throw new Error(`No record ${String(args?.id)}`);
        return found;
      } },
  ];
}
const DECLARATIONS = renderDeclarations({ tools: dataTools() });

/** Run one script in a fresh upstream sandbox. Exported so the journey can probe the sandbox boundary without a model. */
export async function runCode(code, signal) {
  if (typeof code !== 'string' || !code.trim()) return { text: 'script: code is empty', isError: true, calls: [] };
  if (code.length > LIMITS.codeChars) return { text: `script: code exceeds ${LIMITS.codeChars} characters`, isError: true, calls: [] };
  let calls = 0;
  const sandbox = new CodemodeSandbox({ timeoutMs: LIMITS.timeoutMs, memoryLimitBytes: LIMITS.memoryLimitBytes,
    tools: dataTools(() => { if (++calls > LIMITS.nestedCalls) throw new Error(`One execution is limited to ${LIMITS.nestedCalls} tool calls`); }) });
  try {
    const result = await sandbox.execute(code, { signal });
    const lines = result.output.filter(item => item.type === 'text').map(item => item.text);
    if (result.ok && result.value !== undefined) lines.push(typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
    // The message only: a stack (the sandbox's frames, or the host's for a failing tool) never enters the transcript.
    if (!result.ok) lines.push(`${result.error.kind}: ${result.error.name ? `${result.error.name}: ` : ''}${result.error.message}`);
    let text = lines.join('\n') || 'Code finished without output. Use text(value) or return a value.';
    // Upstream keeps all script output until the script ends; this bounds only what enters the transcript.
    if (text.length > LIMITS.outputChars) text = `${text.slice(0, LIMITS.outputChars)}\n[output truncated at ${LIMITS.outputChars} characters; aggregate in code and print less]`;
    return { text, isError: !result.ok, calls: result.calls };
  } finally {
    await sandbox.close();
  }
}

/** The `run_code` tool. Its result `details` carry the count of nested tool calls and the size of the output, for hosts and journeys that check them. */
export const runCodeTool = defineTool({
  name: 'run_code',
  description: `Run JavaScript in an isolated sandbox over the ledger of fictional records. The code is the body of an async function: top-level await and return work.
Call the ledger tools as \`await tools.<name>(args)\`; they return parsed objects. Print with text(value) or return a value; only that output comes back to you.
There are no timers, fetch, require, files or network. Limits: ${LIMITS.timeoutMs / 1000} s, ${LIMITS.nestedCalls} tool calls, ${LIMITS.outputChars} output characters.

${DECLARATIONS}`,
  parameters: Type.Object({ code: Type.String({ description: 'JavaScript async function body.' }) }, { additionalProperties: false }),
  replay: 'safe',
  execute: async ({ code }, _api, context) => {
    const result = await runCode(code, context.abortSignal);
    return { content: [{ type: 'text', text: result.text }], isError: result.isError, details: { nestedCalls: result.calls.length, outputChars: result.text.length } };
  },
});
