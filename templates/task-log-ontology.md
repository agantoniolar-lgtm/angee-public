# The task log — ontology

What a task's working journal records, in what shape, and what changing that shape costs.

**This is not a template.** It lives in `ae-kit-templates/` because that is what the installer copies, but nothing here is filled in per project. It is kit content: the same ontology everywhere.

**This file and its four scripts cannot be declared out** — `scripts/task-log.mjs`, `scripts/task-log-append.mjs`, `scripts/check-task-log.mjs` and `scripts/generate-task-log-view.mjs`. The skills record every step of the work through them, and they only add files. `install.sh` installs them even when `.ae-kit-excluded` names them, and says so; `check-installed-copy.mjs` ignores such a declaration the same way. The two verifiers still survive a project that lost them some other way: they say in prose that the half which reads the format is not installed, exit 3, and block nothing.

**Nothing here changes without a decision by the project owner.** The seven event types are a closed list, the fields of each type are a closed list, and the size cap is a number that was measured before it was chosen. An agent that finds the ontology too tight writes a pending, not a new type.

## Where it lives

One file per task: `logs/tasks/<task-id>.md`. Not in `tasks/`, because the task file is what the owner reads to decide, and the task log is what the work leaves behind — mixing them is what made a task file grow to 350 lines of narration.

Its view lives one folder down, at `logs/tasks/current/<task-id>.md` — same name, no suffix. Two folders and not one because a hundred tasks in a flat layout are two hundred files, and neither half can be listed on its own. That file is **generated**: `scripts/generate-task-log-view.mjs` writes it, and hand-editing it is reported the same way hand-editing `TASKS.md` is. The generator retires a view of the old `<task-id>.current.md` layout the first time it runs, as long as that file carries its marker; one written by hand it never touches.

**The task log replaces the task file's audit log.** The task file says where the work is going and is corrected in place; the task log says what happened and only grows. A task started before its project had task logs keeps its `## Notes`, and nothing migrates it.

**The approved adversarial cases live here too**, one `adversarial-cases` entry per group, so the list can grow without anything being rewritten.

## How the skills write

Every skill that records work appends here with `scripts/task-log-append.mjs <task-id> <type> --body-file <file> [--<field> <value> ...]`, and declares the type in its `output:` block as `kind: task-log` with `event: <type>` — `check-skill-outputs.mjs` rejects a type that is not one of the seven.

**One writer per task log.** It covers any agent dispatched to work on a unit while anyone else works on the same task — the dispatching session, or another agent — whether it is building, verifying or reviewing: that agent writes nothing here, whatever the table below says its skill writes. It returns what it would have written, in its reply, and the session that dispatched it appends every entry once they have all finished, in sequence. Git can merge two branches that both appended to a task log (`logs/tasks/*.md merge=union` in `.gitattributes`), but that merge is a net, not a guarantee: when two appended entries end in the same lines, it writes those lines once and one of the entries loses them, with nothing to report it.

| Skill | Writes |
|---|---|
| `adversarial` | one `adversarial-cases` per group of cases, a `review-round` for the independent gap search (a `note` instead, when that search did not run), and a `note` with the techniques and the surfaces found |
| `design` | one `decision` per design decision |
| `build`, `verify-tests`, `verify-ui`, `verify-rls` | a `note` with what was built or verified (`measurement` where the result is a number) |
| `verify-evals` | a `measurement` with the scorecard |
| `code-review` | a `review-round` with `ref:` to the saved report, a `finding` per finding, a `fix` per fix |

A `measurement` needs `--metric` and `--value`; a `finding`, `--severity` (`blocking` or `flag`, and optionally the fields of the rubric: see below); a `fix`, `--resolves` (and `--commit`, required for the fix of a flag that has a unit: see below); a `review-round`, `--by` and `--result`; an `adversarial-cases`, `--count`. The appender rejects an entry missing one and names it. A `review-round` of a unit also carries `--unit`, `--commit` and `--blocking` (see below): `code-review` writes them on every unit's round, because `integrate-unit.mjs` reads nothing else.

**A task log's view, `current/<id>.md`, is generated, not written.** `session-log` regenerates every view when it closes a session, and `open-session` regenerates before reading one. `commit` does not generate it — it stages `logs/tasks/` whole, additions and deletions — and writes nothing here; nor does `ship`: the verified SHA is in `logs/deploy-checks.md`. The pre-commit hook does not reject a stale view either; nobody reads one without regenerating it first. What it does reject is a view nobody generated.

## What the view summarizes

The view is a report, not a filter. It holds **one section per event type**, in this fixed order, and a section only appears when it has something in it. Every quoted sentence is the first sentence of a body, capped at 100 characters, so the view grows with the NUMBER of entries and never with their length.

| Type | What the view shows |
|---|---|
| `decision` | one line per decision still standing: who, and its first sentence |
| `review-round` | one line with rounds, blocking findings and flags; then one line per blocking finding with its status, and one per flag that was not fixed |
| `finding`, `fix` | one table per round: severity, the finding's first sentence, its status, and a detail only when it was dropped |
| `adversarial-cases` | one line with groups and cases, one line per group — never per case — and one line per case that asked for the owner's call |
| `measurement` | one line per measurement still standing: metric and value |
| `note` | nothing. A last line says how many there are and points at the task log |

**Three things the view derives, because the ontology does not store them.** A finding's status comes from who closed it: a `fix` leaves it fixed, any other type leaves it dropped, nothing leaves it open — and when the closer was itself replaced, the last entry of that chain decides. A finding's round is the last `review-round` written before it; the ones written before any round go in a table of their own. And a case that asked for the owner's call is marked by `adversarial` with `[owner]` at the start of its line; it counts as decided once a later decision that still stands cites its number.

**Two things stay in the task file, because they are state and not history:** the status, and the `BLOCKING` findings still open — one line each, with the id of its entry, removed when it is resolved. That line is a pointer: whether a finding is open is decided by the task log, and a task file that disagrees is corrected to match.

**Longer than the cap, it is summarized** — not split to fit, and not saved to a new file only to hold the full text. The one exception is a group of adversarial cases, where every case counts: it is split into `(1/2)`, `(2/2)`. References to documents and links that already exist are kept, with `ref:`.

## Append-only

Every entry is immutable. An entry that turned out wrong is not edited and not deleted: a new entry is added that says so and links back. This is the model `logs/deploy-checks.md` already runs — its one out-of-order line was corrected by appending a line that explains it, not by rewriting history.

**What enforces this, honestly:** nothing mechanical. No hook detects that a line of an old entry was rewritten, or that ten old entries were deleted to shorten the file. The only thing between the promise and the practice is the diff, which the owner reviews or does not. This is written down rather than glossed because a rule the kit does not check is a rule the kit should not claim to enforce — see the pending opened alongside this document.

## The identifier

`YYYY-MM-DD-hhmmss-xxxx` — the moment the entry was written, then four random lowercase characters.

Two properties earn the shape. It **sorts as text** into the order things happened, across midnight, month and year, so nothing else has to carry an order. And it is assigned **without reading the file**: no counter, no scan, so two entries written in the same second get different ids and appending costs the same with five hundred entries as with none.

The id never changes. It does not encode the task, the path or the position, so renaming a task or moving the file leaves every link pointing where it pointed.

## The seven event types

A closed list. Anything else is rejected by name, with the seven printed.

| Type | What it records | Required fields |
|---|---|---|
| `review-round` | An independent review ran, and what it concluded | `by`, `result` |
| `finding` | Something is wrong — its trigger and its consequence | `severity` |
| `fix` | Something found was fixed | `resolves` |
| `measurement` | A number that was measured, not estimated | `metric`, `value` |
| `decision` | A decision was taken, and by whom | `by` (and `unit`, optional: see below) |
| `adversarial-cases` | The approved Given-When-Then list for this task | `count` |
| `note` | Anything else worth leaving behind | — |

**Two types are deliberately absent.** A **lesson** goes to `lessons/ledger.json` through `scripts/ingest-lesson.mjs`, and a **question for the owner** goes to `PENDINGS.md`. Both already have a channel with its own verifier and its own reader. Adding them here would give each two homes, and two homes is how a record ends up in neither — which is the accumulation of registers this whole design exists to stop.

### The fields

Four fields are available to every type:

| Field | Meaning |
|---|---|
| `ref` | A path to the long version — a report, a diff, a transcript |
| `resolves` | The entry this one closes |
| `replaces` | The entry this one supersedes |
| `by` | Who did it (required on two types, optional on the rest) |

**A unit's review round carries three more fields, as data** (T123): `unit` (the unit reviewed, as in `## Done when`: `U2`), `commit` (the sha of the commit it read: 7 to 64 lowercase hex characters) and `blocking` (how many blocking findings it left: `0`, `1`, `2`…). They exist only on `review-round`, are optional for the type — an adversarial gap search reviews no unit — and go together or not at all. The appender refuses, and the verifier reports, a value out of shape, one or two of them without the rest, and a `unit` the task's `## Done when` does not have. `integrate-unit.mjs` counts a round only with the three, and reads neither its body nor its `result:`: a round written in prose before these fields existed counts for nothing there, while the view keeps showing it.

**A decision may name a unit** (T147): an optional `unit`, in the same shape, on a `decision`. It is how the project owner opens one more review round of a unit that reached the cap below; nearly every other decision leaves it out. The appender refuses a malformed one and one the task's `## Done when` does not have, as for a round.

**At most two review rounds per unit, then the owner decides** (T147; three until T026 lowered it to two). Before writing a `review-round` with `unit`, `task-log-append.mjs` reads this task log and refuses the round when the unit already has two or more and the last one left blocking findings, unless a standing `decision` with that `unit`, written after that last round, opens it. That decision must come after the round both in time and further down the file, and it opens exactly one round. A round that replaces another of the same unit and the same commit is a correction: a round and every correction linked to it by `replaces:`, a correction of a correction included, count once, in the original's place and with the `blocking` of the most recent correction. Two shas are the same commit when one is a prefix of the other. A round replaced by a round of another unit stops counting for its own unit and counts only for the other (D043); a round of the same unit on another commit is a new round, and a round replaced by something that is not a round still counts (D039). A clean round closes the cycle: a later review, after a rebase say, needs no decision. A round whose `blocking` is missing counts as having left blocking findings. Only the appender enforces this, and only when it writes a round: one written by hand with `unit` is read and counted by the next append, one without `unit` is never counted, and nothing stops a round the appender would have refused from being written by hand — an accepted risk (D042) until the check before push of T187 exists.

**A finding's `severity` is `blocking` or `flag`** (T026). `blocking` is fixed before the push; `flag` is not. Case and surrounding spaces do not matter, and the value is stored as it came. The appender refuses any other word and writes nothing, a finding that `replaces:` an older one included. The verifier does not: findings written before this rule with other words (`minor`, `non-blocking`, `nit`…) stay valid and read as not blocking, since only `blocking` blocks. The accepted limit is that a finding typed by hand today with another word passes the verifier too, as long as it carries none of the fields below. The same holds for a flag with `destination: fix` (see "A flag is fixed in a new unit"): only the appender judges it, so one typed by hand under a clean round passes the verifier.

**A finding may carry seven more fields** (T026): `level`, `evidence`, `defect-type` and `destination`, each from a closed list; `induced-by`, the id of the finding whose fix produced this one; and `reopens-if` and `due`, a date `YYYY-MM-DD` or a task id. The lists, what each value means and which pairs cannot happen are in `ae-kit-templates/severity-rubric.md`. All seven are optional, and a finding with only `severity` stays valid. Where they come, the appender refuses and the verifier reports, with the same rule: a value off its list or empty; `blocking` with a level other than `critical` or `major`, and `flag` with one of those two; `hypothetical` with `critical` or `major`, or with `blocking` and no level; a destination the gate does not admit (`fix`, `dissolve`, `accept` or `owner` for `blocking`; `new-unit`, `debt`, `drop`, `dissolve` or `owner` for `flag`, and `fix` on a flag only as below, judged by the appender alone); `debt` without `reopens-if` and `due`, or either of them with another destination or none; a `due` that is not a real date or a task id; an `induced-by` out of shape or pointing at its own finding; and a severity other than `blocking` or `flag` on a finding that carries any of them. Only the verifier checks that `induced-by` names an entry that exists, as it does for `resolves:`. `induced-by` is a reference, not a link: it closes and hides nothing. Nor does `destination`: a blocking finding with `accept`, `dissolve` or `owner` stays open until a `decision` names it in `resolves:`.

**A flag is fixed in a new unit** (T026). A round with no blocking finding closes its unit, so a flag it left is fixed in a new unit, with its own commit and its own review round, not by reopening the unit it came from. A `fix` may carry `commit`, the sha of the commit it landed in, in the same shape as a round's; the appender refuses, and the verifier reports, one out of shape. Before writing a `fix` whose `resolves` names a finding of this log that does not block — `flag`, and the old words (`minor`, `nit`…) too — `task-log-append.mjs` reads this task log and finds the flag's unit: the `unit` of the review round written above it, taking the first finding of its `replaces:` chain, and the unit of the round that replaced that round when a round of another unit did (D043). When that unit exists, the fix must carry `commit`, and that commit, compared by prefix, must have been reviewed by a round of another unit written after the flag — after it in time and further down the file — and by no round of the flag's own unit; otherwise the fix is refused and nothing is written. **One exception** (y1eo): when the flag's round left blocking findings (`blocking` above 0, read from its most recent correction), the unit is amended anyway, so the commit that the next round of that same unit reviewed, written after the flag, holds too, as long as no round of that unit reviewed it before the flag. In that same case, and only then, the flag may carry `destination: fix`: the appender, when it writes the finding, refuses `fix` on a flag whose round left none or that came out of no unit's round. The verifier does not judge it, as with the severity's closed list: a round corrected later from `blocking: 1` to `0` would otherwise turn its flags red, and every commit after them, with no clean way out. Whether the flag deserved fixing — the questions in `ae-kit-templates/severity-rubric.md` — and the cap of two flag fixes per task are the session's judgement; nothing here counts them (T184). The rule does not apply to the fix of a blocking finding, where `commit` is optional; to a flag of a round without `unit` or written before any round; nor to a `resolves` into another task's log, which closes nothing here. A task log that cannot be read lets the fix through with a warning: the rule must never cost a record. What it does not stop, accepted by the owner: a flag closed by a `note` or a `decision`, a new round of a unit whose last round was clean, and a fix written by hand — detecting those is T187.

**A field a type does not define is rejected.** Not tolerated, not ignored. Types erode by accumulating fields nobody decided on, and without this cut the ontology expires by itself within a month.

## Links between entries

`resolves:` and `replaces:` carry an entry id. Two forms, and only two:

- `2026-09-17-143022-a7f3` — an entry in this same task log.
- `T066-logs-por-mes#2026-09-16-101500-b2c1` — an entry in the task log of another task. The task id is not optional here: without it, an id from elsewhere is indistinguishable from an id that does not exist, and the verifier cannot tell a cross-task link from a typo.

`scripts/check-task-log.mjs` reports a link to an id that does not exist, an entry that links to itself, two entries that resolve the same entry, an entry that resolves something already resolved, and a cycle. None of those stop an append — writing and verifying are separate moments on purpose, so that a defect introduced yesterday cannot swallow the record of what is happening today.

## The size cap

**1500 characters of body text.** Fields and the header do not count.

The number was measured, not guessed. The 25 substantive entries in `tasks/T066-logs-por-mes.md` — the last task written entirely as task-file narration — run from 400 to 1404 characters; the largest is a full finding with its trigger, its consequence and its fix. 1500 accepts every one of them with a little room, and rejects a review report of hundreds of lines, which is the case that motivated the task.

**Over the cap, the entry is rejected.** Never truncated: a silently shortened entry reads as complete six weeks later. The message says where the long text goes — a file of its own, linked from the entry with `ref:`. A review that produced eight findings is eight entries plus one `review-round` that points at the report, not one entry holding the report.

An empty body, or a body of only whitespace, is rejected too: an id that occupies a line in the view and says nothing is worse than no entry.

## The file format

```
<!-- GENERATED HEADER — see ae-kit-templates/task-log-ontology.md -->

# Task log — T067-ontologia-de-la-bitacora

### 2026-09-17-143022-a7f3 · finding
- **severity:** blocking
- **ref:** docs/review-t067.md

The verifier only looked at the new path, so a link to the old path —the only one
that can be broken after a migration— was seen by nobody.
```

An entry starts at a line matching `### <id> · <type>`, its fields are the `- **name:** value` lines immediately under it, and the body is everything after the blank line that ends them, up to the next such header.

**The blank line is what ends the field block — not "the first line that stops looking like a field".** The looser rule is ambiguous in exactly the case that matters: a body whose first line reads as `- **resolves:** <id>`, which is how anyone quotes the id of a finding they are talking about. Under it, a `note` that merely CITED a blocking finding acquired a real `resolves:` and that finding vanished from the view of what is open, with every verifier still green — work disappearing in silence, which this document calls the most expensive failure in the design.

**A body whose first line has the shape of a field is rejected.** With the rule above the parser reads it correctly, so this is for the entry typed by hand, where the blank line is easy to forget and its absence turns that line into a field nobody meant to write — a `resolves:` that closes an open finding, or an invented field that makes every later commit fail on an append-only file. Put it above as a field, or start the body with another line.

**A body containing a line that looks like an entry header is rejected.** Neutralizing it silently would change what was written; accepting it would split one entry into two, the second with an id nobody assigned. Pasted tool output is the normal case here, so the rejection names the offending line and points at `ref:`.

**A field value containing a newline is rejected for the same reason, and it is the worse half of the same case.** A field is one line; a newline inside one splits the entry before its body is even written, so everything after the break is read back outside the entry — and if any of it starts with `###`, as pasted tool output routinely does, the split half becomes an entry with its own type, its own fields and the real body, under an id nobody assigned. That id can collide with a future one, or be pointed at by a `resolves:`. The remedy is the same: the long text goes in a file of its own, named by `ref:`.

`scripts/task-log.mjs` is the one place that parses this. The verifier and the view both import it, so the format is never interpreted twice.

## Writing an entry by hand

Allowed. The script is the convenient door, not the only one — if only the script could produce a valid entry, every manual correction would break the commit and people would stop verifying. The verifier judges the shape, not the provenance: an entry typed in an editor that meets the format passes, and one that does not is reported whoever wrote it.
