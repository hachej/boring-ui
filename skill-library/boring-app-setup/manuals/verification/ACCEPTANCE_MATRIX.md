# Boring App Setup — Acceptance Matrix

Use this for advanced child apps, not just thin shells.

## Base shell acceptance

- app boots
- branding/title correct
- env template present
- auth pages load
- workspace route loads

## Plugin acceptance

If custom plugins exist:

- plugin shape chosen explicitly
- plugin registration path works
- provider/binding caveat handled if needed
- correct reload/restart/redeploy instruction is documented

## Backend/domain acceptance

If app-owned backend logic exists:

- key route/service contract is named
- happy-path request works
- permission/guard assumptions are explicit
- no UI bridge misuse for domain data transport

## Provisioning acceptance

If provisioning exists:

- required assets/setup appear
- runtime assumptions are validated
- provisioning-specific failure mode is understood

## Deploy acceptance

- deploy target config present
- auth origin values correct
- mail transport chosen
- migration path documented
- smoke path documented

## Suggested final report for serious apps

```txt
Acceptance summary
- Shell: pass/fail
- Plugins: pass/fail
- Backend/domain: pass/fail
- Provisioning: n/a or pass/fail
- Deploy readiness: pass/fail
- Manual remaining items:
```

## Rule

Do not collapse a sophisticated child app into one vague “build passes” statement.
Report acceptance by layer.
