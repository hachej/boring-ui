import { Button } from "@boring/ui/shadcn/button";
import { Card, CardContent } from "@boring/ui/shadcn/card";
import { FilePick } from "@boring/ui/blocks/file-pick/file-pick";

export function Clean({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <Card>
      <CardContent className="grid grid-cols-[1fr_var(--panel-w)] gap-4 p-4 text-sm data-[state=open]:bg-accent">
        <Button size="sm">Save</Button>
        <FilePick onFiles={onFiles}>Choose a file</FilePick>
        <a href="/docs" className="text-link underline underline-offset-4">Docs</a>
        <code className="font-mono">npm test</code>
        <div className="w-[var(--panel-w)] bg-primary text-primary-foreground" />
      </CardContent>
    </Card>
  );
}
