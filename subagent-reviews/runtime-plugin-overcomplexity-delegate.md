# Runtime Plugin Overcomplexity Review

## P0

No P0 blockers found.

## P1

1. **Eight implementation phases are too many for bead conversion**
   Ref: `docs/runtime-plugin-v2-hot-reload-plan.md` → “Implementation phases”.
   Problem: phases 3/7 (`sandboxTools proxy` vs `runtime plugin RPC`) and phases 5/6 (`hosted stable artifacts` vs `hosted live-dev HMR`) split tightly coupled work into planning taxonomy rather than shippable increments.
   Simplify: convert to four beads/epics only: **local generated plugins**, **hosted iframe stable**, **sandbox tool execution**, **lifecycle/marketplace hardening**. Put RPC and live HMR under “later” unless a concrete first consumer exists.

2. **Runtime RPC is premature beside tools + workspace APIs**
   Ref: `docs/runtime-plugin-v2-hot-reload-plan.md` → “Routes, data, and RPC”, “Phase 7 — runtime plugin RPC”.
   Problem: generated plugins already have manifest tools, workspace file APIs, and UiBridge actions. A separate RPC plane adds another protocol, schema registry, permission path, and endpoint before proving need.
   Simplify: delete Phase 7 from MVP. State: “frontend-triggered backend work must call declared sandbox tools through the existing tool proxy until at least two use cases cannot fit.”

3. **Native/iframe dual scaffold is overdesigned for default generated plugins**
   Ref: `docs/runtime-plugin-v2-hot-reload-plan.md` → “Runtime plugin source layout”.
   Problem: default scaffold includes `front/native.tsx`, `front/iframe.tsx`, and shared `Pane.tsx`. That forces every generated plugin to understand two runtimes up front. README still advertises simpler `front/index.tsx`.
   Simplify: keep canonical scaffold as `front/index.tsx` plus host-selected wrapper. Generate iframe/native adapters internally only when packaging or serving. Add split files only for advanced/manual plugins.

4. **Canonical-doc drift risk from three overlapping plans**
   Ref: `docs/runtime-plugin-v2-hot-reload-plan.md` → “Status”; skimmed `runtime-plugin-agent-generation-plan.md` and `runtime-plugin-trust-modes-plan.md`.
   Problem: all three restate trust classes, routes, hosted iframe, proxy tools, `.boring-agent/`, and hot reload. Bead conversion may pull requirements from the wrong duplicate.
   Simplify: mark older two docs as `Archived / historical review input; do not bead-convert`. Keep only one short “canonical decisions” section in the v2 plan.

## P2

5. **README duplicates major sections**
   Ref: `README.md` → “Built with boring-ui” appears twice; “Repo map” appears twice with slightly different app/package wording.
   Problem: adds reader confusion and drift before plugin docs are already complex.
   Simplify: keep the richer first “Built with” + first table-based “Repo map”; delete/merge the second copies.

6. **README hot-reload matrix repeats plan details**
   Ref: `README.md` → “Plugin shape / Current hot-reload compatibility”; `docs/runtime-plugin-v2-hot-reload-plan.md` → same-named section.
   Problem: README mixes public onboarding with unstable implementation details (`package front assets can be rediscovered`, `local plugin-dev transform endpoint`).
   Simplify: README should say only: “Pi resources and local generated fronts reload with `/reload`; server plugins require restart; hosted iframe reload is planned.” Link to the plan for the matrix.

7. **Too many terms for the same split**
   Ref: v2 plan → “Product classes”, “Current hot-reload compatibility”, “Hosted runtime model”; older plans use `generated/external`, `runtime/generated`, `hosted/generated`, `marketplace`, `promoted`.
   Problem: implementers may create APIs around vocabulary instead of behavior.
   Simplify: use two MVP terms everywhere: **internal plugin** and **runtime plugin**. Mention “promoted/marketplace/hosted” only as deployment states, not new classes.

8. **Ask User and Macro migration notes distract from runtime plugin MVP**
   Ref: `docs/runtime-plugin-v2-hot-reload-plan.md` → “Ask User should move into UiBridge actions”, “Macro deck routes should move to workspace file APIs”.
   Problem: these are cleanup/refactor ideas, not prerequisites for generated plugin hot reload.
   Simplify: move both to “Non-blocking follow-up cleanup” or separate beads after MVP.

## P3

9. **UI primitive policy is vague and could spawn a package prematurely**
   Ref: `docs/runtime-plugin-v2-hot-reload-plan.md` → “UI primitive policy”.
   Simplify: for MVP, whitelist existing package exports and fail unsupported imports. Defer “stable bridge/iframe SDK import path” design until iframe stable artifact work.

10. **`--no-plugin-dev` is named as an implementation flag before UX proof**
    Ref: README → “Current hot-reload compatibility”; v2 plan → “Phase 2 — local CLI plugin-dev”.
    Simplify: bead it as “disable local runtime plugin execution” and choose final flag during CLI implementation.
