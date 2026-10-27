---
name: commit
description: Use once per unit of work, right after `verify-tests` passes for that unit and BEFORE `code-review` sees it — the commit is what gets reviewed, so it has to exist first. Ends at a local commit that is not pushed, every time. Pushing, verifying the remote and closing the task belong to `ship`, which fires once per task after every unit has been reviewed.
---

# Commit

## When this fires

**Once per unit of work**, right after `verify-tests` passes for that unit and before `code-review` sees it. The commit is what gets reviewed, so it has to exist first.

This holds for every kind of task. A documentation, decision or research task has units too — the sections of the document it writes — and each one is a commit like any other. What it lacks is automatic verification, and that is declared in that unit's own `verified by:` field ("read it back", for instance), not in a separate path through this skill. There is no alternate route here; there is a different `verified by`.

## Terminal condition — read this before starting

**One state: a local commit that is not pushed.** The hash is reported in chat the moment it lands.

Nothing here pushes, verifies a remote, sets a task to `done` or regenerates an index. That is `ship`, once per task, after `code-review` has passed over every unit. The split is what the gate rests on: **nothing unreviewed reaches the remote.** A local commit nobody has pushed is not published work, so reviewing after committing is the order, not a shortcut.

## Procedure

1. **Check for a stale `index.lock` before attempting to commit.** Check whether a git process is genuinely still running. If not, and a lock file is present, clear it and retry. If one is running, wait — do not force-remove a lock while a process might still be using it. **If this is a cloud session with a restricted sandbox, clearing the lock may not be permitted from within the session at all**, independent of whether a git process is actually running — if removal fails for a reason that isn't "a process is using it," don't keep retrying; tell the project owner the lock needs clearing from their own terminal.

2. **One commit per unit, and the commit says which unit it is** — a `Unit: U2` line next to `Task:` in its last paragraph. The subject carries no unit mark: nothing reads it. When the unit is integrated, `integrate-unit.mjs integrate` writes the commit under the unit in `## Done when` as `- commit: <sha>`; with a single writer, run `integrate-unit.mjs record <task> <unit>` once the unit's review round came back clean — not right after committing, since an amend asked by the review would leave the old sha recorded — and the session's next commit carries that line. A fix commit carries the `Unit:` line of the unit it corrects and its own review round, which cites it by its sha; it does not replace the unit's `- commit:`, which stays the unit's original commit and anchors the order. Stage that unit's files and its task's task log, and nothing else: a commit that sweeps up unrelated work is one `code-review` cannot judge against a single stated deliverable. The task log is not unrelated work — every unit of the task writes to it — and the paragraph on `logs/tasks/` below says how it travels.

   **The first unit's commit takes one addition to that rule**: the task's own state is staged with it — `tasks/<id>.md`, the scope doc or PRD `scope` wrote under `docs/`, the `status: in progress` edit, and the regenerated indexes. This holds on both paths, because in both the first unit's commit is the task's first commit: whether `scope` step 8 set `in progress` because building started the same day, or `build` step 1 set it because the plan was written for an earlier day. They are the task's state, not a second deliverable, and `code-review` still judges that commit against its one unit. The alternative is leaving them uncommitted for the whole task, where nothing catches it: the index check compares the generated files on disk against `tasks/` on disk, so an untracked task file reads as consistent.

   **The closing commit is not made here.** Setting the task to `done` and regenerating the indexes lands as its own commit at the end of the task, and `ship` is what lands it. It carries no deliverable and gets no review pass, so it is not a unit: a task of n units lands n+1 commits, and this skill makes n of them.

   **A blocking finding on a unit that has not been pushed is fixed by amending that unit's commit**, so one unit stays one commit however many rounds it takes.

   **Amending only works while that unit is the last one.** Once later units sit on top — and especially when they touch the same files, so the diff no longer separates by file — the fix lands as its own **fix commit**, with the `Unit:` line of the unit it corrects — one fix commit per unit. Forcing the amend would mean rewriting every commit above it. Once pushed, neither applies: fix forward in a new commit, never with `force-push`.

   **A unit's commit carries its task log, `logs/tasks/<id>.md`, whole — and not the views.** Any agent dispatched to work on a unit while anyone else works on the same task does not write to it — the session that dispatched it appends its entries (`build` step 4) — but if two branches do end up appending to it, a task log only grows and `.gitattributes` declares `logs/tasks/*.md merge=union`, so when the branches meet git merges them instead of stopping on a conflict. It is a net with a hole: two appended entries that end in the same lines lose those lines from one of them. It does not cover an edit either: an entry edited on one branch next to an append on the other merges silently into the wrong entry, and nothing detects it. Entries are never edited, and that is what this relies on. The views under `logs/tasks/current/` are left out of a unit's commit on purpose. They are generated, the union rule does not cover them, and two branches carrying them would conflict over files nobody wrote by hand. This skill does not generate them: `session-log` regenerates them when it closes the session, and **the session's closing commit is the one that stages `logs/tasks/current/` whole — additions AND deletions**, including a view the generator retired. `open-session` regenerates before reading one, so a view a few commits behind is read by nobody.

   **One limit, declared rather than fixed:** two agents working in the same checkout would stage each other's entries, because the one file on disk holds both. Separate worktrees are what keep them apart.

   Then stage the intended changes and commit using this project's stated commit message convention (see `CLAUDE.md` → Git conventions). **Kit default: a type prefix plus a descriptive summary** — `feat:` / `fix:` / `chore:` / `refactor:`, followed by what changed and, in the body, why. A message like "update", "changes" or "fix" is not acceptable regardless of convention: the point is that someone reading the history a month later knows what happened without opening the diff. **The message ends with a `Task:` line in its last paragraph, next to `Co-Authored-By:` — for a unit's commit, the id of the unit's task (`Task: T104`, not the file name), unless the skill that invoked this one asks for another line (`session-log` and, for a commit that creates several tasks, `scope` ask for `Task: none`)**. A unit's commit adds `Unit: U2` in that same paragraph; a fix that corrects two units of one task is two commits, one per unit, each with its own `Unit:` line. Where the project has wired `scripts/check-commit-task.mjs` as its `commit-msg` hook, a commit without `Task:`, with two `Unit:` lines, or with a unit its task does not have (or struck out), is refused.

3. **Report the outcome explicitly in chat** — the commit hash if it succeeded, or the specific reason if it didn't (including "found and cleared a stale lock, retried, succeeded" if that happened). Never leave the project owner to guess whether anything landed.

Then hand the commit to `code-review`. When the last unit has been reviewed with no open blocking findings, the task goes to `ship`.

> **Every document this skill writes follows `ae-kit-templates/style-rules.md`.** Nine rules, three
> levels by how often a file gets read. Read it before writing, not after. Nothing verifies
> compliance — `R31` declares that honestly with an `owner:` trigger rather than faking a checker.
> The reasoning behind each rule is in `ae-kit-templates/style-rules-appendix.md`.

## Output

**One recorded state, never silence:** the unit's commit, local and unpushed, with its hash reported in chat.

```yaml
output:
  - kind: chat
    must_contain: the commit hash for this unit, or the specific reason nothing was committed
```

The declared artifact is a chat report and nothing else, on purpose. What this skill leaves behind is the commit object itself, which the unit's `- commit:` line in the task file names once it is integrated or recorded — this skill itself writes no file. Naming one it does not write would be the hollow contract this block exists to refuse.

`code-review` reads that commit next, and `ship` reads the task log's review rounds before it pushes anything.
