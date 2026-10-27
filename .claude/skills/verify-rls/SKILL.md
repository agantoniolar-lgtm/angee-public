---
name: verify-rls
description: Use whenever a table is created or modified in a database with per-user or per-role access control (Row Level Security in Postgres/Supabase, or the equivalent in another backend), or whenever policies governing that access are added or changed — or whenever the project owner reports symptoms of access misbehaving ("a user can see someone else's data", "a role that should see records sees nothing"). Access-control bugs are silent, not loud — no error, no crash, just the wrong data (or no data) showing up — so treat them with the same seriousness as a security bug. Covers both policy design (who can see/edit what, by role) and active verification (running real queries as each role) — a policy that "looks right" is not the same as one that's been verified.
---

# Verify access control (RLS or equivalent)

## 1. Document the role model before writing any policy

Every project using this skill needs a written, current table of who can see/edit what, by role, per table — living wherever this project keeps its schema docs (commonly `docs/db-schema.md` or similar; check `CLAUDE.md` for where this project puts it). If that table doesn't exist yet or hasn't been touched in a while, this is the moment to write or update it — not a side task to get to later. The general pattern is usually "a row is visible/editable by whoever owns it, matched via `auth.uid()` (or this backend's equivalent) against an owner column, direct or through a foreign key" — but any exception to that pattern (a role with no access to a table at all, a column that's only unlocked once some other field is set, an admin bypass) has to be written down explicitly. Don't assume the general pattern applies to a table without checking what that table's row in the doc actually says.

Before writing a policy for a new or changed table, answer explicitly: who should be able to read this row? Who should be able to edit it? Is there a state (an unlock flag, an approval status, a date) that gates access beyond just the role? Write the policy from those answers, then update the role-model doc so the next session (human or agent) doesn't have to re-derive it.

## 2. Schema and policy changes are migration files, sandbox first

This follows the same discipline as rule 10 in `CLAUDE.md` and the sandbox setup in `SETUP_CHECKLIST.md` — nothing new here, just applied specifically to RLS: every schema or policy change is a migration file, applied to the sandbox first, verified there (section 3 below), and only pushed to production as an explicit, deliberate step after that verification passes and the project owner confirms — never automatic, never triggered by a merge or a push. If this project's sandbox is a second dedicated database instance (the free-tier pattern) rather than a branch, that's exactly why: the git branch you're on doesn't determine which database you're talking to, the environment config does, and in development that should always point at the sandbox.

**Every migration is also enforced schema-only before it can even reach the sandbox.** `.claude/skills/verify-rls/scripts/check-migrations-schema-only.mjs` blocks a new migration file that mixes DDL (schema) with top-level DML (real data) — a migration tested in the sandbox proves nothing about what a mixed-in `INSERT`/`UPDATE`/`DELETE` would do against production's actual rows, since the two databases hold different data. Install the script as a pre-commit hook (same mechanism as the `gitleaks` hook in `SETUP_CHECKLIST.md` section 4b) so a mixed migration is rejected before it's even committed, and copy `migrations-schema-only-workflow.yml.template` to `.github/workflows/` as the CI backstop for anything that slips past the hook (unhooked clone, `--no-verify`, a direct push). A one-off data fix is a separate script outside the migrations folder, explicit and confirmed by the project owner — never folded into a versioned, replayable migration. **Keep those scripts in two separate folders by target, not one folder by kind** — `scripts/one-off/` for anything that runs against **production** and `scripts/sandbox/` for seed and fixture work. Mixing them loses precisely the distinction that matters at the moment someone is about to run one, and the production folder is the one whose contents also belong in the data-scripts section of the production log. The rare, deliberately-reviewed exception (DML that genuinely belongs in the migration) gets an explicit `-- ALLOW-DML: <reason>` line in the file rather than silently bypassing the check.

**The moment a migration actually lands on production, that push is logged — not just applied.** Append a row to this project's production migrations log (from `PROD_MIGRATIONS_LOG.md.template`) at that same moment, not after, so there's a plain, append-only, reviewable audit trail of every change that ever touched real data — something the project owner can check without opening a diff or trusting session memory.

## 3. Active verification — the step that can't be skipped

After creating or changing a policy, don't assume it works because the SQL reads correctly — run real queries as each role and confirm. Using this backend's own tooling (a SQL console or MCP tool that can run a statement as a given role, a test client authenticated as each test user, or equivalent), check:

1. **As the owning user/role** — can they read/edit their own rows? (should succeed)
2. **As a different user of the same role** — can they read/edit rows that aren't theirs? (should fail — if it doesn't, that's the silent bug)
3. **As a different role entirely** — same check, from that role's side of the relationship.
4. **If the table has a state gate** (an unlock flag, an approval step, a visibility window), test explicitly on both sides of the gate — "before" and "after" — and the transition itself. Gates are where bugs hide most, because the policy can look correct in each state checked in isolation and still fail exactly at the transition.

If any case that "should fail" actually succeeds, or any case that "should succeed" actually fails, the table isn't ready to commit — regardless of how simple the policy looks.

**You need real authenticated users in the sandbox to do any of this, and getting them there is part of the work — not a prerequisite someone else supplies.** Signing test users up through the normal auth flow tends to hit an email rate limit after two or three, which is where this step usually stalls. The way through, for a Postgres-backed auth system: insert the user directly into the auth tables by SQL, with the password hashed by the database's own crypto extension and the email already marked confirmed, so the signup service is never involved. Set passwords the same way when an existing test user can't log in. Seeded sandbox users are cheap, disposable, and worth keeping around between sessions — leave them seeded rather than cleaning up after every run.

> ⚑ **Re-verify an inherited "we can't test this" before repeating it.** A blocker written in a task or a status file is a hypothesis with a date on it, not a fact.

## 3b. Pair the policy with the code that writes through it

A policy is only half the guarantee. **A write that a policy filters out returns success and affects zero rows — no error, no exception, nothing for the app to catch.** So an app that checks only "did this call return an error?" will report "saved" for a write that silently did nothing, and the user discovers it when their data reappears unchanged after a refresh.

Whenever this skill adds or changes a policy on a table, confirm the code writing to that table **asserts on rows affected**, not on the absence of an error — request the affected rows back and check the count. This has bitten the same project twice on two different tables, and both times the screen cheerfully said the work was saved. See `verify-tests` for the testing side of the same rule.

## 4. Watch for timezone edge cases on date-range policies

Any policy or query whose access decision depends on a date or time range (`WHERE created_at >= this_month_start`, "this week's records," anything like that) can behave differently depending on the client's timezone versus the database server's (commonly UTC). If a policy or a query depends on a date range, explicitly test near a local-midnight boundary in the project's actual timezone — that's the edge where this class of bug hides, because it works fine the rest of the day and only breaks in a narrow window most manual testing never hits.

## 5. Record what you ran, where the rest of the work is recorded

Write the result in the task's task log with `scripts/task-log-append.mjs` — see "How the skills
write" in `ae-kit-templates/task-log-ontology.md`. A `note` with **the per-role queries you actually
ran against the sandbox and what each one returned**: which role, which table, what it could see and
what it could not, and the row counts. Not "RLS verified" — the queries and their results, so that
someone reading this in six weeks can tell a policy that was exercised from one that was assumed.

This is the entry the `output:` block below declares. A skill whose output block promises a task-log
entry and whose procedure never says how to write it is a promise nothing keeps: found by the 0.36.0
release test, which is why this step is named rather than implied.

## 6. If you find a broken case

Don't defer it "because you're almost done." A broken access-control case blocks the commit exactly like a failing test. If the fix isn't trivial and can't be resolved in the moment, create a task for it now (category matching this project's convention, type `Bug` or equivalent) rather than trusting session memory to carry it forward.

## Output

An up-to-date role-model doc, a migration file for the schema/policy change that passes the schema-only check, a sandbox where that migration was applied and verified against real per-role queries (not just read), and — only after that verification passes and the project owner confirms — the same migration applied to production as its own deliberate step, logged in `PROD_MIGRATIONS_LOG.md` at the moment it happens.

```yaml
output:
  - kind: file
    path: the migration file, in this project's migrations directory
    must_contain: schema only — no DML, per the schema-only check
  - kind: task-log
    event: note
    must_contain: the per-role queries actually run against the sandbox, with their results
  - kind: file
    path: PROD_MIGRATIONS_LOG.md
    when: the migration reached production
    must_contain: the application logged at the moment it happened
```
