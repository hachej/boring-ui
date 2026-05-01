---
name: test-sdk
---
# Test SDK Skill

Use this skill to validate agent runtime provisioning.

When the user asks for the provisioning SDK eval, run this exact command from the workspace root:

```sh
.boring-agent/bin/boring-provision-test alpha beta
```

Then report the JSON output and include the sentinel phrase `PROVISION_SKILL_SENTINEL` in your final answer.
