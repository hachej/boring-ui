import { useEffect, useState } from "react";
import { ScreenBody } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ViewProps } from "@hachej/boring-agent/host";

export default function NotesView({ call, read }: ViewProps) {
  const [notes, setNotes] = useState<{ number: number; text: string }[]>([]), [text, setText] = useState("");
  const refresh = (after?: unknown) => read("Notes", after).then((v) => setNotes(v?.notes ?? []), () => undefined);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 3000); return () => clearInterval(t); }, []);
  const add = async () => { if (text.trim()) { const receipt = await call("AddNote", { text }); setText(""); await refresh(receipt); } };
  return (
    <ScreenBody>
      <div className="flex gap-2 p-4 pb-0"><Input aria-label="New note" value={text} onChange={(e) => setText(e.target.value)} placeholder="New note" /><Button onClick={() => void add()}>Add</Button></div>
      <ul className="flex flex-col gap-2 p-4" data-testid="notes">{notes.map((n) => <li key={n.number} className="rounded-md border p-3 text-sm">{n.text}</li>)}{notes.length === 0 && <li className="text-sm text-muted-foreground">No notes.</li>}</ul>
    </ScreenBody>
  );
}
