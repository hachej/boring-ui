import { Children, cloneElement, isValidElement } from 'react'
import type { ComponentProps, JSX, ReactElement, ReactNode } from 'react'
import type { Components } from 'streamdown'
import type { SlashCommand, SlashCommandClickBehavior } from '../../slashCommands'
import { cn } from '../../lib'

export type ActionableSlashCommand = Pick<SlashCommand, 'name' | 'clickBehavior'> & {
  clickBehavior: Exclude<SlashCommandClickBehavior, 'disabled'>
}

export interface SlashCommandMentionsProps {
  children: ReactNode
  commands: readonly ActionableSlashCommand[]
  onActivate: (name: string) => void
}

interface SlashCommandSegment {
  text: string
  command?: ActionableSlashCommand
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function splitSlashCommandMentions(
  text: string,
  commands: readonly ActionableSlashCommand[],
): SlashCommandSegment[] {
  const byName = new Map(commands.map((command) => [command.name, command]))
  const names = [...byName.keys()]
    .filter((name) => /^\w[\w-]*$/.test(name))
    .sort((a, b) => b.length - a.length)
  if (names.length === 0 || !text.includes('/')) return [{ text }]

  const pattern = new RegExp(`(^|[\\s(\\[{"'])\\/(${names.map(escapeRegExp).join('|')})(?=$|\\s|[.,;!?)}\\]"'”’]+(?=$|\\s))`, 'g')
  const segments: SlashCommandSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const prefix = match[1] ?? ''
    const name = match[2]
    const command = byName.get(name)
    if (!command || match.index === undefined) continue
    const start = match.index + prefix.length
    if (start > cursor) segments.push({ text: text.slice(cursor, start) })
    segments.push({ text: `/${name}`, command })
    cursor = start + name.length + 1
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments.length > 0 ? segments : [{ text }]
}

const SKIP_ELEMENT_TYPES = new Set(['a', 'button', 'code', 'pre'])

export function SlashCommandMentions({ children, commands, onActivate }: SlashCommandMentionsProps) {
  const decorate = (child: ReactNode, index: number): ReactNode => {
    if (typeof child === 'string') {
      return splitSlashCommandMentions(child, commands).map((segment, segmentIndex) => {
        if (!segment.command) return segment.text
        const label = segment.command.clickBehavior === 'execute' ? 'Run' : 'Insert'
        return (
          <button
            key={`${index}:${segmentIndex}`}
            type="button"
            aria-label={`${label} /${segment.command.name} command`}
            title={`${label} /${segment.command.name} command`}
            className={cn(
              'mx-0.5 inline-flex items-center rounded-[var(--radius-sm)] border border-border/70 bg-muted/55 px-1.5 py-0.5',
              'font-mono text-[0.9em] font-medium leading-none text-foreground underline-offset-2',
              'hover:bg-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            )}
            onClick={() => onActivate(segment.command!.name)}
          >
            {segment.text}
          </button>
        )
      })
    }
    if (!isValidElement(child)) return child
    const element = child as ReactElement<{ children?: ReactNode; node?: { tagName?: string } }>
    const tagName = typeof child.type === 'string' ? child.type : element.props.node?.tagName
    if (tagName && SKIP_ELEMENT_TYPES.has(tagName)) return child
    return cloneElement(element, undefined, Children.map(element.props.children, decorate))
  }

  return Children.map(children, decorate)
}

type MarkdownElementProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & { node?: unknown }

export function createSlashCommandMarkdownComponents(
  commands: readonly ActionableSlashCommand[],
  onActivate: (name: string) => void,
): Components {
  const decorate = (children: ReactNode) => (
    <SlashCommandMentions commands={commands} onActivate={onActivate}>{children}</SlashCommandMentions>
  )
  const paragraph = ({ node: _node, children, ...props }: MarkdownElementProps<'p'>) => <p {...props}>{decorate(children)}</p>
  const listItem = ({ node: _node, children, ...props }: MarkdownElementProps<'li'>) => <li {...props}>{decorate(children)}</li>
  const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    ({ node: _node, children, ...props }: MarkdownElementProps<typeof Tag>) => <Tag {...props}>{decorate(children)}</Tag>
  const inlineCode = ({ node: _node, children, className, ...props }: MarkdownElementProps<'code'>) => (
    <code
      {...props}
      className={cn('rounded-[0.3em] bg-muted/55 px-[0.32em] py-[0.08em] font-mono text-[0.9em] font-medium text-foreground/90', className)}
    >
      {decorate(children)}
    </code>
  )

  return {
    p: paragraph,
    li: listItem,
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
    inlineCode,
  } as Components
}
