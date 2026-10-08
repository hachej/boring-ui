# Onboarding: gh, the invitation, the clone

Run each command yourself when you can. Ask the person only for what needs
them: the browser sign-in and accepting an invitation. One step at a time;
check it worked before the next.

## 1. Install the GitHub CLI

Check first: `gh --version`.

| System | Install |
|---|---|
| macOS | `brew install gh` (Homebrew: https://brew.sh) |
| Linux (Debian, Ubuntu) | `sudo apt install gh`; if the package is missing or old, follow https://github.com/cli/cli/blob/trunk/docs/install_linux.md |
| Windows | `winget install --id GitHub.cli`, then open a new terminal |

## 2. Sign in

`gh auth login --hostname github.com --git-protocol https --web`

Tell the person: a one-time code appears; their browser opens GitHub; they
paste the code and authorise. If they have no GitHub account yet, they create
one at https://github.com/signup first and send their login to the maintainer.
Then `gh auth setup-git` so `git` uses the same account.

Check: `gh auth status` shows their login.

## 3. Accept the invitation to the project

The maintainer invites their GitHub account to the project repository. List
pending invitations: `gh api user/repository_invitations --jq '.[] | {id, repo: .repository.full_name}'`.
With the person's go-ahead, accept the one for the project:
`gh api -X PATCH user/repository_invitations/<id>`. The link in the
invitation email works too.

## 4. Clone the project and work inside it

```
gh repo clone <owner>/<repo>
cd <repo>
```

Then start the agent session **in that folder** (Claude Code, Codex or
Cursor), so the project's settings and instructions apply.

## 5. Verify

- `gh auth status`: signed in.
- `gh repo view --json nameWithOwner`: the project.
- `gh issue list --limit 5`: the issues are readable.
- `project.md` is at the root (or in the project's folder).

## Keeping the skill up to date

The skill is installed with `npx skills add hachej/boring-pm -g`; run the same
command again to update it. The project's own Factory files (labels, forms,
workflows) are updated by the maintainer through "Bump boring-factory" pull
requests; you do not change them.
