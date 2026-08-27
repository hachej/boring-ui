# Building with @hachej/boring-ui-kit

IDE-style UI primitives (panes, toolbars, dialogs, forms) for panel-based apps. Everything is exported flat from `window.BoringUIKit` — there are no dotted compound namespaces; `DialogContent` is a top-level export, not `Dialog.Content`.

## Setup: no provider, two exceptions

Components read no React context by default — render any of them directly, no app-level wrapper needed. Two exceptions:

- **`Tooltip`** must be inside `TooltipProvider`. Wrap once near the root.
- **`toast()`** needs `<Toaster />` mounted once anywhere in the tree.

## Theme: tokens, and a `data-theme` attribute

All color/radius/font values are CSS custom properties named `--boring-*`, defined for light on `:root` and for dark under the attribute selector `[data-theme="dark"]`. Dark mode is set by putting `data-theme="dark"` on a wrapper element (or `<html>`) — **not** by a `.dark` class.

Real token names (from `tokens/tokens.css`): `--boring-background`, `--boring-foreground`, `--boring-card`, `--boring-card-foreground`, `--boring-popover`, `--boring-popover-foreground`, `--boring-primary`, `--boring-primary-foreground`, `--boring-secondary`, `--boring-secondary-foreground`, `--boring-muted`, `--boring-muted-foreground`, `--boring-accent`, `--boring-accent-foreground`, `--boring-accent-soft`, `--boring-success`, `--boring-success-foreground`, `--boring-success-soft`, `--boring-destructive`, `--boring-destructive-foreground`, `--boring-border`, `--boring-input`, `--boring-ring`, `--boring-canvas`, `--boring-radius` (+ `-sm/-md/-lg/-xl`), `--boring-font-sans`, `--boring-font-mono`.

Each also has an unprefixed alias (`--background`, `--primary`, `--border`, `--radius`, …) which is what the utility classes below actually resolve against. To rebrand, override `--boring-accent` and `--boring-ring` together — they are the same value by default, so focus rings stay on-brand.

## Styling idiom: semantic utility classes — but a FIXED set

Components accept `className` and merge it with `tailwind-merge`, so passing `className="bg-muted"` overrides the component's own background rather than fighting it.

**Critical constraint:** the shipped stylesheet is compiled, not a live Tailwind build. It contains **only the ~280 utility classes the kit's own components use**. Arbitrary Tailwind (`grid-cols-3`, `mt-8`, `w-1/2`, `hover:scale-105`) is **not** in the CSS and will silently do nothing.

Classes that DO ship, by family:

| Family | Real names available |
|---|---|
| Background | `bg-background` `bg-card` `bg-muted` `bg-primary` `bg-secondary` `bg-accent` `bg-destructive` `bg-input` `bg-border` `bg-foreground` `bg-transparent` |
| Text color | `text-foreground` `text-muted-foreground` `text-card-foreground` `text-primary` `text-primary-foreground` `text-accent-foreground` `text-destructive` `text-success` |
| Text size/weight | `text-xs` `text-sm` `text-base` `font-normal` `font-medium` `font-semibold` |
| Border | `border` `border-0` `border-2` `border-b` `border-border` `border-input` `border-accent` `border-destructive` `border-dashed` |
| Radius | `rounded-xs` `rounded-sm` `rounded-md` `rounded-lg` `rounded-xl` `rounded-full` `rounded-none` |
| Layout | `flex` `flex-1` `flex-col` `flex-wrap` `items-center` `justify-between` `gap-0..4` `gap-6` |
| Spacing | `p-0..4` `p-6` `p-8` `p-px` |
| Size | `h-1..10` `w-full` `w-fit` `w-32` `w-64` `size-2..10` `size-full` `min-h-0` `min-w-0` |
| Effect | `shadow-xs` `shadow-sm` `shadow-md` `shadow-lg` `transition-colors` `transition-all` `cursor-pointer` |

**For layout glue outside that set, use inline `style` with the tokens** — that always works and stays on-theme:

```jsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
              background: 'var(--boring-card)', borderRadius: 'var(--boring-radius-lg)' }} />
```

Never hardcode a hex color. Every color goes through a `--boring-*` token.

## Where the truth lives

- `styles.css` — the entry; `@import`s `_ds_bundle.css` (all component CSS) and `tokens/tokens.css` (all token values). Read these before styling.
- `components/<Name>/<Name>.d.ts` — the real props contract.
- `components/<Name>/<Name>.prompt.md` — per-component usage.

## Idiomatic example

```jsx
const { Pane, PaneHeader, PaneTitle, PaneBody, PaneFooter, PaneToolbar,
        Button, IconButton, Field, FieldLabel, Input, Badge } = window.BoringUIKit

<Pane className="h-full">
  <PaneHeader>
    <PaneTitle>Connection</PaneTitle>
    <PaneToolbar>
      <Badge variant="secondary">Draft</Badge>
      <IconButton aria-label="Close">×</IconButton>
    </PaneToolbar>
  </PaneHeader>
  <PaneBody>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field>
        <FieldLabel>Host</FieldLabel>
        <Input placeholder="db.internal" />
      </Field>
      <p className="text-xs text-muted-foreground">Credentials are stored per workspace.</p>
    </div>
  </PaneBody>
  <PaneFooter>
    <Button variant="ghost" size="sm">Cancel</Button>
    <Button size="sm">Connect</Button>
  </PaneFooter>
</Pane>
```

`Pane` is panel chrome (header/body/footer, body is the only scroll container); `Card` is a content block inside a page. Don't use `Card` for panel chrome.
