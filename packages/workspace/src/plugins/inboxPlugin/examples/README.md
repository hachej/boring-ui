# Inbox plugin demo playground

This folder owns Inbox demo fixtures/plugins so host apps do not hard-code Inbox domain data.

`inboxDemoPlugin` registers realistic `WorkspaceAttentionBlocker` items with explicit `inbox` metadata:

- question item with a session target;
- review item from an external-review source;
- action buttons and session badges for app-left attention state.

The workspace playground mounts this plugin only when `?inboxDemo=1` is present.

Example route:

```txt
http://localhost:5204/?inboxDemo=1&fresh=1
```
