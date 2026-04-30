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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
} from '@boring/workspace/ui-shadcn'
import * as WorkspaceUi from '@boring/workspace/ui-shadcn'
import { Check, ChevronsUpDown, Plus, Settings } from 'lucide-react'
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

export interface WorkspaceSwitcherProps {
  appTitle?: string
  workspacePathPrefix?: string
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

function hrefForWorkspace(prefix: string, workspaceId: string, suffix = ''): string {
  const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`
  return `${normalized.replace(/\/$/, '')}/${encodeURIComponent(workspaceId)}${suffix}`
}

export function WorkspaceSwitcher({
  appTitle = 'Boring',
  workspacePathPrefix = '/workspace',
}: WorkspaceSwitcherProps) {
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
      navigate(hrefForWorkspace(workspacePathPrefix, data.workspace.id))
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
          variant="ghost"
          onClick={openCreateWorkspace}
          className="-ml-1 h-9 gap-2 px-1.5"
        >
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
          >
            {appTitle.charAt(0).toUpperCase()}
          </span>
          <span className="text-[13px] font-medium tracking-tight text-foreground">
            Create your first workspace
          </span>
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Workspace menu: ${switcherLabel}`}
              className="-ml-1 flex min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
              >
                {appTitle.charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-medium tracking-tight text-foreground">
                  {appTitle}
                </span>
                <span aria-hidden="true" className="text-muted-foreground/30">/</span>
                <span className="truncate text-[13px] font-normal text-muted-foreground">
                  {switcherLabel}
                </span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            {workspaces.map((workspace) => {
              const isCurrent = currentWorkspace?.id === workspace.id
              return (
                <DropdownMenuItem
                  key={workspace.id}
                  data-current={isCurrent ? 'true' : 'false'}
                  onSelect={() => navigate(hrefForWorkspace(workspacePathPrefix, workspace.id))}
                >
                  <span className="truncate">{workspace.name}</span>
                  {isCurrent ? <Check className="ml-auto h-4 w-4" aria-hidden="true" /> : null}
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
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create workspace
            </DropdownMenuItem>

            {currentWorkspace ? (
              <DropdownMenuItem
                onSelect={() => navigate(hrefForWorkspace(workspacePathPrefix, currentWorkspace.id, '/settings'))}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                Workspace settings
              </DropdownMenuItem>
            ) : null}
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
