---
name: session-log
description: Use at the end of a working session (the project owner says something like "let's end here" or "log progress for today"). Sweeps the full task tracker, writes a session log entry, and updates STATUS.md. For the start of a session, or any doubt about current state, use `open-session` instead.
---

# Session log

## When this fires
End of a work session, on explicit signal from the project owner. This is the closing half of a pair — see `open-session` for the opening half (reading `STATUS.md`/`/logs/` at the *start* of a session and recommending what to do next).

## Procedure

1. **Sweep the entire task tracker, not just what was touched today.** Check every task whose file carries `status: in progress` or `waiting on owner` — confirm each one is still accurate. Nothing should be left silently stale. For anything in `waiting on owner`, confirm its `waiting_on:` question is still the real one: a stale question is worse than none, because it looks answered.
1b. **Process the control center's pending decisions, before anything below writes.** This runs before the session log and before the close commit so that the task-log entries it writes travel in that commit. A decision taken on the page after this step is processed by the next `open-session`. Its outcome is one line of the session log (step 3).

   Read `.ae-control-center` at the repo root (its shape is in `open-session` step 5b).
   - **No file, a file with `declined` and no `url`, or a file that does not parse or has no `url`:** no call is made. The line says so in a few words: `control center: none registered`, `control center: declined`, `control center: not done — .ae-control-center does not parse`.
   - **`ArtifactData` is not available in this session** (a subagent or a print session has none): no call is made, and the line says `control center: not done — no ArtifactData in this session`. The next open or close processes what is pending.
   - **Otherwise, process them:** follow section 2 of `ae-kit-templates/control-center.md`, "Processing what was decided", whole. It is one `ArtifactData` `query` for `status == decided`. A card with a non-empty `logEntry` is skipped, and a decision already recorded this session when it arrived is found by section 2's anchored search and not recorded twice. Step 6 of that section ("act on it") does not start work here: the session log names what each decision unblocks.
   - **Then finish the migration, if it is pending.** If that query returned `decided` cards with a non-empty `logEntry`, run "The one-time migration to `recorded`" of the same guide from its step 1. Its gate reads the page's marker. With the marker in place, it continues where an earlier run stopped, and the line says how many cards it moved and how many are left. Without it, nothing is migrated: those cards are safe, since section 2 skips them. The line then says the page is not republished with the current template, which is how a republish that failed or never ran shows up. If this session tried to republish the page and the publish failed, the line says that too.
   - **A call that fails, or a page that says it is read-only:** the part that depends on it is skipped, and the line says which part was not done and why. A decision that `task-log-append.mjs` refused stays unrecorded on the page and is named in the line.

   This step runs before step 2c on purpose: the views it regenerates then include the decisions written here.
2. **Regenerate the indexes** with `scripts/generate-task-index.mjs`, and confirm it exits clean. A task whose status was hand-edited, or one marked done outside the `ship` flow, shows up here as a difference — there is no separate "move it to the archive" step any more, because nothing moves.
2a. **Prune to what is current the task files and scope docs this session changed.** "This session" means the commits since the one that wrote the previous session log — `git log -1 --format=%H -- logs/sessions/` — plus anything still uncommitted; take the files under `tasks/` and `docs/` among them. Documents the session did not touch are left alone: pruning the whole tree would turn one close into a rewrite of the project.

   - **A task file that has a task log**: a section written *after* its first task-log entry that a later decision superseded is rewritten in place to say what holds now. What happened since then is in the task log.
   - **Anything written before the task had a task log is left as is**, whatever its heading — `## Notes`, `## Notas`, an approved list of adversarial cases, a review round, a verification record. It is the only readable record of that part of the work; the task log does not hold it. `git log` on the task log's first commit tells where that line falls.
   - **A scope doc**: the design is rewritten to what holds now, but a dated decision is never deleted; it is marked superseded, with the date and what replaced it.
2b. **Update `PENDINGS.md`.** For every pending still unresolved, **increment its mention count by one** — this session is one more session it survived. Add anything new the session raised, with who can close it (`system`, `project-owner`, `third-party`) and today's date. Then run `scripts/check-pendings.mjs`: anything at three or more mentions and still `open` gets surfaced to the project owner **now**, while there's still a conversation to have, rather than being inherited by the next session as a line nobody reads.

   > This counter is the only reason the pattern is visible at all. Measured before it existed: a mobile-verification pending was carried four sessions before anyone spent the half hour it needed, and a trio of deferred items was copied verbatim across five files and then vanished with no record of anyone deciding against them.
2c. **Regenerate the task logs' views — run `scripts/generate-task-log-view.mjs`.** This is the one moment they are generated on purpose: at the close, every task's view matches its task log, including the tasks that were finished today. Nothing generates them per commit any more, and the pre-commit hook no longer rejects a stale one — it only rejects a view nobody generated. The cost of that is a window between this close and the next open where a view on disk can lag its task log, and nobody reads one in that window: `open-session` regenerates before reading. **The close commit in step 8 is the one that carries them:** a unit's commit leaves `logs/tasks/current/` out on purpose (`commit` step 2), so if this close did not stage that folder whole, the views would sit uncommitted until the next one.

   The script also retires the views of the pre-0.36.0 layout (`logs/tasks/<id>.current.md`) the first time it runs after a kit update, and says which ones. A file with a view’s name that it did not generate, it never touches: it reports it and exits non-zero, and that one has to be moved out of `logs/tasks/` by hand.

3. Write a new file at `/logs/sessions/<YYYY-MM>/session-YYYY-MM-DD.md` — the month folder for the session's own date — summarizing, in plain English: what was worked on, what shipped, what's still open, and any decisions made or deferred during the session. **Create the month folder if it isn't there yet**; the first session of a month is the one that makes it. A second session on the same day keeps the existing suffix convention (`session-YYYY-MM-DDb.md`) inside that same folder.

   **The log carries the control-center line from step 1b**, on a line of its own that starts with `control center:` (no bullet or markup before it), because the next `open-session` searches for it. It says what was done and, for anything not done, the words `not done` and why. The prefix and the words `not done` are written exactly so, in English, whatever language the log is written in; the rest may follow the log's language. For example:

   ```
   control center: 2 decisions recorded, nothing pending
   control center: nothing pending; migration moved 12 cards to recorded, none left
   control center: 1 decision recorded; migration not done — a batch was refused, 30 cards left
   control center: not done — page not republished with the current template (no marker); 80 cards wait on the migration
   control center: not done — no ArtifactData in this session
   control center: none registered
   ```
4. **Nothing is capped, and nothing is moved.** There is no maximum number of sessions and no `archive/` folder: the month folders keep `/logs/` readable on their own, and a session stays at the path it was written to, forever. Leave file names untouched — the date in the name plus the folder it sits in are already the index, so logs need no generated index the way `tasks/` does (a log file is always exactly one session, so its own name tells you what it covers).

   > `/logs/` itself holds only `deploy-checks.md` and the `sessions/` and `tasks/` folders. A document that is neither a session log nor the deploy ledger — a findings write-up, a comparison, a scan — belongs in `/docs/`, not here.

5. **Rewrite `STATUS.md` in its three sections** — `Next session`, `Last session (YYYY-MM-DD)` and `Decisions`, the shape in `ae-kit-templates/STATUS.md.template`. It is read whole at the start of every session, so every line costs context.

   - **Replace** `Last session` with a short paragraph about this session and the path to its log. **Replace** `Next session` with what comes next, in priority order. Replace means the previous text is gone: the previous session lives only in its log. A second `Last session` section is the failure this step exists to prevent.
   - **Authorized to start without asking** is a `###` subsection of `Next session`. A task goes there only in the owner's own words, with its list of steps, and only when every decision it needs is approved. Remove an entry whose task is done, or that gained a pending decision.
   - Nothing else gets a section. A blocker that affects what comes next goes in `Next session`; anything else goes to a task or to `PENDINGS.md`.

5a. **Regenerate the roadmap — run `node scripts/roadmap.mjs`, with no arguments.** It writes `roadmap.html` at the project root: the queue is the `Next session` step 5 just wrote, in its order, and the lanes come from `tasks/` and `PRODUCT.md`. It reads the repo and writes only that page, so it runs at every close, a second one on the same day included, and the page always shows the last close. Steps 6 to 7b do not change what it reads.

   - **Exit `0`:** say in the chat where the page is (the root's real path plus `roadmap.html`) and that `node scripts/roadmap.mjs --open` opens it.
   - **Any other exit, or a script missing from disk that `.ae-kit-excluded` does not declare (an incomplete install, said as one):** the close goes on; a broken view never holds it. Say it in the chat and in one sentence of prose in today's session log, with the exit code and the line the script printed. Exit `4` means the page was not written — the file there was not generated by the script, git tracks it, or the write failed — so the page on disk, if any, is from an earlier close. This sentence never starts with `control center:`: that line is step 1b's, and the next `open-session` reads the first one it finds.
   - **`scripts/roadmap.mjs` declared in `.ae-kit-excluded`:** do not run it. Say once in the chat that the step is skipped, with the reason the file gives. Neither a failure nor a page.

   The page is ignored by git, never committed: the project's `.gitignore` carries `/roadmap.html*`, which also covers the `roadmap.html.tmp-<pid>` an interrupted run leaves. If `git status` lists either one, the line is missing: say so, and add it only with the owner's approval. Never stage the page.


6. **Keep `Decisions` to the decisions still in force, one row each, at most 15.** Each row has four cells: the decision in one sentence, its date, what enforces it (a mechanism, a kit file, or "nothing yet"), and a link to where the reason lives. The reason never goes in the row. Before adding a row, sweep the table into three buckets:

   - **Retire** — a mechanism now enforces it (code, configuration, a check), the kit adopted it, or an open task carries it: the decision is written in that task's file, so it sits in the queue of work. **The mechanism, or the task, is the memory.** Move the row to `docs/decisions-archive.md` (create it with the same table if it does not exist), naming the mechanism, the kit file or the task in `Enforced by`. A task named there that gets dropped brings the decision back to this table. A retired decision that is not a lesson goes only there; it does not travel to the kit.
   - **Keep** — still live judgement that nothing enforces. It stays. **A row kept for months is a candidate to become a mechanism.**
   - **Drop** — the facts overtook it and it no longer describes a choice anyone can make. Remove it.

   If the table would pass 15 rows with every row still in force, that is a class A question: ask the owner which to retire.

6b. **Run `scripts/check-status-shape.mjs`.** Exit `0` is the only acceptable result; a warning about the cap means step 6 is not finished. Exit `3` means this project's `STATUS.md` still has the old layout. Say so, and migrate it to `ae-kit-templates/STATUS.md.template` only with the owner's approval: moving decisions out of the file is a class A decision.

7. **Never touch the `maturity:` field** — that's set only by the project owner, and only when the project's real-world status actually changes.

7b. **Emit the session's lessons to the kit — run `scripts/emit-lessons.mjs`.** This is the push half of the return channel, and it runs **every session**, not "when something important happened." That judgment is exactly the one that fails: the session that took the shortcut would be the one deciding whether the shortcut was worth reporting. A session with nothing to report emits an empty payload rather than emitting nothing, so silence stays readable.

   **Where the two files go — name them, don't invent them.** Write the payload to `logs/lessons/lesson-payload-AAAA-MM-DD.json`, dated like today's session log; if this is the second close of the same day, carry the same letter the log carries (`session-2026-09-19b.md` → `lesson-payload-2026-09-19b.json`), so the second close does not overwrite the first. The script writes its validated report next to it, at `logs/lessons/lesson-payload.md`, and that one is overwritten every close on purpose. `logs/lessons/` holds those two shapes and nothing else — `check-log-layout.mjs` blocks anything else in there, and warns (without blocking) about lesson files still loose in `logs/` from before 0.36.0.

   **Consent gates it, with no default.** The script reads `.ae-kit-contrib`; `no` means it emits nothing and says so, and *missing or unreadable* also means it emits nothing — absence is not consent. If it reports that, ask the owner and record their answer rather than picking one.

   ⚠️ **The owner approves what leaves. Exit 7 means "validated, waiting for a person."** The script prints the exact body it would publish and the repo it would publish to, then stops. **Relay that block verbatim** — not your summary of it — and only rerun with the `--approved=<digest>` line it printed, once they've said yes.

   The digest binds the approval to *that* content and *that* destination: if the payload changes, it stops instead of publishing (exit 9). Don't work around that, and never approve on the owner's behalf. The automated checks are only a first filter — the list of forbidden patterns is not complete — and an issue cannot be unsent.

   ⚠️ **Build the payload from evidence, not from your own account of the session.** You are the same session that made the mistakes, so your summary is the least trustworthy input available — there is a recorded case of a fix being reported as working when it was not. Evidence means what the work left behind and exists whether or not you recognize it: the diff, the tests added, files touched after the work was called done, task state reversals, and the fact that **the owner reported a bug** (the strongest available signal that verification failed). Fill `owner_reported` and the `evidence` counters from those; if a field can't be supported that way, leave it out. The schema has no free-text field large enough to hold a quote, a path, or a name, and the script rejects the payload rather than cleaning it — a rejection means rewrite the lesson in general terms, and a lesson that can't be stated without naming something from this project probably isn't a lesson for the kit.

8. **Close the session by invoking `commit` and then `ship`, and let `ship` reach its terminal state.** Everything above writes files; a session that ends with those files uncommitted has not been closed, it has been abandoned mid-write. `commit` lands them locally; `ship` takes them out and ends either **pushed and verified** or **explicitly held with a reason recorded** — either is a valid close; stopping before one of them is not. The session's closing commit ends its message with `Task: none`: it belongs to no task.

   Take the extra minutes this costs. The alternative is discovering in the morning that something never got verified, which is more expensive than waiting now.

## When the session keeps going after it closed

**A close is not final while the conversation is still alive.** The session keeps running after the log is written, and decisions taken in that tail have nowhere to land unless this check catches them.

**So the close has a second door.** Before the conversation actually ends — the window closing, the context being cleared, the owner saying they're done for real — ask one question: **has anything been decided since the log was written?**

- **Nothing decided** → say so in a sentence and stop. This check must not become ceremony that fires every time; if it costs a paragraph each session, it will be skipped, and then it protects nothing.
- **Something was decided** → append a dated `## Adenda (posterior al cierre)` section to today's log file, put anything durable into `STATUS.md`'s decisions table, **re-run step 7b so the addendum reaches the payload** (a decision that arrives late would otherwise be the one thing the channel never sees), re-run step 5a if `Next session` changed, and re-run `commit` and `ship`.

> **Every document this skill writes follows `ae-kit-templates/style-rules.md`.** Nine rules, three
> levels by how often a file gets read. Read it before writing, not after. Nothing verifies
> compliance — `R31` declares that honestly with an `owner:` trigger rather than faking a checker.
> The reasoning behind each rule is in `ae-kit-templates/style-rules-appendix.md`.

## Output
An accurate task tracker (active file, archive, and any generated index regenerated rather than hand-edited), the control center's pending decisions processed into their task logs, a new session log file (in its month folder) with its `control center:` line, an up-to-date `STATUS.md` in its three sections, with its decisions table pruned to what is still in force, and **a completed `commit` followed by a completed `ship` in one of its terminal states** — reported in chat, not assumed. Combined with `open-session` at the start of the next one, this closes the loop: nothing about project state has to live in anyone's head.

```yaml
output:
  - kind: file
    path: logs/sessions/<YYYY-MM>/session-YYYY-MM-DD.md
    must_contain: where (real paths), what happened, decisions, follow-ups, and a line starting with "control center:" that says what step 1b did, or what it did not do and why; when step 5a failed, a sentence that says so, with the exit code
  - kind: file
    path: logs/tasks/current/<id>.md
    must_contain: a regenerated summary for every task log, with the old-layout views retired
  - kind: file
    path: STATUS.md
    must_contain: exactly three sections, last session replaced rather than appended, next priority, at most 15 decisions in force; check-status-shape.mjs exits 0
  - kind: chat
    must_contain: where roadmap.html is and that `node scripts/roadmap.mjs --open` opens it, or why step 5a did not write it, or that it was skipped because the project excluded the script
  - kind: chat
    must_contain: a completed commit, and a completed ship in one of its terminal states
  - kind: chat
    must_contain: the return channel's outcome — emitted, declined by consent, or blocked with the reason
```
