---
name: adversarial
description: Use after design and before build, on any task that writes data, enforces a rule with more than one condition, or moves something through a lifecycle. Produces the list of cases the feature must survive — written as Given-When-Then, reviewed for gaps by an independent subagent, with only the class A decisions reaching the project owner — using named techniques instead of improvised guessing. Also use standalone when a bug in production suggests a whole class of untested cases.
---

# Adversarial

## When this fires

**Before `build`** — after `design` when design ran, straight after `scope` when it didn't. This skill does not depend on `design`: it triggers on what the task *does*, not on which skills preceded it. A task with no new data structure and no UI surface skips `design` entirely and can still be the one that most needs this — a change to an existing rule's conditions has nothing to design and every reason to be enumerated.

It fires for any task that:

- **writes data** (the failure is silent — see below),
- **enforces a rule with more than one condition** (combinations multiply faster than intuition),
- **moves something through a lifecycle** (`draft → active → completed → archived`),
- or **exposes a surface someone could misuse.**

Skip it for a pure copy change, a styling tweak, or a bug fix whose blast radius is one line.

Standalone trigger: a bug found in production. One bug is an instance; the question this skill asks is what **class** it belongs to, and what else in that class is equally untested.

### If `build` uncovers a new condition

**One exception, and it is a short second pass, not a rerun:** if `build` uncovers a condition the design didn't anticipate — a state that turns out to be reachable, an input that turns out to be nullable — that new condition goes back through step 2 and gets added to the list before `verify-tests`. **It also gets a class** against `decision-classes.md`: if its answer is a business rule, it is class A and goes to the owner before it is built — no reviewer pass for one case, but no deciding it silently either. A class B one is recorded as a `decision` entry citing it, as in step 5 — unless the owner is receiving the whole list (the paragraphs after step 5), and then it goes to the owner too. Discovering a case while implementing is normal; leaving it off the list is what isn't.

## Procedure

### 1. State the rule in one sentence, then find its conditions

Write what must hold, in plain language. Then list every input that can change the answer — including the ones the feature doesn't read yet but a reviewer would expect it to.

### 2. Pick the technique that matches the shape

**Decision table — for a rule with combined conditions.** List every condition as a column, enumerate every combination, and mark the expected outcome for each row. `n` conditions means `2^n` rows; write them all, then decide which are impossible (and say why) versus which are untested.

> Example: `participated` × `submitted the form` × `published` is **eight** rows. Testing two leaves six unlisted, and a bug can live in any of them.

**Equivalence partitioning and boundary values — for anything with ranges, limits, or counts.** Split the input space into classes that should behave alike, test one from each, and then test *both sides of every boundary*. The rule already in this kit's testing guidance — "if it has an `if (x == null)`, there's a test for null; if it has ranges, there are tests at the extremes" — is this technique, and this is its name.

**State transition testing — for lifecycles.** Draw the states and the legal moves between them. Then test the **illegal** ones: what happens on `archived → active`? On a second `completed`? On two writers doing the legal move at the same time? A lifecycle bug is almost never in the transition someone drew; it's in the one nobody drew and the code allows anyway.

**Property-based testing — reserved for write invariants.** Not for everything: its cost is real and its payoff is narrow but unmatched — it catches the **class**, not the instance. Use it for statements that must hold across all inputs, especially isolation:

> *"Saving one record's data never modifies any other record's row."*

That single property covers a family of bugs that no list of examples enumerates.

**Abuse cases — the adversarial pass.** Stop asking "what could go wrong" and ask "what would someone do on purpose". Submit the form twice. Change the URL's id to someone else's. Send the request after the deadline passed. Leave the tab open until the session expires, then save. Each abuse case that has no answer is either a test or an accepted risk — never a shrug.

### 3. Ask the concept question, not the identifier question

**"What other surface asserts this same thing on its own?"**

Search by *concept* — the rule's meaning, the column it writes, the words a person would use — not just by the function's name. A rule reimplemented inline shares no identifier with the pure function that already owns it, so a name-based grep returns clean while a duplicate sits two files away. This is a step, not a suggestion.

**Write down the surfaces you FOUND, as a list, not just the terms you searched for** — and treat that list as the scope of the change, because a surface you didn't enumerate is a surface you won't fix. Naming the search terms proves you looked; naming the hits is what stops the change from landing on one of them.

Don't stop at the first hit in a file: another surface can sit in a different section of a file already on the list.

### 4. Write the cases as Given-When-Then

One line per case, in plain language, no code:

```
Given a participant who took part but never submitted their form
When the owner publishes the session
Then that participant counts as incomplete, and publishing is blocked
```

**Number the cases by group.** Each group of the list gets a capital letter, and each case its place in the group: `A-1`, `A-2`, `B-1`. Cases the independent reviewer adds in step 5, and cases born later in `build` or in review, go in group `R`. The tests use the same ids, so a claim like "case B-2 has a test" can be checked without guessing which list a number came from.

The list must be **readable without reading code** — plain language, so that anyone can check it — but the project owner does **not** read it whole. What reaches the owner is only what step 5 leaves standing as class A.

### 5. An independent reviewer looks for gaps, and only class A reaches the owner

**The author of the list is the worst judge of its gaps**, and an owner reading thirty cases to find the four that are theirs does not scale. So, before anything reaches the owner:

1. **Write the draft list to a file outside the repository, with your own class on every case** — the session's temporary directory, never the working tree: the list's home is the task log (step 6), and a draft left in the repo is an untracked file nobody owns. Give each case A or B **now**, against `decision-classes.md`, before anyone else reads it: a class given after reading the reviewer's is an echo, not a second reader. A case you settled without seeing it as open still gets a class — if its answer is a business rule, it is A.
2. **Dispatch a subagent that did not write the list** (`general-purpose` until this project has a reviewer with domain knowledge). It gets **a copy of the list with your classes removed** — a second file, never the path of the draft, which carries them — the scope, the task log's decisions, `ae-kit-templates/decision-classes.md` and the code the cases touch, and returns: missing cases (with the technique that found each), cases that contradict the scope or an approved decision, and **a class, A or B, for every case on the list and every gap it adds**. It only reads; it never edits. That is an instruction, not a mechanism: nothing yet isolates the reviewer from the repository.

   **A reviewer that fails, or returns nothing, is not a review that found no gaps.** Dispatch it once more. If it fails again, or this environment cannot dispatch a subagent at all, do not hand off and do not play the reviewer yourself: tell the owner the list went unreviewed, and hand over the whole list, with your class A questions marked. Record that as a `note` saying the gap search did not run and why — never as a `review-round`, which the task log reads as a review that happened.
3. **Record the round** in the task log as a `review-round`: `--by` the reviewer, `--result` with how many gaps it found and how many of its classes differ from yours, and `--ref` to the reviewer's saved reply under `logs/subagents/` when the project keeps one. Its first sentence says it is the `adversarial` gap search, not a code review. Fold its new cases in as group `R`.
4. **Settle the class of every case.** **Where your class and the reviewer's differ, it is class A**: `decision-classes.md` takes the higher class whenever the class is in doubt, and two readers disagreeing is doubt. A gap the reviewer added has only its class; take it, or the higher one if you disagree. A case the reviewer says contradicts the scope or an approved decision is corrected or declined with its reason; if correcting it would change the scope, it is class A. Class B —an implementation detail inside the approved scope— is decided here, recorded as a `decision` entry citing the case numbers it settles, and reported in one line each. Only **class A** —a business rule, what the user sees, real data or production, a change of scope— is marked `[owner]`.
5. **The owner receives only the class A decisions**, each in the form `decision-classes.md` gives a class A question, never the full list. Record the list (step 6) before asking, so its `[owner]` cases show as pending; each answer becomes a `decision` entry citing every case number it settles. The full list lives in the task log, where anyone can read it.
6. **If no class A decision is left, hand off to `build` without asking** — moving to the next step of an approved plan is class B. Report it in one line.

**If this project's `CLAUDE.md` says in so many words that the owner approves or reads the whole list of cases, `CLAUDE.md` wins.** Hand over the whole list, with the class A questions marked, and say that the line needs updating — the rules file outranks a skill, and a skill that quietly stops asking is breaking a rule nobody changed. The sentence older versions of the kit's `CLAUDE.md` template carried — it produces the list of cases "for <owner> to approve" — does trigger it. A rule that only names "the approved list" as what gets verified does not: that is the list this step produces.

**Whenever the owner receives the whole list** — this rule, or a reviewer that failed — you decide nothing in it: no class B `decision` entries. The owner's answer is the decision: each answer is a `decision` entry citing every case number it settles, as in step 5.

### 6. Record the list, then hand off

What comes out of step 5, with its class A questions answered, is what `build`, `verify-tests` and the task-log ontology call **the approved list**.

The list, with the reviewer's cases folded in, goes into the task's task log (`logs/tasks/<id>.md`), with `scripts/task-log-append.mjs` — see "How the skills write" in `ae-kit-templates/task-log-ontology.md`:

- **One `adversarial-cases` entry per group**, with `count:` set to the cases in it. A group too long for one entry (1500 characters) is split into `(1/2)`, `(2/2)` rather than shortened.
- **One `note` with the techniques used and the surfaces found** in step 3.
- **A case born later — in `build` or in review — is a new entry** in group `R`. Nothing already written is edited: the task log only grows, which is what lets the list expand without rewriting it.
- **A case whose answer is the owner's to give starts its line with `[owner]`**, right before the case number: `[owner] A-3 Given …`. The task log has no field for this, and without the mark nothing distinguishes a case waiting on a person from one waiting on code. The view lists those cases as pending until a later decision cites the case number, and then lists them as decided — so the mark is what makes an unanswered question visible instead of buried in a list of thirty.

`build` implements against it, and `verify-tests` checks each case has a test — a case approved and then quietly dropped is worse than never listing it, because the record now claims coverage that doesn't exist.

**Cases the owner rejects stay in the list, marked as deliberately out of scope with the reason.** Deleting them loses the fact that someone considered and declined them; six weeks later, that's indistinguishable from never having thought of it.

## Two write rules this skill assumes

These belong to `build` and `verify-tests`, and they're restated here because every case above depends on them:

1. **No write is assembled inside a component.** If the decision about *which rows get saved* lives in the JSX, there's nowhere to test it. Extract it to a pure function. *Origin: a real bug where the pure function was correct, fully tested, and green — and the component handed it the wrong input.*
2. **Every write asserts on its effect, not on the absence of an error.** An `UPDATE` filtered out by row-level security returns success having changed zero rows. "No error" and "it worked" are different claims.

## Output

A plain-language list, reviewed by an independent subagent (or handed to the owner whole, saying so, when that review could not run), whose class A questions the owner answered (or which had none) of cases the feature must survive, recorded in the task's task log — one entry per group — with the technique that produced each group named, the surfaces searched in step 3, and any case the owner deliberately declined kept visible with its reason.

```yaml
output:
  - kind: task-log
    event: adversarial-cases
    must_contain: Given-When-Then cases, one entry per group, any deliberately declined case with its reason
  - kind: task-log
    event: note
    must_contain: the techniques used and the surfaces searched
  - kind: task-log
    event: review-round
    must_contain: "the independent reviewer's gap search, with how many gaps it found, how many of its classes differ from the author's, and a ref to its saved reply — or a statement that none was saved. When the gap search did not run (the reviewer failed twice, or no subagent can be dispatched), this entry is not written: a `note` says the search did not run and why"
```
