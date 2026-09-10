# Command Palette Replay — show me

```diff
 tools/ui-review/src/review-specs/workspace-command-palette/
-  enumerate root actions while shell viewport may still be stale
+  signal existing resize reconciliation and expose Wait until shell aligns
+  re-read alignment after the synchronous resize signal

 replay state selection
-  accept a one-frame full-page pHash spike as a painted desktop palette
+  prefer a distinct Wait frame corroborated by a later Wait
+  require matching extracted modal/focus/overflow shell state
+  retain the independent replay state-signature and pHash verifier

 tests + ownership
+  pin mismatched/matched compact and desktop action policy
+  pin corroborated-Wait selection and transient-state normalization
+  bump scenario ownership through v9 across fix-forward lineage
```

```text
viewport changes / app hydrates
        |
        v
Bombadil extractor ---- marker mismatched? ---- yes ---> resize signal
        |                                           |
        |                                           v
        |                                  re-read shell marker
        |                                           |
        +<------------- still mismatched: Wait only-+
        |
        v
safe palette actions -> staged observations -> corroborated Wait selection
        |                                      |
        v                                      v
reproduce prefix ----------------------> state + screenshot verification
        |
        v
Playwright closed/open/commands -> hard gates -> report
```

Product command-palette components, CSS, breakpoints, dependencies, and CI workflows are unchanged.
