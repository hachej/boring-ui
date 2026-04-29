# CSP Compatibility

`@boring/agent` is compatible with a strict CSP, with one required exception:
`style-src` must allow inline styles for editor/runtime integrations that do
not support nonces end-to-end.

## Recommended Policy

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self';
  img-src 'self' data: blob:;
  font-src 'self';
```

## Notes

- `script-src` does **not** require `'unsafe-eval'`.
- No `eval()` or `new Function()` usage is expected in audited agent UI surfaces
  (shadcn ChatPanel + example apps).
- Shared helper lives at `src/server/http/csp.ts`; example servers consume it
  via `examples/csp.ts`.

## Audited Scope (tv4)

- `src/front/ChatPanel.tsx`
- `examples/with-custom-tool/*`
- `apps/agent-playground/*`

## Remaining Caveat

Even with this cleanup, downstream consumers that enable rich editor stacks
(for example CodeMirror/Tiptap integrations in workspace-oriented shells) should
keep `style-src 'unsafe-inline'` until upstream libraries expose nonce-safe
style injection across the full stack. The default non-shadcn primitive
stack (`src/front/primitives/*`) also still relies on inline style attributes,
so `style-src 'unsafe-inline'` remains required there as well.
