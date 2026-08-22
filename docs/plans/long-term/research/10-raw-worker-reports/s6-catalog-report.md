# Verdict: #1226's central premise is false

`call_tool({name, args})` does **not** preserve the dispatched tool's identity in pi's event stream on pinned `@earendil-works/pi-agent-core@0.80.7`.

When `beta_add` is called directly, pi emits `toolName: "beta_add"` on the call, execution, result, and persisted tool-result message. When the host's `call_tool` implementation directly invokes `beta_add.execute(...)`, pi emits only `toolName: "call_tool"`. No pi event names `beta_add`. The inner return value is the outer `call_tool` result; in this spike, diagnostic inner metadata is nested under `details.innerResult`, but pi does not interpret that as a child call.

This conclusion does not depend on model behavior. It follows from executing both paths through the real pi 0.80.7 harness and recording its hooks/events. #1226 must change shape before implementation planning: a plain dispatcher cannot retain per-tool renderers, metering, or approval semantics.

## Environment and evidence boundary

- Runtime: Node `v22.22.1`.
- Pi packages: exact `0.80.7` pins.
- Tests: Vitest `3.2.7`, 2/2 passing.
- Storage: host-supplied `SessionStorage`, copied from the proven `spike-pi-storage` pattern and injected into `Session`, then `AgentHarness`.
- The sandbox blocked Vault before a key could be read:

```text
Get "http://127.0.0.1:8200/v1/sys/internal/ui/mounts/secret/agent/gemini": dial tcp 127.0.0.1:8200: socket: operation not permitted
Error: GEMINI_API_KEY is required for live mode
```

Consequently, no live Gemini model output or provider-reported token count is claimed below. I did not substitute char/4 or faux-provider estimates. The identity tests use pi's deterministic faux provider only to make tool calls; the call/result events and dispatch behavior are produced by the real pi agent loop. A second run used the real pinned Google provider serializer with a deterministic local HTTP mock to capture the exact wire request bodies. Any model-behavior conclusion is explicitly marked unproven.

## 1. Control: direct `beta_add`

Resident tools exposed to pi: `alpha_ping`, `beta_add`, `gamma_echo`.

Prompt: `You MUST call beta_add exactly once with a=7 and b=5, then report the sum.`

Exact pi harness hook stream, with every emitted field:

```json
[
  {
    "type": "tool_call",
    "toolCallId": "beta_add_1786465739921_1",
    "toolName": "beta_add",
    "input": {
      "a": 7,
      "b": 5
    }
  },
  {
    "type": "tool_result",
    "toolCallId": "beta_add_1786465739921_1",
    "toolName": "beta_add",
    "input": {
      "a": 7,
      "b": 5
    },
    "content": [
      {
        "type": "text",
        "text": "{\"sum\":12}"
      }
    ],
    "details": {
      "tool": "beta_add",
      "toolCallId": "beta_add_1786465739921_1",
      "params": {
        "a": 7,
        "b": 5
      },
      "value": {
        "sum": 12
      }
    },
    "isError": false
  }
]
```

Exact lower-level pi execution stream:

```json
[
  {
    "type": "tool_execution_start",
    "toolCallId": "beta_add_1786465739921_1",
    "toolName": "beta_add",
    "args": {
      "a": 7,
      "b": 5
    }
  },
  {
    "type": "tool_execution_end",
    "toolCallId": "beta_add_1786465739921_1",
    "toolName": "beta_add",
    "result": {
      "content": [
        {
          "type": "text",
          "text": "{\"sum\":12}"
        }
      ],
      "details": {
        "tool": "beta_add",
        "toolCallId": "beta_add_1786465739921_1",
        "params": {
          "a": 7,
          "b": 5
        },
        "value": {
          "sum": 12
        }
      }
    },
    "isError": false
  }
]
```

## 2. Dispatcher: `beta_add` through `call_tool`

The only provider-resident tool is `call_tool`. Its host implementation looks up `beta_add` in a `Map` and calls its `execute` function.

Prompt: `You MUST invoke call_tool exactly once with name beta_add and args {a:7,b:5}, then report the sum. beta_add is not a resident provider tool.`

Exact pi harness hook stream:

```json
[
  {
    "type": "tool_call",
    "toolCallId": "call_tool_1786465739971_2",
    "toolName": "call_tool",
    "input": {
      "name": "beta_add",
      "args": {
        "a": 7,
        "b": 5
      }
    }
  },
  {
    "type": "tool_result",
    "toolCallId": "call_tool_1786465739971_2",
    "toolName": "call_tool",
    "input": {
      "name": "beta_add",
      "args": {
        "a": 7,
        "b": 5
      }
    },
    "content": [
      {
        "type": "text",
        "text": "{\"sum\":12}"
      }
    ],
    "details": {
      "dispatchedName": "beta_add",
      "innerCallId": "call_tool_1786465739971_2:child:beta_add",
      "innerResult": {
        "content": [
          {
            "type": "text",
            "text": "{\"sum\":12}"
          }
        ],
        "details": {
          "tool": "beta_add",
          "toolCallId": "call_tool_1786465739971_2:child:beta_add",
          "params": {
            "a": 7,
            "b": 5
          },
          "value": {
            "sum": 12
          }
        }
      }
    },
    "isError": false
  }
]
```

Exact lower-level pi execution stream:

```json
[
  {
    "type": "tool_execution_start",
    "toolCallId": "call_tool_1786465739971_2",
    "toolName": "call_tool",
    "args": {
      "name": "beta_add",
      "args": {
        "a": 7,
        "b": 5
      }
    }
  },
  {
    "type": "tool_execution_end",
    "toolCallId": "call_tool_1786465739971_2",
    "toolName": "call_tool",
    "result": {
      "content": [
        {
          "type": "text",
          "text": "{\"sum\":12}"
        }
      ],
      "details": {
        "dispatchedName": "beta_add",
        "innerCallId": "call_tool_1786465739971_2:child:beta_add",
        "innerResult": {
          "content": [
            {
              "type": "text",
              "text": "{\"sum\":12}"
            }
          ],
          "details": {
            "tool": "beta_add",
            "toolCallId": "call_tool_1786465739971_2:child:beta_add",
            "params": {
              "a": 7,
              "b": 5
            },
            "value": {
              "sum": 12
            }
          }
        }
      }
    },
    "isError": false
  }
]
```

### Direct diff

| Question | Direct | Through dispatcher |
|---|---|---|
| `tool_call.toolName` | `beta_add` | `call_tool` |
| `tool_result.toolName` | `beta_add` | `call_tool` |
| execution event name | `beta_add` | `call_tool` |
| any pi event carrying `beta_add` as identity | yes | **no** |
| inner result location | own `beta_add` result event | outer result `content`; diagnostic copy nested in `details.innerResult` |
| renderer selected by event name | `beta_add` renderer | `call_tool` renderer |

`beta_add` does occur as ordinary data in `tool_call.input.name` and in host-defined `details.dispatchedName`. That is not preserved event identity; existing renderers dispatching on `event.toolName` see only `call_tool`.

## 3. Search of a 40-tool host catalog

The provider-visible tools were only `search_tools` and `call_tool`; `risk_assess` was present only in a host-side `Map` of 40 signatures. The deterministic transport requested a semantic search, the real host search returned the non-resident signature, and the next pi call dispatched it:

```json
[
  {
    "type": "tool_call",
    "toolCallId": "search_tools_1786465761639_1",
    "toolName": "search_tools",
    "input": {
      "query": "risk_assess"
    }
  },
  {
    "type": "tool_result",
    "toolCallId": "search_tools_1786465761639_1",
    "toolName": "search_tools",
    "input": {
      "query": "risk_assess"
    },
    "content": [
      {
        "type": "text",
        "text": "{\"matches\":[{\"name\":\"risk_assess\",\"description\":\"Assess synthetic project risk.\",\"parameters\":{\"type\":\"object\",\"properties\":{\"project\":{\"type\":\"string\",\"description\":\"Project name\"}},\"required\":[\"project\"],\"additionalProperties\":false}}]}"
      }
    ],
    "details": {
      "query": "risk_assess",
      "matchNames": ["risk_assess"],
      "resultBudgetBytes": 8000
    },
    "isError": false
  },
  {
    "type": "tool_call",
    "toolCallId": "call_tool_1786465761666_2",
    "toolName": "call_tool",
    "input": {
      "name": "risk_assess",
      "args": {
        "project": "Apollo"
      }
    }
  },
  {
    "type": "tool_result",
    "toolCallId": "call_tool_1786465761666_2",
    "toolName": "call_tool",
    "input": {
      "name": "risk_assess",
      "args": {
        "project": "Apollo"
      }
    },
    "content": [
      {
        "type": "text",
        "text": "{\"project\":\"Apollo\",\"risk\":\"medium\"}"
      }
    ],
    "details": {
      "dispatchedName": "risk_assess",
      "innerCallId": "call_tool_1786465761666_2:child:risk_assess",
      "innerResult": {
        "content": [
          {
            "type": "text",
            "text": "{\"project\":\"Apollo\",\"risk\":\"medium\"}"
          }
        ],
        "details": {
          "tool": "risk_assess",
          "toolCallId": "call_tool_1786465761666_2:child:risk_assess",
          "params": {
            "project": "Apollo"
          },
          "value": {
            "project": "Apollo",
            "risk": "medium"
          }
        }
      }
    },
    "isError": false
  }
]
```

The returned signature was 238 UTF-8 bytes, comfortably inside the configured 8,000-byte result cap. This proves the catalog/search/dispatch mechanism and provider visibility boundary. Because Vault was blocked and the response chooser was deterministic, it does **not** prove that Gemini itself can infer the correct tool from a natural-language query. That requested model-behavior claim remains unrun, not fabricated.

## 4. Request-size measurement for the same 40 tools

The real pinned Google provider built each request. A local `fetch` interceptor recorded `init.body` after `@google/genai` converted pi's payload into the exact `streamGenerateContent` wire shape (`contents`, `systemInstruction`, `tools`, `generationConfig`). Sizes below are `Buffer.byteLength(bodyText)`, not token estimates.

Same user prompt in all cases: `Reply with exactly OK and do not call any tool.`

| Shape | Provider-visible material | Exact serialized wire body | Reduction vs 40 resident | Provider input tokens |
|---|---|---:|---:|---:|
| (a) all resident | 40 full function declarations | 10,345 bytes | — | unavailable |
| (b) catalog + search | full declarations for `search_tools` + `call_tool`; catalog host-side | 1,130 bytes | 89.1% | unavailable |
| (c) summary-only | `call_tool` declaration + 40 name/description summaries in system instruction | 2,868 bytes | 72.3% | unavailable |

The search implementation caps a result at 8,000 serialized bytes. That was intended as the requested roughly 2,000-token budget, but it is **not reported as 2,000 real tokens**: enforcing or measuring that precisely requires Gemini tokenization/counting, which was inaccessible with Vault blocked. The only honest real token entry is `unavailable`.

Full wire bodies and pi pre-provider payloads are in `artifacts/tokens-*.json`.

## 5. Eight-turn repeated-search session

Two deterministic sessions were run through the real pi loop and real Google wire serializer:

- Catalog: every logical turn called `search_tools`, then `call_tool`, then received a final response: 24 provider requests total.
- Resident: every logical turn called its target directly, then received a final response: 16 provider requests total.
- The eight distinct targets were `weather_lookup`, `inventory_check`, `sentiment_score`, `build_status`, `queue_depth`, `policy_evaluate`, `project_progress`, and `risk_assess`.
- Observed catalog call sequence was exactly eight repetitions of `search_tools, call_tool`.

Exact serialized wire bytes per logical turn, summing every provider request generated during that turn:

| Turn | Catalog/search (3 requests) | 40 resident (2 requests) | Catalog smaller? |
|---:|---:|---:|:---:|
| 1 | 5,811 | 21,043 | yes |
| 2 | 10,293 | 21,795 | yes |
| 3 | 13,740 | 22,568 | yes |
| 4 | 17,188 | 23,332 | yes |
| 5 | 20,315 | 24,074 | yes |
| 6 | 23,215 | 24,835 | yes |
| 7 | 26,709 | 25,621 | **no** |
| 8 | 29,892 | 26,394 | **no** |
| cumulative | **147,163** | **189,662** | yes, 22.4% smaller |

Conclusion: the byte saving survives cumulatively through eight turns, but repeated search results re-entering context steadily erode it. By turn 7, the catalog path sends more bytes per logical task because it makes an extra model round trip and carries prior search/call records. Therefore “catalog is smaller” is not a durable per-turn invariant without pruning, ephemeral search results, deferred-tool protocol support, or compaction. Real token/cache behavior remains unmeasured because the provider was unreachable.

## Required nested-child-call contract

For renderers, metering, and per-call approval to work, the dispatcher cannot merely call `target.execute` and return nested JSON. The runtime must execute a child through the same lifecycle pipeline and emit first-class child events. At minimum:

```json
{
  "type": "tool_call",
  "toolCallId": "unique-child-id",
  "parentToolCallId": "outer-call_tool-id",
  "toolName": "beta_add",
  "input": { "a": 7, "b": 5 }
}
```

followed by:

```json
{
  "type": "tool_result",
  "toolCallId": "unique-child-id",
  "parentToolCallId": "outer-call_tool-id",
  "toolName": "beta_add",
  "input": { "a": 7, "b": 5 },
  "content": [{ "type": "text", "text": "{\"sum\":12}" }],
  "details": {},
  "isError": false
}
```

The child lifecycle also needs:

- a stable, unique child call ID and explicit `parentToolCallId` for nesting/correlation;
- authoritative target `toolName` on call, execution start/update/end, result, and persisted message;
- validated child arguments before execution;
- the normal pre-execution approval hook at the child boundary, capable of blocking `beta_add` independently of permission to call the dispatcher;
- normal result/error/termination semantics for the child;
- metering fields or timestamps on the child execution boundary, so duration, counts, failures, and cost accrue to `beta_add`, not only `call_tool`;
- a defined policy for whether the outer `call_tool` also emits a result and how double-counting is prevented.

A renderer-specific `details.dispatchedName` convention is insufficient: it does not trigger existing `toolName` dispatch, cannot provide approval before the inner execute, and makes metering dependent on parsing arbitrary tool-owned result details.

## Reproduction and files

Repository: `/home/ubuntu/projects/spike-tool-catalog`

```sh
pnpm install
pnpm test
pnpm run spike:offline
```

Key files:

- `src/catalog.js`: 40 tools, host map, dispatcher, and search implementation.
- `src/host-session-storage.js`: injected host-owned pi storage.
- `src/harness.js`: exact event, provider-payload, and wire-body instrumentation.
- `src/run-spike.js`: control, dispatcher, discovery, size, and eight-turn experiments.
- `test/identity.test.js`: executable assertions that direct identity is `beta_add`, dispatcher identity is only `call_tool`, and the inner result is nested.
- `artifacts/*.json`: complete captured results.

The managed sandbox also prevented pnpm from opening its global store SQLite database. Tests were executed against the already-installed exact pi packages and an existing Vitest installation via local symlinks. On a normal writable package-manager setup, the checked-in `package.json` installs the declared pins.
