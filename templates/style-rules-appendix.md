# Style rules — appendix

The rules live in `ae-kit-templates/style-rules.md`. This is why each one exists, with the examples that produced it.

**Not a template**, same as the rules file. Open it when arguing about a rule. Don't read it while writing.

The measurements come from `ae-setup` and a web application project, called "the web app" below: 292 files, 457,378 words, scanned 2026-08-23. The examples are real text from those repos, anonymized: names of people and projects, and words that would identify a project's domain, are replaced; everything else is kept as written — a rule argued from invented examples is a rule nobody can check.

---

## E1 — A sentence doesn't close by denying what it never claimed

2,554 occurrences, one every 179 words. The most frequent pattern in the corpus.

> verified one by one against the code, **not against the narrative**

→ *verified one by one against the code.*

> **It isn't an oversight: it's how the cycle is built**, which is why R25 exists

→ *R25 exists because the cycle works this way.*

> The actionable form **isn't "write less", it's** a verifiable ceiling

→ *The actionable form is a verifiable ceiling.*

The second half almost never adds information. It discards an alternative nobody proposed, and the reader processes two ideas to keep one.

The exception holds when the contrast is the content. In *"fixed forward, not with `force-push`"*, `force-push` was the reader's obvious option.

---

## E2 — Bold marks the first thing to see

13,486 bolds, one word in every 33. Median of 30 per 1000 words, and twenty-seven files go above 40.

At that density the visual jump has nowhere to land, and the document is read whole or not at all.

> ⚑ **What really matters: the owner asked me to fix how I write.** Four complaints, in their words: too much prose "like you're writing a book", needlessly hard vocabulary, sentences that get in the way instead of explaining, and verbosity that **lowers the quality of their decisions** after hours of reading too much.

→ *The owner asked me to fix how I write. Four complaints: too much prose, hard vocabulary, sentences that get in the way, and verbosity that lowers the quality of their decisions.*

*The split between emphatic and structural bold was added on 2026-08-23, while rewriting `STATUS.md`.* The first version counted both uses together, which put a well-scannable list of decisions in the red. The same false positive had shown up hours earlier with field labels. Twice means the rule is stated wrong.

---

## E3 — A finding is described, not rated

1,554 occurrences. Named by the owner on 2026-08-23: small bugs, important only inside a narrow scope, written up as if they were earth shattering.

The measured forms: 929 alarm emoji, 215 shouted capitals inside bold, 184 "exactly what", 56 personified defects, 44 alarm adjectives, 43 violent verbs, 41 absolutes, 31 superlatives.

775 of the 929 emoji are the web app's.

> ⚑ **BLOCKER 10 — my fix for BLOCKER 9 traded a loud error for SILENT DATA LOSS, which is strictly worse.**

→ *Blocker 10 — the fix for 9 introduced silent data loss. A row the user half-filled is dropped without warning.*

> ⚑ **BLOCKER 8 — name search wasn't finding compound names, which are 35% of the real catalogue. It's the biggest of the nine findings this task produced.**

→ *Blocker 8 — name search doesn't find compound names: 35% of the catalogue.*

The number already carries the size. "The biggest of the nine" is a ranking that helps nobody.

**Why this rule weighs more than the other eight.** The others tire the reader; this one misinforms. When every finding arrives marked severe, the marking stops sorting, and the reader rebuilds real severity by reading each one in full. That is the work the record exists to save.

The healthy form was already in the corpus: *"All six findings are correctness issues with a bounded, verifiable fix, and the most serious one was closed with a test."* The judgement arrives with its scope and with what closes it.

---

## E4 — Paragraph ceiling

297 paragraphs of 90 words or more. The worst five run from 545 to 1,028 words.

`STATUS.md` had one of 546, and `STATUS.md` is read whole at the start of every session:

> ✅ The open question — whether a real Claude Code subagent is context-isolated the way the proxy was — was answered on 2026-08-16, with evidence and not with a design check […]

→ *Confirmed 2026-08-16: the subagent is isolated. Four instances against `B011` found four blockers the green suites couldn't see.*

From 546 words to 22.

---

## E5 — Sentence ceiling

1,010 sentences of 40 words or more. The longest in real prose runs to 164.

It overlaps with E1: closing by contrast is the most common way to extend a sentence that had already ended.

---

## E6 — A heading names its content

33 bridges that promise importance without delivering it, plus 62 sentences opening with a bare connective (44 with "And").

> ## What really matters about this session

→ *## The owner asked me to fix how I write*

> **The reason is measured and it comes from the web app:** over there, 5 of […]

→ *Measured in the web app: 5 of […]*

> ### The question that closed it

→ a heading that says what the question was.

---

## E7 — Quote the owner when the exact words are the content

929 italic quotes, one every 492 words. 687 are the web app's.

It works when the nuance is the content, as in `P002`: *"if it only runs once and then sits in a file, that's fine for now"*.

It doesn't work when the quote repeats what the previous sentence already said, which is the majority case. The owner doesn't need to read themselves quoted to recognise their own decision.

---

## E8 — A term coined here gets defined, or isn't used

~200 uses of terminology coined in these repos, none defined anywhere.

| Term | Uses | ae-setup | web app |
|---|---|---|---|
| `taxonomía` | 47 | 1 | 46 |
| `doctrina` | 39 | 27 | 12 |
| `falso verde` (false green) | 25 | 23 | 2 |
| `premisa` | 24 | 2 | 22 |
| `por construcción` (by construction) | 22 | 5 | 17 |

Calling a retired decision *"archaeology"* names nothing: it goes. `false green` names a check that passes while asserting something untrue, and has no other short name: it stays, with its definition.

---

## E9 — A name states what happens, not what it means

> A record corrected below forces you to read three versions

→ *False text stays written, and the correction goes in a paragraph below.*

This rule was born from breaking it twice in one day, inside the document that reports the pattern. Pattern 1 was first called "contrastive coda" — jargon coined here, which is E8 — then "the closing denial", which is no longer jargon but still narrates. It ended up as "closing by contrast".

---

## What the self-check found

The rules document was measured against its own rules. E4 and E5 passed. E1, E2 and E3 came back red, and all three failures were the measurer's:

| Rule | What it counted | What it was |
|---|---|---|
| E1 | 5 closings by contrast | Two are the names of E6 and E9, which state the rule. Two are quoted examples. |
| E2 | 9 bolds | All nine are field labels, definition-list formatting. |
| E3 | 1 alarm emoji | The list of what is not allowed. |

The measurer can't tell **using** a pattern from **quoting** it. It is the same gap that `T043` opens for kit templates: nothing verifies meaning, only form.

Requirement for whenever the checker exists: exclude quote blocks, rewrites marked with `→`, and example tables. Without that, a document about style will always come back red for discussing what it forbids.

## The proof

`STATUS.md`, rewritten 2026-08-23. Form changed; no decision or datum was dropped.

| Measure | Before | After | Threshold |
|---|---|---|---|
| Words | 2,897 | 1,513 | — |
| Emphatic bold | 10.01 / 1000 | 0.66 / 1000 | ≤8 |
| Longest paragraph | 546 words | 32 | ≤60 |
| Sentences over 30 words | 16 | 1 | 0 |
| Alarm markers | 3 | 0 | 0 |

E1 landed at 3.97 per 1000, over the threshold. The six remaining cases are decision names where the contrast is the content — *"checks mention, not execution"* — plus one quote. They fall under the exception.
