# CLI workspace automations — follow-up TODO

## Done

- [x] Workspace-scoped automation routes and stores in CLI workspaces mode.
- [x] Visible Automations sidebar entry.
- [x] Composer model picker and effort menu in the automation editor.
- [x] Persist and pass effort to local CLI automation runs.
- [x] Close the editor after a successful save.
- [x] Compact the editor popup.
- [x] Keep the effort trigger neutral (not accent/orange).

## Next

- [ ] Verify saved model selection is the exact provider/model sent to each run; show the resolved model in run history.
- [ ] Replace raw Cron + Timezone fields with one schedule block.
- [ ] Add natural-language schedule input that asks an agent to propose cron + IANA timezone, validates the result, and lets the user apply it.
- [ ] Add Pause / Resume directly on automation cards.
- [ ] Consolidate UI and agent operations behind one workspace-scoped automation command/service contract.
- [ ] Expose that contract through an agent tool so an agent can create, update, pause, resume, and run automations.
- [ ] Add end-to-end coverage for model selection, effort, pause/resume, and agent-created automations.
