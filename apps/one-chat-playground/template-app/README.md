# template-app

The standard app: TanStack Start + SQLite (Drizzle) + shadcn/ui. Copy it into a
sandbox and let an agent grow it. One screen today: a list of items with a form.

## Four ideas — that is the whole model

| Idea | Lives in |
| --- | --- |
| a **screen** | `src/routes/*.tsx` (file name = URL) |
| a **server function** | `src/server/*.ts` (the only place data is touched) |
| a **table** | `src/db/schema.ts`, applied with `pnpm db:push` |
| a **component** | `npx shadcn@latest add <name>` → `src/components/ui/` |

## Run

```
pnpm install
pnpm db:push        # creates data/app.sqlite (gitignored)
pnpm dev            # PORT (default 5340) and HOST are respected
```

`/health` returns `{"ok":true}`. `bash scripts/db-dump.sh` writes a SQL backup.

## Rules

`AGENTS.md` is the one-screen builder contract and wins over skill advice:
shadcn components only, Drizzle only, additive schema changes, and no manual
data/config/dependency/server edits. App-specific assistant guidance lives in
`agent/instructions.md`; `skills/` keeps the separate add-tool guide plus the
vendored craft skills and their third-party licenses.

## verify

`bash verify.sh` — typecheck, generate the schema SQL and reject any
DROP/RENAME, `db:push`, boot the dev server on a free port, `GET /health` and
`GET /`, then stop. Non-zero on any failure.
