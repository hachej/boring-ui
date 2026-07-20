# Boring Plugin Build — Registration Matrix

## Surface → registration path

| Plugin surface | Typical registration path | Notes |
|---|---|---|
| panel | static front composition for core apps; package discovery only when the boot path explicitly supports it | do not assume manifest defaults alone make shipped core UI appear |
| command | static front composition for core apps; package discovery only when the boot path explicitly supports it | same as panel |
| catalog | static front composition for core apps; package discovery only when the boot path explicitly supports it | same as panel |
| surface resolver | static front composition for core apps; package discovery only when the boot path explicitly supports it | same as panel |
| provider | static front composition | do not rely on dynamic provider mounting |
| binding | static front composition | same caveat as provider |
| trusted server routes | `boring.server` + app server boot | restart/redeploy required |
| trusted agent tools | `boring.server` + app server boot | restart/redeploy required |

## Core-based shipped app caveat

For core apps, package discovery through `package.json#boring.defaultPluginPackages` only helps if server boot passes:

- `appPackageJsonPath`, or
- `defaultPluginPackages`

Without that, the manifest can be correct and the plugin still will not load.

## Concrete examples

### Static front composition

```tsx
<WorkspaceAgentFront plugins={[myPlugin]} ... />
```

### Package discovery

```json
{
  "boring": {
    "defaultPluginPackages": [
      "./src/plugins/my-plugin"
    ]
  }
}
```

### Core server boot enabling app manifest defaults

Use the lower-level core server APIs and pass `appPackageJsonPath`.
See `.agents/skills/boring-app-setup/SKILL.md`.
