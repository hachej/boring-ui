// Network faults for journeys: a load balancer's idle timeout in front of a server, and a slow or refusing submit around a web handler.
import { createConnection, createServer, type Socket } from 'node:net';

export interface IdleProxy {
  readonly url: string;
  readonly port: number;
  readonly stats: { connections: number; idleClosed: number; cut: number };
  /** Drops every open connection, as a proxy restart would. */
  cut(): void;
  close(): Promise<void>;
}

/**
 * A tiny TCP reverse proxy in front of `target` (an http:// origin) that behaves like a load balancer's idle timeout (an AWS ALB
 * closes a connection after 60 s without bytes in either direction): every connection silent for `idleMs` is closed on both sides.
 */
export async function startIdleProxy({ target, idleMs = 5000, port = 0 }: { readonly target: string; readonly idleMs?: number; readonly port?: number }): Promise<IdleProxy> {
  const upstream = new URL(target);
  const open = new Set<{ client: Socket; backend: Socket }>(), stats = { connections: 0, idleClosed: 0, cut: 0 };
  const server = createServer(client => {
    stats.connections++;
    const backend = createConnection({ host: upstream.hostname, port: Number(upstream.port || 80) });
    const pair = { client, backend };
    open.add(pair);
    let timer: NodeJS.Timeout | undefined;
    const close = () => { clearTimeout(timer); open.delete(pair); client.destroy(); backend.destroy(); };
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => { stats.idleClosed++; close(); }, idleMs); };
    for (const [from, to] of [[client, backend], [backend, client]] as const) {
      from.on('data', chunk => { idle(); if (!to.write(chunk)) { from.pause(); to.once('drain', () => from.resume()); } });
      from.on('end', () => to.end());
      from.on('error', close);
      from.on('close', close);
    }
    idle();
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const address = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${address}/`, port: address, stats,
    cut: () => { for (const { client, backend } of [...open]) { stats.cut++; client.destroy(); backend.destroy(); } },
    close: async () => { for (const { client, backend } of [...open]) { client.destroy(); backend.destroy(); } await new Promise(resolve => server.close(resolve)); },
  };
}

export type WebHandler = (request: Request) => Promise<Response>;
/** Mutable at run time: the next `refuse` submits are refused; every submit's answer is held `delayMs` after the handler answered. */
export interface SubmitFaults { delayMs: number; refuse: number }

/**
 * `handler` behind a submit fault hook, like a slow network between Enter and the host's confirmation: the answer to a submit is held
 * `faults.delayMs` after `handler` handled it (the message is already recorded), and while `faults.refuse` > 0 a submit is answered with
 * a 402 `submission-refused` without reaching `handler`. A submit is a request whose `op` query parameter is `submit` (the
 * `@hachej/boring-agent/chat-transport` protocol) unless `isSubmit` says otherwise.
 */
export function withSubmitFaults(handler: WebHandler, { delayMs = 0, refuse = 0, message = 'Fictional refusal (test hook)', isSubmit = (request: Request) => new URL(request.url).searchParams.get('op') === 'submit' }:
  { readonly delayMs?: number; readonly refuse?: number; readonly message?: string; readonly isSubmit?: (request: Request) => boolean } = {}): { handler: WebHandler; faults: SubmitFaults } {
  const faults: SubmitFaults = { delayMs, refuse };
  return {
    faults,
    handler: async request => {
      if ((!faults.delayMs && !faults.refuse) || !isSubmit(request)) return handler(request);
      const refused = faults.refuse > 0 && faults.refuse-- > 0;
      const response = refused ? Response.json({ reason: 'submission-refused', message }, { status: 402 }) : await handler(request);
      if (faults.delayMs) await new Promise(resolve => setTimeout(resolve, faults.delayMs));
      return response;
    },
  };
}
