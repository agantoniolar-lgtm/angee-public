---
name: verify-tests
description: Use after build, for every task, regardless of whether it also needs verify-evals or verify-ui. Runs deterministic tests and integration tests, self-corrects on failure, and only reports back once green.
---

# Verify — deterministic tests

## When this fires
After every `build`, unconditionally. This is the one verification step that always runs, even for tasks that also need `verify-evals` or `verify-ui`.

## Procedure

1. Run the full test suite command for this project (see `CLAUDE.md` → Stack).
2. If any deterministic test fails — including integration tests for APIs/services (auth, status codes, error handling) — do not report the failure to the project owner and ask for help. Read the failure, locate the root cause, fix the code, and re-run. Repeat until the suite passes.
3. **Hybrid features get split here, not lumped together.** If a task's endpoint has both a deterministic half (fetching data, auth) and a generative half (a model call), only the deterministic half is checked in this step — hand the generative half to `verify-evals`.
4. **A green suite is not evidence that the change is correct — check what the suite structurally cannot see.** Two patterns:

   **(a) Assert on the effect of a write, not on the absence of an error.** Many data layers return success for a write that changed nothing — a row-level security policy filters an update to zero rows and reports no error, so the app cheerfully says "saved" while nothing was saved. If the task writes data, there must be an assertion on *what changed* (rows affected, the value read back), not merely that no exception was raised.

   **(b) A decision with data consequences must live outside the component.** If the code that decides *what gets written* sits inside a UI component, tangled with view state, there is nowhere to test it — and that is exactly where this class of bug hides. Extract it to a pure function that takes state and returns the payload; then the project's ordinary unit-testing rule covers it with no new infrastructure.

5. **Cover the cases the happy path skips — and if `adversarial` ran, that list is the checklist.** Go case by case: every approved Given-When-Then either has a test, or gets reported back by name as uncovered. Silence here is the failure mode — an approved case with no test leaves a record claiming coverage that was never written.

   Where `adversarial` did **not** run (a small change that didn't warrant it), apply its techniques inline at the scale of the change: enumerate the combinations when rules combine conditions rather than testing the one you had in mind (a decision table is the cheap way); test the transitions of a lifecycle, not just its states; and treat "saving one record must not modify any other record's row" as an invariant belonging in a property-based test, which catches the whole class instead of the one instance. See `adversarial/SKILL.md` for when each technique fits — this step applies them, that skill decides which apply.

6. **Where the project has a registry and consumers, guard the coverage in both directions.** Any time one file declares a set of things (content slots, feature flags, environment variables, translation keys, route names) and other files consume them, write a test that reads the real consumer source and fails when either side drifts: **something declared that nobody consumes, or something consumed that nobody declared.** The first direction is the one that hides — an entry nobody reads produces no error, just a feature that silently does nothing. On the project this comes from, three registered entries were editable in an admin panel and read by no page at all; one was a photo that sat uploaded and invisible for a month.

   Two cautions from building it: when entries are generated from a template rather than written literally, the guard has to expand the template or it reports every entry as an orphan — and the guarantee then honestly weakens from per-entry to per-family, which is worth stating rather than glossing. And a registry-to-consumer guard says nothing about whether the *authoring UI* exposes the entry; that gap stays open unless you check it too.

7. **Search by concept, not by identifier, before declaring coverage complete.** Ask: *what else in this codebase asserts this same rule?* A grep for a function name finds its callers; it does not find the same business rule re-implemented inline somewhere else — and a rule that exists in two places will be updated in one. Real cost of skipping this: a counter kept reporting stale results after its underlying rule changed, because a second screen had its own hand-written copy of the logic and never called the shared function.

8. Only proceed past this step once the full suite passes. A failing test blocks the merge exactly like a failing eval would.

9. Report the result in plain English in the task's task log, with `scripts/task-log-append.mjs` — see "How the skills write" in `ae-kit-templates/task-log-ontology.md`. A `note`, or a `measurement` (with `--metric` and `--value`) where the result is a number: what was tested, that it passed, what (if anything) had to be fixed to get there, and — for a task that writes data — which effect assertions cover it. The exception is any agent dispatched to work on a unit while anyone else works on the same task, which does not write this itself — it returns it in its reply, and the session that dispatched it appends it ("One writer per task log" in the ontology).

## Output
A passing test suite, a plain-English pass confirmation in the task's task log naming the write-effect assertions where applicable, and a handoff to `verify-evals` and/or `verify-ui` if applicable, or straight to `commit` if not.

```yaml
output:
  - kind: task-log
    event: note
    must_contain: suite green, naming the write-effect assertions where the task writes data
```
