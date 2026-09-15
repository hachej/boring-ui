---
name: add-table
description: Make the app remember a new kind of thing — a Drizzle table in src/db/schema.ts, server functions to read and write it, and a list plus form on a screen. Use for "remember", "store", "keep track of", "add a field".
---

# Add a table

## Steps

1. **Schema** — append to `src/db/schema.ts`, next to `items`:

   ```ts
   export const notes = sqliteTable("notes", {
     id: integer("id").primaryKey({ autoIncrement: true }),
     title: text("title").notNull(),
     body: text("body"), // nullable = safe to add later
     createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
   })
   export type Note = typeof notes.$inferSelect
   ```

2. **Apply it** — `pnpm db:push`. That is the only way the database changes.
   To read the SQL first: `pnpm db:generate-sql` and look in `drizzle/`.
3. **Server functions** — a new file `src/server/notes.ts`, copying
   `src/server/items.ts`:

   ```ts
   export const listNotes = createServerFn({ method: "GET" }).handler(
     async () => db.select().from(notes).orderBy(desc(notes.id)).all(),
   )
   export const addNote = createServerFn({ method: "POST" })
     .validator((input: { title: string }) => {
       const title = String(input?.title ?? "").trim()
       if (!title) throw new Error("A title is required.")
       return { title }
     })
     .handler(async ({ data }) => (await db.insert(notes).values(data).returning())[0])
   ```

4. **Screen** — load with `loader: () => listNotes()`, render with shadcn
   `Table`, add with a shadcn `Input` + `Button` form, then
   `await router.invalidate()` so the list refreshes. See `src/routes/index.tsx`.
5. Run `bash verify.sh`.

## Rules

- **Additive only**: new tables, new nullable columns, new columns with a safe
  default. Never drop, rename or retype a column — old rows must survive.
- Drizzle only. No raw SQL, no other database, no second data file.
- Never edit rows by hand or with a script; the app's own form writes data.
- Never touch `drizzle.config.ts`, `src/db/index.ts`, dependencies or configs.
