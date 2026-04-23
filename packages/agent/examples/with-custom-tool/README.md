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

## CSP

This example server applies a strict CSP header (see `../csp.ts`). Required
policy baseline:

```http
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'
```
