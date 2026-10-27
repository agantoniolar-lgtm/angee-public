---
name: scope
description: Use at the start of any non-trivial feature, refactor, or bug fix — before any file is touched. Produces the "blueprint" CLAUDE.md's plan-first rule requires, creates or promotes the task's file in tasks/, and — for anything beyond a simple bug fix — a staged scope doc or PRD in /docs so every significant build leaves a durable, reviewable record of the problem and the plan. Skip entirely only for single-line fixes or pure copy/text changes with no side effects.
---

# Scope

## When this fires
Any request to build a feature, change existing behavior, or fix a bug that touches more than a single obvious line. If it's genuinely trivial (a typo, a copy change with zero logic impact), skip straight to `build` — but say so explicitly rather than silently deciding.

This skill is for work whose plan is being written *now*, whether or not it is built today. A plan written and then left to wait is normal: the task ends this skill at `todo`, and moves to `in progress` the day it starts. An idea nobody has planned yet does not need this skill at all — just create its task file (`tasks/<id>.md`) with `status: backlog`.

## Procedure

1. **Get the task's file to exist, and give it a `status`.**

   - **If it is already in the backlog**, it already has a file — `BACKLOG.md` is a generated index, not a list of rows to move from. **Promoting is editing one word of its frontmatter**: `backlog` → `todo`. Nothing is renamed, nothing is moved, and every link written to it stays valid.
   - **If it is new**, create `tasks/<id>.md` from `ae-kit-templates/task.md.template` and fill the frontmatter (id, title, category, type, epic, priority, status, created, updated).

   **Set `status: todo`** — the plan is being written, and the status the timing calls for is step 8's to set, after the approval. Regenerating the indexes waits for step 8 too: nothing this step changes is worth regenerating twice.

   **A task is one of three things, and its body says which.** The kit has no field for it: it is a sentence in `## What this is`, because what changes with it is how the task closes.

   - **A task on its own** — no document, or a scope doc that covers this task and nothing else. Its `## Done when` holds the units that finish the work.
   - **One stage of a document that has several** — the document's `## Fases` holds the stages, this task holds one of them, and its units are the commits that finish that stage.
   - **The task that writes a document** — it closes when the document is approved, not when the tasks that document spawned are done. Those are separate tasks with their own lives. This one exists only when writing the document is itself the work being planned.

   A scope doc with no stages does not make a task the third kind: the document and the task describe the same piece of work, and the task is the first kind with a document attached.

   **Where each artifact this skill produces is written, so nobody has to invent it:**

   | What | Where |
   |---|---|
   | The blueprint (step 2) | A `## Blueprint` section in the task file, after `## Why it matters` |
   | The doc decision (step 3), when the answer is "no doc" | One sentence in that same `## Blueprint`, saying why |
   | The scope doc or PRD (step 3) | `docs/scope-<slug>.md` or `docs/prd-<slug>.md` |
   | The units (step 6), each with its `touches:` | `## Done when` in the task file |
   | The plan review (step 7): its round, its findings, the class B fixes | The task log, `logs/tasks/<id>.md`. For many tasks this is the first entry, so this step creates the task log |
   | Something found while planning that changes the plan | `## Hallazgos` of the scope doc, or the blueprint when there is no doc |
   | A decision the project owner still has to make | `## Decisiones` of the scope doc, under "Pendientes" — or `PENDINGS.md` when there is no doc |
   | Anything decided or found once building starts | The task log, `logs/tasks/<id>.md`. **Step 7's review is the only entry this skill writes**; when the reviewer could not run, that entry is the `note` saying so |

   **"Posting" the blueprint for approval (step 8) means both**: it lives in the task file, and its substance goes in the reply that asks for approval. The project owner should not have to open a file to answer.

   **The id is the highest existing id plus one, counting archived and dropped tasks — never a freed gap.** Reusing a number brings a dead id back to life carrying a different meaning, and a link written months ago then points at work that has nothing to do with what it meant. The id identifies; it does not classify — the `status` says what kind of thing this is, and the id stays the same from the day it is noted to the day it ships.

   Do this before any other step: the file is the record of work that has started, and it needs to exist the moment it starts, not once it's finished.

   **Write it for someone with no history of this project.** Spell out the acronyms once, name the real file paths, and state the problem before the solution. If the file isn't enough for a cold start, it isn't finished.

   **The task file says where the work is going** — status, done-when, open blockers, next step. What happens along the way goes in its task log, `logs/tasks/<id>.md`, which the template links to and the first entry creates; see `ae-kit-templates/task-log-ontology.md`. The blueprint below is plan, so it does belong here.
2. **Write the blueprint**, covering:
   - Proposed change: what logic changes and why, in plain English.
   - File impact list: exact files to be created, modified, or deleted. Step 6 draws each unit's `touches:` from it, so a file missing here is one no unit may write.
   - Dependency warning: anything this could break elsewhere — other modules, other features, shared components.
   - Testing plan: which `verify-*` skills will apply (tests always; evals if this touches a model call; UI walkthrough if this touches a UI flow) and what "passing" looks like for this specific task.
3. **Decide whether this task also needs a written doc in `/docs` — this call is mandatory to make explicitly, not something to skip quietly.** Default to writing one; the bar for skipping is real simplicity, not convenience:
   - **No doc — bug fix or simple, well-understood change.** Skip `/docs` when the cause and the fix are both already clear and confined to one obvious spot: no new or changed data structure, no new access policy, no genuine open question about the problem. The blueprint from step 2, plus the task file (`tasks/<id>.md`) and its task log, is the record.
   - **Scope doc — a standalone feature or complex change.** Write `docs/scope-<slug>.md` from `ae-kit-templates/scope-doc.md.template` when the task is its own self-contained unit of work with real complexity: it touches multiple files, introduces or changes a data structure or access policy, has open decisions that need the project owner's call before or during the build, or is gnarly enough to benefit from being broken into a few checkable sub-steps. A "complex feature" is this same template, not a separate one — a feature is standalone by nature, so it never needs the PRD's product-level framing below.
   - **PRD — a product or epic that will host multiple scopes.** Write `docs/prd-<slug>.md` from `ae-kit-templates/prd.md.template` when the ask is bigger than one feature: it's the umbrella for several distinct scopes/features that will each get their own scope doc over time, and the problem needs to be pinned down with the scoping questions in step 4 before it can be responsibly split into stages.
4. **For a PRD, work through these questions before drafting its "Fases" section — the problem has to be pinned down before it's split, not split first and rationalized after:**
   - What's failing or missing right now, evidenced concretely — not a hypothetical?
   - What does success look like, and for whom? (→ Objetivo)
   - What's explicitly out of scope for this doc — adjacent asks it will *not* cover, and why? (→ No-objetivos)
   - Is there a known failure mode, or a guiding principle, this design must protect against? (skip this if there genuinely isn't one — don't invent one to fill the section)
   - Does this touch the data model? If so, propose it now, verified against the real current schema — not assumed from a doc that might be stale.
   - What's the natural stage breakdown? Each stage should stand on its own — ships value by itself, is independently verifiable and committable — and the sequence should de-risk the riskiest or most foundational piece first.
   - Which stages gate on a prior stage finishing, and which gate on an external decision (a pending convention, a pending call from the project owner)? Name the gate explicitly, per stage — not just "this doc is blocked."
   - Of the decisions needed to proceed, which are already resolved and which are still open — and which *specific* stage does each open one block?
   - What does the verification plan look like per stage (which `verify-*` skills apply)?
   - What does this depend on, or relate to, elsewhere in the project?
5. **If the doc defines multiple stages substantial enough to build and verify independently, stage them as separate task files** — one per stage, each referencing the doc and its stage number, rather than one task covering the whole doc. Judge this at the discretion of complexity: how much context a single build session needs to hold to stay focused, and how precisely progress needs to stay trackable — not a fixed rule, and it applies the same way whether the doc is a scope doc's own "Fases" section or a full PRD. A stage's task only moves to `in progress`, or gets prioritized, once the stage(s) it depends on are `done` — don't start a dependent stage while its dependency is still open.
6. **Break the task into units of work, and write them into its `## Done when`.** A unit is the smallest change that is buildable and verifiable on its own, and **each unit is its own commit**. This is not a stylistic preference: `code-review` reviews commit by commit, so a commit carrying three unrelated changes is one the reviewer has to untangle before it can judge anything, and the parts it never separates are the parts it never checks.

   **The format, because `code-review` reads this section to know what to review.** The `- [ ] **U<n>** —` line is the unit, and its text is what the unit delivers: the observable change, not the file it lives in. Three fields go beneath it, as nested list items:

   ```
   - [ ] **U1** — The header rule moves out of the importer into one pure function
     - verified by: test-header-rule.sh
     - depends on: nothing
     - touches: src/import/header-rule.js, src/import/importer.js, test/test-header-rule.sh
   - [ ] **U2** — Imports accept a CSV whose header row is missing
     - verified by: test-import.sh, the two new cases for a headerless file
     - depends on: U1
     - touches: src/import/importer.js, test/test-import.sh
   ```

   - **verified by** — the suite, check, or execution that says it worked. **A change that cannot be verified on its own is not a unit**: fold it into the unit it belongs with, rather than leaving the reviewer a commit with nothing to check it against.
   - **depends on** — the unit that has to land first. This is what makes the critical path readable, lets independent units be built and reviewed in parallel, and tells `code-review` which pass waits on another's findings.
   - **touches** — the files this unit writes, and the only ones its builder may write. It is a write contract: `build` reads it to decide which units can run at the same time when the project delegates, and a builder asks before writing any other file, following a class B answer without waiting for the owner (`build` step 1). Take the entries from step 2's file impact list, split by unit; every file on that list belongs to at least one unit, except the task's own state files (`tasks/`, `logs/tasks/`, `TASKS.md`, `BACKLOG.md`, `TASKS_ARCHIVE.md`), which only the session writes and no unit declares. One file path per entry, separated by commas: no directory, no pattern, no phrase such as "and its copies", because none of those can be compared against another unit's list. A file the unit creates is declared like one that exists, a file it deletes likewise, and a rename with both names, because that is how `integrate-unit.mjs check` counts them. **In the repo that produces the kit, a file that has an installed copy is declared with both** — the source under `kit/` and the copy — because the pre-commit check that keeps the pair identical makes every change write the two.

   **`touches:` is also what `task-units.mjs --plan` compares against other tasks**, before each unit is built, by a single writer too: a unit whose file another task has — a unit of it dispatched and not integrated (a live worktree, or a branch with a commit), or the branch `ai/<task>` of any task not `done` or `dropped`, noted when that task is not `waiting on owner` — waits there, named, until the file is released (`build` step 1). Warning here about a clash that may come later is not this step's job; `--plan` sees it when the unit is built.

   Write all three field lines on every unit, `nothing` where `depends on` is empty — `touches:` is never empty, since a unit that writes no file is not a unit — and keep them as nested list items rather than indented text, which renders as one run-on line.

   **One unit is a normal answer**, not a sign of having split badly: plenty of changes are one indivisible thing. The point of this step is never the count.

   **No checkbox in this section is anything but a unit.** A condition that is not a change — a decision the project owner has to make, an approval, a measurement — belongs in the task log: a checked line with no commit behind it is one `code-review` will look for and never find. Prose around the list is fine and often necessary; only the `- [ ]` lines are read as units.

   **A task of n units lands n+1 commits.** The closing one — status `done`, indexes regenerated — carries no deliverable and gets no review pass of its own. All of them go out in **one push, at the end**, once every unit has passed its review; that is what keeps the remote from ever holding a state where an old rule and its replacement both apply.

   **The list is not final once approved.** A unit that turns out to be two while being built gets split then and there, and the `## Done when` is rewritten — discovering it during `build` is normal, leaving it off the list is not.

   Three cases that only apply sometimes, so skip them when they don't:

   - **A document split into stages** — one whose `## Fases` section lists several deliverables that each build and verify on their own. Step 5 has already turned each into its own task. This step and step 5 are different levels: step 5 splits a *document* into tasks, this one splits a *task* into commits. Write units only for the task starting now. When step 3 produced such a document, the task in front of you is the one that *writes* it, and it has one unit — the document — closing when the document is approved. Each stage task gets its own units the day it starts.
   - **A task written before this rule existed.** Leave its `## Done when` alone until it is about to be built; the model applies to work split from here on. Before anything of it is built, this step writes its units, each with its `touches:`: a task with no units has nothing `build` can build. In a task that has units, a unit with no `touches:` is not built: `build` does not fill the field, it sends the unit back here, and this step writes its `touches:`, splitting it again if it has to, and step 7 reviews the rewritten units before they are built. The task's other units go on meanwhile.
   - **A change touching data structure or access control.** Order it to close before whatever depends on it, so nothing is built on an unverified layer.

7. **Have the plan reviewed by a subagent that did not write it, before the owner sees it.** Dispatch the `scope-reviewer` agent (`.claude/agents/scope-reviewer.md`, subagent type `scope-reviewer`) as a separate subagent. Hand it only the task file's path and, if step 3 wrote one, the path of the scope doc or PRD. Never hand it this session's conversation: a reviewer that inherits the author's reasoning checks the plan against the author's own premises. If the session cannot dispatch that agent type, dispatch a general-purpose subagent told to read `.claude/agents/scope-reviewer.md` and follow it, and say so in the `review-round` below. That fallback is weaker: it has Edit and Write, so its read-only is an instruction and nothing more.

   **Each finding carries a class from `ae-kit-templates/decision-classes.md`, and the class says who acts on it:**

   - **Class B** — this skill fixes the plan itself, without asking the owner: splits or folds units, completes a `touches:`, cites the id of the decision the plan relies on. The reviewer's proposed unit lines are a starting point, read before they are pasted.
   - **Class A** — goes to the owner with the plan, in the same reply that asks for approval (step 8): one question per finding, with this skill's recommendation. When the project has a control center, each one is also a card there.

   **One re-run, only when a fix changed the units.** A fix that split, folded or renumbered units gets one fresh reviewer instance over the rewritten plan; any other fix gets none. A finding that still blocks after that second pass goes to the owner, whatever its class. There is no third pass.

   **Record the run with `scripts/task-log-append.mjs`.** For many tasks this is the first entry, and the appender creates the task log. Write one `review-round` with `--by scope-reviewer`, a `--result` such as "2 blocking, 1 flag; units 3 → 5", and a `--ref` to the report saved under `logs/subagents/`, found by the agent id as `code-review` step 5 describes. It takes no `--unit`, `--commit` or `--blocking`: those belong to the review of a commit. Class B findings fixed before the owner sees the plan go in that round's body, one line each with the criterion and what changed, and get no `finding` entry: they were never open, and a `fix --resolves` in the planning commit would hold the push `ship` makes at session close. Each class A finding, and each finding still blocking after the second pass, gets a `finding` with `--severity` BLOCKING or FLAG and a body that opens with the criterion and the class: "C3 · class A — …". **The owner's answer closes it**: a `decision --by <owner> --resolves <finding id>` with the choice, written when the answer arrives. A blocking finding left open stops every unit of the task at `integrate-unit.mjs` and holds `ship`, so none is left without its decision. A second pass is its own `review-round`.

   A reviewer that fails or returns nothing is not a review that found nothing. Dispatch it once more; if it fails again, record a `note` saying the review did not run and why, never a `review-round`, and tell the owner the plan went unreviewed. **Without a review, the split is the owner's call again**: the units and their `touches:` go to the owner with the plan, as class A, the way `adversarial` hands over its whole list when its gap search could not run.

   The approval reply says in one line what the reviewer changed — "the reviewer split U2 in two; units 3 → 4" — without listing the class B details: those are in the task log.
8. **Set the status the plan's timing calls for, and regenerate the indexes** with `scripts/generate-task-index.mjs` — never write to `TASKS.md` or `BACKLOG.md` directly, they are generated artifacts. **In the repo that produces the kit, the copy to run is `kit/scripts/`**, the source; everywhere else `scripts/` is the only one. Do this only after posting the blueprint (and the doc, if step 3 called for one) and pausing for explicit approval — the owner approves what gets built and its scope. How the work is split into units is class B (`ae-kit-templates/decision-classes.md`): step 7's reviewer settles it, and the approval reply only states the unit count and what the reviewer changed. When that review could not run, the split goes to the owner with the plan instead (step 7, last paragraph). A split that changes what gets built is still the owner's call. Do not proceed to `design` or `build` without it, regardless of how confident the plan seems. **Approval is not a start.** When building begins right away, set `in progress` here. When the plan is being written for a later day, the task ends this skill at `todo`, and **`build` sets `in progress` before its first unit** — that is the skill where work actually starts, and leaving it to nobody is how a task gets built, committed and reviewed while still reading `todo`, invisible to every index and to `open-session`'s stall check. The commit that creates or promotes the task file ends its message with that task's `Task: <id>`, or with `Task: none` when one commit creates several tasks, as a split PRD does.
9. **Create the branch if this project's branch policy calls for one** (`CLAUDE.md` → Git conventions), named `ai/<task-id>-<slug>`. Kit default: isolation follows concurrency, so a single writer skips this step.

> **Every document this skill writes follows `ae-kit-templates/style-rules.md`.** Nine rules, three
> levels by how often a file gets read. Read it before writing, not after. Nothing verifies
> compliance — `R31` declares that honestly with an `owner:` trigger rather than faking a checker.
> The reasoning behind each rule is in `ae-kit-templates/style-rules-appendix.md`.

## Output
An approved blueprint reviewed by `scope-reviewer`, a task file (one per stage, when the document lists stages) in `tasks/` with its units of work written into `## Done when` — `todo` until work starts, `in progress` on the day it does — a scope doc or PRD in `/docs` when step 3 called for one, and, when the project's branch policy calls for one, a branch ready for work. Hand off to `design` (if the task involves new data structure or a UI surface) or straight to `build` otherwise.

```yaml
output:
  - kind: file
    path: docs/scope-{slug}.md or docs/prd-{slug}.md
    when: anything beyond a simple bug fix
    must_contain: the problem, the agreed plan, and what is explicitly out of scope
  - kind: task-entry
    must_contain: the approved blueprint and the units of work in `## Done when` — one per commit, each with what it delivers, what verifies it, what it depends on, and the files it touches. Status is `todo` until work starts and `in progress` on the day it does
  - kind: task-log
    event: review-round
    must_contain: the scope-reviewer's run over the plan, by and result, with a ref to the saved report, followed by a finding per finding and a fix per class B fix applied — or a note saying the review did not run and why
```
