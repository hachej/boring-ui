# Question bank

Select a few relevant prompts, then follow the answer. The wording below is original Boring PM material informed by the interviewing, ACTA, discovery, and requirements sources. Do not read the whole bank aloud.

| Purpose | Starter | Probe when useful |
| --- | --- | --- |
| Technical comfort, first if unknown | What are you comfortable doing with software today—for example, using apps, setting up workflows, or writing code? | What is a recent example? |
| Desired involvement | How much of the setup and maintenance would you want to handle yourself? | Who could handle the rest, and is that support available? |
| Explanation depth | Would a worked example, a sketch, or technical detail help you assess this? | Which part should we explore more closely? |
| Expert context | What work do people come to you for help with? | Which part have you done yourself recently? |
| Intended user | Who would use the result day to day? | Are they as experienced as you? Who decides to adopt it? |
| Trigger | What happened the last time this task came up? | What made you start working on it then? |
| Current process | Take me from the first input to the final result. | What happened immediately before and after that step? |
| Artifacts | Can you show a redacted input and its finished output? | What does each field mean? Where did it come from? |
| Pain | Where did this particular case become difficult? | What did the delay or mistake prevent you from doing? |
| Existing alternatives | What do you use to get this done today? | What have you tried and stopped using? What was missing? |
| Solution tradeoff | For this same case, which part would you want to review yourself? | What would make either approach difficult to use next week? |
| Operating fit | If something stopped working, who would fix it? | How much time or help can you realistically rely on? |
| Profile correction | Has anything changed about how hands-on you want to be? | Which part of the current recommendation should that change? |
| Cognitive cues | What did you notice that changed your decision? | Would a less experienced person notice the same thing? |
| Competing explanations | What else could have explained that signal? | What information ruled that explanation out? |
| Thresholds | What makes an input acceptable in this situation? | What happens exactly at the boundary? What are the units? |
| Counterexample | When would that rule produce the wrong result? | Can you recall such a case? What did you do instead? |
| Uncertainty | What do you do when you cannot tell? | What further information is worth waiting for? |
| Human control | Which decisions would you trust software to make? | Which should it draft, explain, or escalate for you? |
| Handoffs | Who receives the result, and what do they do next? | What must they know to trust or correct it? |
| Variants | Which part changes for another user or situation? | Which variation must the first version support? |
| Value | What would a meaningfully better outcome look like? | How could we observe it on the next real task? |
| Adoption | What would have to change for someone to use this? | Who controls the budget, data, installation, or approval? |
| Scope | If the first version did one job well, which job matters most? | What can remain manual for now? |
| Data | Where will the first realistic input come from? | Who can access it, and what happens if it is absent or stale? |
| Permissions | Who may view, change, approve, and export this information? | Is that permission about the whole project or one item? |
| Failure | What is the most consequential plausible failure? | How would the user notice, stop, undo, or recover from it? |
| Quality | What does “fast” or “accurate” mean for this task? | Under what load, with what measurement and tolerated error? |
| Acceptance | Show me how you would check whether this result is correct. | What example would expose a subtle mistake? |
| Delivery | Where must the product be available for you to use it? | What input, access, and instructions do you need on day one? |

## Repair a leading question

| Avoid | Better |
| --- | --- |
| You're an expert, so you can manage the server? | Who would handle setup and keep this running? |
| Should we use React or Python? (before the user needs that decision) | What do you need to be able to change yourself after delivery? |
| Would an AI assistant save you hours? | What took time in the last case, and how much? |
| Do you want a dashboard? | What do you need to decide after seeing the information? |
| You would pay for this, right? | How is this task funded today, and who makes a purchase decision? |
| So we can automate that? | What must be true before software can act on that result? |
| Is this spec correct? | Walk through this example using the proposed behavior. Where does it break? |

## Handling disagreement

“I have two accounts: this rule applies in case A, but case B appears to violate it. What differs between the cases?” If context does not explain the disagreement, record separate rule variants and an unresolved decision. Never average incompatible rules into a new rule nobody supplied.

## Useful closing

Summarize the task, the main decision, the proposed improvement, and the largest remaining uncertainty. Ask for corrections. Agree on one concrete next step: another case, a redacted artifact, a prototype trial, a feasibility spike, or a first build.
