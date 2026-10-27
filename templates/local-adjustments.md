# Turning an edited kit file into a local adjustment

Sometimes a project needs a fix before the kit ships it, and the quick way is to edit the kit's
own file — a skill, a script, a template. That works until the next install. **This guide moves
such a fix out of the kit file and into a row of the "Local kit adjustments" section of
`CLAUDE.md`, where an install can't touch it and `check-local-adjustments.mjs` keeps it honest.**

It is written to be run step by step, by a person or by Claude, from the project's root.

**How to use the blocks.** Each one is pasted whole into a terminal (zsh or bash) and works on its
own, in the same terminal or a new one. When a block needs a value from you, the text right above
it says which line to change; nothing else in it is edited. The blocks hold no comments on
purpose: a terminal pastes them as typed, and zsh would run a comment as a command.

**Where the work goes.** Every block uses the same work folder, named after the project's full
path, in your temporary folder: `$TMPDIR/ae-kit-adjust-<number>`. Step 1 empties it. A spare copy
of each edited file goes next to it, in `$TMPDIR/ae-kit-adjust-<number>-backup`, which step 1 does
not empty. Both live in the temporary folder, so **a restart of the computer can delete them**:
finish the guide in one sitting, and commit at the end of step 6.

## Do it before installing a new kit version

Run this guide **first**, then install. The order matters because of what an install does to a
kit file you edited: **it overwrites it.** A kit file belongs to the kit, so every install replaces
one that differs from the new version, without asking. It does tell your edit apart from a newer
kit — it compares each file against the previous `.ae-kit-manifest`, or, in a project that has
none, against the published version `.ae-kit-version` names — and it lists what you had edited,
apart, with the git command that brings each one back. But the fix itself is gone from the file,
and the only copy left is in your git history, where nobody will look until the behavior it fixed
comes back.

Once every edit is a row, the install replaces only the kit's own older copies, and loses nothing.

**If the project has `.ae-kit-customized`** — a list older kits kept of kit files a project had
customized on purpose — nothing reads it any more, and the installer overwrites the files it names
like any other kit file. Convert each of them here before installing: step 6 removes its line, and
deletes the list once it names no file.

## 1. Find which kit files are edited

**If the project has `.ae-kit-manifest`**, the checker names them — look for "Kit files edited
since they were installed":

```bash
node scripts/check-local-adjustments.mjs
```

**Either way, run this block.** It empties the work folder, fetches the kit version you installed
(the first word of `.ae-kit-version`, published as a commit titled `kit <version>`) and
compares every kit file against it. Without a footprint, this is how you find the edits; with one,
steps 2 and 6 still need the copy it fetches.

The block picks the repo by the version it looks up (its `V=`): `angee-private` for a version older
than 0.40.1 — that repo keeps every earlier version — and `angee-public`, whose history starts at
0.40.1, for the rest. Nothing has to be exported first, so it works the same in a new terminal, and
step 7 can run it with an earlier `V=` after the project already moved past 0.40.1. An
`AE_KIT_REPO` already set in the shell still wins over that choice.

```bash
H=$(pwd -P | cksum | cut -d' ' -f1)
WORK="${TMPDIR:-/tmp}/ae-kit-adjust-$H"; KIT="$WORK/kit"
rm -rf "$WORK"; mkdir -p "$WORK"
V=$(cut -d' ' -f1 .ae-kit-version)
OLD=$(printf '%s\n' "$V" | awk -F. '{ print ($1 == 0 && ($2 < 40 || ($2 == 40 && $3 < 1))) ? 1 : 0 }')
if [ "$OLD" = 1 ]; then R="${AE_KIT_REPO:-agantoniolar-lgtm/angee-private}"; else R="${AE_KIT_REPO:-agantoniolar-lgtm/angee-public}"; fi
REF=$(gh api --paginate "repos/$R/commits" --jq ".[] | select(.commit.message | split(\"\n\")[0] == \"kit $V\") | .sha" | grep -E '^[0-9a-f]{40}$' | head -1)
if [ -z "$REF" ]; then
  echo "STOP: kit $V is not in $R, or gh could not reach it. NOTHING WAS COMPARED."
elif gh repo clone "$R" "$KIT" -- -q && git -C "$KIT" checkout -q "$REF"; then
  n=0; m=0
  while read -r f; do
    p=$(printf '%s' "$f" | sed 's|^templates/|ae-kit-templates/|')
    [ -f "$p" ] || continue
    n=$((n + 1))
    if cmp -s "$KIT/$f" "$p"; then :; else m=$((m + 1)); echo "EDITED: $p"; fi
  done < <(cd "$KIT" && find .claude scripts templates -type f)
  echo "compared $n kit files with kit $V ($R@$REF): $m edited"
else
  rm -rf "$KIT"
  echo "STOP: could not fetch $R@$REF. NOTHING WAS COMPARED."
fi
```

Trust only the last line. `compared N kit files … 0 edited` means nothing is edited; a `STOP`
line means nothing was compared, which is not the same thing — fix what it says and run it again.

`install.sh --dry-run` may name some of the same files, under "EDITED IN THE PROJECT" — only the
ones the new version would replace, and none if it refuses — and it leaves no copy of the version
you installed on disk, which steps 2 and 6 need: run this block anyway.

## 2. For each edited file, see what changed and decide where the fix lives

On the first line, put one path that step 1 printed after `EDITED:`. The block saves the diff to a
file, keeps a spare copy of the edited file in the backup folder, and shows the diff:

```bash
F=.claude/skills/verify-ui/SKILL.md
H=$(pwd -P | cksum | cut -d' ' -f1)
WORK="${TMPDIR:-/tmp}/ae-kit-adjust-$H"; KIT="$WORK/kit"; BACKUP="$WORK-backup"
K="$KIT/$(printf '%s' "$F" | sed 's|^ae-kit-templates/|templates/|')"
S=$(printf '%s' "$F" | tr '/' '_' | sed 's/^[.]//')
if [ -f "$K" ] && [ -f "$F" ]; then
  mkdir -p "$WORK/diffs" "$BACKUP"
  cp "$F" "$BACKUP/$S"
  diff "$K" "$F" > "$WORK/diffs/$S.diff"
  cat "$WORK/diffs/$S.diff"
  echo "diff saved: $WORK/diffs/$S.diff   spare copy: $BACKUP/$S"
else
  echo "STOP: no kit copy of $F, or no $F in the project. Run step 1 again. NOTHING WAS SAVED."
fi
```

Lines marked `>` are what the project added, `<` what it removed: that is the fix. Steps 3 and 6
read the diff from its file — never paste a diff into a command. Then pick one of two homes for the
fix — **never the kit file itself**:

- **Prose in the row** — when the fix is a rule or an instruction: "at most 3 review rounds",
  "use the local Playwright config". `CLAUDE.md` is read every session and wins over any skill, so
  a rule written in the row's "How it is applied" is followed without touching the skill. It needs
  no local file: go to step 3.
- **A local file outside the kit's paths** — when the fix is code, or a rewrite too long for a
  row. Run the block below.

In the block below, the first line is the kit file (as above) and the second is the local file: a
path the kit doesn't use, such as `.claude/skills/<name>-local/SKILL.md` or
`scripts/local-<name>.mjs`. It copies the edited file there; for a skill it also gives the copy its
own `name:`, and a `description:` that says it complements the kit's skill and is used in its place,
so the two never fire for the same request with nothing to choose between them:

```bash
F=.claude/skills/verify-ui/SKILL.md
L=.claude/skills/verify-ui-local/SKILL.md
H=$(pwd -P | cksum | cut -d' ' -f1)
WORK="${TMPDIR:-/tmp}/ae-kit-adjust-$H"; KIT="$WORK/kit"
K="$KIT/$(printf '%s' "$F" | sed 's|^ae-kit-templates/|templates/|')"
KL="$KIT/$(printf '%s' "$L" | sed 's|^ae-kit-templates/|templates/|')"
case "$L" in .claude/skills/*/*) KD="$KIT/$(printf '%s' "$L" | cut -d/ -f1-3)" ;; *) KD="$KL" ;; esac
if [ -f "$K" ] && [ -f "$F" ]; then
  if [ -e "$L" ]; then
    echo "STOP: $L already exists. Pick another name."
  elif [ -e "$KL" ] || [ -e "$KD" ]; then
    echo "STOP: $L is inside a kit path. Pick a name the kit does not use."
  else
    mkdir -p "$(dirname "$L")" && cp "$F" "$L"
    case "$L" in
      .claude/skills/*/SKILL.md)
        N=$(basename "$(dirname "$L")")
        O=$(basename "$(dirname "$F")")
        awk -v n="$N" -v o="$O" '
          nd == 0 && /^name:/ { print "name: " n; nd = 1; next }
          dd == 0 && /^description:/ { sub(/^description: */, "description: Complements the kit skill " o " in this project, as a local kit adjustment listed in CLAUDE.md. Use it in place of " o ", in the same situations: "); dd = 1 }
          { print }' "$L" > "$L.tmp" && mv "$L.tmp" "$L" ;;
    esac
    if [ -f "$L" ] && cmp -s "$K" "$L"; then
      echo "STOP: $L is identical to the kit version. The fix is not in it."
    elif [ -f "$L" ]; then
      echo "OK: $L holds the fix"; grep -m2 -E '^(name|description):' "$L"
    else
      echo "STOP: $L was not written."
    fi
  fi
else
  echo "STOP: no kit copy of $F, or no $F in the project. Run step 1 again."
fi
```

Only go on when it prints `OK`. If the diff shows several unrelated fixes, each one gets its own
row.

## 3. Open an issue in ae-setup that asks for it in the kit

The row exists until the kit carries the fix, so it needs a pointer to that request. First check
whether one exists — a lesson the project already emitted may be it. Put two words from the fix
between the quotes:

```bash
gh issue list -R agantoniolar-lgtm/ae-setup --state all --search "review rounds"
```

If none fits, build the issue's body. On the first line, the kit file; on the second, one sentence
saying what the kit should do. The block writes the body to a file and shows it — the diff goes in
with `cat`, so nothing in it reaches the command line — and sends nothing:

```bash
F=.claude/skills/verify-ui/SKILL.md
WHAT='The kit skill should write its case list before walking the UI.'
H=$(pwd -P | cksum | cut -d' ' -f1)
WORK="${TMPDIR:-/tmp}/ae-kit-adjust-$H"
S=$(printf '%s' "$F" | tr '/' '_' | sed 's/^[.]//')
if [ -f "$WORK/diffs/$S.diff" ]; then
  {
    printf 'Carried as a local adjustment in %s since %s, to %s.\n\n' "$(basename "$PWD")" "$(date +%F)" "$F"
    printf 'What the kit should do: %s\n\n' "$WHAT"
    printf 'The change, as a diff against the installed kit version:\n\n~~~diff\n'
    cat "$WORK/diffs/$S.diff"
    printf '~~~\n'
  } > "$WORK/issue-$S.md"
  cat "$WORK/issue-$S.md"
  echo "body saved: $WORK/issue-$S.md   nothing was sent"
else
  echo "STOP: no saved diff for $F. Run step 2 for it first."
fi
```

Read the body. Then send it with the block below: on the first line the kit file again, on the
second the issue's title. It stops without creating anything if an issue with that exact title
already exists:

```bash
F=.claude/skills/verify-ui/SKILL.md
TITLE='verify-ui: write the case list before walking the UI'
H=$(pwd -P | cksum | cut -d' ' -f1)
WORK="${TMPDIR:-/tmp}/ae-kit-adjust-$H"
S=$(printf '%s' "$F" | tr '/' '_' | sed 's/^[.]//')
SAME=$(gh issue list -R agantoniolar-lgtm/ae-setup --state all --limit 300 --search "$TITLE in:title" --json number,title --template '{{range .}}{{.number}}{{"\t"}}{{.title}}{{"\n"}}{{end}}' | awk -F'\t' -v t="$TITLE" '$2 == t { print $1 }')
if [ -n "$SAME" ]; then
  echo "STOP: ae-setup already has an issue with that title: ae-setup$(printf '\043')$SAME. Use it, or change the title."
elif [ -f "$WORK/issue-$S.md" ]; then
  gh issue create -R agantoniolar-lgtm/ae-setup --title "$TITLE" --body-file "$WORK/issue-$S.md"
else
  echo "STOP: no body built for $F. Run the block above first."
fi
```

It prints the issue's URL; its number is the `N` of `ae-setup#N`, which is how the row writes it.
A bare `#N` is rejected: it doesn't say which repo.

## 4. Write the row

In `CLAUDE.md`, under the heading `## Local kit adjustments` (a project set up from a recent kit
already has it; if not, add the heading and the table header below). One row per fix, five
columns:

| Column | What goes in it |
|---|---|
| What it modifies | The kit file, folder, skill name or script name the fix changes: `code-review`, `.claude/skills/verify-ui/SKILL.md`. It must be a kit file the install put there. |
| How it is applied | Free text. For a prose fix, the rule itself, complete. For a local file, when to use it instead of the kit's. |
| Local files | Only the adjustment's local files, in backticks. A dash (`—`) for a prose fix. |
| Issue | `ae-setup#N` from step 3. |
| Date | `YYYY-MM-DD`, the day the fix was first made in the project (from git history, or today). |

One row of each kind:

```markdown
## Local kit adjustments

| What it modifies | How it is applied | Local files | Issue | Date |
|---|---|---|---|---|
| `code-review` | At most 3 review rounds per unit. A round with no BLOCKING finding closes the unit: record its FLAGs and move on. If round 3 still returns a BLOCKING finding, stop and take it to the project owner. | — | ae-setup#12 | 2026-09-27 |
| `verify-ui` | Use the `verify-ui-local` skill instead of `verify-ui`: it writes the case list before walking, and splits regressions from pre-existing findings. | `.claude/skills/verify-ui-local/SKILL.md` | ae-setup#13 | 2026-09-24 |
```

## 5. Declare each local file in `.ae-kit-local`

Skip this step for a prose fix. For each file in "Local files", run the block below with the local
file on the first line and, on the second, what it fixes. It adds one line to `.ae-kit-local`
(creating it if needed) whose reason starts with `adjustment:`, and does not add it twice:

```bash
L=.claude/skills/verify-ui-local/SKILL.md
R='replaces verify-ui until the kit ships it, see the row in CLAUDE.md'
touch .ae-kit-local
if [ -s .ae-kit-local ] && [ -n "$(tail -c1 .ae-kit-local)" ]; then printf '\n' >> .ae-kit-local; fi
if awk -v l="$L" '$1 == l { f = 1 } END { exit f ? 0 : 1 }' .ae-kit-local; then
  echo "already declared: $L"; grep -F "$L" .ae-kit-local
else
  printf '%s -- adjustment: %s\n' "$L" "$R" >> .ae-kit-local
  echo "declared:"; tail -1 .ae-kit-local
fi
```

Other lines in `.ae-kit-local` — the project's own skills — stay as they are, without the prefix.

## 6. Put the kit file back to its installed version

On the first line, the kit file. Before restoring, the block checks three things, and restores
nothing if any fails: that a table row in `CLAUDE.md` names the file in backticks (by its path,
or by its skill or script name, as "What it modifies" writes it), that every local file declared
with `adjustment:` in `.ae-kit-local` exists, and that the kit copy from step 1 is there. If the
file is listed in an old `.ae-kit-customized`, it removes that line too, and deletes the list once
it names no file (comment lines don't count):

```bash
F=.claude/skills/verify-ui/SKILL.md
H=$(pwd -P | cksum | cut -d' ' -f1)
WORK="${TMPDIR:-/tmp}/ae-kit-adjust-$H"; KIT="$WORK/kit"
K="$KIT/$(printf '%s' "$F" | sed 's|^ae-kit-templates/|templates/|')"
BT='`'
C2=$(printf '%s' "$F" | sed -n 's|^\.claude/skills/\([^/]*\)/.*|\1|p')
C3=$(basename "$F")
C4=$(printf '%s' "$C3" | sed 's|\.[^.]*$||')
[ -n "$C2" ] || C2="$F"
case "$F" in .claude/skills/*) C3="$C2"; C4="$C2" ;; esac
ROW=$(grep -n '^ *|' CLAUDE.md | grep -F -e "$BT$F$BT" -e "$BT$C2$BT" -e "$BT$C3$BT" -e "$BT$C4$BT" | head -1 | cut -d: -f1)
bad=0
if [ -z "$ROW" ]; then echo "STOP: no row in CLAUDE.md names $F (step 4)."; bad=1; fi
touch .ae-kit-local
grep 'adjustment:' .ae-kit-local | grep '^[[:space:]]*[[:alnum:]._/]' | awk '{ print $1 }' | sed 's|^\./||' > "$WORK/declared.txt"
while read -r p; do if [ -e "$p" ]; then :; else echo "STOP: $p is declared as an adjustment but does not exist (step 2)."; bad=1; fi; done < "$WORK/declared.txt"
if [ -f "$K" ]; then :; else echo "STOP: no installed version of $F in $KIT (run step 1)."; bad=1; fi
if [ "$bad" -eq 0 ]; then cp "$K" "$F" && echo "restored $F to the installed kit version (row at CLAUDE.md line $ROW)"; else echo "NOTHING WAS RESTORED."; fi
if [ "$bad" -eq 0 ] && [ -f .ae-kit-customized ] && grep -qE "^[[:space:]]*${F}([[:space:]]|\$)" .ae-kit-customized; then grep -vE "^[[:space:]]*${F}([[:space:]]|\$)" .ae-kit-customized > "$WORK/customized.tmp"; cp "$WORK/customized.tmp" .ae-kit-customized; echo "removed $F from .ae-kit-customized"; fi
if [ "$bad" -eq 0 ] && [ -f .ae-kit-customized ] && ! grep -qvE '^[[:space:]]*(#|$)' .ae-kit-customized; then rm .ae-kit-customized; echo "deleted .ae-kit-customized: no file is listed in it any more"; fi
```

Then run the step-1 comparison block again: its last line must say `0 edited`. (It empties the
work folder; the spare copies in the backup folder stay.) Commit the row, `.ae-kit-local`,
`.ae-kit-customized` if it changed or was deleted, the local files and the restored kit file
together, so no commit holds the fix in neither place.

## 7. Install the new kit version

Install as usual, with one exception. **A project with no `.ae-kit-manifest` whose `.ae-kit-version`
names a version older than 0.40.1** puts the variable on the installer's own command, so the
installer finds its base version in `angee-private`'s history:
`… | AE_KIT_REPO=agantoniolar-lgtm/angee-private bash -s -- <path>`. Written before `gh` instead, it
reaches `gh` and not the installer. Every other project installs as usual, without it. The installer
replaces every kit file that differs from the new version and lists them. After step 6 none of them holds a fix of yours, so its "EDITED IN THE PROJECT" list
should be empty.

**If it names a file, that file still held an edit**, and the install replaced it. Recover it like
this, in order — the fix comes back from git, and the kit file ends at the **new** version:

1. Commit the install as it is (with `.ae-kit-manifest`), so `HEAD` holds the new kit.
2. Put the edited content back where it was, with the command the report printed:
   `git show <sha>:<path> > <path>`.
3. Run the step-1 block with its `V=` line changed to `V=<previous version>`, the version the
   report printed as "previous version". That fetches the kit the edit was made on. Ignore its
   `EDITED` list this time: the other files already carry the new kit, so they differ from it.
4. Run steps 2 to 5 for that file, as written.
5. **Do not run step 6.** Its copy would put the *previous* kit version back. Instead, run
   `git restore -- <path>`: it puts back the new version the install committed in 1.
6. Commit the row, `.ae-kit-local` and the local files, then go to step 8.

- **It refuses, writing nothing (exit 4)**, when it cannot be sure git could bring back what it
  replaces. Usually a kit file it would change has uncommitted changes: commit step 6 first, or
  stash what is not yours to commit, and install again. Otherwise its message names the cause.
- **A file the kit no longer ships is removed** if it is unchanged since it was installed, and
  left, reported once, if the project changed it. If a row of "Local kit adjustments" names a
  removed file, the report says so: delete the row, or point it at what replaced the file.
- **It stops, writing nothing (exit 5)**, when the release notes of a version between the
  installed one and the new one ask for steps under "Before installing". It printed them: do
  each, asking the owner before any step that writes, moves or deletes anything in the project
  other than the kit files the installer replaces — for example `CLAUDE.md`, `STATUS.md`,
  `.gitignore`, `.gitattributes`, `settings.json`, a hook, `.ae-kit-excluded`, or a `git stash`
  or reset of the owner's work — or that acts outside the repo — a push, an issue, a call to an
  API, a secret — and before building or committing. Then run it again with
  `--notes-done <new version>`, the exact x.y.z its message names. One flag confirms every
  "Before installing" step it printed: never pass it while one is left. Those steps include this
  guide's steps 1 to 6: if you already did them, they count as done.
- **Exit 3** means the install is incomplete: a line to paste in `.claude/settings.json` or
  `.gitattributes`, a kit file it could not write, a dropped file it could not remove, or a
  `.ae-kit-manifest` it could not write. It says which.

**Commit what it wrote**, `.ae-kit-manifest` included, before step 8.

## 8. Run the checker until it exits 0

```bash
node scripts/check-local-adjustments.mjs; echo "exit $?"
```

- **0** — every kit file matches the footprint and every row is complete. Done.
- **1** — it names what is wrong and how to fix each one; fix it and run it again. If it says
  "STAGED version differs" right after installing, the install isn't committed yet: commit it
  (step 7) and run it again — `git restore --staged` does not fix that.
- **3** — no footprint, so kit files weren't compared: the install in step 7 did not write
  `.ae-kit-manifest` (its report says why — no SHA-256 tool on the machine, or the file could not
  be written), or it was deleted since. Fix that and install again.

If the project's pre-commit doesn't run the checker yet, add this line to it, as
`ae-kit-templates/SETUP_CHECKLIST.md.template` describes, so the next edit to a kit file is
stopped at the commit instead of at the next install. Exit 3 warns without blocking:

```bash
node scripts/check-local-adjustments.mjs || [ $? -eq 3 ]
```

When the kit ships the fix, delete the row, its local files and their `.ae-kit-local` lines in
the same commit as the install that brings it.
