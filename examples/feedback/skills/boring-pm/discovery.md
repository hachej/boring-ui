# Discovery: from a need to an approved contract

Output: `features/F-<n>.md`, valid, approved by the expert's review on the
contract pull request's exact head. Not output: code, a build, a promise.

## 1. Read before asking

- The feature issue `#<n>`: `gh issue view <n> --comments`. No issue yet: file
  one first ([tickets.md](tickets.md)); its number is the feature's `F-<n>`.
- The contract on the default branch (`git fetch origin && git show origin/HEAD:features/F-<n>.md`)
  and on its branch if a discovery is under way (`git show origin/contract/F-<n>:features/F-<n>.md`).
- The project's `docs/product/`, `CAPABILITIES.md` (what the app can and cannot
  do) and `decisions/`.
- If the contract has a `next_question`, resume there. Never restart an
  interview; never ask what is already written.

## 2. The person first

When you do not know it yet, the first question is about them, not the
feature: "What are you comfortable doing with software today: using apps,
setting up tools, writing code?" Then, when it matters, how involved they
want to be (try things themselves, review mockups, only accept the result).
Adapt your explanations to the answer: everyday examples for some, fields and
flows for others. Keep it in the conversation: a profile of a person is never
written to the repository. Domain expertise, software skill and willingness to
maintain things are different; never infer one from another.

## 3. The interview

- One question per message, in the project's language. Ask only what could
  change behaviour, scope, safety, acceptance or priority.
- Start from a **recent real case**, told anonymously: what triggered it, what
  they did, what was hard, what it cost. Then probe the cues they use, the
  exceptions, and what a newcomer would miss. Do not turn a judgement into an
  invented numeric rule: an unknown threshold stays an open question.
- In this order when useful: today's workaround; the simplest useful behaviour
  versus the desired later one; failure, uncertainty and the expert's override;
  what must stay unchanged; whether existing work is affected
  (`existing_work`); how fast the first useful result must come (`latency`).
- Separate what the software should do, what it should suggest, and what the
  expert keeps deciding.
- Test your understanding with a fictional scenario or a mockup
  ([mockups.md](mockups.md)) before asking for approval. Exploring is not
  building: an idea can get a mockup without becoming a contract.

## 4. Write the contract on its branch

```
git fetch origin
git switch contract/F-<n> 2>/dev/null || git switch -c contract/F-<n> origin/HEAD
```

Write `features/F-<n>.md` from [templates/contract.md](templates/contract.md):
`feature: F-<n>`, `product_owner: person:<the expert's login>`, then `need`,
`current_workaround`, fictional `scenarios`, `in_scope`,
`not_in_this_version`, `invariants`, `acceptance` (each `AC-<k>` with
given / when / then and the `proof_required`: test, driven-ui, real-model or
expert), `latency`, `existing_work`, `failure_and_recovery`, `mockups` (path
and commit), `open_questions`, `next_question`, and the body "Ce qui change
pour vous". Leave `risk` and `release_mode` null: the Factory sets them.

Versions: a new contract is `contract_version: 1`. If the contract is already
on the default branch (approved earlier) and you change anything the expert
approved, the version becomes the next number, and you say plainly that the
earlier approval no longer holds.

The branch holds only `features/F-<n>.md` and files under `mockups/`. Commit and
push: `git add features/F-<n>.md mockups/ && git commit -m "contract: F-<n> v<k>" && git push -u origin contract/F-<n>`.

The Factory opens the pull request "contract: F-<n>" for you (you cannot
approve a pull request you opened yourself). Find it:
`gh pr list --head contract/F-<n> --json number,headRefOid,url`. Within a minute
the Factory comments if the contract is invalid; read it with
`gh pr view <pr> --comments` and fix what it lists.

## 5. The approval

Only when the contract is complete and the pull request shows your last push:

1. Show the expert, in their language: the summary ("Ce qui change pour vous"),
   the scenarios, every acceptance line, what is not in this version, and the
   exact commit: `gh pr view <pr> --json headRefOid --jq .headRefOid` (it must
   equal `git rev-parse HEAD`).
2. Ask: "Do you approve this exact version (commit `<first 7 characters>`)?"
3. Only after an explicit yes to that question, in this session:
   `gh pr review <pr> --approve --body "<one line in their words>"`. The
   permission prompt asks them once more; that is expected.
4. Anything else ("change X first", silence, a vague "ok for now"): do not
   submit. Changes requested: edit, push, and ask again; a new commit needs a
   new approval.

The Factory merges the contract when the product owner's approval is on the
current head, and the feature becomes "Prêt à développer". Tell the expert what
happens next: the Factory splits it into tasks and builds them; you will
bring back questions and, when it is ready, something to try.

## 6. Pausing

Before the session ends, save `next_question` (and `open_questions`) in the
contract on its branch and push, so the next session resumes there. Then the
end-of-session summary ([tickets.md](tickets.md)).
