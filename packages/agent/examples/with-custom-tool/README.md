# with-custom-tool

Runnable example showing how to add a custom tool to `@boring/agent`, override
its renderer in `ChatPanel`, and restyle via CSS variables.

## Run

```bash
export ANTHROPIC_API_KEY=your_key_here
pnpm --filter with-custom-tool dev
```

This starts:

- an API server with a custom `reverse` tool (`server.ts`)
- a Vite client rendering `ChatPanel` with `toolRenderers={{ reverse: ... }}`
  and hotpink theme overrides (`client.tsx`)

Then in chat, try:

```ts
reverse hello
```

You should see the custom renderer output:

```
Reversed: olleh
```
