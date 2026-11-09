# Skills

Agent skills for people (and coding agents) who build an app with the kit. They are instructions, not code: nothing here is imported or run. Boring Factory's `build-app` and `boring-app-template` skills point app builders at them, so keep the folder names.

| Skill | Load it when |
| --- | --- |
| [`boring-ui`](boring-ui/SKILL.md) | You start: what the packages and registry blocks are, the rules every change follows, which skill comes next. |
| [`build-agent-app`](build-agent-app/SKILL.md) | You create a React + Node app with an agent inside, or add one to an existing app. |
| [`add-blocks`](add-blocks/SKILL.md) | You install, update, check or restyle registry blocks with `boring-ui-blocks`. |
| [`app-layout-and-agent`](app-layout-and-agent/SKILL.md) | You lay out screens with `AppShell` and decide where the agent lives. |
| [`agent-capabilities`](agent-capabilities/SKILL.md) | You give the agent tools, file access, approvals, questions, sub-agents or schedules. |
| [`boring-design-system`](boring-design-system/SKILL.md) | You restyle or build UI: theme tokens, kit parts, the `design` check. |

What the kit does feature by feature is in [`features/`](../features/README.md); skills point there and do not repeat it.
