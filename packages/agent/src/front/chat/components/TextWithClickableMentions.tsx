"use client"

import type { ReactNode } from 'react'
import { ClickableMentionLink, type ClickableMention as MentionType } from './ClickableMention'
import { parseMentions, type TextSegment } from './mentionParser'

export interface TextWithClickableMentionsProps {
  children: string
  availableCommands?: string[]
  onMentionClick?: (mention: MentionType) => void
  className?: string
}

export function TextWithClickableMentions({
  children,
  availableCommands,
  onMentionClick,
  className,
}: TextWithClickableMentionsProps) {
  const text = typeof children === 'string' ? children : String(children)
  const segments = parseMentions(text, availableCommands)

  if (segments.every(s => s.type === 'text')) {
    return <>{text}</>
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <span key={index}>{segment.content}</span>
        }
        
        if (segment.mention) {
          return (
            <ClickableMentionLink
              key={index}
              mention={segment.mention}
              onClick={onMentionClick}
              className={className}
            />
          )
        }

        return <span key={index}>{segment.content}</span>
      })}
    </>
  )
}
