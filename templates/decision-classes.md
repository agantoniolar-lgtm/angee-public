# Decision classes

Who takes each decision in this project, and how work gets ordered.

**This is not a template.** It lives in `ae-kit-templates/` because that is what the installer copies, but nothing here is meant to be filled in per project. The one project-specific fact it depends on, the project's delivery channel, lives in `CLAUDE.md` → Git conventions. Every project that installs the kit uses them; there is no option to exclude this file.

## Three classes

| Class | Who decides | What falls in it | What the owner gets |
|---|---|---|---|
| A | The owner, before it happens | What gets built and its scope; business rules; approving a plan — what it builds and its scope, not how it splits into units; the questions a list of cases leaves open whose answer is one of the above — the list itself is not class A, and moving on to `build` once no such question is left is class B; anything irreversible or that leaves the repo, such as touching production or real data, publishing, sending something to a third party, or deleting something outside the approved scope or that git cannot recover; a push that reaches production or the project's delivery channel; changes to `CLAUDE.md`, the product document or the maturity | The question on its own, with a recommendation and the five priority questions answered |
| B | Claude, and reports it | Moving to the next step of an approved plan; splitting a task into units and writing their `touches:`, once `scope-reviewer` has run — a split that changes what gets built is still A; running the mandatory steps of the skill chain; implementation details inside the approved scope; fixing a review finding that changes neither the scope nor what the user sees; correcting records; a push that does not reach production, verified green | One line in the report or in the task file |
| C | Claude, without reporting | Mechanical work: regenerating indexes, committing the proof that a push was verified | Nothing |

Five rules sit on top of the table:

- **A B decision that would change the approved scope is an A decision.** So is a fix that changes what the user sees.
- **When Claude is unsure between two classes, it takes the higher one.** A project whose `CLAUDE.md` does not name its delivery channel treats every push as reaching it.
- **A push that comes back red, or with no verdict, is reported to the owner.** No verdict is never reported as green.
- **A class A decision still pending stops only the work that depends on it.** Work depends on a pending question if its answer could change what that work builds, whether it is built at all, or a file it touches — **and when unsure, it depends.** A task whose list of cases still has an unanswered `[owner]` case does not start `build`. Everything else keeps being built and reviewed. The report says which unit waits on which question. This rule governs work already under way; whether a task starts at all when a session opens is the next section's call.
- **When the project has a control center, a class A question goes on a card, and never lives only in the chat** — also while the owner is at the terminal. An answer the owner gives in the chat is written onto the card, marked as answered in the chat. The checks a question passes before it becomes a card, and how a decision taken there reaches the task log, are in `ae-kit-templates/control-center.md`. A project with no control center asks in the chat.

Some A decisions stay with the owner whatever a skill says: accepting a blocking review finding without fixing it, approving lessons that leave for the kit, and marking a setup item as not applicable.

## Opening a session

A session always opens by asking the owner what to do, with one recommendation and the five questions below answered for it.

The one exception is work the owner already authorized to start without asking, or to run in parallel. That authorization is written in `STATUS.md` → "Next session" → "Authorized to start without asking". Only the owner's own words put a task there, and only with its list of steps and with every decision it needs already approved. A task with a pending decision does not start on its own, even if it is listed. Anything not on that list waits for the owner.

## Priority criterion

It serves two purposes: ordering work, and building a class A question. Claude answers the five questions; the owner decides.

1. Is it blocked by something? If so, it stays out of the order until it is unblocked.
2. Does it block something?
3. What does it benefit? Which of the project's success signals it moves, and by how much.
4. Does it affect something that already exists, in the repo or in the project? Users, data or other systems, for example.
5. What does it cost, in time and in scope? Scope counts the work the answer opens up: approving or declining a question can end in a phased document.

## What these classes do not cover

Nothing checks that a decision was taken by the right class. The measure is how many questions reach the owner per session, and how many of them belonged to class B or C.
