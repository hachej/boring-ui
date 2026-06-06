"use client"

import { AlertCircleIcon, Loader2, PaperclipIcon } from 'lucide-react'
import { IconButton } from '@hachej/boring-ui-kit'
import { composerActionClass } from '../../chatPanelComposerControls'
import { cn } from '../../lib'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '../../primitives/attachments'
import { usePromptInputAttachments } from '../../primitives/prompt-input'

export function AttachmentButton({ disabled, className }: { disabled?: boolean; className?: string }) {
  const attachments = usePromptInputAttachments()
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={() => {
        if (!disabled) attachments.openFileDialog()
      }}
      className={cn(composerActionClass, 'w-8', className)}
      aria-label="Attach files"
      title={disabled ? 'Attachments are available when the composer is ready.' : 'Attach files'}
    >
      <PaperclipIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </IconButton>
  )
}

export function AttachmentsList() {
  const attachments = usePromptInputAttachments()
  if (attachments.files.length === 0) return null
  return (
    <Attachments
      data-align="block-start"
      variant="inline"
      className="w-full flex-wrap items-center justify-start gap-2 px-5 pb-1 pt-3"
    >
      {attachments.files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={() => attachments.remove(file.id)}
          className={cn(
            '!h-9 !gap-2 !rounded-full !border-input/80 !bg-muted/40 !pl-1 !pr-2',
            'transition-colors hover:!bg-muted/70 hover:!text-foreground',
            file.status === 'error' && '!border-destructive/50 !bg-destructive/10',
          )}
        >
          <div className="relative shrink-0">
            <AttachmentPreview className="!size-7 overflow-hidden !rounded-full bg-background/60" />
            {file.status === 'uploading' ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              </div>
            ) : null}
            {file.status === 'error' ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-destructive/20">
                <AlertCircleIcon className="size-3.5 text-destructive" />
              </div>
            ) : null}
          </div>
          <AttachmentInfo className="min-w-0 !max-w-[180px] truncate text-[13px] font-medium" />
          <AttachmentRemove className="!size-5 !rounded-full !opacity-100 text-muted-foreground/80 hover:text-foreground" />
        </Attachment>
      ))}
    </Attachments>
  )
}
