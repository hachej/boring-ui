import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useToast,
} from '@hachej/boring-ui-kit'
import { z } from 'zod'

import { type MemberRole, type Workspace } from '../../shared/types.js'
import { WORKSPACES_QUERY_KEY, workspaceQueryKey } from '../WorkspaceAuthProvider.js'
import { apiFetchJson, getHttpErrorDetail } from '../utils.js'

const workspaceNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Workspace name is required')
    .max(100, 'Workspace name must be 100 characters or fewer'),
})

export interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the workspace is created and the cache is primed. */
  onCreated?: (workspace: Workspace) => void
  title?: string
  description?: string
  /** Label for the submit button / spinner text noun. Defaults to "workspace". */
  entityNoun?: string
}

/**
 * Standalone "create a workspace" dialog, extracted from `WorkspaceSwitcher` so
 * the multi-project app-left pane can offer a real form instead of a
 * `window.prompt` (plan: multi-project-left-bar §7.2). Controlled via
 * `open`/`onOpenChange`; primes the workspaces cache and calls `onCreated`
 * (e.g. to navigate to the new workspace).
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
  title = 'Create workspace',
  description = 'Choose a name for your new workspace.',
  entityNoun = 'workspace',
}: CreateWorkspaceDialogProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const validation = useMemo(() => workspaceNameSchema.safeParse({ name }), [name])
  const shouldShowNameError = name.length > 100 || (attemptedSubmit && !validation.success)
  const nameError = shouldShowNameError && !validation.success
    ? validation.error.issues[0]?.message ?? 'Invalid workspace name'
    : null

  function reset(): void {
    setName('')
    setAttemptedSubmit(false)
    setIsSubmitting(false)
    setServerError(null)
  }

  function handleOpenChange(next: boolean): void {
    onOpenChange(next)
    if (!next) reset()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAttemptedSubmit(true)
    setServerError(null)

    const parsed = workspaceNameSchema.safeParse({ name })
    if (!parsed.success) return

    setIsSubmitting(true)
    try {
      const data = await apiFetchJson<{ workspace: Workspace; role: MemberRole }>('/api/v1/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: parsed.data.name }),
      })

      queryClient.setQueryData(workspaceQueryKey(data.workspace.id), data)
      queryClient.setQueryData<Workspace[]>(WORKSPACES_QUERY_KEY, (current = []) => {
        if (current.some((workspace) => workspace.id === data.workspace.id)) return current
        return [...current, data.workspace]
      })
      handleOpenChange(false)
      onCreated?.(data.workspace)
      void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: workspaceQueryKey(data.workspace.id) })
    } catch (error) {
      const detail = getHttpErrorDetail(error)
      if (typeof detail.status === 'number' && detail.status >= 400 && detail.status < 500) {
        toast({
          title: `Unable to create ${entityNoun}`,
          description: detail.message,
          variant: 'destructive',
        })
      } else {
        setServerError(detail.message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="create-workspace-name">Name</Label>
              <span className="text-xs text-muted-foreground">{name.length}/100</span>
            </div>
            <Input
              id="create-workspace-name"
              name="name"
              value={name}
              maxLength={101}
              onChange={(event) => {
                setName(event.target.value)
                if (serverError) setServerError(null)
              }}
              placeholder="Default workspace"
              aria-invalid={nameError ? 'true' : 'false'}
              autoFocus
            />
            {nameError ? <p role="alert" className="text-sm text-destructive">{nameError}</p> : null}
            {serverError ? <p role="alert" className="text-sm text-destructive">{serverError}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !validation.success}>
              {isSubmitting ? 'Creating...' : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
