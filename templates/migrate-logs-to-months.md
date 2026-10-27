<!-- check-log-layout: ignore — this procedure quotes pre-migration paths as examples -->

# Migrating session logs into month folders

Kit 0.34.0 moved session logs from `logs/session-YYYY-MM-DD.md` to
`logs/sessions/<YYYY-MM>/session-YYYY-MM-DD.md`, and retired both the 30-session cap and
`logs/archive/`.

**The installer does not do this for you, and that is deliberate.** Moving a project's history is not
something a kit update should do behind your back: it rewrites paths that your own documents point at,
and only you know which of those documents are live and which are frozen records. Run this when you
choose to, as its own task.

**Until you run it, nothing breaks.** `open-session` still finds loose logs — it reads them and tells
you they haven't been migrated. You can stay un-migrated for as long as you like.

## Before you start

Commit or stash whatever is in your working tree. This procedure moves files and edits references, and
you want a clean `git diff` at the end to be able to read what it did.

## 1. Inventory every reference before moving anything

This is the step that makes the migration verifiable, and skipping it is how a link dies quietly:
**no verifier in the kit validates links to logs.** If a reference breaks, nothing reports it — someone
finds it months later opening an old document.

From the project root:

```bash
grep -rno "logs/session-[^)\`\" ]*\.md" --include="*.md" . | grep -v "^./.git" \
  > logs-references-before.txt
wc -l logs-references-before.txt
```

Keep that file. It is your checklist, and at the end it is your evidence.

If you keep it as a document in the repo, give it the line `<!-- check-log-layout: ignore -->`:
it quotes pre-migration paths by design, and without the marker `check-log-layout.mjs` will report
every row as a broken link. The marker exempts the **whole file**, so put it only on documents whose
job is to quote old paths — never on a document that also carries live links you want checked.

Read through it once and sort every line into one of two kinds, because they are handled differently:

- **A link** — it names a real log file, like `logs/session-2026-08-23.md`. The file moves, so the
  reference must be updated.
- **A pattern** — it names the shape, like `logs/session-YYYY-MM-DD.md`, or a glob. It cannot break as
  a link. Decide per document whether to update it: a live document describing current doctrine should
  say the new path; a sealed historical record should be left exactly as it is.

**Check whether any reference is already broken** before you move anything, so the migration doesn't
inherit a fault it didn't cause:

```bash
cut -d: -f3 logs-references-before.txt | sort -u | while read -r f; do
  [ -e "$f" ] || echo "ALREADY BROKEN: $f"
done
```

Fix those separately, or write down that you are leaving them.

## 2. Move the files, preserving history

Use `git mv`, never delete-and-recreate: the history of a log is often the only record of when
something was decided.

```bash
mkdir -p logs/sessions
for f in logs/session-*.md; do
  [ -e "$f" ] || continue
  month=$(basename "$f" | sed -n 's/^session-\([0-9]\{4\}\)-\([0-9]\{2\}\).*/\1-\2/p')
  if [ -z "$month" ]; then echo "NO DATE, decide by hand: $f"; continue; fi
  mkdir -p "logs/sessions/$month"
  git mv "$f" "logs/sessions/$month/"
done
```

A log whose name carries no parseable date — a reconstruction spanning a range, say — is reported
rather than guessed at. Put it in the month it ends in, or the month it best belongs to, by hand.

**If you have a `logs/archive/`**, its contents are session logs too, and they go through the same
loop. `archive/` is retired: once it is empty, remove it. Nothing in the kit refers to it any more.

## 3. Move out what was never a session log

`/logs/` now holds only `deploy-checks.md` and the `sessions/` (and, if you use it, `tasks/`) folder.
Anything else living there — a findings write-up, a comparison, a scan — belongs in `/docs/`. Move it
with `git mv` as well, and update whatever pointed at it.

**`logs/deploy-checks.md` does not move.** Its path is wired into `check-deploy-verified.mjs` and the
`ship` skill; leave it exactly where it is.

## 4. Update the references

Work from the inventory, not from memory. For the links:

```bash
grep -rl "logs/session-2[0-9]" --include="*.md" . \
  | grep -v "^./.git\|^./node_modules" | while read -r doc; do
  cp "$doc" "$doc.bak"
  perl -pi -e 's{(?<![\w:/])(\.\./|/)?logs/session-((\d{4})-(\d{2})-[^)\s`"|]*\.md)}{${1}logs/sessions/$3-$4/session-$2}g' "$doc"
done
```

Three guards in that command, each for a way the naive version does damage:

- **`(?<![\w:/])` plus an optional `../` or `/` prefix that is carried through.** The lookbehind
  keeps `OTHER:logs/session-2026-08-15.md` — another project's log, quoted in a comparison — and
  `other-repo/logs/…` from being silently "migrated" on a repo that never migrated; the kit's own run
  did exactly this to three of another project's paths before the guard existed. The optional prefix is what
  catches `/logs/session-…` and `../logs/session-…`, **the form the kit's own skills write**, so a
  project that copied that style has most of its citations in it. An earlier version of this command
  rejected any leading slash and silently skipped every one of them.
- **excluding `|` from the path** stops a greedy match from swallowing two cells of a Markdown
  table written without spaces and producing one nonsense path out of them.
- **the `.bak` copy** is your undo. Check the diff, then `find . -name '*.md.bak' -delete`.

**A log whose name has no single date — a reconstruction covering a range — is not matched by this,
because the pattern requires `YYYY-MM-DD` right after `session-`.** Step 2 reports that file when it
moves it; this step will not update the references to it. Fix those by hand, from the inventory. This
is the one case that slipped through on the kit's own migration, and it left four broken links in
documents that are read every session.

Then decide the patterns document by document. Do not batch-rewrite those: that is the step where a
sealed historical document gets silently edited.

> **Watch for paths that belong to another project.** A document that compares projects, or quotes
> another repo's logs, often writes them in the same shape — `OTHER:logs/session-2026-08-15.md`, or a
> bare path in a sentence about somewhere else. A blanket rewrite cannot tell those apart from your
> own and will silently migrate a project that hasn't migrated. This happened on the kit's own run:
> three of another project's paths were rewritten and had to be reverted. Reading the inventory before
> rewriting is what catches it.

## 5. Prove it

Re-run the inventory and confirm every target resolves:

```bash
grep -rnoE "logs/(sessions/[0-9]{4}-[0-9]{2}/)?session-[^)\`\" ]*\.md" --include="*.md" . \
  | grep -v "^./.git" > logs-references-after.txt
wc -l logs-references-after.txt
grep -oE "logs/(sessions/[0-9]{4}-[0-9]{2}/)?session-[^)\`\" ]*\.md" logs-references-after.txt \
  | sort -u | grep -v 'YYYY\|\*' | while read -r f; do
  [ -e "$f" ] || echo "BROKEN: $f"
done
```

An empty result is the pass, and it is the one that matters: **it catches both shapes**, so a citation
left in the old flat form shows up here as broken rather than passing unnoticed.

The two counts, `before` and `after`, should be the **same number** — every reference still exists,
just pointing somewhere else. A smaller `after` means a reference was dropped rather than moved.
(Counting is only meaningful because both greps match both shapes; a grep that matched only the new
form would report a near-total loss on a perfectly good migration.)

Better still, if your project runs kit 0.34.0: `node scripts/check-log-layout.mjs` does all of this,
and the pre-commit hook runs it from now on.

Then run `open-session`. It should find your latest log in its month folder and say nothing about loose
files.

Finally, delete the two `logs-references-*.txt` files, or keep the inventory as a document under
`docs/` if your project wants the record. Either way, don't commit them to the repo root as scratch.

Clean up the backups the same way, but **list them before deleting** — `find . -name '*.md.bak'` — so
you don't remove a `.bak` the project already had for its own reasons. If one existed before you
started, step 4 overwrote it; recover that one from git before deleting anything.

## What this does not cover

If a document outside this repo — a wiki, an issue tracker, a bookmark — links to a log by path, this
procedure cannot see it. Grep is limited to your working tree.
