# with-shadcn

Runnable example showing `@boring/agent/ui-shadcn` with a custom `reverse`
tool renderer.

## Run

```bash
export ANTHROPIC_API_KEY=your_key_here
pnpm --filter with-shadcn dev
```

## CSP

This example server applies the shared CSP policy from `../csp.ts`:

```http
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'
```
