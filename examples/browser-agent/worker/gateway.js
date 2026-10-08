// This example's model gateway: host policy, not part of the library. ChatGPT refuses model calls made from a web page, so
// when the person sets a gateway URL the worker sends allow-listed provider hosts through `<gateway>/<host>/<path>`, a
// pass-through on the dev server (serve.mjs) that adds no credentials. The URL is a host setting kept in the app database.

/** Hosts the gateway may forward to. serve.mjs enforces the same list. */
export const GATEWAY_HOSTS = ['api.openai.com', 'api.anthropic.com', 'chatgpt.com'];
/** Hosts that refuse calls made from a web page: without a gateway, requests to them fail with a clear message. */
export const GATEWAY_REQUIRED_HOSTS = ['chatgpt.com'];

/** Send `request` to another URL with the same method, headers, body and signal (the body is buffered: a streamed body needs `duplex`). */
export async function redirect(send, request, url) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  return send(url, { method: request.method, headers: request.headers, signal: request.signal, ...(body ? { body } : {}) });
}

/** Keep the gateway URL in `db` and route this worker's provider calls through it. Returns { url(), set(url) }. */
export async function openGateway(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS gateway (id INTEGER PRIMARY KEY CHECK (id = 1), url TEXT NOT NULL)');
  let url = (await db.get('SELECT url FROM gateway WHERE id = 1'))?.url ?? '';
  const direct = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const target = new URL(request.url);
    if (url && GATEWAY_HOSTS.includes(target.host)) return redirect(direct, request, `${url.replace(/\/$/, '')}/${target.host}${target.pathname}${target.search}`);
    if (!url && GATEWAY_REQUIRED_HOSTS.includes(target.host)) return Promise.reject(new Error(`${target.host} blocks model calls from web pages. Set a gateway in the model settings.`));
    return direct(input, init);
  };
  return {
    url: () => url,
    async set(next) { url = String(next ?? '').trim(); await db.run('INSERT OR REPLACE INTO gateway (id, url) VALUES (1, ?)', url); },
  };
}
