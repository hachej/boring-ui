import * as React from 'react'
import { cn } from './lib'

export type SettingsPanelProps = React.ComponentProps<'section'> & {
  icon?: React.ReactNode
  testId?: string
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  danger?: boolean
}

function SettingsPanel({ className, icon, title, description, footer, danger, testId, children, ...props }: SettingsPanelProps) {
  return (
    <section
      data-slot="settings-panel"
      data-testid={testId}
      className={cn('scroll-mt-6 overflow-hidden rounded-lg border border-border/60 bg-background shadow-none', className)}
      {...props}
    >
      <div data-slot="settings-panel-header" className="flex min-h-11 items-center gap-2 border-b border-border/50 px-4 py-2.5">
        {icon && <span data-slot="settings-panel-icon" className={danger ? 'text-destructive' : 'text-muted-foreground'}>{icon}</span>}
        <div className="min-w-0">
          <h2 data-slot="settings-panel-title" className={cn('text-[13px] font-medium leading-5', danger ? 'text-destructive' : 'text-foreground')}>{title}</h2>
          {description ? <p data-slot="settings-panel-description" className="text-[12px] leading-5 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div data-slot="settings-panel-body" className="p-4">{children}</div>
      {footer ? <div data-slot="settings-panel-footer" className="flex items-center justify-end gap-2 border-t border-border/50 bg-muted/10 px-4 py-3">{footer}</div> : null}
    </section>
  )
}

export type SettingsNavItem = { href: string; label: React.ReactNode; description?: React.ReactNode }
export type SettingsNavProps = React.ComponentProps<'nav'> & {
  label: string
  items: SettingsNavItem[]
}

function SettingsNav({ className, label, items, ...props }: SettingsNavProps) {
  return (
    <nav data-slot="settings-nav" aria-label={`${label} sections`} className={cn('boring-settings-nav', className)} {...props}>
      <p data-slot="settings-nav-label" className="boring-settings-nav-label">{label}</p>
      {items.map((item) => (
        <a data-slot="settings-nav-item" key={item.href} href={item.href} className="boring-settings-nav-item">
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium text-foreground">{item.label}</span>
            {item.description ? <span className="block truncate text-[11.5px] leading-4 text-muted-foreground">{item.description}</span> : null}
          </span>
        </a>
      ))}
    </nav>
  )
}

export type SettingsPageHeaderProps = React.ComponentProps<'header'> & {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  context?: React.ReactNode
}

function SettingsPageHeader({ className, eyebrow, title, description, context, children, ...props }: SettingsPageHeaderProps) {
  return (
    <header data-slot="settings-page-header" className={cn('boring-settings-page-header', className)} {...props}>
      {context}
      <div className="max-w-2xl">
        {eyebrow ? <p data-slot="settings-page-eyebrow" className="text-[11px] font-medium uppercase leading-4 text-muted-foreground">{eyebrow}</p> : null}
        <h1 data-slot="settings-page-title" className="mt-1 text-[20px] font-semibold leading-7 tracking-tight text-foreground">{title}</h1>
        {description ? <p data-slot="settings-page-description" className="mt-2 text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </header>
  )
}

export type SettingsActionRowProps = React.ComponentProps<'div'> & {
  title: React.ReactNode
  description?: React.ReactNode
  action: React.ReactNode
}

function SettingsActionRow({ className, title, description, action, ...props }: SettingsActionRowProps) {
  return (
    <div data-slot="settings-action-row" className={cn('boring-settings-action-row', className)} {...props}>
      <div className="min-w-0">
        <p data-slot="settings-action-title" className="text-[13px] font-medium leading-5 text-foreground">{title}</p>
        {description ? <p data-slot="settings-action-description" className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div data-slot="settings-action" className="shrink-0">{action}</div>
    </div>
  )
}

export type DetailLineProps = React.ComponentProps<'div'> & {
  icon?: React.ReactNode
  label: React.ReactNode
}

function DetailLine({ className, icon, label, children, ...props }: DetailLineProps) {
  return (
    <div data-slot="detail-line" className={cn('flex min-h-12 items-center gap-3 px-3 py-2 text-[13px]', className)} {...props}>
      {icon ? <span data-slot="detail-line-icon" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">{icon}</span> : null}
      <dt data-slot="detail-line-label" className="w-32 shrink-0 text-[12px] text-muted-foreground">{label}</dt>
      <dd data-slot="detail-line-value" className="min-w-0 flex-1 text-foreground">{children}</dd>
    </div>
  )
}

export { SettingsPanel, SettingsNav, SettingsPageHeader, SettingsActionRow, DetailLine }
