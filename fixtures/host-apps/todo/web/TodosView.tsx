import { useEffect, useState } from "react";
import { ScreenBody } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ViewProps } from "@hachej/boring-agent/host";

export default function TodosView({ call, read }: ViewProps) {
  const [items, setItems] = useState<{ number: number; text: string; done: boolean }[]>([]), [text, setText] = useState("");
  const refresh = (after?: unknown) => read("Todos", after).then((v) => setItems(v?.items ?? []), () => undefined);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 3000); return () => clearInterval(t); }, []);
  const add = async () => { if (text.trim()) { const receipt = await call("AddTodo", { text }); setText(""); await refresh(receipt); } };
  return (
    <ScreenBody>
      <div className="flex gap-2 p-4 pb-0"><Input aria-label="Nouvelle tâche" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nouvelle tâche" /><Button onClick={() => void add()}>Ajouter</Button></div>
      <ul className="flex flex-col gap-2 p-4" data-testid="todos">
        {items.map((i) => <li key={i.number} className="flex items-center gap-2 rounded-md border p-3 text-sm"><input type="checkbox" aria-label={`Terminer : ${i.text}`} checked={i.done} disabled={i.done} onChange={() => void call("CompleteTodo", { number: i.number }).then((r) => refresh(r))} /><span className={i.done ? "line-through text-muted-foreground" : ""}>{i.text}</span></li>)}
        {items.length === 0 && <li className="text-sm text-muted-foreground">Aucune tâche.</li>}
      </ul>
    </ScreenBody>
  );
}
