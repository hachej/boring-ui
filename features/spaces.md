# Spaces

An app with shared spaces gets its client from the UI bundle: `@boring/ui/blocks/spaces/spaces`, or the `spaces` registry item. The host's Spaces service decides who may do what.

## Sub-features

- `spaces-hook` `useSpaces({ kind, transport })` lists a kind's spaces, remembers the current one per kind on the device, creates, accepts an invitation from the address once, and calls member operations. `registry/spaces/use-spaces.ts`.
- `spaces-switcher` `SpaceSwitcher` shows the current space and offers the person's others; `label` says what a space is called. `registry/spaces/space-switcher.tsx`.
- `spaces-members` `MembersSheet` lists members; a manager changes roles, removes, invites by link and sees administrator accesses; anyone can leave. `registry/spaces/members-sheet.tsx`.
- `spaces-labels` `spacesLabels`, `spacesLabelsFr` and `spaceErrorMessage` hold every word, including what each host refusal code means. `registry/spaces/spaces-labels.ts`.

## How to get to it (user POV)

- The switcher sits where the app puts it, usually the page header.
- The app opens the sheet from its own control, with the current space's `read(id)`.

## Driving it with the render test

Preconditions: `node_modules` installed, so in CI on this VM.

- **Hook.** `spaces-hook`: `node --test test/contracts/spaces-render.test.mjs` lists, selects, creates and accepts an invitation under Strict Mode over a fictional transport.
- **Switcher.** `spaces-switcher`: the same test opens the menu and picks another space.
- **Members.** `spaces-members`: the same test changes a role, removes, invites and leaves as a manager, then checks what a guest does not see.
- **Words.** `spaces-labels`: the same test shows the words for a refused list and a refused leave.

## Gotchas

- Keep `transport` stable: a new function reads the list again.
- The block hides what the host would refuse. It is not the permission check.
- The block prescribes no route. The host's service is reached only through `transport`.
