# Prepare an npm release

The packages remain private at candidate version `1.0.0`. See the
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

Choose a version and update all seven package versions and internal peer versions
together. Update the lockfile. Set package `private` fields to `false` in the
reviewed release commit; keep the repository root private. Run the validation
again, including `npm run release:preflight`. This command requires both full
release verification and publication-ready manifests. There is no override flag.

## Publish only after separate authorization

Record the exact commit, package names, versions, npm account, and dist-tag before
publication. Use a prerelease version and explicit prerelease tag for an approved
prerelease. Do not put an unqualified prerelease on `latest`.

Pack each reviewed package into a dedicated artifact directory. Run the tarball
audit on that same checkout. Record archive integrity values and retain the
archives. Perform npm's publish dry run against those archives before requesting
publication approval. Publish the approved archives, not a later rebuild.

Configure npm authentication or trusted publishing in the release environment
under the owner's policy. This PR creates no tokens, publishing workflow, tags,
GitHub release, or npm publication. Test a fresh consumer against registry
versions after publication; local tarball installation cannot establish that
the registry packages are available.

License qualification for optional tldraw use and live provider qualification
remain host and release obligations. The shipped MIT license and third-party
icon notices do not replace them.
