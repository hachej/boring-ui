---
name: add-tool
description: Give the in-app assistant a new action it can perform on the app's data — a pi extension under .pi/extensions that reads or writes the SQLite through the app's own db module. Use for "let the assistant do X", "add a tool/command".
---

# Add a tool

A tool is one TypeScript file in `.pi/extensions/`. It is loaded by the
assistant runtime, runs in Node beside the app, and reaches data through the
app's own `src/db` module — never through a second connection or raw file read.

## Template

`.pi/extensions/count-items.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "count_items",
    label: "Count items",
    description: "Count how many items the app is keeping.",
    parameters: Type.Object({
      search: Type.Optional(Type.String({ description: "Only titles containing this" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { db, schema } = await import(
        pathToFileURL(join(ctx.cwd, "src/db/index.ts")).href
      );
      const rows = db.select().from(schema.items).all();
      const matches = params.search
        ? rows.filter((r: { title: string }) => r.title.includes(params.search!))
        : rows;
      return {
        content: [{ type: "text", text: `There are ${matches.length} items.` }],
        details: { count: matches.length },
      };
    },
  });
}
```

To write instead of read, use `db.insert(schema.items).values({...}).returning()`
inside the same `execute` — the same Drizzle calls the server functions use.

## Rules

- Tools go in `.pi/extensions/` only, one file per tool, `name` in snake_case.
- Read and write through `src/db` and Drizzle. Never open the SQLite file
  yourself, never shell out to `sqlite3`, never hand-edit rows.
- A tool never changes the schema; that is `add-table` plus `pnpm db:push`.
- Never touch config, dependencies, the dev server or `src/routeTree.gen.ts`.
- After adding a tool, run `bash verify.sh`.
