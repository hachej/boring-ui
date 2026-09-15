import { createServerFn } from "@tanstack/react-start"
import { desc } from "drizzle-orm"
import { db } from "@/db"
import { items, type Item } from "@/db/schema"

/** Read every item, newest first. */
export const listItems = createServerFn({ method: "GET" }).handler(
  async (): Promise<Array<Item>> =>
    db.select().from(items).orderBy(desc(items.id)).all(),
)

export type AddItemInput = { title: string; note?: string }

/** Add one item. Returns the row that was written. */
export const addItem = createServerFn({ method: "POST" })
  .validator((input: AddItemInput) => {
    const title = String(input?.title ?? "").trim()
    if (!title) throw new Error("A title is required.")
    const note = String(input?.note ?? "").trim()
    return { title, note: note || null }
  })
  .handler(async ({ data }): Promise<Item> => {
    const [row] = await db.insert(items).values(data).returning()
    return row
  })
