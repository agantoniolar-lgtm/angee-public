---
name: verify-evals
description: Use after build (and after verify-tests), only for tasks where the agent's own output is a model call with non-deterministic results — text generation, an LLM judging or classifying something, anything that can't be checked against one fixed expected output. Never substitute a single unit test for this.
---

# Verify — AI-native evals

## When this fires
Any task where part of the feature is a model call whose output varies — not a task that merely uses an LLM at build time to write code, but a task where the *shipped feature itself* calls a model at runtime.

## Procedure

1. Define the rubric or judge criteria for what counts as a correct/acceptable output, if not already defined in `design` or `scope`. Write this down explicitly — it's the equivalent of a test's "expected output" for non-deterministic work.
2. Run the feature against a representative sample of inputs, multiple times per input (pass@k), scoring each against the rubric — either with a judge model or fixed criteria.
3. Set and apply a hard pass/fail threshold. **A result below threshold blocks the merge exactly like a failing deterministic test — this is not advisory.**
4. If the threshold isn't met, don't report the shortfall and stop — diagnose (prompt, retrieval, model choice, rubric miscalibration) and iterate the same way `verify-tests` iterates on a failing test, then re-run the eval.
5. Report the result in the task's task log as a `measurement`, with `scripts/task-log-append.mjs` — see "How the skills write" in `ae-kit-templates/task-log-ontology.md`. A scorecard: what was evaluated, the threshold, the score achieved, and pass/fail — this is what the project owner reviews, not the model's raw outputs or any code.

## Output
An eval scorecard meeting threshold, recorded in the task's task log in plain English, before handoff to `verify-ui` (if applicable) or `commit`.

```yaml
output:
  - kind: file
    path: the project's agreed evals location (dataset + rubric)
    must_contain: the case set and the grading rubric
  - kind: task-log
    event: measurement
    must_contain: a scorecard — rubric, pass@k runs, the hard threshold, and the score that met it
```

> If the scorecard cannot be pointed at, the skill did not run.
