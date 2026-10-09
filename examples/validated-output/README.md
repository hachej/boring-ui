# Fictional validated output

Run `node examples/validated-output.mjs`. The fixture uses a scripted model and Pi's native generation, tool, conversation, task, and recovery paths. It reads a fictional source and calculates 2 + 2 through native ToolTasks. The first model answer says 7. A native `onYield` hook uses the same evidence check as the separate validation task, commits one repair allowance in a session document, and asks for a correction. The second answer says 4.

The producer retains evidence for the exact final answer generation. A separate `createOutputValidation` task verifies the actual tool results and ownership. The formatter waits for that result. Guarded delivery publishes the Markdown output only after validation. The host checks tool access when a tool runs and checks publication access at the provider transaction.

All data and model output are fictional. Tests exercise exhausted repair, missing and forged references, a real unrelated producer's tool results, denied tools, revoked publication, a failed hook, a later evidence overwrite, and SIGKILL after a committed repair decision. This fixture does not exercise a live model, browser, or socket provider.
