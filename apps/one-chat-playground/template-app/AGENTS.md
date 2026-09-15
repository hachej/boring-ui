These rules win over anything a skill suggests.

# Build this app

Keep every change inside this app and use only these parts:

- **Screens:** `src/routes/*.tsx`. The file name is the URL. Make new screens reachable with a TanStack Router `Link`; never edit generated `src/routeTree.gen.ts`.
- **Server functions:** `src/server/*.ts`. They are the only place data is read or written. Use TanStack `createServerFn`; do not add REST routes.
- **Tables:** `src/db/schema.ts`, through Drizzle and the existing `src/db` module only. Schema changes are additive: new tables, nullable columns, or columns with safe defaults. Never drop, rename, or retype anything. Apply changes with `pnpm db:push`, not migrations.
- **Components:** `src/components`. Use existing shadcn components or add them from the registry with `npx shadcn@latest add <name>`. Do not hand-roll replacements.

Do not add libraries. Never edit data by hand or with a script. Never touch configuration, dependencies, generated routes, or servers. Run `./verify.sh` before finishing and report success only when it passes.
