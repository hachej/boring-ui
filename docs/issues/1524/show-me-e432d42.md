# [Transcription Quality] Show me

Reviewed repair: `b30708a86e30eca206d75ee178c3ac92e7cf192a`  
Integrated code/ledger revision: `e432d42ca663b32dd9d7d9aa9f886e49584d9b82`  
Current `origin/main`: `0889bf792f3c2c69011636fa444bc29e09790b84`

## Integration result

```diff
 reviewed feature delta (packages/ plugins/ apps/ .github/)
- base 68dcb7db → repair b30708a8: 255,172 bytes
+ base 0889bf79 → integrated e432d42c: 255,172 bytes
  SHA-256 (both): 8d6b5e657f636e2bbb0cf255726584f85684c7a9e1711c3587bad9a760284eac
```

The feature delta is byte-identical after integrating current main. The existing exact-SHA APPROVE at `b30708a8` therefore carries under the supervisor-authorized review rule; no new review round is consumed.

## Structure

```diff
 plugins/live-transcription/
+├── services/refine/          # authenticated faster-whisper + medical lexicon refinement
 ├── services/sortformer/      # steadier multi-speaker confirmation
-├── services/lifecycle/       # live-stream readiness only
+├── services/lifecycle/       # requires two WebSockets plus refine HTTP health
 └── src/
-    ├── front/                # raw worklet forwarding
+    ├── front/                # explicit AGC + anti-aliased 16 kHz diarizer feed
     └── server/
-        └── manager.ts        # live stream only
+        ├── manager.ts        # live stream + atomic no-overwrite file transcription
+        ├── projector.ts      # guarded post-finalize replacement
+        └── refine.ts         # bounded multipart refinement and response-body deadline
```

## Behavior

```diff
 audio input
-  one stream → recognizer + diarizer with lag-sensitive labels
+  explicit browser AGC → recognizer
+  anti-aliased 16 kHz feed → lag-compensated diarizer
+  stable speaker confirmation → projected live transcript

 completed recording
-  no offline quality pass
+  Workspace binary read + size guard
+  GPU lifecycle requires Kyutai WS + Sortformer WS + Refine HTTP readiness
+  faster-whisper + medical lexicon correction
+  atomic create or explicit overwrite
```

## Protected route

```text
public plugin/server contracts + authenticated GPU lifecycle authority
  → protected owner route
  → Orchestrator starts exact-SHA demo
  → owner decides [Transcription Quality] Merge approval (PR #1524)
```

No deployment, release, migration, deletion, rebase, force-push, or PR merge is part of this handoff.
