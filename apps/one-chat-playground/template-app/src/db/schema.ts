import { sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * One table per "thing" the app keeps.
 * Schema changes are additive only: new tables, new nullable columns, new
 * columns with a safe default. Never drop, rename or retype a column.
 */
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  note: text("note"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
})

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
