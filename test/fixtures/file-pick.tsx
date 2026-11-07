// FilePick (D-1783) as an app uses it: the button form (default, outline, sm, busy) and the drop form (idle, drag-over, a refusal the app words).
// Fictional text. Drive drag-over with dragenter on [data-testid=drop-over] and a refusal by dropping a file on [data-testid=drop-refuse].
import { createRoot } from "react-dom/client"
import { useState } from "react"
import { FilePick, type FilePickRefusal } from "../../registry/file-pick/file-pick"

const WORDS = { type: "is not a PDF or an image", size: "is over 2 MB", count: "was not taken: one file only" }

function Refusing() {
  const [refused, setRefused] = useState<FilePickRefusal[]>([])
  return (
    <div className="flex flex-col gap-2" data-testid="drop-refuse">
      <FilePick drop accept="application/pdf,image/*" maxSize={2_000_000} onFiles={() => setRefused([])} onRefused={setRefused}>Choose a file</FilePick>
      {refused.map(item => <p key={item.file.name} role="alert" className="m-0 text-xs text-destructive-soft-foreground">{item.file.name} {WORDS[item.reason]}</p>)}
    </div>
  )
}

function Page() {
  const none = () => {}
  return (
    <main className="flex flex-col gap-6 p-4">
      <section className="flex flex-wrap items-center gap-3" data-testid="buttons">
        <FilePick onFiles={none}>Choose a file</FilePick>
        <FilePick variant="outline" onFiles={none}>Choose a file</FilePick>
        <FilePick variant="outline" size="sm" onFiles={none}>Choose a file</FilePick>
        <FilePick busy onFiles={none}>Sending</FilePick>
        <FilePick disabled variant="outline" onFiles={none}>Choose a file</FilePick>
      </section>
      <section className="flex flex-col gap-4">
        <div data-testid="drop-idle"><FilePick drop multiple variant="outline" onFiles={none}>Add files</FilePick></div>
        <div data-testid="drop-over"><FilePick drop onFiles={none}>Choose a file</FilePick></div>
        <Refusing />
        <div data-testid="drop-busy"><FilePick drop busy onFiles={none}>Sending</FilePick></div>
      </section>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<Page />)
