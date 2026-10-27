---
name: design
description: Use after a scope is approved, before build starts, whenever the task introduces or changes data structure (new table, new schema, new access rules) or a UI surface (new screen, new flow, changed component). Covers both halves — don't run only the data-structure half and skip the UI/UX half when a task has both.
---

# Design

## When this fires
Any approved task from `scope` that has a data-structure component, a UI component, or both. A backend-only change with no new data shape and no UI impact skips straight to `build`.

## Procedure

### If the task involves new or changed data structure
1. Design the schema/type change explicitly before writing implementation code — table shape, types, relationships.
2. **Write the change as a migration file using this project's migration tool, never as SQL run directly against the database by hand.** Check `SETUP_CHECKLIST.md` section 3b first — if the migrations folder doesn't exist or doesn't reflect the actual current schema, that's a retrofit gap to close (baseline the live schema into a first migration) before this task's schema change can be added on top of it. This holds even for a change that feels small.
3. If the change touches access rules for different roles/users, this is where the RLS-equivalent verification requirement gets flagged for `verify-tests` later — record it as a `decision` in the task's task log so it isn't missed at verification time.
4. Confirm the design against the strict-mode constraints of the language named in `CLAUDE.md` → Stack before moving on — if the type checker would reject the shape, fix it here, not during build.

### If the task involves a new or changed UI surface
1. Cover these three things explicitly before writing any component code, as steps of this skill — not as separate skills to remember:
   - **Consistency**: how does this fit the components, spacing, and variants that already exist? Reuse before inventing; if you invent, say why the existing pattern didn't fit.
   - **Microcopy**: every new label, button, empty state, and error message is a decision. Write them here, in the project's own register, not as placeholders to fix later.
   - **Critique**: when there's an existing screen or mockup, react to it before extending it — what's duplicated, what's ambiguous, what a first-time user would misread.
2. This is not optional or a nice-to-have step reserved for polish passes — a UI-touching task that skips this runs the risk of shipping something inconsistent that only gets caught in the `verify-ui` walkthrough, which is a more expensive place to catch it.
3. Record the design decisions in the task's task log (`logs/tasks/<id>.md`), one `decision` each, with `scripts/task-log-append.mjs` — see "How the skills write" in `ae-kit-templates/task-log-ontology.md`, in plain English (what the UI does, not implementation detail) so the eventual `verify-ui` walkthrough has something to check against.

## Output
A confirmed schema/type shape (if applicable) and a confirmed UI/UX design decision set (if applicable), both recorded in the task's task log, before `build` starts.

```yaml
output:
  - kind: task-log
    event: decision
    must_contain: the confirmed schema/type shape and/or the confirmed UI decisions, recorded before build starts
```
