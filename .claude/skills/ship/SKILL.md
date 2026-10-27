---
name: ship
description: Use once per task, when every unit has passed `code-review` with no open blocking findings. Lands the closing commit, runs whatever this project gates on push, pushes, verifies the remote came back green, and writes the proof into `logs/deploy-checks.md`. Two modes — straight to the tracked branch, or from a worktree through a pull request. A local commit nobody has confirmed on the remote is not a finished task.
---

# Ship

## When this fires

**Once per task**, after `code-review` has passed over every unit and there are zero open `BLOCKING` findings — counted in the task log, where a `finding` with `severity: blocking` that no `fix` or `decision` resolves is still open. Confirm that count before anything else here; it is the gate this skill holds.

The same applies to a documentation, decision or research task. Those have units too (the sections of the document), each one already committed by `commit` and reviewed by `code-review`. Nothing about this skill changes for them.

**`session-log` also calls this skill to close a session**, and that call has no task behind it: `commit` lands the session's files locally, then `ship` takes them out. Three steps read differently there, and reading them as written is how a session close either skips the gate or marks unfinished work `done`:

- **Step 1** has no task's review gate to confirm — a session close has no task behind it. What replaces it is the same invariant applied to the push itself: **every commit this push would carry has been through `code-review`.** List the commits between the tracked branch's remote head and local `HEAD`. **The test is per commit and does not depend on how its subject is written:** a commit whose trailers carry `Task:` and `Unit: U<n>` is answered by a `review-round` of that task whose fields say `unit: U<n>`, `commit:` that commit's sha (or the sha it had before a rebase that left its patch and the unit's files as they were) and `blocking: 0` — the subject and the round's prose are not read — **and only while its task has no open blocking finding, in that unit or in any other**, counted in the task log exactly as step 1 counts it for a task. A round that found a blocker is a review that failed, not a review that passed: the unit commit waits until the blocker is fixed and a fresh reviewer has confirmed it, or the project owner accepts the risk in writing. A commit that carries changed files without one — a fix commit, a correction, anything landed outside a unit — is unreviewed until a review round in some task log cites that commit's own hash. **A record-only commit is exempt**, checked on the diff and not taken from the commit's description: it is not a merge commit (a merge shows no numstat, which is not the same as showing none), and every file it touches is record — anything under `logs/`, `tasks/` or `docs/`, the generated indexes, `STATUS.md`, `PENDINGS.md`, or `PRODUCT.md` where the project has one — the list `RECORD_PATHS` in `scripts/check-push-tasks.mjs` carries, so the two never drift. `git show --stat <sha>` answers both. Anything else it touches — the kit, a script, a skill, a workflow — makes it unreviewed like any other. **One exception inside the exemption:** a record-only commit that adds a `resolves:` or a `replaces:` line, in an entry of any type, is not exempt. Those two lines are what close a finding or take it out of the count, and the count is what opens this skill's gate. Such a commit needs a review round that cites its hash — the reviewer is asked to confirm that what the line claims is true: the fix exists in a reviewed commit and does resolve the finding — or the project owner's confirmation in writing. An edit to an old entry that closes nothing stays exempt: entries are never edited, the pre-commit hook still checks the task log's shape, and a deliberate edit by hand is the risk the project owner accepted rather than a thing this step can detect. say which ones you exempted and why.

  A review round on a unit answers only for the commit it read. When a fix commit rewrote that unit afterwards, the round is stale and the fix commit is unreviewed in its own right — the earlier round examined content the fix replaced.

  An unreviewed commit does not leave in a session-close push, and neither does a unit commit whose task still has an open blocking finding: either `code-review` runs on it now, or the push is held under step 5c, and `STATUS.md` says what is waiting. **A push carries the history in order and cannot skip a commit in the middle**, so one held commit holds every commit above it — including clean commits of another task — and `STATUS.md` names both: the commit that holds the push, and what it is waiting for. On top of that, no task may be left with open blocking findings and a status of `done` or `dropped`; if one is, fix the status before pushing. A dropped task is not an exception: its commits are already in the history this push carries.
- **Step 2** sets no status and lands no closing commit. The session's own files — the log, `STATUS.md`, the regenerated indexes — are the payload, and `commit` already landed them.
- **Step 1b** does not run: it reads one task, and a session close has none.
- **Step 2b** runs as `scripts/check-push-tasks.mjs --session-close`: no task ships, so any code of a task not closed holds the push (step 5c), and stays local until its own task ships (the owner, 2026-10-15). Record-only commits — a task log note, a new task file — still leave once nothing holds them back, since a push cannot skip a commit.
- **Step 5c** records a hold in `STATUS.md` under "Next session" instead of in a task file, because there is no task file to hold.

Everything else — running what the project gates on push, pushing, verifying the remote, writing the deploy ledger, the two terminal states — applies unchanged.

## Terminal condition — read this before starting

**This skill is not done when the closing commit lands.** It is done when its mode's terminal state is reached, and there is never a third state.

**Straight to the tracked branch:**

- **Pushed and verified** — the change is on the tracked branch and its remote checks came back green, or
- **Explicitly held** — the work is committed locally, not pushed, and the reason is written into the task file.

**From a worktree, through a pull request:**

- **Merged, and the tracked branch green** — the PR was merged and the merge result itself was verified on the tracked branch, or
- **Explicitly held** — the branch is pushed and the pull request is open and unmerged because something the project owner must authorize has not arrived, and the reason is written into the task file (step 6e).

"Committed and quiet" is the failure this skill exists to prevent, and a pull request left open with nothing written down is its other shape: unfinished work that looks finished because the work is done. A pull request held under 6h is not that one — its reason is on record, and the next session picks it up from the task file rather than from the branch list.

## Which mode

Read this project's isolation policy in `CLAUDE.md` → Git conventions, and read where you are: a session working in the tracked branch's own checkout ships straight to it; a session working in a git worktree on its own branch ships through a pull request. **Kit default: isolation follows concurrency, not tasks.** A branch or worktree exists because two writers are active at the same time — parallel sessions, or a dispatched background agent — not because a task exists.

**Do not assume the remote enforces any of this.** A private repository in a personal GitHub account gets no rulesets and no branch protection, so nothing on the remote refuses a direct push to the tracked branch. The barrier is this procedure and the local hooks, and saying otherwise would describe a guard that is not there.

## Procedure

1. **Confirm the review gate.** Every unit reviewed, zero open blocking findings in the task log. A unit's commit is the one whose `Unit: U<n>` line names it (its `- commit:` in `## Done when` once integrated or recorded), and it is reviewed when a `review-round` says `unit: U<n>`, `commit:` its sha and `blocking: 0` — read from those fields, never from the subject or the round's prose. A fix commit carrying the same `Unit:` line needs its own round citing its sha. If one is open, this skill does not start: it goes back to `code-review`'s fix loop.

1b. **Ask `status` what the task left alive, and clear only what it names as safe to clear.** Before the closing commit of step 2, so that whatever this step writes into the task file travels in it. **Straight-to-branch mode only:** `integrate-unit.mjs` reads the task file and the units from the main checkout, so in the pull-request mode, where the task lives in a worktree on `ai/<task>`, it would read another task file and write `commit:` lines into the main checkout. There, this step does not run, and the task log says so. At a session close (`session-log`, no task behind it) it does not run either.
   - **First, `scripts/integrate-unit.mjs status <task>`** on the task that ships, and only on it: another task's live work sits on its own branches and does not travel in this push. **Read its exit code from the command itself, never through a pipe** — `status … | tail` reports the exit code of `tail`, and a red check reads as green.
   - **`0`** — nothing out of place: go on to step 2.
   - **`1`** — act on each finding by its name, then run `status` again:
     - `integrated-branch-left`: the unit is in the tracked branch and its branch and worktree are leftovers — **unless `status` also reports `worktree-dirty` for the same worktree**: then there is work in it nobody committed, and the task is held (step 5c) before anything is discarded. Otherwise run `scripts/integrate-unit.mjs discard <task> <unit>`; nothing of it is lost. Copy into the task log the ignored files it lists (a `.env` written by hand, a `node_modules`): they go with the worktree.
     - `no-record`: run `scripts/integrate-unit.mjs record <task> <unit>`.
     - **Anything else** — `not-integrated`, `worktree-dirty`, `no-commit`, `bad-record`, `out-of-order`, `backup-integrated`, or a `discard` or `record` that does not exit `0` — is work or record that is not where it should be, and **this step does not clear it**: a commit ahead of the tracked branch is a fix nobody integrated, and discarding it would ship the task without it. The task is held (step 5c), naming each finding.
   - **`2`** — it could not read the task. Nothing is taken as good: fix what it names (most often a unit line in `## Done when` that is not in the format `scope` writes; `scripts/task-units.mjs <task>` shows how the units are read) and run `status` again. If it cannot be fixed here, hold (step 5c).
   - **Backup branches** (`ai/<task>-U<n>-backup-<k>`) are listed by `status` and are not findings. Each one holds a commit that is in no other branch, so deleting it loses that work: **list them in the task log and leave them**; one is deleted only on the project owner's word.
   - **What `status` does not see:** a unit not checked off with no `commit:` line raises no finding, so a forgotten `record` on an unchecked unit passes. Step 1's review gate is what reads the units one by one.

2. **Decide the task's status, and land the closing commit.** **This happens before the remote says anything**, because the closing commit has to travel in the same push as the units. The consequence, stated rather than discovered: if step 5b comes back red, the task already reads `done` in git and has already left the active index. What surfaces it is not the task index but `check-deploy-verified.mjs`, at the next session open. **The default is `done`.** Use `waiting on owner` only when you can write, in the task's `waiting_on:` field, the specific question the owner has to answer — not "please review", but the decision itself. If you cannot name the question, the work is `done` and the review happens by reading the task log.

   Set it in the task's own file — a one-line edit to its `status:` frontmatter — then regenerate the indexes with `scripts/generate-task-index.mjs`. **Nothing is moved, copied or appended between files**, and **`TASKS.md` and `TASKS_ARCHIVE.md` are never hand-edited**: they are generated artifacts, the pre-commit check rejects a version that drifted from `tasks/`, and a manual edit is lost on the next regeneration.

   Commit that as the **closing commit**, together with any task-log entries still uncommitted — the ones the session appended for agents that worked in parallel (`build` step 4). It carries no deliverable, it is not a unit, and it gets no review pass. It has to exist before the push, because a task's units and its closing commit reach the remote in one push — that is what `scope` promises, and it is what keeps the frontmatter edit and the regenerated indexes from sitting uncommitted, or riding a second push no step verifies, which is the state `R5` and `R6` describe and `check-deploy-verified.mjs` hands to the next session. Its message ends with the line `Task: <id>` of the task it closes; the push itself adds no line, because it only moves commits that already carry one.

   **The verified SHA is not written to the task log.** It is already in `logs/deploy-checks.md` and in git, and a note written after the push would sit uncommitted until some later commit carried it.

2b. **Check that the push would carry no other task's unfinished code — run `scripts/check-push-tasks.mjs --task <task>`**, right after the closing commit, reading its exit code from the command itself, never through a pipe. Units of every task are integrated into the same local branch, and a push carries everything between the remote and `HEAD`: the push of a finished task can take another task's integrated units with it, and where the tracked branch is production that is half a feature in front of users. The script reads the `Task:` line of every commit in the range and the state of each task at the tip. A commit passes when it is of the task that ships, of a task `done` or `dropped`, `Task: none`, or record-only (the paths in `RECORD_PATHS` of that script — the same list step 1's session-close exemption uses). It says what it does not see: a commit that names the right task while carrying another's code.
   - `0` — go on.
   - `1` — the push is held (step 5c), **naming every task the script lists** and its commits. **The task that ships keeps the `done` its closing commit gave it**: it is finished, only its push waits. That is what lets it leave later — when a task that held it ships, its own check reads this one as `done` and both go out in that push. Changing it back to `in progress` or `waiting on owner` would make each of two tasks hold the other forever.
   - `2` — it could not judge: no `commit-msg` hook running `check-commit-task.mjs` (the `Task:` line is required in every project: install it), no range, a fetch that failed, or a task file it cannot read. Never a pass: fix what it names, or hold.
   **It runs again right before every push**: in step 5a, and in the pull-request mode after the rebase of step 6a and before the push of 6c, with `--base <the tracked branch's upstream>` since `HEAD` is then the task's branch. Another session may have integrated in between, and a rebase can bring commits in.

3. **Run whatever this project gates on push, before pushing.** If the project has a `pre-push` hook (lint, tests, type check), it runs on its own — but if the push is going to be held, run those checks anyway so the held commit is known-good rather than unknown. A commit parked overnight without its checks run is a commit whose state nobody knows in the morning.

4. **Then follow the mode.** Straight to the tracked branch is step 5; through a pull request is step 6.

### 5. Straight to the tracked branch

5a. **Push — under this project's stated authorization policy.** Run `scripts/check-push-tasks.mjs` once more first, as in step 2b, and push only on `0`.
   - If the project's policy allows this agent to push, push now.
   - If the policy requires the project owner's explicit approval per push, **ask, and wait.** If approval isn't given, go to 5c.
   - If the project owner says they pushed it themselves, that is the trigger for 5b — don't wait to be asked.

5b. **Pushed → verify the remote, always.** Passing locally is not the same as passing on the tracked branch. Run `.claude/skills/ship/scripts/check-deploy-status.sh <sha>` (requires the `gh` CLI, authenticated; defaults to `HEAD`; polls every 10s up to 15 times — pass different `max_attempts`/`sleep_seconds` for a slower pipeline). Exit `0` = all green, `1` = something failed, `2` = **no verdict** (see below), `3` = passed except for checks listed as known-failing (does not block, but **do not report it as a clean run**).

   **A `2` has three causes and only one of them is fixed by waiting.** The script says which on its own output — read it rather than assuming:
   - *Still running within the poll budget* → re-run to keep waiting. This is the ordinary one.
   - *A partial response* — fewer checks arrived than GitHub says exist. Re-run once; if it persists, pagination is failing.
   - *One of the two APIs did not answer at all.* **Waiting will not fix this**, and the most likely cause is permanent: a fine-grained token holding `Checks: read` but not `Commit statuses: read`, or the reverse. Re-running forever while reporting "still pending" would misdescribe a broken configuration as a slow pipeline. Check the token's permissions.

   In all three the script deliberately writes **nothing** to the ledger: a commit whose state could not be established must never look accounted for.

   **The script writes one line per resolved SHA to `logs/deploy-checks.md`** — timestamp, SHA, exit code, summary. That ledger, not the terminal output, is this step's evidence: scrollback disappears, and a claim in chat that the check ran is exactly the self-report this kit stopped trusting. Never write a ledger line by hand.

   **If it exits `1`, treat it exactly like a failing local test: blocking.** Diagnose the real cause — verify fresh, don't assume it's the same issue as a previous failure — fix, recommit, push again, and re-run until it exits `0`. Never move on to another task while a known-red commit sits on the tracked branch: a broken build left unattended is one the next session inherits silently.

5c. **Held → record it in the task file**, with the reason and the commit hash — a hold is state, not history — so the next session inherits a fact instead of a surprise. A hold is a legitimate outcome; an unrecorded hold is not. **A hold from step 2b is recorded in `STATUS.md` under "Next session" and in the task log, not by changing the task's status**: the task stays `done`, the entry names each task holding it and says it leaves with that task's push. **The `ship` whose push carries it out removes that entry**, in the same push, and says so; a code commit made to it after its close is held by the check (`after-close`) until the task is reopened, reviewed and shipped again — its own `ship`, where its commits pass as the task that ships. The check sees that only while the close has not reached the remote: a fix to a task already pushed as `done` is reopening it, and nothing here detects that it was not.

Report the resolved state in chat either way.

### 6. From a worktree, through a pull request

6a. **Rebase the branch onto the tracked branch**, so the pull request carries the task's units and nothing else. This local rebase is also where task logs that both sides appended to get merged: git applies the `merge=union` rule of `.gitattributes` here, on this machine. Do not count on the hosting service's merge button to apply it. If the tracked branch moves again before 6f, rebase again.

6b. **If the rebase hit a conflict, the units whose commits changed content go back to `code-review` before anything is pushed.** Resolving a conflict is writing new content, and nobody has reviewed it. A clean rebase keeps its review: the commits move, their content does not. Name in the task log which units were re-reviewed and why, so the log says the rebase happened rather than leaving a second review round unexplained.

6c. **Push the branch and open the pull request.** Its description names the task and its units — the same sentence per unit as the task's `## Done when`, so a reader sees what the branch claims to deliver without opening a diff.

6d. **Wait for CI to come back green on the pull request.** `check-deploy-status.sh` resolves any reference to a SHA, so it works on the branch head exactly as it does on the tracked branch: run it against the branch's head commit and read its exit code as in 5b.

   **Whether a pull request verifies without publishing is a property of this project's workflows, not of pull requests.** It holds when the CI workflow triggers on `pull_request` against the tracked branch and the publish or deploy workflow triggers only on push to it. Read the two workflow files once and record the answer in `CLAUDE.md` → Git conventions; do not re-derive it per task, and do not assume it.

6e. **Before merging, check that nothing is still waiting on the project owner.** In this kit that is a change to `kit/VERSION`, which publishes. If that authorization has not arrived, **stop here and hold**: the pull request stays open, and the reason goes in the task file exactly as step 5c records one, naming what is being waited on. An open pull request nobody is waiting on is the failure this skill prevents; one with its reason written down is a hold, and the next session picks it up. Do not continue to 6f, 6g or 6h — the branch is not merged and deleting it would take the work with it.

6f. **Merge once every check is green, and nothing is held.** The agent merges on its own — this is not a question for the project owner, and asking turns a green result into a wait. What does need the owner's approval is whatever this project's Git conventions say reaches the delivery channel; that is a separate decision and it is taken before the merge, not instead of it.

6g. **Bring the tracked branch to local, and verify the remote over it.** What CI approved was the pull request, not the result of the merge — a merge commit is content no check has seen. Run `.claude/skills/ship/scripts/check-deploy-status.sh <sha>` against the tracked branch's new head and resolve it exactly as in 5b, ledger line included. Until that line exists, the task is not shipped.

6h. **Delete the branch, locally and remotely, and remove the worktree.** A merged branch left behind is the next session reading a stale copy of work that already landed.

Report the resolved state in chat.

> **Every document this skill writes follows `ae-kit-templates/style-rules.md`.** Nine rules, three
> levels by how often a file gets read. Read it before writing, not after. Nothing verifies
> compliance — `R31` declares that honestly with an `owner:` trigger rather than faking a checker.
> The reasoning behind each rule is in `ae-kit-templates/style-rules-appendix.md`.

## Output

**One recorded terminal state for the mode that ran, never silence:**

- **Verified**: the pushed SHA on the tracked branch, its remote checks resolved green (or `3` with the known-failing checks named), reported in chat;
- **Held**: the reason written into the task file and reported in chat — on the tracked-branch path the commit hash, local and unpushed; on the pull-request path the branch pushed and the pull request open and unmerged, named by its number; or
- **Merged**: the pull request merged, and the tracked branch's resulting head verified green in its own right.

```yaml
output:
  - kind: file
    path: logs/deploy-checks.md
    must_contain: the resolved SHA with its exit code — and on the pull-request path, the tracked branch's post-merge head as well
    when: the terminal state was Verified or Merged
    written_by: check-deploy-status.sh   # never by the agent
  - kind: task-entry
    must_contain: the task's status, and for a Held state the reason, plus the commit hash on the tracked-branch path or the open pull request on the pull-request path
```

`check-deploy-verified.mjs` checks that ledger independently of whether this skill was ever invoked, and `open-session` runs it at the start of the next session.

Plus: an updated task file, with its `status:` set at the moment the task reached `done` and the indexes regenerated rather than hand-edited.
