---
name: verify-ui
description: Use after build (and after verify-tests/verify-evals as applicable), only for tasks that touch a UI flow significantly enough that visual/behavioral correctness can't be confirmed by tests alone. Skip for isolated bug fixes or small changes where a targeted before/after check is enough — don't over-apply this to every tiny UI tweak.
---

# Verify — UI walkthrough

## When this fires
Any task that introduces or meaningfully changes a UI flow. Not every UI-touching change needs this — a one-line style fix or an isolated bug fix just needs a targeted before/after check, stated plainly in the task's task log. This step is for builds significant enough that a reviewer needs to actually walk the flow to catch missing states or edge cases.

## Procedure

1. Walk the affected flow end to end as the relevant user role would (e.g., "as an editor, opening a record someone else created…").
2. Produce a summary **organized by flow, not by file** — describe what a reviewer would see and do at each step, and what changed, in plain English. Capture recordings or screenshots where useful; these double as the human-readable artifact, not just a pass/fail signal.

3. **Verify the small viewport if the project has mobile users — and verify it with something that actually changes the viewport.** This is a manual check with no linter behind it, which is exactly why it needs to be a named step instead of an intention. Three ways to get it wrong, all measured rather than assumed:

   - **A headless browser launched with a window-size flag does not set the layout viewport.** It renders wider and *crops* the screenshot, so text that overflows on a real phone looks fine, and text that fits looks broken. It produces false positives in both directions — one nearly caused a fix to a bug that did not exist.
   - **A browser-extension "resize window" call can report success without changing the page's inner width**, so media queries never engage and you are looking at the desktop layout at a small scale.
   - **What works without new dependencies:** render the page inside an `<iframe>` of the target size (e.g. 390×844) served from the project's own dev server. It gives a true layout viewport. Its one known limit: programmatic scrolling does not work inside it, so verify scroll behavior in a real window.

   **The better answer, when the project can carry the dependency, is a real browser-automation tool** (Playwright or equivalent): it sets a true viewport, can authenticate programmatically, and emits screenshots and video the project owner reviews without touching the app. That last part is the actual argument for it — **it is what removes the project owner from having to walk every flow personally.** Do not assume it is installed: check, and if it is not, say so and use the iframe.

4. **Walking the happy path is not a walkthrough.** Explicitly visit the empty state, the error state, the loading state, and the state where the user lacks permission. Missing states are where real bugs surface — more reliably than in code review.

5. Record the walkthrough in the task's task log as a `note`, with `scripts/task-log-append.mjs` — see "How the skills write" in `ae-kit-templates/task-log-ontology.md`, so the project owner can repeat the same motions and confirm it matches expectations. **State plainly which parts you verified yourself and which still need a human on a real device** — an unverified area named as such is fine; one quietly omitted is not.

## Output
A flow-organized walkthrough (plus recordings/screenshots if applicable) in the task's task log, naming the viewports actually exercised and the states beyond the happy path that were visited — ready for the project owner to check by using the feature, not by reading anything.

```yaml
output:
  - kind: task-log
    event: note
    must_contain: viewports actually exercised, states beyond the happy path visited, and who verified — the agent or the owner
```
