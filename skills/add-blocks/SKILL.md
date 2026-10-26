---
name: add-blocks
description: Find, install, update, check and theme Boring UI registry blocks (shadcn items such as pi-chat, pi-ambient, pi-workspace, pi-app, app-shell, viewers, file-tree, documents, feedback, windows) with the boring-ui-blocks command. Use when asked to "add a chat/agent block", "install pi-app", "upgrade/update the Boring blocks", "boring-ui-blocks check fails", "blocks edited", "restyle/rebrand the agent UI", "change the chat labels/icons/actions", "dark mode for the chat", or when tempted to edit a file under src/components/pi-*.
---

# Add and maintain blocks

Blocks are shadcn registry items: React source the shadcn CLI copies into the app. They are generated copies. The app installs them, configures them through props and theme tokens, and updates them with one command. It never edits them.

Prerequisites: React 19, Tailwind v4, a `components.json` with a Base UI style (only `base-nova` is supported), and `@hachej/boring-ui-kit` installed (the `boring-ui-blocks` command is its `bin`). A new app starts with `npx shadcn@4.21.5 init -t vite -b base -p nova -n app -y --no-monorepo`.

Run every command in the directory that holds `components.json`, or pass `--cwd <dir>`.

## Find a block

The registry for version `<v>` is `https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<v>/r/`. The installed kit ships the same items in `node_modules/@hachej/boring-ui-kit/r/`. List them with their descriptions:

```sh
node -e "const r=JSON.parse(require('fs').readFileSync('node_modules/@hachej/boring-ui-kit/r/registry.json','utf8'));for(const i of r.items)console.log(i.name.padEnd(18),(i.description??'').slice(0,90))"
```

Pick by placement ([full table](../../registry/README.md#blocks-what-to-install)):

| Need | Block |
| --- | --- |
| The conversation only, in your own layout | `pi-chat` |
| A floating bar over an existing site | `pi-ambient` (brings `pi-chat`, `pi-workspace`) |
| Chat plus a resizable artifact panel | `pi-workspace` (brings `pi-chat`) |
| A whole agent page: sessions, chat, viewers | `pi-app` (brings `pi-chat`, `pi-workspace`, `viewers`) |
| One agent above any app, drawer on phones | `app-shell` (brings `pi-chat`, `feedback`, `sidebar`, `avatar`, `drawer`, `dropdown-menu`) |
| Chat and files in resizable docks | `dock` |
| The Library and file history alone | `file-tree`, `documents`, `version-history` |
| Viewers for agent artifacts | `viewers`, `markdown-editor`, `html-viewer`, `mockup-viewer`, `diagram-viewer`, `maquette-viewer`, `record-viewer`, `board-viewer`, `task-list-viewer` |
| User feedback (point, dictate, send) | `feedback`, `feedback-preview` |
| Model and key picker | `provider-setup` |
| Floating utility windows | `windows` |

## Install

```sh
npx boring-ui-blocks add https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<v>/r/pi-app.json https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<v>/r/pi-app-kinds.json
```

- `pi-app` draws only the kinds passed in `artifactKinds`; `pi-app-kinds` installs the viewers and `defaultKinds({ locale })`, the default list to pass.

- Use the same `<v>` as the installed `@hachej/boring-ui-kit` (`npm ls @hachej/boring-ui-kit`).
- `add` runs `npx -y shadcn@4.21.5 add <args>`, then records every file under `components/ui` in `SHADCN-GENERATED.json`. Use it for plain shadcn components too (`npx boring-ui-blocks add dialog`).
- `pi-chat`, `button`, `dock`, `feedback`, `app-shell`, `windows` and `agent-target` install no tokens. If the app has no shadcn tokens yet, add `.../r/theme.json` in the same command. The theme keeps tokens the app already defines.
- When the CLI installs `tooltip`, wrap the app in `TooltipProvider` from `@/components/ui/tooltip`.
- After a plain `npx shadcn add`, run `npx boring-ui-blocks manifest` to record the files.

Files land in `src/components/<item>/` (one folder per item) and `src/components/ui/`.

## Configure, never edit

Change a block only through these extension points ([source](../../registry/README.md#updating-installed-blocks)):

| To change | Use |
| --- | --- |
| Colours, radius, fonts, dark mode | The theme tokens in the app's CSS. `--shell` and `--overlay` are the kit's own tokens |
| Any word, or French | `labels` (partial) and `locale="fr"` |
| Icons, header, panel, message or row actions | `icons`, `headerActions`, `panelActions`, `messageActions`, `conversations.rowActions` |
| Your own artifact type and renderer | `artifacts.kinds` on `PiChat`/`AmbientChat`, `artifactKinds` on `AgentWorkspace` (`[myKind, ...defaultKinds()]` keeps the default viewers) |
| A viewer for a file kind | `viewers` on `AgentWorkspace` |
| Something under or inside the composer | `belowComposer`, `tools` |
| How a tool result renders | `renderTool`, `renderEntry`, `groupTool`, `replyFooter` |

Example: rebrand words and add a header action.

```tsx
<AgentWorkspace
  {...props}
  labels={{ sessionsTitle: 'Notes' }}
  chat={{ labels: { title: 'Notes assistant', placeholder: 'Ask about your notes' },
          headerActions: [{ id: 'help', label: 'Help', icon: LifeBuoyIcon, onSelect: openHelp }] }}
/>
```

Theme rules ([BORING-UI-1](../../INVARIANTS.md#boring-ui-1--shadcn-first-blocks-carry-no-visual-value)):

- Set core tokens (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`, …) in `:root` and `.dark` of the app's CSS.
- Do not override a block's CSS, set `--boring-editor-*` or `--boring-html-*`, or edit copied shadcn components.
- In app code, use token utilities (`bg-primary`, `rounded-md`, `text-sm`), never literals (`#hex`, `bg-red-500`, `rounded-[7px]`) or `dark:` variants.

A change no extension point covers is a feature request for this repository, not a local edit.

## Update

Check first, because `update` overwrites edited copies:

```sh
npx boring-ui-blocks check --design src
npm i @hachej/boring-ui-kit@<new> @hachej/boring-agent@<new> @hachej/boring-files@<new>
npx boring-ui-blocks update --dry-run    # prints the shadcn command
npx boring-ui-blocks update
```

`update` reinstalls every installed block from the installed kit's version (`--version <v>` or `--registry <url>` to choose), runs the CLI with `--overwrite --yes`, rewrites the manifest and keeps your `package.json` version specifiers. Read the top of [MIGRATING.md](../../MIGRATING.md) for the target version before upgrading.

## Fix a failing check

Each violation is one line `<check> <rule> <file>[:line:col] <detail>`. Exit `1` means violations, `2` a usage or configuration error.

| Line starts with | Meaning | Fix |
| --- | --- | --- |
| `blocks edited` | A block file differs from the installed kit | Move the change to an extension point, then `npx boring-ui-blocks update` |
| `design color`, `design arbitrary-value`, `design border-width`, `design font`, `design literal-value`, `design dark` | App code uses a literal | Use a token utility or set the token in the theme |
| `ui edited`, `ui unrecorded`, `ui missing` | A file under `components/ui` changed outside the CLI | Re-add it with `npx boring-ui-blocks add <name>`, or run `manifest` after a deliberate `npx shadcn add` |

Never add an allowlist or change the rule; fix the app.

## Verify

1. `npx boring-ui-blocks check --design src` prints `ok @hachej/boring-ui-kit@<v>: ...` and exits 0.
2. `npx tsc -p tsconfig.app.json --noEmit` and the app build pass.
3. The page renders the block in light and dark mode at phone and desktop widths.
4. `git diff src/components` after an update shows only kit changes, never local edits.
