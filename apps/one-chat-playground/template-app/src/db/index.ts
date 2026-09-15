import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

/**
 * The one SQLite file this app owns. Server-side only — never import this
 * module from a component; go through a server function instead.
 */
export const DB_PATH = resolve(
  process.cwd(),
  process.env.DATABASE_URL ?? "./data/app.sqlite",
)

mkdirSync(dirname(DB_PATH), { recursive: true })

const sqlite = new Database(DB_PATH)
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")

export const db = drizzle(sqlite, { schema })
export { schema }
