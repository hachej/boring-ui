# Ambient example

## Embedding an agent beside an existing site

A fictional settings console (the "existing app") with the agent floating over it. It installs only `pi-chat` and `pi-ambient` (plus `pi-workspace`, which `pi-ambient` needs for its in-window artifact panel, and two hook files of `pi-app`: `useRemoteChat` and `useSaved`); the host page keeps its own layout. Install commands and when to pick which block: [registry/README.md](../../registry/README.md#blocks-what-to-install). The component's behaviour, props and states: [Ambient agent](../../registry/README.md#ambient-agent-pi-ambient-ambientchat-agentnotifications). Integration levels: [WEBSITE-INTEGRATION.md](../../docs/architecture/WEBSITE-INTEGRATION.md).

```sh
npm run ambient            # the console with the bar over it
npm run ambient:journey    # real-browser journey, screenshots under .cache/evidence/ambient/
```

`?view=full` renders a `PiChat` with the same composer configuration; `?artifacts=host` hands artifacts to the host viewer instead of the window.
