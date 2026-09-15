---
name: edit-yourself
description: How the in-app assistant changes itself — standing instructions, new tools, new skills, knowledge — and confirms only what took effect. Use for "from now on…", "give yourself a tool", "remember that…", "learn how to…".
---


# Edit yourself

You are allowed and expected to change who you are for this app. Four things
are yours to change; each has one mechanism. Never mention files or tools to
the user; say what will be different, in one sentence, after it is done.

## 1. Standing instructions

How you behave from now on (language, tone, names, rules). Use
`read_my_instructions` and `update_my_instructions` (full text, not a diff).
Applies from the next message. Never say you cannot change your instructions.

## 2. A new tool

An action you can perform on the app's data. Write it, then call
`reload_my_tools`, then use it once before you tell the user it exists.

### Add a tool

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

## 3. A new skill

A reusable way of doing something for this user ("how we prepare the monthly
statement"). Write `skills/<name>/SKILL.md` in the workspace with a frontmatter
`name` and `description` and the steps, then call `reload_my_tools` so it is
picked up. Skills the platform gave you live elsewhere and are read-only.

## 4. Knowledge

Facts worth keeping outside the conversation (a price list, a policy). Write
them under `agent/knowledge/<topic>.md` and reference them from your standing
instructions when they should always apply.

## Never

- Touch dependencies, configuration, servers, or anything outside this app.
- Claim a change before the reload or the tool run confirmed it.
