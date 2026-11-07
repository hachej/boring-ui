import { Button } from "@boring/ui/shadcn/button";
import { Card, CardContent } from "@boring/ui/shadcn/card";
import { Dialog, DialogContent, DialogTitle } from "@boring/ui/shadcn/dialog";
import { Table } from "@boring/ui/shadcn/table";
import { Textarea } from "@boring/ui/shadcn/textarea";
import { FilePick } from "@boring/ui/blocks/file-pick/file-pick";

export function Clean({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <Card>
      <CardContent className="grid grid-cols-[1fr_var(--panel-w)] gap-4 p-4 text-sm data-[state=open]:bg-accent">
        <Button size="sm">Save</Button>
        <FilePick onFiles={onFiles}>Choose a file</FilePick>
        <a href="/docs" className="text-link underline underline-offset-4">Docs</a>
        <code className="font-mono">npm test</code>
        <Textarea variant="code" defaultValue="{}" />
        <div className="border rounded-md shadow-md w-[var(--panel-w)] bg-primary text-primary-foreground" />
      </CardContent>
    </Card>
  );
}

export const Overlay = () => (
  <Dialog>
    <DialogContent>
      <DialogTitle>Title</DialogTitle>
    </DialogContent>
  </Dialog>
);

// Prose is not a class: a width in a sentence is not an arbitrary value.
export const note = `Set w-[340px] here`;
export const Wrapped = () => <div className="overflow-x-hidden"><Table /></div>;
