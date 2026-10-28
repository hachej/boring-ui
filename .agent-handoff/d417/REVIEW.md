# D-417 integration review

Fresh read-only review of `f81113dc9..a8d9610c8` blocked merge on five concrete findings. Corrections:

- Pending native task presentations now open `AgentWorkspace`'s registered `panels.task` before the tool returns. Its mounted host panel alone acknowledges.
- Phone task hosts decide their own availability; the existing narrow-screen refusal still protects file-panel auto-open.
- Acknowledgement evidence is keyed by subject. Showing/hiding one task/file no longer forgets an independently mounted viewer.
- The regular file viewer's fullscreen action expands the native Drawer instead of positioning a child inside a transformed ancestor. The journey now asserts actual viewport geometry for Markdown, HTML and images.
- Library Drawer shadows were removed. The host example selects its theme's shadow through `overlayClassName`; no checker exemption or library visual value was added.

Fail-first: the public native tool/component regressions produced three assertion failures before correction, then passed; the Chromium fullscreen regression measured x=690,width=895 against a 1600px viewport before correction. Final journey also drives a native phone task presentation. Raw logs: `.cache/evidence/d417/review-native-before.log`, `review-native-after.log`, `review-geometry-before.log`, `review-geometry-after.log`.

This is bounded local native/Chromium evidence, not real-model judgment, production provider qualification or physical-phone testing. Studio headers and PM Montrer/pointing remain their owners' work, with exact-target callbacks here.
