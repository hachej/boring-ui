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
  useToast,
} from '@hachej/boring-ui-kit'
import { ChevronsUpDown, LayoutGrid, Plus, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { type MemberRole, type Workspace } from '../../shared/types.js'
import {
  WORKSPACES_QUERY_KEY,
  useCurrentWorkspace,
  workspaceQueryKey,
} from '../WorkspaceAuthProvider.js'
import { useOptionalConfig } from '../ConfigProvider.js'
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

function workspaceInitial(name: string): string {
  return (name.trim()[0] ?? 'W').toUpperCase()
}

function OpenInNewTabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

export function WorkspaceSwitcher({
  appTitle,
  workspacePathPrefix = '/workspace',
}: WorkspaceSwitcherProps) {
  const config = useOptionalConfig()
  const resolvedAppTitle = appTitle ?? config?.appName ?? 'Boring UI'
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
      onModalChange(false)
      navigate(hrefForWorkspace(workspacePathPrefix, data.workspace.id))
      void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: workspaceQueryKey(data.workspace.id) })
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

  function openWorkspaceInNewTab(workspaceId: string): void {
    window.open(hrefForWorkspace(workspacePathPrefix, workspaceId), '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      {workspaces.length === 0 ? (
        <Button
          type="button"
          variant="ghost"
          onClick={openCreateWorkspace}
          className="-ml-1 h-8 gap-2 rounded-md px-1 pr-2.5 hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
          >
            {resolvedAppTitle.charAt(0).toUpperCase()}
          </span>
          <span className="text-[13px] font-medium text-foreground">
            Create your first workspace
          </span>
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Workspace menu: ${switcherLabel}`}
              className="-ml-1 h-8 min-w-0 justify-start gap-2.5 border border-transparent px-1 py-1 text-left"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
              >
                {resolvedAppTitle.charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-foreground">
                  {resolvedAppTitle}
                </span>
                <span aria-hidden="true" className="text-muted-foreground/30">/</span>
                <span className="truncate text-[13px] font-normal text-muted-foreground">
                  {switcherLabel}
                </span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            className="w-80 rounded-lg border-border/70 bg-[color:var(--surface-workbench-left)] p-2 shadow-2xl"
          >
            <DropdownMenuLabel className="px-2 pb-2 pt-1">
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                Workspaces
              </span>
            </DropdownMenuLabel>
            <div className="max-h-72 overflow-y-auto pr-1">
              {workspaces.map((workspace) => {
                const isCurrent = currentWorkspace?.id === workspace.id
                return (
                  <div key={workspace.id} className="group relative w-full">
                    <DropdownMenuItem
                      aria-label={workspace.name}
                      data-current={isCurrent ? 'true' : 'false'}
                      onSelect={() => navigate(hrefForWorkspace(workspacePathPrefix, workspace.id))}
                      style={{ paddingRight: 72 }}
                      className="gap-3 rounded-md py-2 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-xs font-semibold text-muted-foreground">
                        {workspaceInitial(workspace.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{workspace.name}</span>
                    </DropdownMenuItem>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Open ${workspace.name} in new tab`}
                      title="Open in new tab"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        openWorkspaceInNewTab(workspace.id)
                      }}
                      style={{ right: 4, top: '50%', transform: 'translateY(-50%)' }}
                      className="absolute z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-foreground/10 hover:text-foreground focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      <OpenInNewTabIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>

            <DropdownMenuSeparator className="-mx-2" />

            <DropdownMenuItem
              aria-label="Create workspace"
              onSelect={(event: Event) => {
                event.preventDefault()
                openCreateWorkspace()
              }}
              className="gap-3 rounded-md py-2 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span>Create workspace</span>
                <span className="text-xs text-muted-foreground">Start a clean project space</span>
              </span>
            </DropdownMenuItem>

            {currentWorkspace ? (
              <DropdownMenuItem
                aria-label="Workspace settings"
                onSelect={() => navigate(hrefForWorkspace(workspacePathPrefix, currentWorkspace.id, '/settings'))}
                className="gap-3 rounded-md py-2 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span>Workspace settings</span>
                  <span className="text-xs text-muted-foreground">Rename, runtime, deletion</span>
                </span>
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
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="workspace-name">Name</Label>
                <span className="text-xs text-muted-foreground">{name.length}/100</span>
              </div>
              <Input
                id="workspace-name"
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
