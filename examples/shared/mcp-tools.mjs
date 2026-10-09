// MCP servers as native Pi tools, through Pi's own MCP client (@earendil-works/pi-mcp). No Boring MCP layer: the host builds the
// transport (stdio, Streamable HTTP with its own fetch and credentials, OAuth from `@earendil-works/pi-mcp/oauth`) and owns the policy.
//   - only the tools the host allows are offered (whatever else the server lists is absent);
//   - only the tools the host lists as `readOnly` run at once; the server's own annotations decide nothing;
//   - every other tool asks the person through the existing approval gate (`requireApproval`) and is `replay: 'unsafe'`, so a crash
//     after the call started reports "outcome unknown" instead of calling the server again;
//   - results are capped at `maxResult` characters of text.
// Per person: with `credentials` (a `CredentialResolver` of `@hachej/boring-agent/workspaces`, the host's), every call asks the host for the
// credential of the person behind the call and runs on a connection opened lazily with it (`transport(credential)`), one per credential,
// reused and closed after `idleMs` without calls. The credential lives only in that in-memory cache: never in the conversation, a tool
// result or a log. The server's tool list is read once through the host's own connection (`transport()`, no person's credential).
// Without `credentials` every call uses that one connection, as before.
// The tools are ordinary native tool registrations: a host passes them to its agent like any other (a standard-agent part).
import { McpClient, toLlmContent } from '@earendil-works/pi-mcp';
import { requireApproval } from '@hachej/boring-agent/approval';
import { jsonSchemaTool } from '@hachej/boring-agent/agents';
import { callTarget } from '@hachej/boring-agent/workspaces';

export const MAX_MCP_RESULT = 20_000;

function capped(content, max) {
  let left = max;
  return content.map(part => {
    if (part.type !== 'text') return part;
    const text = part.text.length > left ? `${part.text.slice(0, left)}\n[Truncated: the result is longer than ${max} characters.]` : part.text;
    left = Math.max(0, left - part.text.length);
    return { ...part, text };
  });
}

async function connected(transport) {
  const client = new McpClient({ name: 'boring-agent', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/** One connection per credential, opened on first use and closed after `idleMs` without a call (never during one). */
function connectionsPerCredential(transport, idleMs) {
  const open = new Map();
  const close = async entry => { clearTimeout(entry.timer); await (await entry.client.catch(() => undefined))?.close().catch(() => {}); };
  return {
    async call(credential, run) {
      let entry = open.get(credential);
      if (!entry) {
        entry = { client: connected(transport(credential)), busy: 0 };
        open.set(credential, entry);
        const created = entry;
        entry.client.catch(() => { if (open.get(credential) === created) open.delete(credential); });
      }
      entry.busy++;
      clearTimeout(entry.timer);
      try { return await run(await entry.client); } finally {
        entry.busy--;
        const held = entry;
        if (held.busy === 0) { held.timer = setTimeout(() => { if (held.busy === 0 && open.get(credential) === held) { open.delete(credential); void close(held); } }, idleMs); held.timer.unref?.(); }
      }
    },
    size: () => open.size,
    close: async () => { const all = [...open.values()]; open.clear(); await Promise.all(all.map(close)); },
  };
}

/**
 * @param {{ id: string, transport: (credential?: string) => import('@earendil-works/pi-mcp').McpTransport, allow: string[], readOnly?: string[], maxResult?: number,
 *   credentials?: import('@hachej/boring-agent/workspaces').CredentialResolver, idleMs?: number }} server
 * @returns {Promise<{ tools: object[], connections: () => number, close: () => Promise<void> }>} native tools named `<id>_<tool>`, the number of
 *   per-credential connections open now, and how to close every connection
 */
export async function connectMcpTools({ id, transport, allow, readOnly = [], maxResult = MAX_MCP_RESULT, credentials, idleMs = 5 * 60_000 }) {
  const shared = await connected(transport());
  const perCredential = credentials ? connectionsPerCredential(transport, idleMs) : undefined;
  const reads = new Set(readOnly);
  const tools = (await shared.listTools()).filter(tool => allow.includes(tool.name)).map(tool => {
    const name = `${id}_${tool.name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    const call = (client, args, context) => client.callTool(tool.name, args ?? {}, context.abortSignal ? { signal: context.abortSignal } : {});
    // The server's input schema as Pi's parameters: the Harness validates every call against it before anything reaches the server.
    const native = jsonSchemaTool({
      name,
      description: tool.description ?? tool.name,
      // Providers require an object schema (jsonSchemaTool adds an empty `properties` when the server lists none).
      parameters: { ...tool.inputSchema, type: 'object' },
      replay: reads.has(tool.name) ? 'safe' : 'unsafe',
      execute: async (args, api, context) => {
        let result;
        if (perCredential) {
          const credential = await credentials(await callTarget(api, context), context, { tool: name, server: id });
          if (!credential) return { content: [{ type: 'text', text: `${id} is not connected for this person: the host has no credential for it.` }], isError: true };
          result = await perCredential.call(credential, client => call(client, args, context));
        } else result = await call(shared, args, context);
        // MCP reports a tool's own failure in the result, not as a protocol error.
        return { content: capped(toLlmContent(result), maxResult), isError: result.isError === true };
      },
    });
    return reads.has(tool.name) ? native : requireApproval(native, { summarize: args => `${id}: ${tool.name} ${JSON.stringify(args)}` });
  });
  return { tools, connections: () => perCredential?.size() ?? 0, close: async () => { await perCredential?.close(); await shared.close(); } };
}
