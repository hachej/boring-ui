import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { defineConfig } from "drizzle-kit"

// The one SQLite file this app owns. Keep this in sync with src/db/index.ts.
const url = process.env.DATABASE_URL ?? "./data/app.sqlite"
mkdirSync(dirname(resolve(process.cwd(), url)), { recursive: true })

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: false,
  verbose: false,
})
