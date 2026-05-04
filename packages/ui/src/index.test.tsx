import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  Badge,
  Button,
  Chip,
  DetailLine,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  InlineCode,
  Kbd,
  Notice,
  Pane,
  PaneBody,
  PaneHeader,
  PaneTitle,
  SegmentedControl,
  SegmentedControlItem,
  Separator,
  SettingsActionRow,
  SettingsNav,
  SettingsPageHeader,
  SettingsPanel,
  Skeleton,
  Spinner,
  StatusBadge,
  Textarea,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
  TooltipProvider,
  cn,
} from './index'

describe('@boring/ui primitives', () => {
  it('merges Tailwind classes predictably', () => {
    expect(cn('px-2 text-sm', false, 'px-4')).toBe('text-sm px-4')
  })

  it('renders the core primitives with stable data slots', () => {
    const html = renderToStaticMarkup(
      <div>
        <Button variant="ghost" size="icon-sm">Open</Button>
        <Badge variant="secondary">Ready</Badge>
        <Input aria-label="Name" />
        <Textarea aria-label="Message" />
        <Separator />
        <TooltipProvider delayDuration={100}><span>Tip host</span></TooltipProvider>
        <IconButton aria-label="Icon action">I</IconButton>
        <Kbd>⌘K</Kbd>
        <Spinner />
        <EmptyState title="Empty" description="Nothing here" />
        <ErrorState title="Error" description="Broken" />
        <Notice tone="accent" title="Heads up" description="Consistent notice" />
        <Skeleton />
        <InlineCode>src/app.ts</InlineCode>
        <Chip>Filter</Chip>
        <SegmentedControl><SegmentedControlItem selected>Chart</SegmentedControlItem></SegmentedControl>
        <Toolbar><ToolbarGroup><ToolbarButton>Bold</ToolbarButton></ToolbarGroup><ToolbarSeparator /></Toolbar>
        <SettingsPanel id="settings" title="Settings"><DetailLine label="Name">Boring</DetailLine></SettingsPanel>
        <SettingsNav label="Settings" items={[{ href: '#settings', label: 'General', description: 'Basics' }]} />
        <SettingsPageHeader eyebrow="Account" title="Settings" description="Manage settings" />
        <SettingsActionRow title="Action" description="Do a thing" action={<Button size="xs">Run</Button>} />
        <Pane><PaneHeader><PaneTitle>Pane</PaneTitle></PaneHeader><PaneBody>Body</PaneBody></Pane>
        <StatusBadge tone="success">Ready</StatusBadge>
      </div>,
    )

    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="icon-sm"')
    expect(html).toContain('data-slot="badge"')
    expect(html).toContain('data-slot="input"')
    expect(html).toContain('data-slot="textarea"')
    expect(html).toContain('data-slot="separator"')
    expect(html).toContain('data-slot="kbd"')
    expect(html).toContain('data-slot="spinner"')
    expect(html).toContain('data-slot="empty-state"')
    expect(html).toContain('data-slot="error-state"')
    expect(html).toContain('data-slot="notice"')
    expect(html).toContain('data-tone="accent"')
    expect(html).toContain('data-slot="skeleton"')
    expect(html).toContain('data-slot="inline-code"')
    expect(html).toContain('data-slot="chip"')
    expect(html).toContain('data-slot="segmented-control"')
    expect(html).toContain('data-slot="toolbar"')
    expect(html).toContain('data-slot="settings-panel"')
    expect(html).toContain('data-slot="settings-nav"')
    expect(html).toContain('data-slot="settings-page-header"')
    expect(html).toContain('data-slot="settings-action-row"')
    expect(html).toContain('data-slot="pane"')
    expect(html).toContain('data-slot="status-badge"')
  })
})
