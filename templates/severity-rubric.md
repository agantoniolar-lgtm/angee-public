# Severity rubric

How a review finding gets rated, and where it goes once it is rated.

**This is not a template.** It lives in `ae-kit-templates/` because that is what the installer copies, and it is kit content: the same rubric in every project. The reviewers that rate findings (`code-reviewer`, `scope-reviewer`) read it, and `code-review` uses it to assign each finding a destination. A finding is any entry of type `finding` in a task log (`ae-kit-templates/task-log-ontology.md`).

The rubric exists to take the room for interpretation out of a review. Every axis below has a closed list, every combination that cannot happen is named, and every severity comes with real examples from two projects: ae-setup, the kit itself, and a web application with real users, called "web app" below.

## The fields a finding carries

| Field | Values | What it says |
|---|---|---|
| `severity` | `blocking`, `flag` | the gate: whether the finding stops the push |
| `level` | `critical`, `major`, `debt`, `cosmetic`, `suggestion` | how bad it is; it decides the gate |
| `evidence` | `reproduced`, `plausible`, `hypothetical` | how often real use produces the input that triggers it |
| `defect-type` | the eight ODC types below | what kind of defect it is |
| `destination` | `fix`, `new-unit`, `debt`, `drop`, `dissolve`, `accept`, `owner` | what happens to it |
| `induced-by` | the id of another finding | the finding whose fix produced this one, when that applies |
| `reopens-if` | a condition, in a sentence | what would bring a deferred finding back; required with `debt` |
| `due` | a date (`YYYY-MM-DD`) or a task id | when or where a deferred finding gets fixed; required with `debt` |

`defect-type` is not called `class` because in the kit a class is already the A, B or C of a decision (`ae-kit-templates/decision-classes.md`).

## Level, and with it the gate

The level decides the gate. The two are written separately so that an impossible pair can be rejected when the entry is written.

| `level` | `severity` | What it is |
|---|---|---|
| `critical` | `blocking` | harm, reproduced or plausible, to users, to their data, to a secret, or work lost without warning |
| `major` | `blocking` | a concrete, plausible failure: a gate that lets through what it should stop, a rejection with no way out, a report that leads someone to a harmful action |
| `debt` | `flag` | a real defect whose cost grows if it is left, with no failure now |
| `cosmetic` | `flag` | text, names or form, with no effect on behaviour and nothing that misleads a reader into acting |
| `suggestion` | `flag` | an improvement, not a defect |

**Valid pairs.** `blocking` goes only with `critical` or `major`. `flag` goes only with `debt`, `cosmetic` or `suggestion`. Every other pair is rejected. **`cosmetic` never blocks.**

**Telling a level from its neighbour.** Ask the question for the pair you are unsure between.

- `critical` or `major`: does the failure itself land the harm, or does it leave the harm one act away? A gate left open is `major`; what slips through it may be `critical` on its own.
- `major` or `debt`: can you name a scenario in real use, as Evidence defines it, where it fails now? If you can only name a cost that grows, it is `debt`.
- `debt` or `cosmetic`: could a reader act wrongly because of it, or would fixing it change behaviour? Then it is `debt`. Text that misleads is `debt` or higher, never `cosmetic`.
- `cosmetic` or `suggestion`: is something wrong today? If nothing is wrong and the finding proposes something better, it is `suggestion`.

A finding is rated by what it does, not by how it was registered. Several examples below were registered one level off; the rubric rates them where they belong.

## Evidence

**Evidence rates the input that triggers the defect in real use, not the mechanism.** A mechanism that fails on some input says nothing about whether real use ever produces that input.

- `reproduced`: the failure already happened in real use, or someone triggered it with an input that real use produces, an attacker's included under the rule below.
- `plausible`: nobody has triggered it yet, but real use produces the input that would.
- `hypothetical`: the input is one real use does not produce. An attacker's input counts as real use only under the rule below. The mechanism failing on the input does not change that. NOT-3 and NOT-5 are examples.

**An attacker's input is real use when there is something real to harm.** Two questions decide it. Does the harm land on users, their data or a secret? Does the project hold real users or real secrets? When both answers are yes, an input an attacker would send is `plausible`, and `reproduced` once someone has sent it, so it can block. A forged request, a role someone grants themselves and probing addresses to learn which have accounts are such inputs. When either answer is no, the attacker's input is not real use, and it is `hypothetical`.

**A `hypothetical` finding is capped at `debt`, so it never blocks.** It may be `debt`, `cosmetic` or `suggestion`; `hypothetical` with `critical` or `major` is rejected. Measured in both projects: the 12 blocking findings rated hypothetical in ae-setup and the only one in the web app were all over-rated.

**Maturity moves what counts as plausible, not the table.** `maturity:` in `STATUS.md` says what real use is:

- `prototype`: real use is what the owner and the agent actually do in the project's ordinary operation. A scenario that needs real users, real data or a second person is `hypothetical`, unless the project already holds a real secret: then an attacker reaching it is `plausible` under the rule above.
- `pre-users`: the paths the first users will actually take in the project's ordinary operation are plausible. Scale the project does not have yet is `hypothetical`. An attacker's input follows the rule above: `plausible` once the project holds real users' data or real secrets and the harm lands on them.
- `live-users`: any path real users, or projects that installed the kit, actually take in the project's ordinary operation is plausible. That includes a shared device, a slow network, the default terminal, and an attacker after users' data under the rule above.

The same finding can be `critical` in a project with live users and `debt` in a prototype. What changes is its evidence; the levels and the gate stay as written.

## Defect type

The list is IBM's Orthogonal Defect Classification (ODC). It covered every finding in both projects but one. It describes what kind of defect it is; it does not change the level.

| `defect-type` | What it covers |
|---|---|
| `function` | a capability or a step that is missing or wrong, and needs a design change to fix |
| `interface` | two surfaces that disagree: a script and its caller, a skill and its script, a library and how it is called |
| `checking` | a missing or wrong validation of a value, a condition or a permission |
| `assignment` | a wrong value: an initial value, a default, a field written with the wrong thing |
| `timing` | order, concurrency or time limits: two writers at once, a deploy order, a call with no timeout |
| `build` | packaging, merging, versions and CI: what gets installed, published or merged, and with what configuration |
| `documentation` | text that describes something that lives elsewhere: a README, a comment, a help line, a note |
| `algorithm` | a procedure that is wrong or costly, fixable by rewriting it without changing the design |

**A skill, an agent prompt or a procedure is something an agent executes**, not a description. Its defects take the type of what goes wrong when it runs: a missing step is `function`, a wrong order is `algorithm`, a missing check is `checking`. `documentation` is for text that only describes.

## Contradictions between surfaces

A contradiction between two surfaces is `major` only if it leads an agent or a person to do something harmful. Otherwise it is `debt`. The surfaces can be a skill and its script, two documents, or a plan and the design it implements.

It is the largest bias measured in ae-setup: 11 of the 22 blocking contradictions carried no concrete failure, only confusion. The question to ask is what the reader does after following the wrong side, and whether that act damages something.

## Destinations, and who chooses them

| `destination` | What it means | Who decides | Allowed for |
|---|---|---|---|
| `fix` | fixed inside the unit where it was found | the session | `blocking`; a `flag` only when its round left blocking findings |
| `new-unit` | fixed now, in a new, atomic unit of its own | the session, with the questions below | `flag` only |
| `debt` | left as debt, with `reopens-if` and a `due` date or task | the session, and it is reported | `flag` only |
| `drop` | discarded, with its reason | the session, and it is reported | `flag` only |
| `dissolve` | the design decision that makes it possible is changed, and the finding stops existing | the owner (class A) | both |
| `accept` | the risk of a blocking finding is accepted without fixing it | the owner (class A) | `blocking` only |
| `owner` | waiting for the owner's decision | the session sets it; the owner's decision replaces it | both |

**A blocking finding** admits only `fix`, `dissolve`, `accept` or `owner`. **A flag** admits `new-unit`, `debt`, `drop`, `dissolve` or `owner`; it never takes `accept`, and takes `fix` only when the round it came out of left blocking findings.

**A destination closes nothing by itself.** A blocking finding with `accept`, `dissolve` or `owner` stays open, and keeps blocking, until a `decision` from the owner names it in `resolves:`.

**A flag fixed in a new unit** is closed by a `fix` entry whose `commit:` was reviewed by a round of another unit, written after the flag. A fix committed inside the flag's own unit does not close it. That stops a flag from being recorded as fixed inside its unit, not the unit from being reopened: a session could still amend the commit, ask for another round and close the flag with a note. The check before the push, `T187`, is what detects that path. **One exception:** when the flag's round left blocking findings, the unit is amended anyway, so a flag that passes the questions below may be fixed in that same amendment, with `destination: fix`, and closed by a `fix` whose `commit:` the next round of that unit reviewed; it counts toward the two flag fixes per task.

**A blocking finding induced by the previous round's fix** is not fixed automatically. It goes to `owner`, with `dissolve` as the recommendation when the reviewer proposed one.

## Which flags get fixed now

**A flag goes to `debt` by default.** A unit that came out with no blocking findings closes. Its flags stay with a `due` date or inside a task, and none of them reopens the unit.

A flag leaves debt only through these questions, in order. The first one that answers decides.

1. Is it `hypothetical`, or a `suggestion`? Then `debt` or `drop`. It is never fixed inside the review cycle.
2. Is it `cosmetic`? Then `debt` or `drop`.
3. Does the fix change behaviour: a new branch, a gate, a message or an exit code? Then `debt`. It leaves debt only with `reproduced` evidence and an effect on installed projects or on users; then it is `new-unit`.
4. Is it text that misleads (level `debt`), or a test that passes with the defect alive? And does its fix touch only text or a test, inside files the unit already touches? Then `new-unit`.
5. Anything else: `debt`.

The data behind questions 3 and 4, from ae-setup: fixing a text or a test produced another finding in 15–20 % of cases. Fixing an edge, a gate or a report did so in 35–42 %. The web app shows the same pattern, 14–17 % against 33–67 %.

**One new unit per mechanism**, never one unit that gathers every flag: that keeps it atomic. It is reviewed once. If that round leaves only flags, the unit closes and those flags go to `debt`.

**At most two flag fixes per task.** Once a task has fixed two flags, every later flag that would be `new-unit` goes to `debt` or to another task.

## Examples

Each example names its level, evidence, defect type, whether the defect lives in prose or code, and where it comes from. Then it says what went wrong and why it is that level and not its neighbour. None carries data about a person: the web app ones describe the defect, not the data, and leave out the application's domain and anything that would let someone reproduce the defect against it.

### `critical`

- **CRIT-1** · `reproduced` · `build` · code · ae-setup T052. The merge setting for task logs dropped the closing lines that two entries appended on different branches had in common, and every verifier stayed green. Text is lost without warning; it is not `major` because nobody has to act for the loss to happen.
- **CRIT-2** · `reproduced` · `checking` · code · ae-setup T127. When git could not read a project that is a repository, the installer treated it as not a repository, overwrote an uncommitted edit and exited 0. It was triggered with a moved worktree and an inherited `GIT_DIR`, inputs real use produces, so `reproduced`.
- **CRIT-3** · `reproduced` · `algorithm` · prose · ae-setup T037. The update procedure's `--force` step deleted the project customisations the same procedure promised to keep. Following the text as written loses the project's work; the procedure is the agent's code, so this is not documentation.
- **CRIT-4** · `plausible` · `checking` · code · ae-setup T104. `discard` did not validate the unit it was given; with a backup's name as argument it deleted the only copy of uncommitted work and exited 0. A typo in real use is enough, so the evidence is `plausible`, not `hypothetical`.
- **CRIT-5** · `plausible` · `build` · prose · ae-setup T168. The plan's test for a page used a copy of a client project's data, which CI cannot reach, and committing it under `kit/` would publish private data. Caught at plan time, so `plausible`; a secret or user data reaching a public repository is `critical` on its own.
- **CRIT-6** · `plausible` · `timing` · code · web app. While a service it depends on was slow, an account-recovery request answered differently for an address with an account and one without. The message revealed which accounts exist to anyone probing addresses, an attacker's input in a project with live users, so `plausible`. It is harm to users' data, not a gate left open. Fixed.
- **CRIT-7** · `plausible` · `checking` · code · web app. A change meant to close a path into a privileged role verified only part of the permissions in force. It could finish without error and leave another path open to users' data. Someone granting themselves the role is an attacker's input with live users, so `plausible`. Fixed.
- **CRIT-8** · `plausible` · `timing` · code · web app. If a user's recording was still saving when they switched to another record, it was discarded, and if the save then failed nothing said so. It was registered as a flag; losing a user's recording without warning is `critical`.

### `major`

- **MAJ-1** · `reproduced` · `checking` · code · ae-setup T052. The session-close gate recognised a unit by the suffix in its commit subject, so a fix commit without it went to the remote unreviewed. The gate let through what it exists to stop; the content itself did no harm, so not `critical`.
- **MAJ-2** · `plausible` · `checking` · prose · ae-setup T168. The guide copied `resolves:` from the owner's card without looking at the chosen option, so "fix this blocking finding" closed it and `ship` pushed the defect. A gate defeated by following the text, one act away from the harm.
- **MAJ-3** · `plausible` · `function` · prose · ae-setup T070. A release note told installed projects to finish, commit and push their tasks in progress without asking the owner. In a project with users that deploys unauthorised work; it is an instruction that leads to a harmful act, not the act.
- **MAJ-4** · `plausible` · `build` · code · ae-setup T070. CI and the publish step ran in parallel, so a version without its notes published even when CI was red. A gate that does not hold; it is not `debt` because every release takes that path.
- **MAJ-5** · `reproduced` · `checking` · prose · ae-setup T083. A release condition was marked met on a run that failed and wrote nothing, so the release check would pass without exercising anything. A blind check on a gate is `major`; a blind test on correct code is `debt` (DEBT-4).
- **MAJ-6** · `reproduced` · `interface` · code · ae-setup T074. The installer read its merge result from the first line of mixed output. Any start-up message from node made the report lie, and left the project unable to install any version. A rejection with no way out; nothing was lost, so not `critical`.
- **MAJ-7** · `reproduced` · `algorithm` · prose · ae-setup T130. A guide had the owner paste a diff inside double quotes, and the terminal ran words from the diff as commands. It leads a person to a harmful act; it would be `critical` if those words had destroyed something.
- **MAJ-8** · `plausible` · `interface` · prose · ae-setup T127. `open-session` and a script told projects to update without the step that converts their local edits, while the installer now overwrites them. A contradiction that leads an agent to a harmful act, so `major` under the contradiction rule; it was registered as a flag.
- **MAJ-9** · `reproduced` · `interface` · code · web app. A check that a table was removed always failed: it asked with a request that returns no body, and the client library turns that into success. The unit could never meet its own verification; a rejection with no way out.
- **MAJ-10** · `plausible` · `timing` · code · web app. If the front end reached production before its migration, every save failed and the user saw an error although the data was saved, so most would capture it again. A report that leads to a harmful act; nothing is lost, so not `critical`.
- **MAJ-11** · `plausible` · `timing` · code · web app. A change to a user's account settings had no time limit: if the change succeeded and the step after it hung, the screen stayed on "Saving" and a retry reported failure. The person believes the change failed when it did not; a concrete failure on a common network.
- **MAJ-12** · `plausible` · `function` · code · web app. After each deploy, a lazy-loaded screen resolved to nothing and threw, and with no error boundary the app went blank until the reload arrived. It was registered as a flag; users see a failure in real use, but recover with no loss.
- **MAJ-13** · `plausible` · `function` · prose · web app. The design for a feature let one kind of user send questions to another, but no piece of its data model stored the question, its target, the answer or its state. Built as written, the feature cannot work; a plan gap with a concrete failure, not a cost that grows.

### Looks blocking, is not

All ten were registered as blocking.

- **NOT-1** · `debt` · `plausible` · `interface` · prose · ae-setup T052. "Inseparable" meant "same push" in `scope` and "one review pass" in `code-review`. A contradiction whose worst outcome is a weaker combined review, with no harmful act, so `debt` under the contradiction rule.
- **NOT-2** · `debt` · `reproduced` · `documentation` · prose · ae-setup T052. Seven citations in a live task file and its scope document pointed at the wrong step numbers after a renumbering. It misleads a reader, so `debt` and not `cosmetic`; it leads to no harmful act, so not `major`.
- **NOT-3** · `debt` · `hypothetical` · `checking` · code · ae-setup T070. New ways of writing "nothing" in a release note's steps ("- (none)", "- Skip.") still passed validation and stopped every installing project with exit 5. The reviewer did trigger the stop, but with strings written on purpose; the owner judged that no author writes that way, so the input is `hypothetical` and the cap is `debt`.
- **NOT-4** · `debt` · `plausible` · `checking` · code · ae-setup T104. A worktree whose folder was deleted made a script end with a stack trace and exit 1. It fails toward the safe side, and nothing is lost or passed by mistake; only the message is poor.
- **NOT-5** · `debt` · `hypothetical` · `algorithm` · prose · ae-setup T168. Changing a decision from a reopened card did not reach the log as a replacement. The owner had never reopened a card: the path was imagined, so `hypothetical`, capped at `debt`.
- **NOT-6** · `debt` · `hypothetical` · `checking` · code · ae-setup T127. If a kit folder were a submodule or a nested repository, the installer would not see an uncommitted edit in it and would overwrite it. The mechanism fails, but nobody, honest or malicious, builds that layout, so the input is `hypothetical`; the cap applies however bad the loss.
- **NOT-7** · `debt` · `reproduced` · `checking` · code · ae-setup T168. A dashboard showed a task whose work lives only on short-named unit branches as "not started". A report that shows a wrong state but leads to no harmful act is `debt`; MAJ-10 is the contrast.
- **NOT-8** · `debt` · `reproduced` · `algorithm` · code · ae-setup T168. In a fresh clone, a ten-minute overlap re-sent every report already sent, up to 482 in a single load. A cost, and only on cloning; nothing is lost.
- **NOT-9** · `cosmetic` · `reproduced` · `documentation` · code · web app. A screen's empty-state message dropped the closing sentence of the approved text, the one suggesting another option. The screen behaves correctly and the meaning survives; copy only.
- **NOT-10** · `debt` · `reproduced` · `interface` · prose · web app. A design page scheduled a feature in a phase the product document did not, and dropped one it did, contradicting the document sent to users. No harmful act, so `debt`; it misleads users, so it can qualify for `new-unit`.

### `debt`

- **DEBT-1** · `plausible` · `algorithm` · code · ae-setup T168. Every turn rereads every decided card, with no cap. Fast today, and its cost grows with the history; no scenario fails now, so not `major`.
- **DEBT-2** · `plausible` · `build` · code · web app. Nothing pins the Node version: CI runs one major version and the local machine another, so the local check can pass what CI rejects. It already happened once and was caught by CI, which is why it is not `major`.
- **DEBT-3** · `reproduced` · `documentation` · prose · ae-setup T083. A table listed `commit` among the skills that write the task log, and it does not. A reader planning around the table would act wrongly, so `debt` and not `cosmetic`.
- **DEBT-4** · `plausible` · `checking` · code · web app. A test checked that each question appeared in a form, not above which control, so swapping two labels would still pass. The code is right today, so `debt` and not `major`; as a blind test it qualifies for `new-unit`.

### `cosmetic`

- **COS-1** · `reproduced` · `documentation` · code · ae-setup T104. A script printed its "queued" line twice. Form only; nobody reads the second line differently from the first.
- **COS-2** · `reproduced` · `documentation` · prose · ae-setup T052. Two historical documents still cited "step 4" of `code-review` after the content moved to step 5. Nobody follows a historical document to act, which is what separates it from NOT-2.
- **COS-3** · `reproduced` · `documentation` · code · web app. A suggestions panel showed a garbled sentence. The reader still understands it, and the behaviour is right.
- **COS-4** · `plausible` · `documentation` · code · web app. A file's header comment said only one message lived in the shared catalogue, when a second one now does too. The reviewer noted it breaks nothing, and no one acts on the comment.

### `suggestion`

- **SUG-1** · `plausible` · `interface` · code · ae-setup T104. A script reported its rejections only as prose, with no machine-readable type a caller could test. No caller parses that prose today; if one did, it would be `debt`.
- **SUG-2** · `plausible` · `function` · code · ae-setup T168. The control-center page has no "mark all as read". Every report still shows and can be marked one by one: an improvement, not a defect.
- **SUG-3** · `plausible` · `function` · code · web app. A recording capped at a maximum length does not log how far past the cap it ran. A diagnostic that would help; the saved recording is correct without it.
- **SUG-4** · `plausible` · `algorithm` · code · web app. An email check is written out a second time instead of reusing the shared validator. Today both are the same expression and nothing reads one against the other; a reviewer who names how they would diverge makes it `debt`.

### How the examples are spread

| | ae-setup | web app | Prose | Code | Total |
|---|---|---|---|---|---|
| `critical` | 5 | 3 | 2 | 6 | 8 |
| `major` | 8 | 5 | 6 | 7 | 13 |
| Looks blocking, is not | 8 | 2 | 4 | 6 | 10 |
| `debt` | 2 | 2 | 1 | 3 | 4 |
| `cosmetic` | 2 | 2 | 1 | 3 | 4 |
| `suggestion` | 2 | 2 | 0 | 4 | 4 |
| Total | 27 | 16 | 14 | 29 | 43 |

ae-setup is a kit made mostly of prose; the web app is an application made mostly of code. The 21 blocking examples come from both, because a rubric calibrated on one would mis-rate the other.

## Confirmed by the owner

The owner approved this rubric on 2026-10-25 (decision `2026-10-25-194340-9zxi` in the log of `T026`). That approval confirmed:

- `cosmetic` never blocks.
- A `hypothetical` finding is capped at `debt`.
- Three readings of the session that wrote the rubric: maturity moves what counts as plausible; a skill, an agent prompt or a procedure takes the defect type of what goes wrong when it runs; and the questions on which flags get fixed now are the five above, in that order.
- The rule on an attacker's input, decided the same day in `2026-10-25-185430-lnvp`.
