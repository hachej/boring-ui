# App shell example

A fictional fitness app ("Forme") in `<AppShell layout="screen">` from `registry/app-shell/`: three screens (bottom tabs on a phone, the sidebar on a wide screen), a header per screen (`useScreenHeader`), the account menu, and the `AgentLayer` with the coach (push-to-talk) and, from the account menu, the product manager. Compact (below 768px) the layer is a bottom drawer with peek, half and full snap points; expanded it is a right panel. `components/`, `hooks/` and `lib/` are pinned shadcn fixtures (see their header), used only to type-check and run the item.

```sh
npm run app-shell           # the page on a local port (?app=fitness|empty, &nav=6 for « Plus », ?agent=none, ?send=draft)
npm run app-shell:journey   # real-browser journey at 390x844 with touch, plus the 1280x800 panel (scripted model, no key), screenshots under .cache/evidence/app-shell/
```

The server only serves the page and the chat transport (two agents); `STUDIO_MODEL=scripted` (set by the journey) answers from `script.mjs`. It records each submit body and the `context` the transport hands to `requestContext`.
