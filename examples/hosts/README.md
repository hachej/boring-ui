# Host recipes

> Library host recipes, not how apps ship: apps ship through the [Factory](https://github.com/hachej/boring-factory/blob/main/docs/PROVISIONING.md).

Where the same agent runs in production-shaped environments: [`cloudflare/`](cloudflare/README.md) (Workers and Durable Objects) and [`aws/`](aws/README.md) (AgentCore Runtime, Code Interpreter, EFS).

Each folder has its own README with the offline proof and the live-run commands.
Run the offline journeys with `npm run aws:journey` and `npm run cloudflare:build`.
