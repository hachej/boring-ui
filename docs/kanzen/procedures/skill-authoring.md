# Skill Authoring

Use for `/skill:skill-management create <name-or-goal>`.

Before drafting, read the pinned Matt Pocock `writing-great-skills` source and
its glossary in:

- `.agent/skills/skill-management/references/matt-pocock-writing-great-skills/SKILL.md`
- `.agent/skills/skill-management/references/matt-pocock-writing-great-skills/GLOSSARY.md`
- source and license metadata in the same directory

Treat that material as an external method. Boring repository policy, Pi's skill
contract, and the user's request take precedence.

## Method

1. **Define predictability.** State the process the skill must repeat, its
   invocation branches, and a checkable completion criterion for every step.
2. **Choose invocation first.** Project workflow/meta skills default to explicit
   invocation: include `disable-model-invocation: true` so Pi hides them from
   the system prompt. Use model invocation only when the user requests it or
   autonomous discovery is necessary and its permanent context load is
   justified.
3. **Design the hierarchy.** Keep always-needed steps in `SKILL.md`; disclose
   branch-only reference behind precise pointers. Split only for independent
   invocation or when hiding later steps prevents premature completion. A
   router may expose argument-selected branches without creating independently
   discovered nested skills.
4. **Place ownership correctly.** Active project skills live in
   `.agents/skills/<name>/SKILL.md`. Boring policy lives in `docs/kanzen/`. Raw
   third-party references live under `.agent/skills/*/references/` with pinned
   source, hashes, attribution, and license. Keep active policy on canonical
   project paths.
5. **Write tightly.** Give the description one human-facing summary for an
   explicit skill, or distinct trigger branches for a model-invoked skill.
   Remove duplication, sediment, and no-ops; use leading words where they make
   behavior more predictable.
6. **Validate.** Confirm lowercase-hyphenated name (maximum 64 characters), a
   non-empty description, intended discovery/invocation behavior, resolving
   relative paths, complete external attribution, and no accidental nested
   discovery. Run available skill validation, `git diff --check`, and relevant
   repository checks.
7. **Review.** Independently review determinism, context load, branch routing,
   completion criteria, safety/policy ownership, and source fidelity. Integrate
   material findings and re-run proof.

## Completion criterion

Finish only when invocation behavior is intentional, each branch reaches all
and only the context it needs, every step has a checkable bound, references and
licenses resolve, validation and independent review are green, and the handoff
shows exact invocation examples.
