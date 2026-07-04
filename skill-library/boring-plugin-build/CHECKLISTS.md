# Boring Plugin Build — Checklists

## Shape checklist

- [ ] runtime vs app/internal chosen explicitly
- [ ] reason for that choice stated
- [ ] provider/binding needs considered
- [ ] trusted backend route/tool needs considered

## Runtime plugin checklist

- [ ] scaffolded through `boring-ui-plugin scaffold ...`
- [ ] edited in place
- [ ] verified with `boring-ui-plugin verify ...`
- [ ] user told to run `/reload`

## App/internal plugin checklist

- [ ] plugin package location chosen intentionally
- [ ] manifest contains `boring.front`
- [ ] `boring.server` added only if needed
- [ ] package registration path wired
- [ ] for core-based shipped apps, front plugin surfaces are statically composed when the shipped UI must render them
- [ ] provider/binding caveat handled if relevant
- [ ] core `appPackageJsonPath` caveat handled if applicable
- [ ] restart/redeploy requirement stated if server changed

## Verification checklist

- [ ] plugin registration path verified
- [ ] local typecheck/lint run if relevant
- [ ] correct reload/restart instruction given
