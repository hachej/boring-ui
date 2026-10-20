/** Unanswered transport calls retain their identity and payload across reconnects. The host must deduplicate mutating calls. */
export function createChatOutbox<Input, Output>() {
  const pending = new Map<string, { readonly input: Input; readonly resolve: (output: Output) => void; readonly reject: (error: unknown) => void }>();
  return {
    enqueue: (id: string, input: Input): Promise<Output> => new Promise((resolve, reject) => { pending.set(id, { input, resolve, reject }); }),
    get: (id: string) => pending.get(id),
    values: () => [...pending.values()],
    resolve: (id: string, output: Output) => { const call = pending.get(id); pending.delete(id); call?.resolve(output); },
    reject: (id: string, error: unknown) => { const call = pending.get(id); pending.delete(id); call?.reject(error); },
    clear: () => pending.clear(),
  };
}
