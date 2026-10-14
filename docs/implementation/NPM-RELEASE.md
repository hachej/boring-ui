# Prepare an npm release

Candidate version is `0.2.0`. See the [breaking migration](../../MIGRATING.md)
for package identities and removals. [PARTIAL.md](PARTIAL.md) records remaining
implementation work, and [VERIFY.json](../../VERIFY.json) owns proof deferrals.

## Release ruling (owner, 2026-10-10)

Deferred proofs are backlog, not release blockers. `verify:release` and
`release:preflight` still list every `DEFERRED` proof and `release.json` records
them (`deferredProofs`), but they no longer fail the run. Failing tests, missing
evidence files, missing runtime proof slots and broken verifiers still fail it.
VERIFY.json keeps its deferrals unchanged; they remain visible backlog.

Publish set, from version `0.2.4` (owner approval 2026-10-13), dist-tag `latest`: `@hachej/boring-agent`,
`@hachej/boring-ui-kit`, `@hachej/boring-files`, `@hachej/boring-execution`, `@hachej/boring-feedback`
(the app-shell registry item depends on it). `@hachej/boring-browser` and
`@hachej/boring-testing` stay `private: true`: release packing, `readRelease` and
the publisher skip them explicitly (`scripts/release-set.mjs`), and the workflow
checks the retained artifact contains none of them. No published package depends on them.

## Validate the candidate

1. Use a clean checkout of the exact candidate with Node.js 22.19.0 or later.
2. Run `npm ci`.
3. Run `npm run check`, `npm run typecheck`, `npm test`, and `npm run verify`.
4. Run `npm run check:pack`. It creates real tarballs, reads their manifests and
   file lists, checks every export, compares the MIT license, rejects build state
   and source files, and checks internal dependency versions. Temporary archives
   are deleted after inspection. It never publishes.
5. Run the isolated consumers in the CI workflow and the browser journeys for
   the same commit. Preserve their logs and artifact identities.
6. Run `npm run verify:release` separately. Deferrals are listed but do not fail it
   (see the ruling above). Do not delete deferrals or weaken proofs to make it pass.

## Set the release identity

Confirm the npm organization and publishing account with
the owner. The candidate names use `@hachej/boring-*`; repository ownership does not prove
ownership of that npm scope. Confirm that all pinned external peers are available
to the intended consumer. The tarball audit does not contact the registry.
Pi peers use the tilde range `~1.2.0` (dev pins exact `1.2.0`); a Pi minor move is a reviewed change to both.

Run `npm run release:version -- 0.2.0` (or an exact prerelease such as `0.2.0-rc.1`).
This updates all seven workspace packages, internal dependency pins, lockfile records and
source/generated registry recipe pins together. It changes neither privacy flags
nor external dependency versions. Review the changes and commit them. Build metadata
suffixes and version aliases such as `latest` are not accepted.

The five publish-set packages are `private: false` in the reviewed release
commit; browser, testing and the repository root stay private. Run the validation
again, including `npm run release:preflight`. This command requires both full
release verification and publication-ready manifests. There is no override flag.

## Maintainer-triggered publishing

Record the exact commit, package names, versions, npm account, and dist-tag before
publication. Use a prerelease version and explicit prerelease tag for an approved
prerelease. Do not put an unqualified prerelease on `latest`.

The `Publish npm release` workflow in `.github/workflows/release.yml` runs
only through manual dispatch. It admits only `hachej` as both initiating and
rerunning actor, in `hachej/boring-ui`, on `main`. Enter the exact reviewed main
SHA, the version already in its manifests and a distribution tag. The supplied
SHA must match the dispatch SHA; arbitrary checkouts are refused. Merging this
PR or pushing a tag does not publish anything.

The workflow reruns the normal verification/installed-consumer, scripted-browser
and full-history secret-scan workflows. Separately, preparation runs
`release:preflight`, retaining all existing release blockers. It audits the actual
tarballs, writes their package identities and SHA-512 integrity into `release.json`,
and performs npm publish dry runs. Qualification and installation jobs have no
OIDC publishing permission. Existing consumer scripts test separately packed
archives from the same source commit; they are not claimed to consume the retained
publishing archives.

The publish job waits for every qualification job, enters the `release` environment,
and receives OIDC permission. It installs only the pinned npm CLI, without lifecycle
scripts; it does not install project dependencies or rebuild. It downloads the exact
artifact ID from preparation, checks all archive hashes and manifests against the
reviewed source, and publishes only those archives with `--ignore-scripts` and an
explicit public npm destination. Release runs are serialized without cancelling an
active publication. Neither job changes package versions or privacy flags.

After a successful publish, a final `github-release` job creates the `v<version>` git
tag and GitHub release at the reviewed commit, with the body of the merged release PR
(generated notes if none is found). It marks the release Latest only for the `latest`
dist-tag; other tags become prereleases that are not Latest. If the release already
exists, the job does nothing, so reruns are safe. It uses only the job's `GITHUB_TOKEN`.

### Owner checklist before first publish

1. `npm login` as the owner of the `@hachej` scope, with 2FA enabled. GitHub
   ownership is insufficient.
2. First-publish the never-published names `@hachej/boring-files` and
   `@hachej/boring-execution` and `@hachej/boring-feedback` from the owner's 2FA
   session, using the exact CI-audited tarballs (the retained `npm-release-*`
   artifact, checked against `release.json`). No placeholder packages.
3. Create the GitHub `release` environment with the intended maintainer approval and
   main-branch policy. This code does not create or change those settings.
4. Configure a trusted publisher on each of the 5 packages: user `hachej`,
   repository `boring-ui`, workflow filename `release.yml`, environment `release`.
   Permit direct publishing if the npm configuration defaults to staged-only access.
   Complete setup near the first qualified release: unused new trust configurations
   can expire. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
5. Nothing to host separately: the registry is in the `@hachej/boring-ui-kit` archive
   under `r/`. `npm run build` copies the committed `public/r` into `packages/ui/r`
   (gitignored, generated), and `check:pack` fails if `r/registry.json`, any item
   listed in `registry.json`, or any `@hachej/*` pin inside `r/*.json` is missing or
   differs from the released version. Consumers pin the version in the URL, which must
   equal the installed npm version:
   `https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<version>/r/<item>.json`
   (`unpkg.com` works too). `npm run registry:build` (`scripts/build-registry.mjs`) writes each item's
   `registryDependencies` as absolute URLs of that version, so consumers need no `registries` line.
   `release:version` rewrites those URLs with the version, and `check:pack` fails if one names another version or a
   missing item. Consumer setup is in the [README](../../README.md#install-components).
   After publication, verify the pinned URL serves `r/registry.json` and that
   `npx shadcn@latest add https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<version>/r/pi-chat.json` installs from a fresh project.

### Interrupted publication

Five package publications are not one transaction. Before any write, the publisher
looks up every version. Registry errors are failures, not proof a version is absent.
An existing version is skipped only when both its integrity and requested dist-tag
match these artifacts. Different bytes or tags stop the run for manual review.

After each `npm publish`, the publisher polls the registry every 15 seconds for up to 5 minutes until the version and dist-tag are visible, since npm can take a few minutes to expose a new version.

The `npm-publication-*` artifact records each package as pending, unconfirmed,
published or already-published. A failed command or lost response can leave a package
published. Keep the original `npm-release-*` artifact and rerun only the failed publish
job of that workflow run. It uses the original preparation artifact ID and reconciles
registry state before retrying. Do not rebuild the release, blindly republish, delete
published versions, or silently change distribution tags. Artifacts are retained for
30 days; archive them before expiry if recovery is still pending.

License qualification for optional tldraw use and live provider qualification
remain host and release obligations. The shipped MIT license and third-party
icon notices do not replace them.
