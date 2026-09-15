import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { addItem, listItems } from "@/server/items"

export const Route = createFileRoute("/")({
  component: ItemsScreen,
  loader: () => listItems(),
})

function ItemsScreen() {
  const items = Route.useLoaderData()
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await addItem({ data: { title, note } })
      setTitle("")
      setNote("")
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add that.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Add an item</CardTitle>
          <CardDescription>A title, and a note if you want one.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Input
              name="title"
              aria-label="Title"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="sm:flex-1"
            />
            <Input
              name="note"
              aria-label="Note"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="sm:flex-1"
            />
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add item"}
            </Button>
          </form>
          {error ? (
            <p role="alert" className="text-destructive mt-3 text-sm">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>
            {items.length === 1 ? "1 item" : `${items.length} items`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    Nothing here yet.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} data-testid="item-row">
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.note ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {item.createdAt}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  )
}
