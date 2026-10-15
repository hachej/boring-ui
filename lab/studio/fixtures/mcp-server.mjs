// A tiny fictional MCP server in the studio process, over Pi's in-memory transport pair: a harbour office with a read (tide_times),
// a write (book_mooring) and a tool the studio does not allow (close_harbour). It answers only what the MCP client asks for here.
import { createInMemoryTransportPair } from '@earendil-works/pi-mcp/testing';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties) });
const TOOLS = [
  { name: 'tide_times', description: 'High and low tide at the fictional Placeholder Pier for a date.', inputSchema: object({ date: { type: 'string', description: 'YYYY-MM-DD' } }) },
  { name: 'book_mooring', description: 'Book a mooring at the fictional Placeholder Pier.', inputSchema: object({ boat: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } }) },
  { name: 'close_harbour', description: 'Close the fictional harbour to all boats.', inputSchema: object({}) },
];

/** Every booking any instance received, for a scenario to check what reached the server. */
export const harbourBookings = [];
/** Every tool call any instance received, with the fictional credential its connection was opened with (the team variant's per-person token). */
export const harbourCalls = [];

/** `credential` stands for what a real server reads from its connection (an Authorization header): the person the calls act for. */
export function fictionalHarbourServer({ credential } = {}) {
  const { client, server } = createInMemoryTransportPair();
  const run = (name, args) => {
    if (name === 'tide_times') return `Tides at Placeholder Pier on ${args.date}: high 06:12, low 12:25, high 18:40.`;
    if (name === 'book_mooring') { harbourBookings.push(args); return `Mooring ${harbourBookings.length} booked for ${args.boat} on ${args.date}.`; }
    if (name === 'close_harbour') return 'The harbour is closed.';
    return undefined;
  };
  server.onMessage(message => {
    if (message.id === undefined) return; // notifications
    const reply = result => void server.send({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'initialize') return reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fictional-harbour', version: '1.0.0' } });
    if (message.method === 'tools/list') return reply({ tools: TOOLS });
    if (message.method === 'tools/call') {
      harbourCalls.push({ tool: message.params.name, credential });
      const text = run(message.params.name, message.params.arguments ?? {});
      return reply(text === undefined ? { content: [{ type: 'text', text: `Unknown tool ${message.params.name}` }], isError: true } : { content: [{ type: 'text', text }] });
    }
    if (message.method === 'ping') return reply({});
    void server.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  });
  void server.start();
  return { transport: client };
}
