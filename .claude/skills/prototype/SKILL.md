---
name: prototype
description: Use before `scope`, when nobody knows yet whether an idea is worth building — a new library, an unfamiliar API, an interaction nobody has seen on screen. Builds the shortest thing that answers two questions, does it work and does it show something, in a throwaway git worktree, and leaves a report in `docs/` the project owner decides on. It does not verify, review, or ship; an idea that survives goes to `scope` and starts there.
---

# Prototype

## When this fires

An idea whose viability is unknown. Nobody can say whether the library does what its README claims, whether the data is shaped the way the plan assumes, or whether the screen reads well once it exists. Running `scope` on that is planning a build whose central assumption has never been touched.

**Not for work already decided.** If the question is *how* to build it and not *whether* it can be built, this skill is a detour: go to `scope`. It is also not a smaller `build` — nothing written here reaches the tracked branch.

Skip it when the answer is one search away, and say so rather than deciding silently.

## What it answers, and only this

**1. Does it work?** Take the single assumption most likely to be false and exercise it end to end, against the real service, the real file, the real data shape. The smallest path that could *disprove* the idea, not the path that shows it off.

**2. Does it show something?** In a project with a UI, one screen rendered with realistically shaped data at the viewport the project's users actually have, captured as a screenshot. In a project with no UI — `CLAUDE.md` → Stack says Frontend does not apply, or `.ae-kit-excluded` names `verify-ui` — the second question does not disappear, it changes surface: **what does its output look like to the person who reads it?** Paste the real printed output, or the real generated file, into the report. A script whose result nobody has seen is as unproven as a screen nobody has rendered.

**Everything else is out of scope here**: performance, security, error handling, edge cases, tests, naming, structure. Not deferred with a promise — simply not asked.

## Procedure

1. **Write the question in one sentence, with the answer that would kill the idea.** "Can the export API return more than 1000 rows in one call?" has a losing answer; "explore the export API" does not. Set a time budget out loud and stop when it runs out, answered or not — an unanswered prototype that reports the time it burned is a result.

2. **Sweep what earlier prototypes left behind.** `git worktree list` and `git worktree prune`. Anything under `.worktrees/` from a previous session gets closed as in step 7, or named in the report as deliberately still open with the reason. This step is why forgotten worktrees stay a rarity.

3. **Open the worktree.**

   ```
   git worktree add -b proto/<slug> .worktrees/<slug>
   ```

   `<slug>` is two or three words naming the question, the same one the report will carry. `.worktrees/` has to be in `.gitignore` — add the line if it is missing, and say so in the report, because it is the one change this skill makes to the main tree.

   **The worktree starts from the last commit of the tracked branch, not from your working tree.** Uncommitted work in the main tree is not there. If the prototype needs it, copy it in on purpose and write that down. Record the base SHA (`git rev-parse HEAD`); step 7 needs it. Installed dependencies are not shared either — install them inside the worktree if the project has any.

4. **Build the shortest thing that answers the question, and name every shortcut as you take it.** Hardcoded data, skipped authentication, no error handling, copied-and-pasted blocks: all allowed here, all listed in the report. A shortcut nobody wrote down is how a prototype gets promoted as if it were finished work.

5. **Answer both questions with evidence a reader can see.** Run it, capture the output, take the screenshot. Screenshots and captured output go under `docs/prototype-<slug>/` in the main tree, next to the report.

6. **Write the report in the main working tree, at `docs/prototype-<slug>.md`, never inside the worktree** — the worktree is deleted in the next step and everything in it goes with it. It lives in `docs/` because it is a document somebody decides on, which is what `docs/` holds; `check-log-layout.mjs` rejects a folder in `logs/` that is not one of the five it knows. Six sections, in this order:

   - **The question**, as written in step 1.
   - **The verdict**: `works`, `does not work`, or `undecided`, each with one paragraph of why. `undecided` is a legitimate ending, and it says what the next prototype would have to touch.
   - **What is real and what is fake**, as two lists. The fake list is the shortcut list from step 4.
   - **What `scope` keeps** — see below.
   - **What is still unknown**, including everything the prototype deliberately did not ask.
   - **How it closed**: the time spent, and the `git worktree list` output showing nothing named `proto/` is left.

7. **Close the worktree in the same session that opened it**, whichever way the verdict went.

   When the idea is promoted, capture the code as a patch first — it is text, it survives, and it does not keep a branch alive:

   ```
   mkdir -p docs/prototype-<slug>
   git -C .worktrees/<slug> add -A
   git -C .worktrees/<slug> diff --stat <base-sha>
   git -C .worktrees/<slug> diff <base-sha> > docs/prototype-<slug>/code.patch
   ```

   The `--stat` line goes in the report. Then, either way:

   ```
   git worktree remove --force .worktrees/<slug>
   git branch -D proto/<slug>
   ```

   `--force` because the worktree is dirty by construction, and `-D` because the branch was never merged and never will be. The empty `.worktrees/` directory that remains is ignored and harmless.

8. **Hand off by verdict.** `works` goes to `scope`, carrying the report. `does not work` ends here: the report is the record, and nothing is opened. `undecided` gets a line in `PENDINGS.md` naming the decision that is missing, or a task file with `status: backlog` when what is missing is time rather than a call.

## What this skill does not do, and why

**It does not run `verify-tests`, `verify-ui`, `adversarial` or `code-review`.** This is chosen, not forgotten. Most prototypes are thrown away, and a prototype that costs what a feature costs stops being worth running before the decision is made. Tests written against a design nobody has agreed to measure a shape that is about to change, and a review pass spent on code that will not be merged buys an opinion about a draft.

**What a prototype may therefore never claim:** that it passed its tests, that it handles errors, that it is secure, that it performs, that it is ready for anyone but the person who ran it. It answers the one question in step 1 on the one path that was walked. Every other property is unknown — which is different from fine.

**Prototype code does not become the implementation by decree.** It reaches the tracked branch only by being written again under `scope` → `build`, with its cases and its review. The patch from step 7 is reference material, not a starting commit.

## What `scope` keeps, and what it throws away

Keeps: the question and its answer, any number that was measured, the dead ends with the reason each one closed, the interfaces and versions confirmed to exist and the shape of what they return, and the unknowns the prototype discovered along the way.

Throws away: the code, every shortcut in the fake list, and the claim that it works beyond the single path walked.

A promoted prototype is an **input to the blueprint** — the riskiest assumption is now settled, so `scope` can plan against a fact instead of a hope. It is not the blueprint, and it is not permission to skip one.

> **The report follows `ae-kit-templates/style-rules.md`**, like every document the kit writes. Read it before writing, not after.

## Output

A report at `docs/prototype-<slug>.md` the project owner reads to decide — the question, the verdict in one word, what was real and what was faked, what survives into `scope`, and the evidence that the worktree is gone. Plus a `note` in the task log when the idea already has a task file, so the decision is findable from the work it belongs to.

```yaml
output:
  - kind: file
    path: docs/prototype-{slug}.md
    must_contain: the question, a verdict of works / does not work / undecided, the list of shortcuts taken, what scope keeps, and the closing `git worktree list`
  - kind: file
    path: docs/prototype-{slug}/code.patch
    when: the verdict is works and the idea goes to scope
    must_contain: the diff against the base commit, captured before the worktree was removed
  - kind: task-log
    event: note
    when: the idea already has a task file
    must_contain: the verdict and the path of the report
```
