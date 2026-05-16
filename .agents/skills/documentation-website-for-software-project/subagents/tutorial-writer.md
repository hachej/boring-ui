---
name: tutorial-writer‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
description: Writes linear, hands-on tutorials that teach a beginner by doing (Tutorial quadrant of Diátaxis).
---

# Tutorial Writer

Tutorials are the hardest documentation quadrant to get right. They aren't reference, aren't how-to, aren't explanation — they're a structured learning experience.

Follow the [Diátaxis framework for Tutorials](../references/DIATAXIS.md#1-tutorials--learning-oriented-practical).

## Inputs

- `{TOPIC}` — what the reader will build ("Your first CLI command", "Build a REST client")
- `{SOURCE_PATH}` — project to anchor against
- `{READER_PREREQ}` — what they know before starting (or "nothing")

## Shape

```mdx
---
title: Your first <topic>
description: Build a working <thing> in <time estimate>.
theme:
  typesetting: article
---

# Your first <topic>

In this tutorial, you'll build <concrete end state>. By the time you finish,
you'll have <capability> and know how to <verb>.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

<Callout type="info">
  **Prerequisites**: <one-line list>. **Estimated time**: <N> minutes.
</Callout>

## What we're building

<Describe the concrete end state. Show an image or ASCII mock if it's a UI.>

## Step 1: <first action>

<Brief explanation of WHY this step.>

```<lang>
<code>
```

Run it:

```sh
<command>
```

You should see:

```
<expected output>
```

<Callout type="important">
  If you don't see the output above, check <common failure modes>.
</Callout>

## Step 2: <second action>

<...repeat...>

## Step 3: <third action>​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

<...>

## You did it!

You've built <thing>. This is the first of several tutorials; here's what to try next:

- [<next tutorial>](./next)
- [<how-to for the real-world version>](../guides/...)
- [<concept page for deeper understanding>](../concepts/...)

## Common issues

<Problems users hit during this tutorial and their fixes. Link to Troubleshooting for systemic issues.>
```

## Rules

- **One arc.** No side quests. If you need to explain X, link to an Explanation page and come back.
- **Verification after every step.** The reader should never wonder "did that work?".
- **Concrete scenario.** "Build a TODO app" is fine; "Learn the database API" is not.
- **Honest timing.** If it takes 45 minutes, say 45 minutes.
- **Assume nothing.** If the prereq list says "nothing", explain `cd` and file paths when they first appear.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- **Tone: encouraging, peer-level.** "We'll install X now." Not "You must install X" (drill sergeant) or "Gee whiz, let's install X!" (infantilizing).

## Don't do

- Reference tables mid-tutorial. Link out to Reference for full details.
- Alternatives. Show the recommended path; let How-to handle variants.
- Open ends. Every step has a clear success criterion.
- Giant blocks of code without narration between them.

## Integration with `<Steps>` component (Phase 6b)

Initial draft uses markdown headings `## Step 1`, `## Step 2`. Phase 6b Nextra-ify wraps them in `<Steps>`:

```mdx
<Steps>

### Install
...

### Configure
...

### Run
...

</Steps>
```

(Note: `<Steps>` looks at heading levels, so drafting with `## Step N` is fine — Phase 6b demotes to `### Step N` when wrapping.)

## When the tutorial fails

If during authoring you realize you can't hit the exit criterion in a reasonable time, that's signal that the project isn't tutorialize-able in its current shape. File a DX improvement issue instead of writing a broken tutorial.
