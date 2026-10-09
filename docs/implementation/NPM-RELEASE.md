# Prepare an npm release

The packages remain private at candidate version `0.2.0`. See the
[breaking migration](../../MIGRATING.md) for package identities and removals. Passing the tarball audit does
not qualify the library for release. [PARTIAL.md](PARTIAL.md) records remaining
implementation work, and [VERIFY.json](../../VERIFY.json) owns proof deferrals.

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
6. Run `npm run verify:release` separately. A deferral is a failure of release
   qualification even when ordinary verification passes. Resolve its actual
   obligation before changing the verifier. Do not remove deferrals to publish.

## Set the release identity

After qualification, confirm the npm organization and publishing account with
the owner. The candidate names use `@hachej/boring-*`; repository ownership does not prove
ownership of that npm scope. Confirm that all pinned external peers are available
to the intended consumer. The tarball audit does not contact the registry.

Run `npm run release:version -- 0.2.0` (or an exact prerelease such as `0.2.0-rc.1`).
This updates all seven packages, internal dependency pins, lockfile records and
source/generated registry recipe pins together. It changes neither privacy flags
nor external dependency versions. Review the changes and commit them. Build metadata
suffixes and version aliases such as `latest` are not accepted.

Set package `private` fields to `false` in the
reviewed release commit; keep the repository root private. Run the validation
again, including `npm run release:preflight`. This command requires both full
release verification and publication-ready manifests. There is no override flag.

## Maintainer-triggered publishing

Record the exact commit, package names, versions, npm account, and dist-tag before
publication. Use a prerelease version and explicit prerelease tag for an approved
prerelease. Do not put an unqualified prerelease on `latest`.

The `Publish npm release` workflow in `.github/workflows/npm-publish.yml` runs
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

The publish job waits for every qualification job, enters the `npm` environment,
and receives OIDC permission. It installs only the pinned npm CLI, without lifecycle
scripts; it does not install project dependencies or rebuild. It downloads the exact
artifact ID from preparation, checks all archive hashes and manifests against the
reviewed source, and publishes only those archives with `--ignore-scripts` and an
explicit public npm destination. Release runs are serialized without cancelling an
active publication. Neither job changes package versions or privacy flags.

### Owner setup before the first release

1. Confirm control of the npm scope and all seven package names, including any
   first-publication/bootstrap requirements with npm. GitHub ownership is insufficient.
2. Configure the GitHub `npm` environment for the intended maintainer approval
   and main-branch policy. This code does not create or change those settings.
3. Configure each package's npm trusted publisher for user `hachej`, repository
   `boring-ui`, workflow filename `npm-publish.yml`, and environment `npm`.
   Permit direct publishing if the npm configuration defaults to staged-only access.
   Complete setup near the first qualified release: unused new trust configurations
   can expire. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

The workflow pins npm 11.5.1, which supports trusted publishing, and Node 22.22.1.
It has no token fallback. Missing account ownership or trust configuration fails
publication; it does not authorize weakening release gates. This change creates no
credentials, npm packages, version tags or GitHub release, and does not dispatch the
publishing workflow. After an authorized publication, test a fresh consumer against
registry versions; local tarballs cannot establish registry installability.

### Interrupted publication

Seven package publications are not one transaction. Before any write, the publisher
looks up every version. Registry errors are failures, not proof a version is absent.
An existing version is skipped only when both its integrity and requested dist-tag
match these artifacts. Different bytes or tags stop the run for manual review.

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
