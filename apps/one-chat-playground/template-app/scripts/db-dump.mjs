// Node equivalent of `sqlite3 <db> .dump`, used when the sqlite3 CLI is absent.
//   node scripts/db-dump.mjs <db-path> <out-path>
import { createWriteStream } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")

const [dbPath, outPath] = process.argv.slice(2)
if (!dbPath || !outPath) {
  console.error("usage: node scripts/db-dump.mjs <db-path> <out-path>")
  process.exit(2)
}

const db = new Database(dbPath, { readonly: true })
const out = createWriteStream(outPath)

const quote = (v) => {
  if (v === null || v === undefined) return "NULL"
  if (typeof v === "number" || typeof v === "bigint") return String(v)
  if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`
  return `'${String(v).replaceAll("'", "''")}'`
}

out.write("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n")

const objects = db
  .prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
  )
  .all()

for (const object of objects) {
  out.write(`${object.sql};\n`)
  if (object.type !== "table") continue
  for (const row of db.prepare(`SELECT * FROM "${object.name}"`).all()) {
    const columns = Object.keys(row)
      .map((c) => `"${c}"`)
      .join(", ")
    const values = Object.values(row).map(quote).join(", ")
    out.write(`INSERT INTO "${object.name}" (${columns}) VALUES (${values});\n`)
  }
}

out.write("COMMIT;\n")
out.end()
db.close()
