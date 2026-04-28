import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
} from '@boring/workspace/ui-shadcn'
import * as WorkspaceUi from '@boring/workspace/ui-shadcn'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { type Workspace } from '../../shared/types.js'
import {
  WORKSPACES_QUERY_KEY,
  useCurrentWorkspace,
  workspaceQueryKey,
} from '../WorkspaceAuthProvider.js'
import { apiFetchJson, getHttpErrorDetail } from '../utils.js'

const workspaceNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Workspace name is required')
    .max(100, 'Workspace name must be 100 characters or fewer'),
})

type ToastArgs = {
  title?: string
  description?: string
  variant?: 'default' | 'destructive'
}

type ToastApi = {
  toast: (args: ToastArgs) => void
}

function useToastCompat(): ToastApi {
  const maybeUseToast = (WorkspaceUi as unknown as {
    useToast?: () => ToastApi
  }).useToast

  const useToast = maybeUseToast ?? (() => ({ toast: () => {} }))
  return useToast()
}

function validateWorkspaceName(name: string): {
  parsedName: string | null
  message: string | null
} {
  const parsed = workspaceNameSchema.safeParse({ name })
  if (!parsed.success) {
    return {
      parsedName: null,
      message: parsed.error.issues[0]?.message ?? 'Invalid workspace name',
    }
  }

  return {
    parsedName: parsed.data.name,
    message: null,
  }
}

function useWorkspaces() {
  return useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: async () => {
      const data = await apiFetchJson<{ workspaces: Workspace[] }>('/api/v1/workspaces')
      return data.workspaces
    },
  })
}

export function WorkspaceSwitcher() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToastCompat()
  const currentWorkspace = useCurrentWorkspace()
  const workspacesQuery = useWorkspaces()
  const workspaces = workspacesQuery.data ?? []

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const nameValidation = useMemo(() => validateWorkspaceName(name), [name])
  const shouldShowNameError = name.length > 100 || (attemptedSubmit && nameValidation.message !== null)
  const nameError = shouldShowNameError ? nameValidation.message : null

  function openCreateWorkspace(): void {
    setIsModalOpen(true)
    setServerError(null)
  }

  function resetModalState(): void {
    setName('')
    setAttemptedSubmit(false)
    setIsSubmitting(false)
    setServerError(null)
  }

  function onModalChange(nextOpen: boolean): void {
    setIsModalOpen(nextOpen)
    if (!nextOpen) {
      resetModalState()
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAttemptedSubmit(true)
    setServerError(null)

    const parsed = workspaceNameSchema.safeParse({ name })
    if (!parsed.success) {
      return
    }

    setIsSubmitting(true)

    try {
      const data = await apiFetchJson<{ workspace: Workspace }>('/api/v1/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: parsed.data.name }),
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: workspaceQueryKey(data.workspace.id) }),
      ])
      onModalChange(false)
      navigate(`/workspace/${data.workspace.id}`)
    } catch (error) {
      const detail = getHttpErrorDetail(error)
      if (typeof detail.status === 'number' && detail.status >= 400 && detail.status < 500) {
        toast({
          title: 'Unable to create workspace',
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

  const switcherLabel = currentWorkspace?.name ?? 'Select workspace'

  return (
    <>
      {workspaces.length === 0 ? (
        <Button
          type="button"
          variant="outline"
          onClick={openCreateWorkspace}
        >
          Create your first workspace
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label="Workspace switcher"
            >
              {switcherLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {workspaces.map((workspace) => {
              const isCurrent = currentWorkspace?.id === workspace.id
              return (
                <DropdownMenuItem
                  key={workspace.id}
                  data-current={isCurrent ? 'true' : 'false'}
                  onSelect={() => navigate(`/workspace/${workspace.id}`)}
                >
                  <span className="truncate">{workspace.name}</span>
                </DropdownMenuItem>
              )
            })}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={(event: any) => {
                event.preventDefault()
                openCreateWorkspace()
              }}
            >
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={isModalOpen} onOpenChange={onModalChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              Choose a name for your new workspace.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(event) => void handleCreateWorkspace(event)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Name</Label>
              <Input
                id="workspace-name"
                name="name"
                value={name}
                maxLength={101}
                onChange={(event) => {
                  setName(event.target.value)
                  if (serverError) setServerError(null)
                }}
                placeholder="My Workspace"
                aria-invalid={nameError ? 'true' : 'false'}
                autoFocus
              />
              {nameError ? (
                <p role="alert" className="text-sm text-destructive">{nameError}</p>
              ) : null}
              {serverError ? (
                <p role="alert" className="text-sm text-destructive">{serverError}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onModalChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || nameValidation.parsedName === null}
              >
                {isSubmitting ? 'Creating...' : 'Create workspace'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
