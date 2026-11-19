// A chat controller whose connection the atlas can set (the chat's loading and error states), over the scripted fake agent. Shared by the Atlas page and its test, so the page's
// "Loading" and "Connection error" thumbnails are the same states the test drives. `start`: 'connecting', 'error', or nothing (the agent's own, connected).
export function controlled(demo, start) {
  let connection = start ? { kind: start } : undefined, last, cache, calls = 0;
  const listeners = new Set();
  const notify = () => { last = undefined; for (const listener of listeners) listener(); };
  const controller = { ...demo.controller,
    getSnapshot: () => {
      const base = demo.controller.getSnapshot();
      if (!connection) return base;
      // A chat that is still connecting has no view yet: that is what the chat's loading state reads.
      if (base !== last) { last = base; cache = { ...base, connection, ...(connection.kind === 'connecting' || connection.kind === 'idle' ? { view: undefined } : {}) }; }
      return cache;
    },
    subscribe: listener => { listeners.add(listener); const off = demo.controller.subscribe(listener); return () => { listeners.delete(listener); off(); }; },
    // The chat connects once when it mounts (ignored here, so the scene stays loading or failed); a later call is the person's Reconnect.
    connect: async () => { if (connection && !calls++) return; connection = { kind: 'connected' }; notify(); } };
  return { controller, set: kind => { connection = { kind }; notify(); } };
}
