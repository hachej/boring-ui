---
name: boring-browser
summary: Bounded use of the pinned Browser-Use mechanism through Boring's two native tools.
---

# Boring Browser

This is the Host-bounded adaptation of Browser-Use 0.13.8's official skill. Browser-Use is mechanism only. Do not invoke its CLI, Bash, MCP, `eval`, cookie, profile, cloud, tunnel, Agent, or model surfaces directly.

A human starts and stops the browser from BrowserPanel. Use `browser_observe` to obtain the current redacted state and element indices. Use `browser_act` with the returned session id and control epoch to submit one closed immutable action plan. Observe again after acting. Never put credentials, commands, JavaScript, filesystem paths, provider/runtime fields, CDP/VNC/MCP endpoints, or arbitrary tool names in a plan. If the epoch is stale or the human has control, stop and wait for a fresh observation after explicit return.
