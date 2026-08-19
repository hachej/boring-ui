import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@hachej/boring-ui-kit"
import type { ConflictDecision, UploadConflictState } from "./uploadTypes"

export function FileUploadConflictDialog({
  conflict,
  onDecision,
}: {
  conflict: UploadConflictState | null
  onDecision: (decision: ConflictDecision) => void
}) {
  const count = conflict?.rows.length ?? 0
  return (
    <AlertDialog open={conflict !== null} onOpenChange={(open) => { if (!open) onDecision("cancel") }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Some files already exist</AlertDialogTitle>
          <AlertDialogDescription>
            {count} filename {count === 1 ? "conflict" : "conflicts"}. Files without conflicts have already been uploaded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onDecision("cancel")}>Cancel remaining</AlertDialogCancel>
          <AlertDialogAction onClick={() => onDecision("skip")}>Skip existing</AlertDialogAction>
          <AlertDialogAction onClick={() => onDecision("replace")}>Replace all</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
