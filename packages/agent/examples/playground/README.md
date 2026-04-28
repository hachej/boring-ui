# playground

Minimal generic sandbox for `@boring/agent/ui-shadcn`. Just `<ChatPanel>` +
a session picker against a real agent backend, with toggle knobs for the
panel's public props (chrome, thinkingControl, suggestions).

Use this to poke at panel features in isolation. The richer feature
showcase — file tree, demo tool renderers, fake messages — lives in
`with-shadcn`.

## Run

```bash
export ANTHROPIC_API_KEY=...
pnpm --filter @boring/example-playground dev
```

Vite serves at http://localhost:5183 and proxies `/api`, `/health`,
`/ready` to the embedded Fastify agent app.
