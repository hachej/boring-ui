import { Children, isValidElement } from 'react'
import type { ComponentProps, JSX, ReactElement, ReactNode } from 'react'
import type { Components } from 'streamdown'
import type { SlashCommand, SlashCommandClickBehavior } from '../../slashCommands'
import { cn } from '../../lib'
import { INLINE_CODE_CLASS_NAME } from '../../primitives/markdownStyles'

export type ActionableSlashCommand = Pick<SlashCommand, 'name' | 'clickBehavior'> & {
  clickBehavior: Exclude<SlashCommandClickBehavior, 'disabled'>
}

export interface MessageMentionSkill {
  name: string
  commandName: string
}

export interface MessageMentionCatalog {
  commands: readonly ActionableSlashCommand[]
  skills: readonly MessageMentionSkill[]
  files: boolean
}

export type MessageMention =
  | { kind: 'command'; name: string; label: string; behavior: ActionableSlashCommand['clickBehavior'] }
  | { kind: 'skill'; name: string; commandName: string; label: string }
  | { kind: 'file'; path: string; label: string }

export interface MessageMentionSegment {
  text: string
  mention?: MessageMention
}

interface MentionCandidate {
  start: number
  end: number
  mention: MessageMention
}

const TERMINAL_BOUNDARY = String.raw`(?=$|\s|[.,;!?)}\]"'”’]+(?=$|\s))`
const PREFIX_BOUNDARY = String.raw`(^|[\s(\[{"'“‘])`

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function registeredNamePattern(names: readonly string[]): string | undefined {
  const safeNames = [...new Set(names)]
    .filter((name) => /^\w[\w-]*$/.test(name))
    .sort((a, b) => b.length - a.length)
  return safeNames.length > 0 ? safeNames.map(escapeRegExp).join('|') : undefined
}

function addRegisteredCandidates(
  text: string,
  prefix: '/' | '!',
  names: readonly string[],
  createMention: (name: string) => MessageMention | undefined,
  candidates: MentionCandidate[],
): void {
  const namesPattern = registeredNamePattern(names)
  if (!namesPattern || !text.includes(prefix)) return
  const pattern = new RegExp(`${PREFIX_BOUNDARY}\\${prefix}(${namesPattern})${TERMINAL_BOUNDARY}`, 'g')
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    const boundary = match[1] ?? ''
    const name = match[2]
    const mention = createMention(name)
    if (!mention) continue
    const start = match.index + boundary.length
    candidates.push({ start, end: start + name.length + 1, mention })
  }
}

function isSafeWorkspaceMentionPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('://')) return false
  const segments = path.split('/')
  if (!segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')) return false
  const basename = segments.at(-1) ?? ''
  return basename.startsWith('.') || /\.[A-Za-z0-9]{1,12}$/.test(basename)
}

function addFileCandidates(text: string, candidates: MentionCandidate[]): void {
  if (!text.includes('@')) return
  const pattern = new RegExp(`${PREFIX_BOUNDARY}@([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)${TERMINAL_BOUNDARY}`, 'g')
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    const boundary = match[1] ?? ''
    const path = match[2].replace(/[.,;!?]+$/, '')
    if (!isSafeWorkspaceMentionPath(path)) continue
    const start = match.index + boundary.length
    const label = `@${path}`
    candidates.push({ start, end: start + label.length, mention: { kind: 'file', path, label } })
  }
}

function collectMessageMentionCandidates(text: string, catalog: MessageMentionCatalog): MentionCandidate[] {
  const candidates: MentionCandidate[] = []
  const commandsByName = new Map(catalog.commands.map((command) => [command.name, command]))
  addRegisteredCandidates(text, '/', [...commandsByName.keys()], (name) => {
    const command = commandsByName.get(name)
    return command
      ? { kind: 'command', name, label: `/${name}`, behavior: command.clickBehavior }
      : undefined
  }, candidates)
  const skillsByName = new Map(catalog.skills.map((skill) => [skill.name, skill]))
  addRegisteredCandidates(text, '!', [...skillsByName.keys()], (name) => {
    const skill = skillsByName.get(name)
    return skill ? { kind: 'skill', name, commandName: skill.commandName, label: `!${name}` } : undefined
  }, candidates)
  if (catalog.files) addFileCandidates(text, candidates)
  return candidates
}

export function splitMessageMentions(
  text: string,
  catalog: MessageMentionCatalog,
  context: { before?: string; after?: string } = {},
): MessageMentionSegment[] {
  const before = context.before ?? ''
  const after = context.after ?? ''
  const source = `${before}${text}${after}`
  const contentStart = before.length
  const contentEnd = contentStart + text.length
  const candidates = collectMessageMentionCandidates(source, catalog)
    .filter((candidate) => candidate.start >= contentStart && candidate.end <= contentEnd)
    .map((candidate) => ({ ...candidate, start: candidate.start - contentStart, end: candidate.end - contentStart }))
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const segments: MessageMentionSegment[] = []
  let cursor = 0
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue
    if (candidate.start > cursor) segments.push({ text: text.slice(cursor, candidate.start) })
    segments.push({ text: candidate.mention.label, mention: candidate.mention })
    cursor = candidate.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments.length > 0 ? segments : [{ text }]
}

function mentionActionLabel(mention: MessageMention): string {
  if (mention.kind === 'command') return mention.behavior === 'execute' ? `Run ${mention.label} command` : `Insert ${mention.label} command`
  if (mention.kind === 'skill') return `Insert ${mention.label} skill`
  return `Open ${mention.path}`
}

function visibleText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isValidElement(node)) return ''
  const element = node as ReactElement<{ children?: ReactNode }>
  return Children.toArray(element.props.children).map(visibleText).join('')
}

export function MessageMentions({
  children,
  catalog,
  onActivate,
}: {
  children: ReactNode
  catalog: MessageMentionCatalog
  onActivate: (mention: MessageMention) => void
}) {
  const nodes = Children.toArray(children)
  const decorate = (child: ReactNode, index: number): ReactNode => {
    if (typeof child === 'string') {
      return splitMessageMentions(child, catalog, {
        before: visibleText(nodes[index - 1]),
        after: visibleText(nodes[index + 1]),
      }).map((segment, segmentIndex) => {
        if (!segment.mention) return segment.text
        const actionLabel = mentionActionLabel(segment.mention)
        return (
          <button
            key={`${index}:${segmentIndex}`}
            type="button"
            aria-label={actionLabel}
            title={actionLabel}
            data-message-mention-kind={segment.mention.kind}
            className={cn(
              'mx-0.5 inline-flex items-center rounded-[var(--radius-sm)] border border-border/70 bg-muted/55 px-1.5 py-0.5',
              'font-mono text-[0.9em] font-medium leading-none text-foreground underline-offset-2',
              'hover:bg-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            )}
            onClick={() => onActivate(segment.mention!)}
          >
            {segment.text}
          </button>
        )
      })
    }
    // Do not cross Markdown element boundaries. This keeps links/code inert and
    // prevents formatting splits from manufacturing a token boundary.
    return child
  }

  return nodes.map(decorate)
}

type MarkdownElementProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & { node?: unknown }

export function createMessageMentionMarkdownComponents(
  catalog: MessageMentionCatalog,
  onActivate: (mention: MessageMention) => void,
): Components {
  const decorate = (children: ReactNode) => <MessageMentions catalog={catalog} onActivate={onActivate}>{children}</MessageMentions>
  const paragraph = ({ node: _node, children, ...props }: MarkdownElementProps<'p'>) => {
    const content = Children.toArray(children).filter((child) => child !== null && child !== '')
    if (content.length === 1 && isValidElement(content[0])) {
      const child = content[0] as ReactElement<{ node?: { tagName?: string } }>
      if (child.props.node?.tagName === 'img') return <>{children}</>
    }
    return <p {...props}>{decorate(children)}</p>
  }
  const listItem = ({ node: _node, children, className, ...props }: MarkdownElementProps<'li'>) => (
    <li {...props} data-streamdown="list-item" className={cn('py-1 [&>p]:inline', className)}>{decorate(children)}</li>
  )
  const headingClasses = {
    h1: 'text-3xl',
    h2: 'text-2xl',
    h3: 'text-xl',
    h4: 'text-lg',
    h5: 'text-base',
    h6: 'text-sm',
  } as const
  const heading = (Tag: keyof typeof headingClasses) =>
    ({ node: _node, children, className, ...props }: MarkdownElementProps<typeof Tag>) => (
      <Tag {...props} data-streamdown={`heading-${Tag.slice(1)}`} className={cn('mt-6 mb-2 font-semibold', headingClasses[Tag], className)}>
        {decorate(children)}
      </Tag>
    )
  const inlineCode = ({ node: _node, children, className, ...props }: MarkdownElementProps<'code'>) => (
    <code
      {...props}
      className={cn(INLINE_CODE_CLASS_NAME, className)}
    >
      {children}
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
