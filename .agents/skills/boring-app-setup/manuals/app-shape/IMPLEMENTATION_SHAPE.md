# Boring App Setup — Implementation Shape

Use this file to convert an app idea into a concrete file/module plan.

## Start with 5 buckets

For a serious child app, decide what belongs in each bucket:

1. **identity/config**
   - package name
   - README
   - HTML title
   - `boring.app.toml`
   - `.env.example`

2. **front composition**
   - `src/front/main.tsx`
   - static plugin composition if needed
   - app-specific routes/pages if any

3. **server composition**
   - `src/server/main.ts`
   - `src/server/dev.ts`
   - `src/server/vercel-entry.ts` / deploy boot
   - plugin discovery choices

4. **plugin layer**
   - front plugin packages
   - trusted server plugins
   - panel/catalog/provider/binding surfaces

5. **domain/backend layer**
   - app-owned services
   - backend integrations
   - domain routes/contracts
   - provisioning if needed

## Suggested planning output

Before coding, write a short module map like this:

```txt
Child app shape
- Identity/config:
  - ...
- Front composition:
  - ...
- Server composition:
  - ...
- Plugin layer:
  - ...
- Domain/backend layer:
  - ...
```

## Minimal example

```txt
Child app shape
- Identity/config:
  - app name, README, boring.app.toml, env template
- Front composition:
  - CoreWorkspaceAgentFront title + one custom page
- Server composition:
  - lower-level core server boot with appPackageJsonPath
- Plugin layer:
  - one app/internal catalog plugin + one provider plugin
- Domain/backend layer:
  - one app-owned search service used by trusted plugin route/tool
```

## Rule

If an app is sophisticated, do this shape pass before implementation.
Otherwise the agent drifts into file creation without a mental model.
