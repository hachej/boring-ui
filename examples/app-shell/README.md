# App shell example

A fictional fitness app ("Forme") with a fake screen, a 56px fake tab bar and the `AgentLayer` from `registry/app-shell/agent-layer.tsx`: the coach (push-to-talk) and, from the menu, the product manager. Compact (below 768px) the layer is a bottom drawer with peek, half and full snap points; expanded it is a right panel. `components/`, `hooks/` and `lib/` are pinned shadcn fixtures (see their header), used only to type-check and run the item.

```sh
npm run app-shell           # the page on a local port (?mode=fitness|redaction|template, ?send=draft)
npm run app-shell:journey   # real-browser journey at 390x844 with touch, plus the 1280x800 panel (scripted model, no key), screenshots under .cache/evidence/app-shell/
```

The server only serves the page and the chat transport (two agents); `STUDIO_MODEL=scripted` (set by the journey) answers from `script.mjs`. It records each submit body and the `context` the transport hands to `requestContext`.
