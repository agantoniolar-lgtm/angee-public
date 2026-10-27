#!/usr/bin/env bash
# ae-kit installer — installs the kit into any project, ALWAYS from the remote.
#
# USAGE
#   From anywhere, with the GitHub CLI authenticated (works with a private repo):
#
#     gh api repos/agantoniolar-lgtm/angee-public/contents/install.sh \
#       -H "Accept: application/vnd.github.raw" | bash -s -- /path/to/project
#
#   Running this file from a local checkout does the SAME thing: it clones the remote.
#   It does not install what you have on disk — see "ONE SOURCE" below.
#
#   Options:
#     --ref <branch|tag>     which version of the kit to install (default: main).
#                            A commit sha is NOT accepted: this is passed to git clone's
#                            --branch, which takes a branch or a tag and nothing else.
#     --dry-run              reports what would change — written, replaced, refused —
#                            and writes nothing
#     --from <path>          installs from a kit on disk instead of the remote. It
#                            exists ONLY so the kit's own suites can test the installer
#                            without depending on the network. Not for a real project
#     --notes-done <version> the steps under "Before installing" of the release notes up
#                            to <version> are done: install. An exact x.y.z, and only the
#                            version being installed confirms them (see RELEASE NOTES)
#
# WHAT IT INSTALLS
#   .claude/skills/, .claude/agents/, templates/ (as ae-kit-templates/), scripts/, a
#   .ae-kit-version marker recording the version that project is running, and — on every
#   install that gets through copying the kit files — .ae-kit-manifest, the SHA-256 and path
#   of every kit file it left on disk.
#   The kit's own suites (scripts/test-*.sh) do NOT travel: they test the kit on itself.
#   A project can declare in .ae-kit-excluded which pieces it doesn't use, with a reason —
#   including .ae-kit-version itself, which then isn't stamped (the repo that produces the
#   kit does this, since there its own VERSION is already the truth).
#
#   It also writes into TWO files that are the project's, not the kit's, one declaration
#   each: the `SubagentStop` hook in .claude/settings.json, which is what makes the
#   subagent collector run, and the line `logs/tasks/*.md merge=union` appended to
#   .gitattributes, which lets two branches that both appended to a task log merge. Either
#   one conflicting with what the project already declares is reported with the exact text
#   to paste, and left alone: those two files are the project's. The collector shipped in 0.35.0 with nobody calling it, so the first
#   project that installed it kept losing every subagent transcript exactly as before.
#   Declaring the collector in .ae-kit-excluded means there is no hook to write either.
#
# KIT FILES ARE OVERWRITTEN (T127) — a kit file is the kit's, not the project's: a project
# does not edit one, it declares a fix in "Local kit adjustments" of its CLAUDE.md. So a kit
# file that differs from the new version is REPLACED, with no question asked. The report
# lists every replaced file, and lists apart the ones that also differed from the previous
# .ae-kit-manifest — those had been edited in the project — each with the git command that
# brings its previous content back. That command names the commit that was HEAD before this
# install, so it still works after the install is committed. Without a previous manifest
# there is no way to tell an edit from an old version, and every replaced file is listed as
# such.
#   The one refusal: a kit file this install would change that has UNCOMMITTED changes, in
# the index or on disk, or is not tracked by git at all. git cannot bring that content back,
# so the install refuses BEFORE writing anything — not a kit file, not settings.json, not
# .gitattributes — names the files, and exits 4. A file already identical to the new version
# is not changing, and does not count.
#
# FILES THE KIT DROPPED ARE RETIRED (D022) — a file the previous install left (per the
# previous .ae-kit-manifest; without one, per the kit as published at the version
# .ae-kit-version names, D030) that the new kit no longer ships is removed if it is unchanged,
# and left in place, reported once, if the project changed it. Nothing outside the four kit
# folders, nothing declared in .ae-kit-excluded or .ae-kit-local, and no folder of the four
# is ever removed. With no base at all, nothing is removed, and the report says so.
#
#   Only the paths the kit ships are written: a project file in scripts/ at a path the kit
# does not ship is never touched, nor is anything outside the four kit folders — except
# .ae-kit-manifest, .ae-kit-version and the two project files described above. This
# installer reads .ae-kit-local only to decide what it does not retire: a project file at
# the very path a kit file comes to occupy is still overwritten like any kit file (an
# accepted risk, D029).
#   A kit file whose place is taken by a folder is not written into it: it is reported as a
# folder in the way, and the install ends incomplete.
#   A kit file that is a symbolic link, or sits under one, is not written through: it is
# reported, and the install ends incomplete.
#
# EXIT CODES — 0 installed; 1 a fatal error (no kit, no target, a malformed release-notes
# file); 2 a malformed argument; 3 incomplete (a project file needs a manual line, or a kit
# file could not be written); 4 refused, nothing written (a kit file it would change has
# uncommitted changes, or the project is under git and git could not be asked); 5 stopped by
# the release notes, nothing written (a version in the range asks for steps "Before
# installing", and --notes-done did not name the version being installed).
#
# RELEASE NOTES (T070) — every kit version from 0.37.0 ships release-notes/<version>.md: its
# title "# Kit <version>", a "## Before installing" and a "## After installing" section, and
# nothing else (CI checks that shape; the installer prints the file whole). A section with
# nothing to do is left empty, blank lines only (D059). Before writing anything, the
# installer prints the notes of every version above the one .ae-kit-version names and up to
# the one being installed, in numeric order. If any "Before installing" holds a non-blank
# line, whatever it says, it stops with exit 5 and says how to go on: do those steps, then
# run again with --notes-done <version>.
# "After installing" is printed again at the end of every install that gets through the copy:
# one that completes, and one that ends incomplete (exit 3), saying it has not finished.
#   No notes at all: reinstalling the same version, going back to an older one (D055), and
# the repo that produces the kit. A project with kit files (or a .ae-kit-manifest) but no
# readable .ae-kit-version sees every note up to the new version and can be stopped (D054);
# one with neither is a new install, sees only the new version's note, and is never stopped.
# A kit VERSION that is not x.y.z shows every note and stops if any has steps, until
# --notes-done names exactly that VERSION. A project with no marker whose .ae-kit-manifest was
# written by the version being installed is a new install that did not finish: not stopped.
#
#   .claude/settings.json is held to a stricter version of the same promise, because it is
#   yours: it is only written when it does not exist, or when it exists and declares no
#   SubagentStop hook at all AND writing it back unchanged reproduces it byte for byte. A
#   hook of your own, a file that doesn't parse, or a formatting style this can't reproduce
#   is a conflict with the exact block to paste, and the file is left alone.
#   settings.local.json is never read and never written: it is gitignored, so anything
#   declared there runs for one person and for nobody else.
#
# ONE SOURCE (0.24.0) — before the kit lived on GitHub, distribution went through a flat
# bundle with checksums, because the repo wasn't reachable from wherever you happened to
# work. Git solves that better: integrity, versions and history come for free. The bundle
# was retired completely, and with it the preference for a local checkout: installing from
# disk handed a project a version of the kit that had never been pushed.
# Consequence: a kit change must be pushed before it can be installed anywhere.
# Requires network and an authenticated `gh` (or an SSH key with access); no offline path.

set -uo pipefail

# The kit is distributed from `angee-public`, not from `ae-setup`. `ae-setup` is the workshop —
# it holds the working journal, the tasks and the scope docs — and `angee-public` is the
# artifact: only the kit, published by CI on every VERSION bump, with no development history.
# Its history starts at 0.40.1; `angee-private` holds every earlier `kit X.Y.Z` commit, and a
# project installed before 0.40.1 with no `.ae-kit-manifest` sets AE_KIT_REPO to it once.
# Note the path mapping that implies: in `ae-setup` the kit lives under `kit/`; in the
# artifact repos it lives at the ROOT. That's why the layout is detected below instead of assumed.
REPO_DEFAULT="agantoniolar-lgtm/angee-public"
REPO="${AE_KIT_REPO:-$REPO_DEFAULT}"
REF="main"
DRY_RUN=0
TARGET=""
# FROM is initialized like the rest. Without this, a `FROM` exported in the caller's
# environment selected the install-from-disk branch with nobody passing the flag — exactly
# the outcome this change exists to prevent.
FROM=""
# --notes-done <x.y.z>: the version whose "Before installing" steps the project says are done.
NOTES_DONE=""
# The exit code of a stop over the release notes. Not 1-4: each of those already means
# something else, and a session reading the code has to tell "do the steps" from the rest.
NOTES_EXIT=5

# 0 for an exact x.y.z, the only shape a version takes here.
is_semver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

while [ $# -gt 0 ]; do
  case "$1" in
    # `shift 2` with only one argument left FAILS under `set -u` without `-e`, so $# never
    # dropped, $1 stayed "--ref", and the loop spun forever with zero output. A malformed
    # argument that hangs silently is strictly worse than the one that was ignored
    # silently — and it survived in the branch next to the fix for that very bug.
    --ref)
      [ $# -ge 2 ] || { echo "✗ --ref requires a value" >&2; exit 2; }
      REF="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    # --force is gone (T127): the installer always overwrites kit files, so there is nothing
    # left for it to force. It stops rather than being ignored: a flag accepted in silence
    # is the bug the catch-all below was written to end, and whoever passes it expects a
    # different installer from this one.
    --force)
      echo "✗ --force no longer exists: the installer always overwrites kit files, and" >&2
      echo "  refuses only when one it would change has uncommitted changes. Run again without it." >&2
      exit 2 ;;
    # --from <path>: installs from a kit on disk instead of the remote. It exists ONLY so
    # the kit's suites can test the installer without depending on the network or on the
    # state of `main`. Don't use it to install into a real project: it would deliver code
    # that isn't on the remote, which is exactly what this installer stopped doing in 0.24.0.
    --from)
      [ $# -ge 2 ] || { echo "✗ --from requires a path" >&2; exit 2; }
      FROM="$2"; shift 2 ;;
    # The value has to be an exact version. Anything else — an option in its place
    # (--notes-done --dry-run), 0.38, v0.38.0 — stops with exit 2: taken loosely, the next
    # option would be swallowed, and a --dry-run lost that way installs for real (R-2, R-12).
    # One exception (T070 U6): a kit whose VERSION is not x.y.z (0.38.0-rc1 through --ref)
    # is confirmed by exactly that text. The kit is not known yet here, so a value that is
    # not x.y.z is only screened (no leading "-", no spaces) and checked against the kit's
    # VERSION once it is read, still before anything is written.
    --notes-done)
      [ $# -ge 2 ] || { echo "✗ --notes-done requires a version (x.y.z)" >&2; exit 2; }
      if ! is_semver "$2" && [[ ! "$2" =~ ^[0-9A-Za-z][0-9A-Za-z.+_-]*$ ]]; then
        echo "✗ --notes-done takes an exact version, x.y.z: got '$2'" >&2; exit 2
      fi
      NOTES_DONE="$2"; shift 2 ;;
    # The text is embedded, not read from "$0". Reading it from the file only worked when
    # executed by path: through a pipe — the only route the docs now offer — "$0" is
    # `bash`, so --help printed "sed: bash: No such file or directory" and exited 0.
    -h|--help)
      cat <<'HELP'
ae-kit installer — installs the kit into any project, ALWAYS from the remote.

  gh api repos/agantoniolar-lgtm/angee-public/contents/install.sh \
    -H "Accept: application/vnd.github.raw" | bash -s -- /path/to/project

Options:
  --ref <branch|tag>      which version to install (default: main). Not a commit sha:
                          git clone --branch does not take one, and the run fails outright
  --dry-run               reports what would change — written, replaced, refused —
                          and writes nothing
  --from <path>           installs from a kit on disk. ONLY for the kit's own
                          suites; in a real project it would deliver unpushed code
  --notes-done <x.y.z>    the "Before installing" steps of the release notes are done.
                          Only the version being installed confirms them; a kit whose
                          VERSION is not x.y.z is confirmed by exactly that text

Installs .claude/skills/, .claude/agents/, ae-kit-templates/, scripts/ and the
.ae-kit-version marker, and .ae-kit-manifest, the hash of every kit file installed, so
the project can tell when one is edited. The kit's suites (scripts/test-*.sh) don't travel. A project can
declare in .ae-kit-excluded which pieces it doesn't use, with a reason per line. Declaring .ae-kit-version in .ae-kit-excluded
stops it being stamped — only meaningful where the kit and the project are the same repo.

Two files of yours get one declaration each, and nothing else in them changes: the
SubagentStop hook in .claude/settings.json, and the line `logs/tasks/*.md merge=union`
appended to .gitattributes. If either one conflicts with what you already declare, it is
reported with the exact text to paste. Declaring the file in .ae-kit-excluded skips it.

Kit files are OVERWRITTEN: one that differs from the new version is replaced. The report
lists them, and apart the ones the project had edited (they differed from the previous
.ae-kit-manifest), with the git command that brings each one back. It refuses, writing
nothing, only when a kit file it would change has uncommitted changes or is untracked:
commit or stash them first. A file the kit no longer ships is removed if it is unchanged
since it was installed, and left, reported once, if the project changed it; without a
manifest, "unchanged" means equal to the published version .ae-kit-version names.
A file declared in .ae-kit-local is never removed. Only the paths the kit ships are
written, and .ae-kit-local does not stop that: a file of yours at the same path as a kit
file is overwritten.

Before writing anything, it prints the release notes of every version between the one
installed and the new one. If any asks for steps "Before installing", it stops, writing
nothing: do them, then run again with --notes-done <new version>. "After installing" is
printed again at the end. A section with nothing to do is empty; any line in it is a step.

Exit codes: 0 installed · 1 fatal error · 2 bad argument · 3 incomplete (a manual line,
or a file that could not be written) · 4 refused, nothing written · 5 stopped by the
release notes, nothing written.
Requires network and an authenticated `gh` (or SSH key with access); no offline path.
HELP
      exit 0 ;;
    # An unrecognized flag ABORTS. It used to fall through to the catch-all below and be
    # swallowed as a target path, so `install.sh --force .` (back when --force existed)
    # silently ran without forcing anything — while this script's own conflict message, the README and setup/SKILL.md
    # all told you to rerun with --force. A promised flag that was never implemented, and
    # an argument discarded without a word: the same shape as the migrator bug found the
    # day before, in the kit that exists to eliminate exactly this.
    -*) echo "✗ Unrecognized option: $1" >&2; exit 2 ;;
    *) TARGET="$1"; shift ;;
  esac
done

die() { echo "✗ $1" >&2; exit 1; }

[ -n "$TARGET" ] || die "Missing target. Usage: install.sh <path-to-project> [--ref <ref>] [--dry-run] [--notes-done <x.y.z>]"
[ -d "$TARGET" ] || die "Not a directory: $TARGET"
TARGET="$(cd "$TARGET" && pwd)"

# ------------------------------------------------ exclusions declared by the project
# `.ae-kit-excluded` says which kit pieces are NOT used in this project, with a reason.
# The installer has to read it or the file is worthless: without this, every reinstall
# revives what was excluded and the checker (check-installed-copy.mjs) sits red asking you
# to delete the same things, every time, forever. A deliberate absence that only the
# checker respects isn't a state — it's a recurring manual chore.
# Found by independent review, reproduced against this installer.
EXCLUDED_FILE="$TARGET/.ae-kit-excluded"
excluded_paths=(); excluded_reasons=(); excluded_malformed=0
if [ -f "$EXCLUDED_FILE" ]; then
  while IFS= read -r raw || [ -n "$raw" ]; do
    line="${raw#"${raw%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    # Path + separator + reason. The reason is mandatory: without it nothing is skipped,
    # because skipping a file over a line nobody can read is worse than installing it.
    #
    # These rules are THE SAME as check-installed-copy.mjs's, deliberately and word for
    # word: separator = the FIRST occurrence of `#`, `—` or `--`; path before, reason after,
    # both trimmed; a path with spaces is malformed; a leading `./` is normalized. If the
    # two parsers disagree on a line, the installer installs what the checker demands you
    # delete, and the red loop returns — silently, because neither one mentions the line's
    # format. `test-installed-copy.sh` runs a matrix requiring both to agree; if you touch
    # either one, that test is what catches it.
    sep_line="$(printf '%s' "$line" | sed -E 's/(#|—|--)/@@AEKITSEP@@/')"
    if [ "$sep_line" = "$line" ]; then
      excluded_malformed=$((excluded_malformed + 1)); continue
    fi
    p="${sep_line%%@@AEKITSEP@@*}"
    r="${sep_line#*@@AEKITSEP@@}"
    p="${p#"${p%%[![:space:]]*}"}"; p="${p%"${p##*[![:space:]]}"}"   # trim
    r="${r#"${r%%[![:space:]]*}"}"; r="${r%"${r##*[![:space:]]}"}"
    p="${p#./}"
    case "$p" in
      ''|*[[:space:]]*) excluded_malformed=$((excluded_malformed + 1)); continue ;;
    esac
    if [ -z "$r" ]; then
      excluded_malformed=$((excluded_malformed + 1)); continue
    fi
    excluded_paths+=("$p"); excluded_reasons+=("$r")
  done < "$EXCLUDED_FILE"
fi

# Prints the reason and returns 0 if the path (relative to the project) is declared out.
is_excluded() {
  local rel="$1" i=0 p
  while [ "$i" -lt "${#excluded_paths[@]}" ]; do
    p="${excluded_paths[$i]}"
    case "$p" in
      */) case "$rel" in "$p"*) printf '%s' "${excluded_reasons[$i]}"; return 0 ;; esac ;;
      *)  [ "$rel" = "$p" ] && { printf '%s' "${excluded_reasons[$i]}"; return 0; } ;;
    esac
    i=$((i + 1))
  done
  return 1
}

# Prints the declared path (file or folder) that excludes this one.
excluded_match() {
  local rel="$1" i=0 p
  while [ "$i" -lt "${#excluded_paths[@]}" ]; do
    p="${excluded_paths[$i]}"
    case "$p" in
      */) case "$rel" in "$p"*) printf '%s' "$p"; return 0 ;; esac ;;
      *)  [ "$rel" = "$p" ] && { printf '%s' "$p"; return 0; } ;;
    esac
    i=$((i + 1))
  done
  return 1
}

# The task log's pieces cannot be declared out (T054). The skills write every step of the
# work through them, and they only add files: a project without them has skills that fail
# at the moment they try to record something. So a declaration is ignored for these, the
# piece is installed, and the summary says so. check-installed-copy.mjs holds the same list
# and treats them the same way, or the two would disagree about what should be present.
is_required() {
  case "$1" in
    scripts/task-log.mjs|scripts/task-log-append.mjs|scripts/check-task-log.mjs|\
    scripts/generate-task-log-view.mjs|ae-kit-templates/task-log-ontology.md) return 0 ;;
  esac
  return 1
}

# ------------------------------------------------------------------ hashing and git
# Both are needed BEFORE the copy now: the hash to tell an edited kit file from one that is
# only out of date, git to know whether what is about to be replaced can be brought back.
HASH_TOOL=""
if command -v sha256sum >/dev/null 2>&1; then HASH_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then HASH_TOOL="shasum"
fi

# Prints the SHA-256 of a file's bytes as 64 lowercase hex characters, or fails.
sha256_of() {
  local h
  case "$HASH_TOOL" in
    sha256sum) h="$(sha256sum < "$1" 2>/dev/null)" || return 1 ;;
    shasum)    h="$(shasum -a 256 < "$1" 2>/dev/null)" || return 1 ;;
    *) return 1 ;;
  esac
  h="${h%% *}"
  [[ "$h" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$h"
}

# Whether the target lives in a git work tree, and where in it. A project outside git still
# installs (D029): it simply has no way back for what gets replaced, and the report says so.
# GIT_PREFIX is the target's path inside the repo ("" at its root, "app/" in a monorepo
# folder): `git status` and `git show` speak in paths from the repo's top.
IN_GIT=0; GIT_PREFIX=""; HEAD_SHA=""; HEAD_SHORT=""
if command -v git >/dev/null 2>&1 \
   && [ "$(git -C "$TARGET" rev-parse --is-inside-work-tree 2>/dev/null)" = "true" ]; then
  IN_GIT=1
  GIT_PREFIX="$(git -C "$TARGET" rev-parse --show-prefix 2>/dev/null)"
  HEAD_SHA="$(git -C "$TARGET" rev-parse --verify -q HEAD 2>/dev/null)"
  [ -n "$HEAD_SHA" ] && HEAD_SHORT="$(git -C "$TARGET" rev-parse --short=12 HEAD 2>/dev/null)"
fi

# "Not in git" has to mean there IS no repository, not that git failed to read one. A
# worktree whose main repository moved, a repository git refuses over its owner ("dubious
# ownership": sudo, a mounted volume, WSL), or a GIT_DIR / GIT_WORK_TREE inherited from the
# environment all make the question above fail on a project that is under git — and taking
# that as "no git" would replace uncommitted edits without the refusal ever running. Same
# rule as when `git status` fails below: unable to ask means unable to promise. So the
# install refuses when git could not answer but a .git (file or folder) sits in the target
# or any folder above it, and whenever those two variables come from the environment, which
# point git somewhere other than the target. A project with no .git anywhere installs (D029).
git_unreadable=""
if [ -n "${GIT_DIR:-}" ] || [ -n "${GIT_WORK_TREE:-}" ]; then
  git_unreadable="GIT_DIR or GIT_WORK_TREE is set in the environment, so git would answer about another repository, not about this project. Run the installer without them"
elif [ "$IN_GIT" -eq 0 ]; then
  d="$TARGET"
  while :; do
    if [ -e "$d/.git" ]; then
      if command -v git >/dev/null 2>&1; then
        why_git="$(git -C "$TARGET" rev-parse --is-inside-work-tree 2>&1 | head -1)"
        git_unreadable="$d/.git exists, but git could not read the repository (${why_git:-no answer}) — a worktree whose main repository moved, or one git refuses over its owner (see git's safe.directory)"
      else
        git_unreadable="$d/.git exists, but git is not installed on this machine"
      fi
      break
    fi
    [ "$d" = "/" ] && break
    d="$(dirname "$d")"
  done
fi
if [ -n "$git_unreadable" ]; then
  echo "✗ Install REFUSED. Nothing was written." >&2
  echo "  $git_unreadable." >&2
  echo "  Without git's answer there is no telling whether replacing kit files would lose" >&2
  echo "  uncommitted work. Fix that, then run the installer again." >&2
  exit 4
fi

# ------------------------------------------------------------ the previous manifest
# What the last install left, which is what tells "edited in the project" apart from "only
# changed in the kit". It is read from the COMMITTED version (HEAD), never from the disk
# (R-7): a manifest written by an install nobody committed, or edited by hand, does not
# describe what the project agreed to. Outside git, the disk is all there is.
# A manifest with a malformed line is treated as absent, and the report says so (B-3):
# trusting half of a broken file would call an edit "untouched", and refusing to install
# over it would leave the project stuck on a file nobody reads by hand.
# A well-formed line whose path is absolute, has a `.` or `..` segment, or lies outside the
# four kit folders is SUSPICIOUS (C-8, R-5): it is dropped from the base, so nothing at that
# path is ever removed, and the report names it. Nothing the installer writes looks like it.
MANIFEST_REL=".ae-kit-manifest"
MANIFEST="$TARGET/$MANIFEST_REL"
suspicious_list=""
# 0 if a path is one the installer could have put there: relative, plain segments, inside
# one of the four kit folders. The only paths a removal may ever touch.
is_kit_path() {
  case "/$1/" in //*|*/../*|*/./*|*//*) return 1 ;; esac
  case "$1" in .claude/skills/?*|.claude/agents/?*|ae-kit-templates/?*|scripts/?*) return 0 ;; esac
  return 1
}
prev_manifest=""
prev_manifest_state="none"   # none | ok | broken | uncommitted | excluded | unhashable
if is_excluded "$MANIFEST_REL" >/dev/null; then
  prev_manifest_state="excluded"
else
  prev_raw=""; prev_found=0
  if [ "$IN_GIT" -eq 1 ]; then
    if [ -n "$HEAD_SHA" ] && prev_raw="$(git -C "$TARGET" show "$HEAD_SHA:${GIT_PREFIX}$MANIFEST_REL" 2>/dev/null)"; then
      prev_found=1
    elif [ -f "$MANIFEST" ]; then
      prev_manifest_state="uncommitted"
    fi
  elif [ -f "$MANIFEST" ]; then
    prev_raw="$(cat "$MANIFEST")"; prev_found=1
  fi
  if [ "$prev_found" -eq 1 ]; then
    prev_manifest_state="ok"
    while IFS= read -r ml || [ -n "$ml" ]; do
      case "$ml" in ''|\#*) continue ;; esac
      if [[ ! "$ml" =~ ^[0-9a-f]{64}\ \ [^\ ].*$ ]]; then prev_manifest_state="broken"; break; fi
      mp="${ml:66}"
      if ! is_kit_path "$mp"; then
        suspicious_list="${suspicious_list}  ${mp}"$'\n'
        continue
      fi
      prev_manifest="${prev_manifest}${ml}"$'\n'
    done <<< "$prev_raw"
    [ "$prev_manifest_state" = "ok" ] || { prev_manifest=""; suspicious_list=""; }
  fi
  # Without a hash tool nothing on disk can be compared against it.
  [ "$prev_manifest_state" = "ok" ] && [ -z "$HASH_TOOL" ] && prev_manifest_state="unhashable"
fi

# Prints the hash the previous manifest recorded for a path, or nothing.
prev_hash_of() {
  printf '%s' "$prev_manifest" | awk -v p="$1" 'substr($0, 67) == p { print substr($0, 1, 64); exit }'
}

# ----------------------------------------------------------------- version direction
# R-13: --ref can name a version OLDER than the one installed. That is allowed — it is how
# a bad release is rolled back — but every kit file then goes back to its older bytes, and
# that has to be said before anyone reads the list of replaced files as an upgrade.
PREVIOUS=""
# A marker saved with CRLF line ends (an editor on Windows, a checkout with autocrlf) keeps
# its "\r": stripped, or the version would never read as x.y.z (T070 U6).
[ -f "$TARGET/.ae-kit-version" ] && PREVIOUS="$(head -1 "$TARGET/.ae-kit-version" | tr -d '\r')"
PREVIOUS_VERSION="${PREVIOUS%% *}"

# D030: without a usable manifest, the base is the published version the marker names. That
# needs the kit's history, so the clone below is a full one only in that case — known here,
# before anything is fetched.
need_base=0
case "$prev_manifest_state" in
  none|broken|uncommitted) [ -n "$PREVIOUS_VERSION" ] && [ -n "$HASH_TOOL" ] && need_base=1 ;;
esac
DEPTH_ARGS="--depth 1"
[ "$need_base" -eq 1 ] && DEPTH_ARGS=""
# ---------------------------------------------------------------- source of the kit
# THE REMOTE IS THE ONLY SOURCE. Until 0.23.0 this script preferred a local checkout when
# it found one, and did so silently. That allowed installing into a project a version of
# the kit that lived only on someone's disk — it's the equivalent of shipping a feature
# that isn't merged into the remote main but does exist on a local branch. The artifact
# repo publishes only what was pushed, so what isn't on the remote must not reach a project.
#
# Accepted consequence: to install a kit change you must push it first. That applies to the
# repo producing the kit installing onto itself too, and there it's an improvement — it
# guarantees the workshop runs exactly what it distributes, not something ahead of it.
#
# `--from` is the only exception: explicit, noisy, and for the kit's own tests.
CLEANUP_DIR=""
BASE_TMP=""
trap 'rm -rf "$CLEANUP_DIR" "$BASE_TMP"' EXIT

if [ -n "${FROM:-}" ]; then
  [ -d "$FROM/.claude/skills" ] || die "--from $FROM no parece un kit (falta .claude/skills)"
  KIT_DIR="$(cd "$FROM" && pwd)"
  SOURCE_DESC="an explicit local path ($KIT_DIR)"
  echo "⚠ --from: installing from disk, NOT from the remote."
  echo "  This can deliver unpushed content. It is for testing the kit."
  echo
else
  command -v git >/dev/null 2>&1 || die "git is required to fetch the kit."
  CLEANUP_DIR="$(mktemp -d)"
  echo "→ Fetching kit ($REPO@$REF)…"
  # The fallback without --branch lands on the default branch. It used to do that silently,
  # so a mistyped --ref (or a transient failure on the first attempt) installed `main` while
  # .ae-kit-version recorded the requested ref. Now it's stated, and it only falls back when
  # NO ref was asked for: if someone named one and it doesn't exist, installing a different
  # one is worse than failing.
  # Sólo se cae al branch por omisión cuando NO se pidió un ref concreto. Si se pidió uno,
  # installing something else would be worse than failing.
  #
  # Check the remote is reachable BEFORE blaming the ref: the first clone attempt
  # también falla por falta de autenticación, por permisos o por red, y atribuir eso a un
  # "mistyped ref" sends someone to look at the wrong thing. Without this check, the
  # authentication message further down was dead code for any --ref.
  fallback_note() {
    [ "$REF" = "main" ] && return 0
    if ! git ls-remote "https://github.com/$REPO.git" >/dev/null 2>&1 \
       && ! git ls-remote "git@github.com:$REPO.git" >/dev/null 2>&1; then
      return 0   # the remote is unreachable: let the authentication message speak
    fi
    die "The remote $REPO responds, but has no '$REF'. Installing the default branch
  instead would be worse than failing. Check the ref name."
  }
  if command -v gh >/dev/null 2>&1; then
    gh repo clone "$REPO" "$CLEANUP_DIR/clone" -- $DEPTH_ARGS --branch "$REF" --quiet 2>/dev/null \
      || { fallback_note && gh repo clone "$REPO" "$CLEANUP_DIR/clone" -- $DEPTH_ARGS --quiet 2>/dev/null; } \
      || die "Couldn't clone $REPO with gh. Is it authenticated (\`gh auth status\`) and do you have access?"
  else
    git clone $DEPTH_ARGS --branch "$REF" "git@github.com:$REPO.git" "$CLEANUP_DIR/clone" -q 2>/dev/null \
      || { fallback_note && git clone $DEPTH_ARGS "git@github.com:$REPO.git" "$CLEANUP_DIR/clone" -q 2>/dev/null; } \
      || die "Couldn't clone $REPO over SSH, and the gh CLI isn't installed. Install gh, or set up an SSH key with access."
  fi
  # Dos layouts posibles, y se DETECTA en vez de suponerse:
  #   - the artifact repo: the kit is at the root of the clone.
  #   - the workshop repo: the kit is under `kit/`.
  # Assuming either one breaks the other, and both are real: the artifact is the
  # destino normal, y `ae-setup` sigue siendo un remoto válido vía AE_KIT_REPO —por ejemplo
  # normal destination, and the workshop stays valid via AE_KIT_REPO — for instance to
  # install a change before CI publishes it. The root is tried first: it's the normal case.
  if [ -f "$CLEANUP_DIR/clone/VERSION" ]; then
    KIT_DIR="$CLEANUP_DIR/clone"
  elif [ -f "$CLEANUP_DIR/clone/kit/VERSION" ]; then
    KIT_DIR="$CLEANUP_DIR/clone/kit"
  else
    die "Cloned $REPO but found no VERSION, at the root or under kit/. That repo doesn't look like the kit."
  fi
  SOURCE_DESC="$REPO@$REF"
fi

[ -f "$KIT_DIR/VERSION" ] || die "No VERSION file at $KIT_DIR — this doesn't look like the kit."
KIT_VERSION="$(tr -d '[:space:]' < "$KIT_DIR/VERSION")"

# --notes-done that is not x.y.z is accepted only as the exact text of a kit VERSION that
# is not x.y.z either (T070 U6). Anything else is the malformed argument it always was:
# exit 2, nothing written. Plain text comparison, only in this case: there is no number in
# 0.38.0-rc1 to compare.
if [ -n "$NOTES_DONE" ] && ! is_semver "$NOTES_DONE"; then
  if is_semver "$KIT_VERSION" || [ "$NOTES_DONE" != "$KIT_VERSION" ]; then
    echo "✗ --notes-done takes an exact version, x.y.z: got '$NOTES_DONE'. Only a kit whose VERSION" >&2
    echo "  is not x.y.z takes another text, and then exactly that VERSION (this kit's is '$KIT_VERSION')." >&2
    exit 2
  fi
fi

echo "→ Kit v$KIT_VERSION (from $SOURCE_DESC)"
echo "→ Target: $TARGET"
[ "$DRY_RUN" -eq 1 ] && echo "→ DRY RUN — nothing will be written."
echo

# 0 when $1 is a lower dotted version than $2 (numeric per field; anything else is not compared).
version_lt() {
  local a="$1" b="$2" x y
  [[ "$a" =~ ^[0-9]+(\.[0-9]+)*$ && "$b" =~ ^[0-9]+(\.[0-9]+)*$ ]] || return 1
  while [ -n "$a" ] || [ -n "$b" ]; do
    x="${a%%.*}"; y="${b%%.*}"; x="${x:-0}"; y="${y:-0}"
    [ "$((10#$x))" -lt "$((10#$y))" ] && return 0
    [ "$((10#$x))" -gt "$((10#$y))" ] && return 1
    case "$a" in *.*) a="${a#*.}" ;; *) a="" ;; esac
    case "$b" in *.*) b="${b#*.}" ;; *) b="" ;; esac
  done
  return 1
}
downgrade=0
version_lt "$KIT_VERSION" "$PREVIOUS_VERSION" && downgrade=1

# ------------------------------------------------------------------ the base (D030)
# What the project is compared against, both to tell an edited kit file from an outdated one
# and to know which files the kit stopped shipping. Normally the previous manifest. Without a
# usable one (installed before the manifest existed, or one that is broken or uncommitted),
# the base is the kit AS PUBLISHED at the version .ae-kit-version names — read from the
# history of the same source this install comes from: the remote it cloned, or, with
# --from, the git repository the kit on disk lives in. Once this install writes a manifest,
# the next one reads that instead, so this happens once per project.
# Without either, nothing can be identified as dropped by the kit, and the report says so
# (C-5): guessing would mean deleting files nobody can vouch for.
base_ok=0
base_desc="the previous manifest"
base_note=""
[ "$prev_manifest_state" = "ok" ] && base_ok=1

# Prints `<sha256>  <path in the project>` for every file a kit tree installs, sorted — the
# manifest that tree would have written, minus exclusions (an excluded file is never removed).
manifest_of_kit() {
  local kit="$1" pair src_root dest_root f rel dest_rel h
  for pair in ".claude/skills|.claude/skills" ".claude/agents|.claude/agents" \
              "templates|ae-kit-templates" "scripts|scripts"; do
    src_root="$kit/${pair%%|*}"; dest_root="${pair#*|}"
    [ -d "$src_root" ] || continue
    while IFS= read -r f; do
      rel="${f#"$src_root"/}"; dest_rel="$dest_root/$rel"
      case "$dest_rel" in
        scripts/test-*.sh|scripts/check-installed-copy.mjs|scripts/merge-claude-hook.mjs) continue ;;
      esac
      h="$(sha256_of "$f")" || return 1
      printf '%s  %s\n' "$h" "$dest_rel"
    done < <(find "$src_root" -type f ! -name '.DS_Store')
  done | LC_ALL=C sort -k2
}

# Sets PUB_DIR to a kit tree as published at version $1, or base_note to why there is none.
# The published content of a version is the last commit before the one that moved VERSION
# past it — in angee that is its latest `kit X.Y.Z` commit, and in the workshop the last
# commit on main where kit/VERSION still said it.
PUB_DIR=""
published_kit() {
  local v="$1" top prefix vpath c cv found="" newer="" base
  if [ "$v" = "$KIT_VERSION" ]; then PUB_DIR="$KIT_DIR"; return 0; fi
  if ! top="$(git -C "$KIT_DIR" rev-parse --show-toplevel 2>/dev/null)" || [ -z "$top" ]; then
    base_note="the kit being installed has no git history to read v$v from"
    return 1
  fi
  prefix="$(git -C "$KIT_DIR" rev-parse --show-prefix 2>/dev/null)"
  vpath="${prefix}VERSION"
  while IFS= read -r c; do
    cv="$(git -C "$top" show "$c:$vpath" 2>/dev/null | tr -d '[:space:]')"
    if [ "$cv" = "$v" ]; then found="$c"; break; fi
    newer="$c"
  done < <(git -C "$top" log --format=%H -- "$vpath" 2>/dev/null)
  if [ -z "$found" ]; then
    base_note="v$v is not in the history of the kit being installed"
    [ "$(git -C "$top" rev-parse --is-shallow-repository 2>/dev/null)" = "true" ] \
      && base_note="$base_note (its history is shallow)"
    return 1
  fi
  if [ -n "$newer" ]; then base="$newer^"; else base="HEAD"; fi
  BASE_TMP="$(mktemp -d)" || { base_note="a temporary folder could not be created"; return 1; }
  if ! git -C "$top" archive --format=tar "$base" ${prefix:+"$prefix"} 2>/dev/null | tar -x -C "$BASE_TMP" 2>/dev/null \
     || [ ! -f "$BASE_TMP/${prefix}VERSION" ]; then
    base_note="v$v could not be read from the kit's history"
    return 1
  fi
  PUB_DIR="$BASE_TMP/${prefix%/}"
  return 0
}

if [ "$base_ok" -eq 0 ] && [ "$need_base" -eq 1 ]; then
  if published_kit "$PREVIOUS_VERSION" && pub_manifest="$(manifest_of_kit "$PUB_DIR")"; then
    prev_manifest="$pub_manifest"$'\n'
    base_ok=1
    base_desc="the published v$PREVIOUS_VERSION"
  else
    [ -n "$base_note" ] || base_note="the published v$PREVIOUS_VERSION could not be hashed"
  fi
elif [ "$base_ok" -eq 0 ] && [ -n "$PREVIOUS_VERSION" ] && [ -z "$HASH_TOOL" ]; then
  base_note="no SHA-256 tool on this machine"
fi

# ---------------------------------------------------------------------- the plan
# FIRST PASS, READ ONLY. Every kit file is classified before a single byte is written,
# because the one refusal there is (uncommitted changes) has to be able to stop the install
# with nothing touched — not after half the kit has been copied and settings.json merged.
#   new        the destination does not exist
#   identical  it exists, byte for byte the new version
#   replace    it exists and differs: it will be overwritten
#   symlink    it is a symbolic link, or sits under one: never written through
#   inway      a folder sits where the file goes: never written into
written=0; replaced=0; identical=0; conflicts=0; skipped=0
plan_src=(); plan_rel=(); plan_act=()
skipped_list=""
skipped_present_list=""
required_override_list=""

# 0 if any component of a path inside the target — the file or a folder on the way — is a
# symbolic link. Writing through one would land outside the folders this install owns.
path_has_symlink() {
  local acc="$TARGET" part parts
  IFS='/' read -r -a parts <<< "$1"
  for part in "${parts[@]}"; do
    acc="$acc/$part"
    [ -L "$acc" ] && return 0
  done
  return 1
}

plan_tree() {
  local src_root="$1" dest_root="$2"
  [ -d "$src_root" ] || return 0
  while IFS= read -r src; do
    local rel="${src#"$src_root"/}"
    local dest="$dest_root/$rel"
    local dest_rel="${dest#"$TARGET"/}"
    # The checkers' suites are NOT product: they test the kit on itself and already run in
    # the kit's own CI. Shipping them to every project hands it ~1,200 lines it will never
    # run. This rule also lives in check-installed-copy.mjs (NEVER_INSTALLED);
    # if the two stop matching, the checker reports as missing something the installer
    # never sends — test-installed-copy.sh's integration block catches that.
    # check-installed-copy.mjs compares an installed tree against the source in kit/, and
    # kit/ only exists in the repo that PRODUCES the kit. Anywhere else it can only exit 2
    # forever — not broken, just delivered somewhere it cannot answer its own question.
    case "$dest_rel" in
      scripts/test-*.sh) continue ;;
      scripts/check-installed-copy.mjs) continue ;;
      # A step of INSTALLING, not a piece of what gets installed: this installer runs it
      # from the kit it just cloned, and a project has no use for it afterwards. Same list
      # in check-installed-copy.mjs (NEVER_INSTALLED), for the same reason as above.
      scripts/merge-claude-hook.mjs) continue ;;
    esac
    local why
    if why="$(is_excluded "$dest_rel")" && is_required "$dest_rel"; then
      # A folder line (scripts/) also covers pieces that are rightly excluded: deleting it
      # would un-exclude all of them. Only a line naming the piece itself should go.
      decl="$(excluded_match "$dest_rel")"
      case "$decl" in
        */) required_override_list="${required_override_list}  ${dest_rel} — covered by the folder line \"${decl}\": keep that line, nothing to do"$'\n' ;;
        *)  required_override_list="${required_override_list}  ${dest_rel} — declared out: ${why}. Remove this line"$'\n' ;;
      esac
    elif why="$(is_excluded "$dest_rel")"; then
      skipped=$((skipped + 1))
      skipped_list="${skipped_list}  ${dest_rel} — ${why}"$'\n'
      # Skipping does NOT delete a declared-out file. If a copy survived from an earlier
      # install it's reported, because the checker will flag it and the person needs to
      # know where it came from.
      [ -f "$dest" ] && skipped_present_list="${skipped_present_list}  ${dest_rel}"$'\n'
      continue
    fi
    local act
    if path_has_symlink "$dest_rel"; then act="symlink"
    elif [ -f "$dest" ]; then
      if cmp -s "$src" "$dest"; then act="identical"; else act="replace"; fi
    # A folder (or anything else that is not a regular file) where a kit file goes: cp would
    # drop the file INSIDE it, at a path the kit never ships and the manifest never lists.
    elif [ -e "$dest" ]; then act="inway"
    else act="new"
    fi
    plan_src+=("$src"); plan_rel+=("$dest_rel"); plan_act+=("$act")
  done < <(find "$src_root" -type f ! -name '.DS_Store' | sort)
}

plan_tree "$KIT_DIR/.claude/skills"  "$TARGET/.claude/skills"
plan_tree "$KIT_DIR/.claude/agents"  "$TARGET/.claude/agents"
plan_tree "$KIT_DIR/templates"       "$TARGET/ae-kit-templates"
# Project-level checks (new in v0.17.0). These enforce the rules rather than describe
# them, so they belong next to the project's own scripts, not inside a skill folder:
# CI and `open-session` both run them without going through a skill at all.
plan_tree "$KIT_DIR/scripts"         "$TARGET/scripts"

# ---------------------------------------------------------------- release notes (T070)
# Some steps of an upgrade cannot be run by the installer, because they change the owner's
# files (CLAUDE.md, STATUS.md) or have to happen BEFORE kit files are overwritten. Each
# version says so in release-notes/<version>.md, which travels with the kit. They are read
# here, still before a single byte is written, and printed before the refusal over
# uncommitted changes so that both are seen together (R-6).
#
# Which versions apply, in this order (the first that matches decides):
#   producer   the repo that produces the kit — .ae-kit-version declared out AND the kit
#              source here, the same predicate as the marker section below (A-9, R-13).
#              Evaluated first: that repo has no marker, and must not read as a new install
#   same       the marker names this very version: nothing (A-5). Evaluated before badkit
#              (T070 U6): reinstalling a 0.38.0-rc1 over a 0.38.0-rc1 has no range to compute
#              and nothing new to read. Exact text, or the same number when both are x.y.z
#   badkit     the kit's VERSION is not x.y.z: no range can be computed, so every note, and
#              it stops if any has steps (R-11), until --notes-done names that exact VERSION
#   downgrade  the marker names a newer version: nothing, the warning below speaks (D055)
#   range      above the marker's version, up to the kit's (A-1, A-2)
#   fresh      (half-finished) no readable marker, and the .ae-kit-manifest on disk says it
#              was written by THIS very version: see below
#   unknown    no readable marker, but kit files or a .ae-kit-manifest are here: something
#              was installed and nobody can say what, so every note up to the kit's (D054)
#   fresh      no readable marker and nothing of the kit: a new install, which sees only the
#              new version's note and is never stopped by it (A-4)
#
# The half-finished new install (T070 U6). A first install that ends with exit 3 has written
# the kit files and .ae-kit-manifest, but not the marker — so its second run used to find
# "kit files, no marker" and be taken for D054's unknown project, stopped by steps that only
# apply to an upgrade. The signal that tells them apart is the manifest's own header,
# "# kit-version: <version>": every manifest names the version that wrote it, and the marker
# is written by that same install only when it completes. A manifest of the version being
# installed, with no readable marker, can only be a run of this version that did not finish
# (or a marker deleted by hand after one that did): either way that version's "Before
# installing" was already crossed — passed as a new install, or confirmed with --notes-done —
# so it is a new install again. A manifest of ANY other version, or none, with kit files and
# no marker, is still D054's unknown project. Read from the disk, not from HEAD: the run that
# stopped with 3 is exactly the one nobody committed yet.
manifest_kit_version=""
if [ -f "$MANIFEST" ]; then
  manifest_kit_version="$(sed -n 's/^# kit-version: \(.*\)$/\1/p' "$MANIFEST" 2>/dev/null | head -1 | tr -d '\r')"
fi
notes_resumed=0
notes_mode=""
if is_excluded ".ae-kit-version" >/dev/null && [ -d "$TARGET/kit/.claude/skills" ]; then
  notes_mode="producer"
elif [ -n "$PREVIOUS_VERSION" ] && { [ "$PREVIOUS_VERSION" = "$KIT_VERSION" ] || \
     { is_semver "$PREVIOUS_VERSION" && is_semver "$KIT_VERSION" && \
       ! version_lt "$PREVIOUS_VERSION" "$KIT_VERSION" && ! version_lt "$KIT_VERSION" "$PREVIOUS_VERSION"; }; }; then
  notes_mode="same"
elif ! is_semver "$KIT_VERSION"; then
  notes_mode="badkit"
elif is_semver "$PREVIOUS_VERSION"; then
  if version_lt "$KIT_VERSION" "$PREVIOUS_VERSION"; then notes_mode="downgrade"
  else notes_mode="range"
  fi
elif [ -n "$manifest_kit_version" ] && [ "$manifest_kit_version" = "$KIT_VERSION" ]; then
  notes_mode="fresh"; notes_resumed=1
else
  kit_present=0
  [ -f "$MANIFEST" ] && kit_present=1
  [ -n "$skipped_present_list" ] && kit_present=1
  for a in "${plan_act[@]+"${plan_act[@]}"}"; do
    case "$a" in identical|replace) kit_present=1; break ;; esac
  done
  if [ "$kit_present" -eq 1 ]; then notes_mode="unknown"; else notes_mode="fresh"; fi
fi

NOTES_DIR="$KIT_DIR/release-notes"
# Every file in release-notes/ named <x.y.z>.md, sorted numerically: 0.37.10 after 0.37.9
# (A-3). Any other name (a README, .DS_Store) is not a version and is ignored (R-4).
notes_all=()
if [ -d "$NOTES_DIR" ]; then
  while IFS= read -r v; do
    [ -n "$v" ] && notes_all+=("$v")
  done < <(for f in "$NOTES_DIR"/*.md; do
             [ -f "$f" ] || continue
             b="${f##*/}"; b="${b%.md}"
             is_semver "$b" && printf '%s\n' "$b"
           done | sort -t. -k1,1n -k2,2n -k3,3n)
fi

notes_sel=()
for v in "${notes_all[@]+"${notes_all[@]}"}"; do
  case "$notes_mode" in
    badkit) notes_sel+=("$v") ;;
    # Above the installed version, never above the new one (R-3).
    range)   version_lt "$PREVIOUS_VERSION" "$v" && ! version_lt "$KIT_VERSION" "$v" && notes_sel+=("$v") ;;
    unknown) ! version_lt "$KIT_VERSION" "$v" && notes_sel+=("$v") ;;
    fresh)   ! version_lt "$KIT_VERSION" "$v" && ! version_lt "$v" "$KIT_VERSION" && notes_sel+=("$v") ;;
  esac
done

# A section of a notes file: the lines under its "## " heading, up to the next heading of
# level one or two. Trailing whitespace (a CR included) is dropped from every line.
notes_section() {
  awk -v h="## $2" '
    { sub(/[[:space:]]+$/, "") }
    /^##?[[:space:]]/ { insec = ($0 == h); next }
    insec { print }
  ' "$1"
}
notes_heading_count() {
  awk -v h="## $2" '{ sub(/[[:space:]]+$/, "") } $0 == h { n++ } END { print n + 0 }' "$1"
}
# 0 when a section asks for nothing: it is empty, blank lines only (D059). Any non-blank
# line is a step, whatever it says — "- Nothing." included, which is no longer a form of
# its own: a stop nobody needed costs a second run, a step skipped can cost an overwritten
# file (R-10). The notes are always read from the kit being installed, never from the
# project, so no older notes file in the old form is ever read by this rule.
notes_is_nothing() {
  ! printf '%s\n' "$1" | grep -q '[^[:space:]]'
}

notes_steps=()      # versions whose "Before installing" has steps
notes_after=()      # "v<version>|<after section>", for the end of the install
for v in "${notes_sel[@]+"${notes_sel[@]}"}"; do
  f="$NOTES_DIR/$v.md"
  # A file without one of its two sections, or with one twice, cannot be read safely: the
  # step it was meant to carry may be the missing one. Exit 1, naming it (C-1).
  for h in "Before installing" "After installing"; do
    n="$(notes_heading_count "$f" "$h")"
    [ "$n" = "1" ] || die "release-notes/$v.md has $n \"## $h\" section(s); it needs exactly one. Fix the notes file in the kit before installing."
  done
  notes_is_nothing "$(notes_section "$f" "Before installing")" || notes_steps+=("$v")
  aft="$(notes_section "$f" "After installing")"
  notes_is_nothing "$aft" || notes_after+=("v$v|$aft")
done

notes_stop=0
notes_done_wrong=0
if [ "${#notes_steps[@]}" -gt 0 ] && [ "$notes_mode" != "fresh" ]; then
  # Only the version being installed confirms the steps (B-2, B-3): if angee moved on
  # between two runs, the new version's notes have not been read yet (R-8). Compared
  # numerically. A kit VERSION that is not x.y.z is confirmed only by its exact text (the
  # argument check above already refused any other non-x.y.z value).
  if [ -n "$NOTES_DONE" ] && { { is_semver "$KIT_VERSION" && is_semver "$NOTES_DONE" \
       && ! version_lt "$NOTES_DONE" "$KIT_VERSION" && ! version_lt "$KIT_VERSION" "$NOTES_DONE"; } \
       || { ! is_semver "$KIT_VERSION" && [ "$NOTES_DONE" = "$KIT_VERSION" ]; }; }; then
    notes_stop=0
  else
    notes_stop=1
    [ -n "$NOTES_DONE" ] && notes_done_wrong=1
  fi
fi

case "$notes_mode" in
  unknown)
    echo "⚠ There is no readable .ae-kit-version${PREVIOUS:+ (it says '$PREVIOUS')}, but kit files are"
    echo "  already here: which release notes apply cannot be told, so every one up to v$KIT_VERSION"
    echo "  is shown."
    echo ;;
  badkit)
    echo "⚠ The kit's VERSION ('$KIT_VERSION') is not a version (x.y.z): which release notes apply"
    echo "  cannot be computed, so every one is shown."
    echo ;;
  fresh)
    if [ "$notes_resumed" -eq 1 ]; then
      echo "⚠ There is no readable .ae-kit-version, but .ae-kit-manifest was written by v$KIT_VERSION"
      echo "  itself: an earlier install of this version did not finish. It goes on as a new install."
      echo
    fi ;;
esac
# A-8: the version being installed should carry its own notes from 0.37.0 on. Versions in
# between without a file cannot be known at all, so only the new one is checked.
case "$notes_mode" in
  range|unknown|fresh)
    if ! version_lt "$KIT_VERSION" "0.37.0" && [ ! -f "$NOTES_DIR/$KIT_VERSION.md" ]; then
      echo "⚠ This kit has no release-notes/$KIT_VERSION.md: what v$KIT_VERSION asks before or after"
      echo "  installing is not known. Only the notes of versions that have a file are shown."
      echo
    fi ;;
esac
if [ "${#notes_sel[@]}" -gt 0 ]; then
  if [ "$notes_mode" = "range" ]; then
    echo "→ Release notes from v$PREVIOUS_VERSION to v$KIT_VERSION (${#notes_sel[@]}):"
  elif [ "$notes_mode" = "fresh" ]; then
    echo "→ Release notes of v$KIT_VERSION. This is a new install, so nothing in them stops it:"
  else
    echo "→ Release notes (${#notes_sel[@]}):"
  fi
  echo
  for v in "${notes_sel[@]}"; do
    echo "  ── release-notes/$v.md"
    sed 's/^\(.\)/  \1/' "$NOTES_DIR/$v.md"
    echo
  done
fi

# How to go on from a stop: one line, with the version (C-4, B-3).
notes_stop_message() {
  local steps_list
  steps_list="$(printf 'v%s, ' "${notes_steps[@]}")"; steps_list="${steps_list%, }"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "✗ The real install WOULD STOP here, writing nothing: the release notes of $steps_list"
    echo "  ask for steps under \"Before installing\"."
  else
    echo "✗ Install STOPPED by the release notes. Nothing was written: the notes of $steps_list"
    echo "  ask for steps under \"Before installing\"."
  fi
  if [ "$notes_done_wrong" -eq 1 ]; then
    echo "  --notes-done $NOTES_DONE was given, but this install goes to v$KIT_VERSION: only that version confirms the steps."
  fi
  echo "  Do those steps, then run the installer again with --notes-done $KIT_VERSION"
  if ! is_semver "$KIT_VERSION"; then
    echo "  The kit's VERSION is not x.y.z: only that exact text, '$KIT_VERSION', confirms them."
  fi
}

# ------------------------------------------------------------------ the refusal
# The only one (D029). A kit file that is about to be replaced while it carries uncommitted
# changes — staged, unstaged, or never tracked at all — holds content git cannot return, so
# replacing it would be a loss with no way back. Everything else that gets replaced is in
# HEAD and comes back with the command the report prints.
# Asked once, for the four folders, with -z so no path comes back quoted. Porcelain paths
# are from the repo's top, hence GIT_PREFIX. Only files that WILL CHANGE are checked: an
# uncommitted file already identical to the new version loses nothing (R-1).
# A file git ignores does not show up here and is replaced like a committed one: an
# accepted risk (D029, R-2) — no project ignores the kit's folders.
refuse_list=""
if [ "$IN_GIT" -eq 1 ]; then
  dirty=$'\n'
  status_ok=1
  status_out="$(mktemp)" || status_ok=0
  if [ "$status_ok" -eq 1 ] && git -C "$TARGET" status --porcelain=v1 -z --untracked-files=all \
       -- .claude/skills .claude/agents ae-kit-templates scripts > "$status_out" 2>/dev/null; then
    take_orig=0
    while IFS= read -r -d '' entry; do
      if [ "$take_orig" -eq 1 ]; then
        p="$entry"; take_orig=0
      else
        p="${entry:3}"
        case "${entry:0:1}" in R|C) take_orig=1 ;; esac
      fi
      case "$p" in "$GIT_PREFIX"*) p="${p#"$GIT_PREFIX"}" ;; *) continue ;; esac
      dirty="${dirty}${entry:0:2}|${p}"$'\n'
    done < "$status_out"
  else
    status_ok=0
  fi
  # A file flagged skip-worktree or assume-unchanged never shows in `git status`, edited or
  # not: git has been told not to look. Its disk content may be an edit git does not have,
  # so it counts as uncommitted. `ls-files -v` marks it with a lowercase letter, or S; its
  # paths are relative to the target already.
  if [ "$status_ok" -eq 1 ] && git -C "$TARGET" ls-files -v -z \
       -- .claude/skills .claude/agents ae-kit-templates scripts > "$status_out" 2>/dev/null; then
    while IFS= read -r -d '' entry; do
      case "${entry:0:1}" in
        [[:lower:]]|S) dirty="${dirty}HD|${entry:2}"$'\n' ;;
      esac
    done < "$status_out"
  else
    status_ok=0
  fi
  rm -f "$status_out"
  if [ "$status_ok" -eq 0 ]; then
    # Unable to ask means unable to promise the loss is recoverable: refusing is the side
    # that cannot destroy anything.
    echo "✗ git could not report the state of the kit folders in $TARGET, so it cannot be" >&2
    echo "  told whether replacing kit files would lose uncommitted work. Nothing was written." >&2
    exit 4
  fi
  i=0
  while [ "$i" -lt "${#plan_rel[@]}" ]; do
    if [ "${plan_act[$i]}" = "replace" ]; then
      line="$(printf '%s' "$dirty" | grep -F -- "|${plan_rel[$i]}" | while IFS= read -r l; do
                [ "${l#*|}" = "${plan_rel[$i]}" ] && { printf '%s' "$l"; break; }
              done)"
      if [ -n "$line" ]; then
        code="${line%%|*}"
        case "$code" in
          '??') why="untracked: never committed" ;;
          HD)   why="flagged skip-worktree or assume-unchanged: git does not see its edits" ;;
          ?' ') why="staged, not committed" ;;
          *)    why="uncommitted changes" ;;
        esac
        refuse_list="${refuse_list}  ${plan_rel[$i]} — ${why}"$'\n'
      fi
    fi
    i=$((i + 1))
  done
fi

if [ "$downgrade" -eq 1 ]; then
  echo "⚠ This installs v$KIT_VERSION, OLDER than the v$PREVIOUS_VERSION this project runs."
  echo "  Every kit file that changed since then goes back to its older version."
  echo
fi

if [ -n "$refuse_list" ]; then
  [ "$DRY_RUN" -eq 1 ] && echo "✗ The install WOULD BE REFUSED. Nothing would be written." \
                       || echo "✗ Install REFUSED. Nothing was written — no kit file, no settings, no .gitattributes."
  echo "  These kit files would be replaced, and their current content is not committed, so"
  echo "  git could not bring it back:"
  printf '%s' "$refuse_list"
  echo
  echo "  Commit them (or stash them: git stash -u), then run the installer again. If an edit"
  echo "  is a fix the project needs, it belongs in \"Local kit adjustments\" of CLAUDE.md:"
  echo "  the kit file itself is overwritten on every install."
  # A project with no repository of its own inside one that is not about it — a home folder
  # versioned as dotfiles — sees its kit files as untracked there, and is refused on every
  # install that changes one. The refusal is right (that content is in no commit), but the
  # advice above would send someone to commit into the wrong repository, so it is named.
  git_top="$(git -C "$TARGET" rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$git_top" ] && [ "$(cd "$git_top" && pwd -P)" != "$(cd "$TARGET" && pwd -P)" ] \
     && printf '%s' "$refuse_list" | grep -q "untracked: never committed"; then
    echo
    echo "  Note: this project sits inside the git repository at $git_top, and the files"
    echo "  above are untracked THERE. If that repository is not this project's (a home folder"
    echo "  kept as dotfiles, for instance), do not commit them into it: give the project its"
    echo "  own repository (git init in $TARGET, then commit), or ignore the project folder"
    echo "  in that repository — either way, the installer then sees the project's own state."
  fi
  # Both stops at once (R-6): the notes' code wins, because their "Before installing" steps
  # come first and may themselves be what settles these files.
  if [ "$notes_stop" -eq 1 ]; then
    echo
    notes_stop_message
    exit "$NOTES_EXIT"
  fi
  exit 4
fi

# The stop over the release notes (B-1): nothing has been written yet, and nothing will be.
# A dry run goes on to say what it would replace, and stops with the same code at its end
# (B-6, R-9).
if [ "$notes_stop" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  notes_stop_message
  exit "$NOTES_EXIT"
fi

# ------------------------------------------------------------- what the kit dropped
# D022: a file in the base that the new kit no longer ships is REMOVED if it is exactly
# what the kit put there (its hash matches the base), and LEFT, with a line in the report,
# if the project changed it. Decided here, before anything is written; carried out after the
# copy, and only if every kit file landed (R-4) — a refusal above has already stopped the
# whole install (C-9). Never removed, whatever the base says:
#   - a path outside the four kit folders, absolute, or with `.`/`..` (suspicious, C-8, R-5)
#   - a path declared in .ae-kit-excluded today (C-6 declined, D033: reported as before)
#   - a path declared in .ae-kit-local (R-8): the project says it is its own
#   - a path with a symbolic link in it, or that is not a regular file
# A file left because it changed is no longer a kit file, so the new manifest does not list
# it and the next install does not mention it again: it is reported once (D033, R-10).
local_paths=()
if [ -f "$TARGET/.ae-kit-local" ]; then
  while IFS= read -r raw || [ -n "$raw" ]; do
    line="${raw#"${raw%%[![:space:]]*}"}"
    case "$line" in ''|\#*) continue ;; esac
    # A line without its reason still protects its path: the checker reports it as
    # malformed, but deciding a removal, any mention of the path counts as a claim.
    sep_line="$(printf '%s' "$line" | sed -E 's/(#|—|--)/@@AEKITSEP@@/')"
    lp="${sep_line%%@@AEKITSEP@@*}"
    lp="${lp%%[[:space:]]*}"; lp="${lp#./}"
    [ -n "$lp" ] || continue
    local_paths+=("$lp")
  done < "$TARGET/.ae-kit-local"
fi
is_local() {
  local p
  for p in "${local_paths[@]+"${local_paths[@]}"}"; do
    case "$p" in
      */) case "$1" in "$p"*) return 0 ;; esac ;;
      *)  [ "$1" = "$p" ] && return 0 ;;
    esac
  done
  return 1
}

retire_paths=(); kept_changed_list=""; retire_skip_list=""
if [ "$base_ok" -eq 1 ]; then
  plan_set=$'\n'
  for r in "${plan_rel[@]+"${plan_rel[@]}"}"; do plan_set="${plan_set}${r}"$'\n'; done
  while IFS= read -r ml; do
    [ -n "$ml" ] || continue
    bh="${ml:0:64}"; bp="${ml:66}"
    case "$plan_set" in *$'\n'"$bp"$'\n'*) continue ;; esac
    is_excluded "$bp" >/dev/null && continue
    [ -e "$TARGET/$bp" ] || [ -L "$TARGET/$bp" ] || continue      # already gone (C-3)
    if is_local "$bp"; then
      retire_skip_list="${retire_skip_list}  ${bp} — declared in .ae-kit-local: the project's own"$'\n'
    elif path_has_symlink "$bp"; then
      retire_skip_list="${retire_skip_list}  ${bp} — a symbolic link is in its path, and it is not followed"$'\n'
    elif [ ! -f "$TARGET/$bp" ]; then
      retire_skip_list="${retire_skip_list}  ${bp} — not a regular file"$'\n'
    elif [ "$(sha256_of "$TARGET/$bp" || true)" = "$bh" ]; then
      retire_paths+=("$bp")
    else
      kept_changed_list="${kept_changed_list}  ${bp}"$'\n'
    fi
  done <<< "$prev_manifest"
fi

# ---------------------------------------------------------------------- the copy
# SECOND PASS. What exists and differs is replaced; the report sorts the replaced files by
# what the previous manifest knew about them:
#   updated_list   matched the previous manifest — changed in the kit, nobody touched it
#   edited_list    differed from it — the project had edited it — with the way back
#   nomanifest_list  there is no usable previous manifest, so nobody can tell
manifest_paths=()
copy_failed=0; copy_failed_list=""
# Whether this run changed any kit file on disk. It decides what happens to a previous
# manifest when a new one cannot be written (see the manifest section).
changed_on_disk=0
updated_list=""; edited_list=""; nomanifest_list=""

# The command that brings back what was replaced, or why there is none. It names the commit
# that was HEAD before this install, not HEAD itself, so it still works once the install is
# committed (R-18). The preflight guarantees that commit holds exactly the replaced bytes,
# except for a file git ignores — which is checked, not assumed.
recovery_of() {
  local rel="$1"
  if [ "$IN_GIT" -eq 0 ]; then
    printf 'not a git repository: its previous content cannot be recovered'
  elif [ -z "$HEAD_SHA" ] || ! git -C "$TARGET" cat-file -e "$HEAD_SHA:${GIT_PREFIX}$rel" 2>/dev/null; then
    printf 'never committed: its previous content cannot be recovered'
  else
    printf 'git show %s:%s%s' "$HEAD_SHORT" "$GIT_PREFIX" "$rel"
  fi
}

i=0
while [ "$i" -lt "${#plan_rel[@]}" ]; do
  src="${plan_src[$i]}"; dest_rel="${plan_rel[$i]}"; act="${plan_act[$i]}"
  dest="$TARGET/$dest_rel"
  i=$((i + 1))
  case "$act" in
    identical)
      identical=$((identical + 1))
      # Already identical is still a kit file this install leaves on disk.
      manifest_paths+=("$dest_rel")
      continue ;;
    inway)
      copy_failed=$((copy_failed + 1))
      copy_failed_list="${copy_failed_list}  ${dest_rel} — a folder in the way: nothing was written into it"$'\n'
      continue ;;
    symlink)
      copy_failed=$((copy_failed + 1))
      copy_failed_list="${copy_failed_list}  ${dest_rel} — a symbolic link is in its path, and it is not followed"$'\n'
      continue ;;
    replace)
      replaced=$((replaced + 1))
      if [ "$base_ok" -eq 1 ]; then
        ph="$(prev_hash_of "$dest_rel")"
        bh="$(sha256_of "$dest" || true)"
        if [ -n "$ph" ] && [ "$bh" = "$ph" ]; then
          updated_list="${updated_list}  ${dest_rel}"$'\n'
        else
          note=""
          [ -z "$ph" ] && note=" (not in ${base_desc})"
          edited_list="${edited_list}  ${dest_rel}${note}"$'\n'"      previous content: $(recovery_of "$dest_rel")"$'\n'
        fi
      else
        nomanifest_list="${nomanifest_list}  ${dest_rel}"$'\n'
      fi ;;
    new)
      written=$((written + 1)) ;;
  esac
  if [ "$DRY_RUN" -eq 1 ]; then
    manifest_paths+=("$dest_rel")
    continue
  fi
  # A copy that fails is counted, not ignored. Carrying on in silence used to cost only
  # a missing file; with the manifest it would also record a hash for a file that never
  # landed, and the project's verifier would then block every commit over it.
  if ! { mkdir -p "$(dirname "$dest")" && cp "$src" "$dest"; } 2>/dev/null; then
    if [ "$act" = "new" ]; then written=$((written - 1)); else replaced=$((replaced - 1)); fi
    copy_failed=$((copy_failed + 1))
    copy_failed_list="${copy_failed_list}  ${dest_rel}"$'\n'
    # A file that kept its old content stays out of the manifest: listing it would bless
    # bytes the kit did not put there.
    continue
  fi
  changed_on_disk=1
  manifest_paths+=("$dest_rel")
  # The kit stores content, not file mode — anything under a scripts/ folder or
  # ending in .sh needs its executable bit restored, or it fails at the moment
  # somebody tries to run it, which is always the worst moment.
  # Match on $dest, not on the path inside the kit: files installed from kit/scripts/ have
  # no "scripts/" segment there (the folder name lives in the destination root), so such a
  # match silently shipped check-skill-outputs.mjs without its +x bit.
  case "$dest" in */scripts/*|*.sh) chmod +x "$dest" ;; esac
done

# Carried out only when every kit file landed: with one missing, the install is incomplete
# anyway, and removing files on top of it would leave the project further from either
# version (R-4). The files stay, and the report says they are still due.
retired_list=""; retire_failed=0; retire_failed_list=""; retire_held=0
KIT_ROOTS="$TARGET/.claude/skills $TARGET/.claude/agents $TARGET/ae-kit-templates $TARGET/scripts"
if [ "${#retire_paths[@]}" -gt 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    for rp in "${retire_paths[@]}"; do retired_list="${retired_list}  ${rp}"$'\n'; done
  elif [ "$copy_failed" -gt 0 ]; then
    retire_held=1
  else
    for rp in "${retire_paths[@]}"; do
      if rm -f "$TARGET/$rp" 2>/dev/null && [ ! -e "$TARGET/$rp" ]; then
        retired_list="${retired_list}  ${rp}"$'\n'
        changed_on_disk=1
        # C-7: a folder the removal left empty goes too — a skill retired whole — up to, and
        # never including, one of the four kit folders. Empty folders beneath it go first
        # (git keeps none, so they hold nothing), then the folder if it is empty now. rmdir
        # only ever removes an empty folder.
        d="$(dirname "$TARGET/$rp")"
        while :; do
          case " $KIT_ROOTS $TARGET " in *" $d "*) break ;; esac
          case "$d" in "$TARGET"/*) ;; *) break ;; esac
          [ -L "$d" ] && break
          find "$d" -mindepth 1 -depth -type d -empty -exec rmdir {} \; 2>/dev/null
          rmdir "$d" 2>/dev/null || break
          d="$(dirname "$d")"
        done
      else
        retire_failed=$((retire_failed + 1))
        retire_failed_list="${retire_failed_list}  ${rp}"$'\n'
      fi
    done
  fi
fi

# R-9: a row of "Local kit adjustments" in CLAUDE.md that names a retired file now points at
# nothing, and check-local-adjustments.mjs rejects it on the next commit. The rows are found
# here so the report can name them before that happens. A row names a file by its path, by
# its skill's name (only when the whole skill is gone) or by its script's name.
adj_rows=""
adjustment_rows() {
  [ -f "$TARGET/CLAUDE.md" ] || return 0
  awk '
    /^[[:space:]]*(```|~~~)/ { fence = !fence; next }
    fence { next }
    /^#+[[:space:]]/ {
      n = match($0, /^#+/); lvl = RLENGTH
      title = $0; sub(/^#+[[:space:]]+/, "", title); sub(/[[:space:]#]+$/, "", title)
      if (insec && lvl <= seclvl) insec = 0
      if (title == "Local kit adjustments" || title == "Ajustes locales al kit") { insec = 1; seclvl = lvl }
      next
    }
    insec && /^[[:space:]]*\|/ { print NR "\t" $0 }
  ' "$TARGET/CLAUDE.md"
}
if [ -n "$retired_list" ]; then
  rows="$(adjustment_rows)"
  if [ -n "$rows" ]; then
    while IFS= read -r rp; do
      rp="${rp#  }"; [ -n "$rp" ] || continue
      tokens=("$rp")
      case "$rp" in
        .claude/skills/*/*)
          sk="${rp#.claude/skills/}"; sk="${sk%%/*}"
          case "$plan_set" in *$'\n'".claude/skills/$sk/"*) ;; *)
            tokens+=(".claude/skills/$sk" "\`$sk\`") ;; esac ;;
        scripts/*)
          bn="${rp##*/}"; tokens+=("\`$bn\`" "\`${bn%.*}\`") ;;
      esac
      for t in "${tokens[@]}"; do
        while IFS= read -r row; do
          [ -n "$row" ] || continue
          entry="  CLAUDE.md line ${row%%	*} names ${rp}"
          case "$adj_rows" in *"$entry"*) ;; *) adj_rows="${adj_rows}${entry}"$'\n' ;; esac
        done < <(printf '%s\n' "$rows" | grep -F -- "$t")
      done
    done <<< "$retired_list"
  fi
fi

# ------------------------------------------------- Claude Code hook (SubagentStop)
# The collector (scripts/collect-subagent.mjs) only ever runs if .claude/settings.json
# declares a SubagentStop hook pointing at it. Until now nobody wrote that declaration: the
# collector shipped in 0.35.0, the first project to install it got the script and no hook,
# and every subagent there kept vanishing after 90 days — the exact loss the collector
# exists to stop. Installing a mechanism without the one line that starts it is not an
# install, which is why a conflict here counts like any other and leaves the version marker
# where it was.
#
# This is the only place the installer touches a file that belongs to the project, so it is
# also the only place that needs a merge instead of a copy. The merge lives in Node
# (merge-claude-hook.mjs) — the rest of this script is cmp and cp, and rewriting someone
# else's JSON with sed produces a file that parses until the day it doesn't.
HOOK_REL=".claude/settings.json"
HOOK_SETTINGS="$TARGET/$HOOK_REL"
COLLECTOR_REL="scripts/collect-subagent.mjs"
hook_status="none"     # none | created | added | present | excluded | conflict
hook_detail=""
hook_conflict=0

# The block someone pastes when this reports a conflict. It is written here rather than in
# the Node script because the "no node on this machine" case has to print it too, and a
# message that only exists inside the program you couldn't run is no message at all.
# It has to stay in step with merge-claude-hook.mjs. F-2 in the suite pastes this very
# block and reruns the installer: a block that stopped being valid JSON, or stopped naming
# the collector, shows up there as a conflict where `present` was expected. Cosmetic drift
# it does not catch — that one is on whoever edits either side.
hook_paste_block() {
  cat <<'HOOKBLOCK'
  {
    "hooks": {
      "SubagentStop": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "node \"$CLAUDE_PROJECT_DIR/scripts/collect-subagent.mjs\"",
              "timeout": 15
            }
          ]
        }
      ]
    }
  }
HOOKBLOCK
}

hook_note_conflict() {
  hook_status="conflict"
  hook_detail="$1"
  hook_conflict=1
  conflicts=$((conflicts + 1))
}

if [ ! -f "$KIT_DIR/$COLLECTOR_REL" ] || [ ! -f "$KIT_DIR/scripts/merge-claude-hook.mjs" ]; then
  # A kit old enough not to ship the collector has nothing to declare. Reporting a missing
  # hook there would send someone hunting for a file that was never in that version.
  #
  # The merge script is checked alongside it, and that second half is not hypothetical: 0.35.x
  # ships the collector and not the merge, and it is the version already sitting in projects.
  # Without this, installing that --ref ran a script that is not there and printed a Node stack
  # trace as the "Reason" in a report whose whole purpose is to be readable by someone who does
  # not read code.
  hook_status="none"
  # Distinguished in the report from "this project does not want it": a kit that ships the
  # collector without the merge leaves a project with the script installed and nothing calling
  # it, which is the exact silence T074 exists to end. Saying "not in this version" alone would
  # read as nothing to do.
  [ -f "$KIT_DIR/$COLLECTOR_REL" ] && hook_status="collector-without-merge"
elif hook_why="$(is_excluded "$COLLECTOR_REL")"; then
  # Excluding the collector is how a project says it doesn't want this at all. There is no
  # separate path to declare for the hook: without the script it calls, the hook has no one
  # to run, so the exclusion covers both — and this is a CLEAN install, not a conflict.
  hook_status="excluded"
  hook_detail="$hook_why"
elif ! command -v node >/dev/null 2>&1; then
  # Without node the merge cannot run, and finishing green would leave a project believing
  # it collects transcripts while nothing does. The block is printed and this counts as a
  # conflict, like every other way of ending up without the hook.
  hook_note_conflict "node is not installed on this machine, so the merge could not run"
else
  hook_args=(--settings "$HOOK_SETTINGS")
  [ "$DRY_RUN" -eq 0 ] && hook_args+=(--apply)
  # stdout and stderr are captured SEPARATELY, and that separation is load-bearing.
  # Merging them with 2>&1 was a real defect: this script reads the merge's status from the
  # first line, and any machine whose node prints to stderr before the program runs — a
  # NODE_OPTIONS instrumentation shim, a version manager that greets, an ExperimentalWarning —
  # pushed that line down. The status was then read as unrecognized, so a settings.json that
  # HAD been written was reported as untouched, the install ended incomplete, and the version
  # marker never advanced again on that machine. The report said the opposite of the disk.
  # Its own temp file: CLEANUP_DIR only exists when the kit was cloned, and with --from it is
  # empty, which would send this redirect to /hook-stderr.txt and fail before node ever ran.
  hook_err="$(mktemp)" || hook_err=""
  # Named rather than left to surface as an ambiguous-redirect error from bash: without this
  # the reason printed was "the merge could not be completed: no output", which sends the
  # reader to the merge script when the problem is the temp directory.
  [ -n "$hook_err" ] || hook_note_conflict "a temporary file could not be created — check TMPDIR"
  hook_out="$(node "$KIT_DIR/scripts/merge-claude-hook.mjs" "${hook_args[@]}" 2>"$hook_err")"
  hook_rc=$?
  # Found by its prefix, not by its position: see the note in merge-claude-hook.mjs. Anything
  # the machine's node prints before the program runs is now just noise around a line we can
  # still locate.
  hook_line="$(printf '%s\n' "$hook_out" | sed -n 's/^AEKIT-HOOK-STATUS: //p' | head -1)"
  hook_rest="$(printf '%s\n' "$hook_out" | grep -v '^AEKIT-HOOK-STATUS: ')"
  # stderr is only ever quoted as the reason for a failure, never parsed for status.
  hook_stderr="$(cat "$hook_err" 2>/dev/null)"
  rm -f "$hook_err"
  case "$hook_rc:$hook_line" in
    0:created|0:added|0:present)
      hook_status="$hook_line"; hook_detail="$hook_rest" ;;
    3:conflict)
      hook_note_conflict "$hook_rest" ;;
    # Anything else is the merge itself failing, and it is treated as a conflict rather
    # than ignored: an unreadable answer about whether the hook got written is not an
    # answer, and the whole point here is never to finish green without it.
    *)
      hook_note_conflict "the merge could not be completed (exit $hook_rc): ${hook_out:-no output}${hook_stderr:+ | stderr: $hook_stderr}" ;;
  esac
fi

# ------------------------------------------------- merge attribute (.gitattributes)
# Task logs only grow: an entry is never edited, only appended. So when two branches each
# append to the same task log, git has nothing to reconcile — it just has to keep both
# sides. `merge=union` tells it to do that. It is a net: the kit has one writer per task
# log, and this covers two branches that appended anyway. It is not lossless — two appended
# entries that end in the same lines keep those lines only once — which is why the one-writer
# rule, not this line, is what the skills rely on.
#
# .gitattributes belongs to the project, so this is held to the same promise as
# settings.json above: one line appended, nothing else touched, and anything the project
# already declared for these paths wins — reported as a conflict with the line to paste,
# and the file is left alone. The decision is asked of git (`git check-attr`), not read
# from the file: in .gitattributes the LAST matching rule wins, and a nested file or
# .git/info/attributes can decide it too, so a blind append could silently override a rule
# of the project's own — or be silently overridden by one.
ATTR_REL=".gitattributes"
ATTR_FILE="$TARGET/$ATTR_REL"
ATTR_LINE="logs/tasks/*.md merge=union"
ATTR_COMMENT="# ae-kit — task logs only grow, so a merge keeps the entries of both sides"
ATTR_PROBE="logs/tasks/T000-probe.md"
attr_status="none"     # created | added | present | excluded | conflict
attr_detail=""
attr_conflict=0

attr_note_conflict() {
  attr_status="conflict"
  attr_detail="$1"
  attr_conflict=1
  conflicts=$((conflicts + 1))
}

# What merge attribute git applies today to a task log in the target. Inside a repo — its
# root or any folder of it, like a project in a monorepo — the repo answers, with every
# source it reads (.git/info/attributes, core.attributesFile, parent .gitattributes).
# Outside one (a project not yet under git) only the target's own file can say anything,
# so it is asked in a scratch repo holding a copy of it.
attr_now() {
  if git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$TARGET" check-attr merge -- "$ATTR_PROBE" 2>/dev/null | sed 's/^.*: merge: //'
  else
    local scratch
    scratch="$(mktemp -d)" || return 1
    git -C "$scratch" init -q 2>/dev/null
    [ -f "$ATTR_FILE" ] && cp "$ATTR_FILE" "$scratch/.gitattributes"
    git -C "$scratch" check-attr merge -- "$ATTR_PROBE" 2>/dev/null | sed 's/^.*: merge: //'
    rm -rf "$scratch"
  fi
}

# What git would apply using ONLY the .gitattributes files that travel with the project —
# every one on the way from the repo's top down to logs/tasks/ — with the machine's own
# sources switched off (.git/info/attributes, core.attributesFile, the system file). A rule
# that lives only on this machine is not in any clone, CI run or colleague's checkout, so it
# cannot count as the project already having the line.
attr_travels() {
  local scratch top tgt rel sub part parts
  scratch="$(mktemp -d)" || return 1
  git -C "$scratch" init -q 2>/dev/null
  top="$(git -C "$TARGET" rev-parse --show-toplevel 2>/dev/null)"
  [ -n "$top" ] || top="$TARGET"
  top="$(cd "$top" && pwd -P)"; tgt="$(cd "$TARGET" && pwd -P)"
  rel="${tgt#"$top"}"; rel="${rel#/}"
  [ -f "$top/.gitattributes" ] && cp "$top/.gitattributes" "$scratch/.gitattributes"
  IFS='/' read -r -a parts <<< "${rel:+$rel/}logs/tasks"
  sub=""
  for part in "${parts[@]}"; do
    sub="${sub:+$sub/}$part"
    if [ -f "$top/$sub/.gitattributes" ]; then
      mkdir -p "$scratch/$sub"; cp "$top/$sub/.gitattributes" "$scratch/$sub/.gitattributes"
    fi
  done
  GIT_ATTR_NOSYSTEM=1 git -C "$scratch" -c core.attributesFile=/dev/null \
    check-attr merge -- "${rel:+$rel/}$ATTR_PROBE" 2>/dev/null | sed 's/^.*: merge: //'
  rm -rf "$scratch"
}

if attr_why="$(is_excluded "$ATTR_REL")"; then
  attr_status="excluded"
  attr_detail="$attr_why"
elif ! command -v git >/dev/null 2>&1; then
  attr_note_conflict "git is not installed on this machine, so what it applies today could not be asked"
else
  attr_before="$(attr_now)"
  attr_carried="$(attr_travels)"
  # Two answers, and the case is decided by both. attr_carried is what the project's own
  # files say (what every clone and CI run gets); attr_before is what git applies on this
  # machine, with .git/info/attributes and the global file on top. The project's files
  # decide what to do; the machine's answer can only turn that into a conflict, never into
  # a write over a rule of the project's, and never into "present".
  case "$attr_carried:$attr_before" in
    union:union)
      attr_status="present"
      # Present on disk is not present in the project until it is committed: a line written
      # by an earlier, interrupted install, or a .gitattributes git ignores, is on this
      # machine only.
      if git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
         && ! git -C "$TARGET" ls-files --error-unmatch -- "$ATTR_REL" >/dev/null 2>&1; then
        attr_status="present-uncommitted"
      fi ;;
    union:*)
      attr_note_conflict "the project's own files say merge=union for $ATTR_PROBE, but this machine answers merge: ${attr_before:-nothing} — a rule in .git/info/attributes overrides it here, and task-log merges on this machine would not keep both sides" ;;
    unspecified:unspecified|unspecified:union)
      if [ -f "$ATTR_FILE" ]; then attr_status="added"; else attr_status="created"; fi
      if [ "$DRY_RUN" -eq 0 ]; then
        # A last line with no newline would swallow ours into it.
        if [ -s "$ATTR_FILE" ] && [ "$(tail -c 1 "$ATTR_FILE" | od -An -c | tr -d ' ')" != '\n' ]; then
          printf '\n' >> "$ATTR_FILE"
        fi
        printf '%s\n%s\n' "$ATTR_COMMENT" "$ATTR_LINE" >> "$ATTR_FILE"
        # The effect, not the absence of an error: both answers have to be union now.
        attr_after="$(attr_now)"
        attr_carried="$(attr_travels)"
        if [ "$attr_after" != "union" ] || [ "$attr_carried" != "union" ]; then
          attr_note_conflict "the line was appended to $ATTR_REL but git answers merge: ${attr_after:-nothing} here and ${attr_carried:-nothing} from the project's own files for $ATTR_PROBE — another rule overrides it (a nested .gitattributes, or .git/info/attributes)"
        fi
      fi ;;
    unspecified:)
      attr_note_conflict "git gave no answer about the merge attribute of $ATTR_PROBE" ;;
    unspecified:*)
      attr_note_conflict "this machine declares merge: $attr_before for $ATTR_PROBE (in .git/info/attributes or a global attributes file), and a rule declared on purpose is not decided for you" ;;
    :*)
      attr_note_conflict "git gave no answer about the merge attribute of $ATTR_PROBE" ;;
    *)
      attr_note_conflict "this project already declares merge: $attr_carried for $ATTR_PROBE, and a rule of the project's own is not overridden" ;;
  esac
fi

# --------------------------------------------------------------------- kit manifest
# .ae-kit-manifest is the footprint of what this install left on disk: one line per kit
# file, with the SHA-256 of its bytes and its path. A project has no kit/ to compare its
# copy against — that only exists in the repo that produces the kit — so without this file
# nothing there can tell an untouched kit file from one somebody edited. The project's
# verifier (check-local-adjustments.mjs) reads it on every commit, and the next install
# reads it to tell an edited kit file from one that is only out of date.
#
# FORMAT — kept trivial so any program recomputes it the same way:
#   lines starting with `#` are comments; the header names the kit version that wrote it
#   every other line is `<sha256>  <path>`: 64 lowercase hex characters, TWO spaces, then
#   the path relative to the project root, never absolute, never with a `..` segment,
#   never repeated. Sorted by path in byte order (LC_ALL=C), so it is stable across machines.
#   The hash is of the file's BYTES, read from stdin so no tool escapes the name. Node's
#   crypto.createHash('sha256') over readFileSync() gives the same digest.
#
# WHAT GOES IN: every kit file this install wrote, replaced or found already identical,
# including a task-log piece installed over a declaration (it is on disk because the kit put
# it there). WHAT DOES NOT: anything declared in .ae-kit-excluded, anything the installer
# never copies (the suites, check-installed-copy.mjs, merge-claude-hook.mjs), a kit file it
# could not write, and what it writes without a source in the kit — .ae-kit-version, the
# hook in .claude/settings.json, the line in .gitattributes. Those are the project's files.
# The manifest does not list itself.
#
# WRITTEN ON EVERY INSTALL THAT GETS THROUGH THE COPY (D032). Since kit files are always
# replaced, what is on disk after the copy IS the kit's, conflict in a project file or not:
# a conflict in settings.json or .gitattributes, or a kit file that could not be written,
# stops only the version marker. Keeping the previous manifest instead would describe files
# that are no longer there. A refused install never gets here, so its manifest is untouched.
# If no SHA-256 tool exists, or the file cannot be written, none is: an empty or partial
# manifest would be worse than none, and a previous one is removed if this run changed kit
# files, since its hashes no longer describe them.
# The whole file is written to a temporary name and moved into place at the very end, so an
# install that dies half way never leaves a partial manifest behind.
#
# KNOWN LIMIT: bytes, not file mode. A kit file whose only change is its executable bit
# hashes the same; check-installed-copy.mjs compares the bit, where kit/ exists.
manifest_status=""     # excluded | dry-run | written | failed
manifest_detail=""
manifest_failed=0
manifest_removed=0

if manifest_why="$(is_excluded "$MANIFEST_REL")"; then
  manifest_status="excluded"
  manifest_detail="$manifest_why"
  skipped=$((skipped + 1))
  skipped_list="${skipped_list}  ${MANIFEST_REL} — ${manifest_why}"$'\n'
  [ -f "$MANIFEST" ] && skipped_present_list="${skipped_present_list}  ${MANIFEST_REL}"$'\n'
elif [ "$DRY_RUN" -eq 1 ]; then
  manifest_status="dry-run"
else
  manifest_tmp="$MANIFEST.tmp.$$"
  if [ -z "$HASH_TOOL" ]; then
    manifest_failed=1
    manifest_detail="neither sha256sum nor shasum is installed on this machine, so no file could be hashed"
  elif ! {
      printf '# .ae-kit-manifest — written by the ae-kit installer; not edited by hand.\n'
      printf '# The SHA-256 of every kit file this install left on disk, then two spaces and its path.\n'
      printf '# kit-version: %s\n' "$KIT_VERSION"
    } > "$manifest_tmp" 2>/dev/null; then
    manifest_failed=1
    manifest_detail="$manifest_tmp could not be written"
  else
    prev_path=""
    while IFS= read -r mp; do
      [ -n "$mp" ] || continue
      # The installer only ever produces relative paths under the target, each once. These
      # guards make the promise checkable rather than assumed: a line that breaks it is a
      # bug here, and failing beats handing the verifier a path outside the repo.
      case "/$mp/" in
        //*|*/../*|*/./*) manifest_failed=1; manifest_detail="refused to record the path '$mp'"; break ;;
      esac
      if [ "$mp" = "$prev_path" ]; then
        manifest_failed=1; manifest_detail="the path '$mp' came up twice"; break
      fi
      prev_path="$mp"
      if ! h="$(sha256_of "$TARGET/$mp")"; then
        manifest_failed=1; manifest_detail="$mp could not be hashed with $HASH_TOOL"; break
      fi
      printf '%s  %s\n' "$h" "$mp" >> "$manifest_tmp"
    done < <(printf '%s\n' "${manifest_paths[@]+"${manifest_paths[@]}"}" | LC_ALL=C sort)
  fi
  if [ "$manifest_failed" -eq 0 ] && mv -f "$manifest_tmp" "$MANIFEST" 2>/dev/null; then
    manifest_status="written"
  else
    [ "$manifest_failed" -eq 0 ] && manifest_detail="$MANIFEST could not be moved into place"
    manifest_failed=1
    rm -f "$manifest_tmp"
    manifest_status="failed"
    if [ -f "$MANIFEST" ] && [ "$changed_on_disk" -eq 1 ]; then
      rm -f "$MANIFEST" && manifest_removed=1
    fi
  fi
fi

# ------------------------------------------------------------------- version marker
MARKER_REL=".ae-kit-version"
MARKER="$TARGET/$MARKER_REL"
# The marker is a GENERATED PIECE: this installer writes it without any source file
# fuente en kit/. Aun así un proyecto puede declararla en .ae-kit-excluded como cualquier
# any other piece, and then it isn't stamped — the repo producing the kit does exactly
# that, because there its own VERSION is already the truth and the marker could only repeat
# it or lie. It's read from the SAME list with the SAME parser as everything else, on
# purpose: a flag like --no-version-marker would have been a state you must remember on
# every reinstall, and the marker would come back on the next one — precisely the loop
# .ae-kit-excluded exists to close. check-installed-copy.mjs knows this same piece
# (GENERATED) and so doesn't report it as a phantom exclusion despite it not being in the kit.
marker_excluded=0
marker_excluded_unsound=0
marker_why=""
if marker_why="$(is_excluded "$MARKER_REL")"; then
  marker_excluded=1
  skipped=$((skipped + 1))
  skipped_list="${skipped_list}  ${MARKER_REL} — ${marker_why}"$'\n'
  # Like any other skip: whatever was already there isn't deleted, it's reported.
  [ -f "$MARKER" ] && skipped_present_list="${skipped_present_list}  ${MARKER_REL}"$'\n'
  # Excluding the marker only makes sense where the kit and the project are the SAME repo:
  # there, its own VERSION is the source. Anywhere else it switches off the only drift
  # detector there is — and switches it off silently one step further on, because the skill
  # that used to ask now has instructions to skip the step without reporting a failure.
  # That is exactly the drift that left two projects running stale skills for a week.
  # It warns loudly rather than refusing: this installer has never blocked over a project's
  # own declaration (an exclusion with no reason is likewise ignored and reported), and
  # turning that into a block here would surprise anyone with a reason I haven't foreseen.
  # The predicate is the SAME one check-installed-copy.mjs uses to decide "there's a kit
  # source here" (its kit/.claude/skills check). It started out as kit/VERSION, which looks
  # similar but isn't: any project vendoring a `kit` folder with a VERSION inside would have
  # switched the warning off. Two programs with two definitions of "this is the kit" is the
  # divergence this checker exists to catch, committed while writing it.
  [ -d "$TARGET/kit/.claude/skills" ] || marker_excluded_unsound=1
fi
# Only stamp the new version when the install actually COMPLETED. Writing it while files
# sat in conflict left the project running old skills under a marker claiming the new
# version — and `check-kit-current.mjs` then answered "up to date" forever. The marker is
# the only mechanism that detects drift, so a false stamp doesn't just lose information,
# it disables the detector. This is the very symptom that script exists to eliminate.
# A copy that failed, or a manifest that could not be written, is incomplete the same way.
if [ "$marker_excluded" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ "$conflicts" -eq 0 ] \
   && [ "$copy_failed" -eq 0 ] && [ "$manifest_failed" -eq 0 ] && [ "$retire_failed" -eq 0 ]; then
  printf '%s — installed %s from %s\n' "$KIT_VERSION" "$(date +%Y-%m-%d)" "$SOURCE_DESC" > "$MARKER"
fi

# -------------------------------------------------------------------------- report
echo "  new files written:      $written"
[ "$DRY_RUN" -eq 1 ] && echo "  kit files to replace:   $replaced" \
                     || echo "  kit files replaced:     $replaced"
echo "  already up to date:     $identical"
if [ "${#retire_paths[@]}" -gt 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then echo "  to retire (kit dropped): ${#retire_paths[@]}"
  else echo "  retired (kit dropped):  $(printf '%s' "$retired_list" | grep -c .)"
  fi
fi
# Skipping silently would be exactly the failure this installer already avoids by reporting
# conflicts: a piece that never arrived and nobody mentioned.
if [ "$skipped" -gt 0 ]; then
  echo "  skipped (declared):     $skipped"
fi
# Only the project's own files can conflict now — settings.json and .gitattributes. A kit
# file never does: it is replaced. The label says so, so nobody reads it as kit files left
# behind (the old installer's meaning).
echo "  project-file conflicts (left alone): $conflicts"
# Always reported, in every state including "nothing to do". A line that only appears when
# something happened teaches nobody to look for it, and this is the line that says whether
# subagent transcripts will be collected at all.
case "$hook_status" in
  created)  [ "$DRY_RUN" -eq 1 ] && echo "  Claude Code hook:       would be written (new settings file)" \
                                 || echo "  Claude Code hook:       written (new settings file)" ;;
  added)    [ "$DRY_RUN" -eq 1 ] && echo "  Claude Code hook:       would be written (added to your settings)" \
                                 || echo "  Claude Code hook:       written (added to your settings)" ;;
  present)  echo "  Claude Code hook:       already present" ;;
  excluded) echo "  Claude Code hook:       declared out — ${hook_detail}" ;;
  conflict) echo "  Claude Code hook:       needs a manual line — see below" ;;
  collector-without-merge)
            echo "  Claude Code hook:       NOT declared — this kit version ships the collector"
            echo "                          but not the merge that declares it. scripts/collect-subagent.mjs"
            echo "                          is installed and nothing will ever call it: install a newer"
            echo "                          kit, or declare the hook by hand." ;;
  *)        echo "  Claude Code hook:       not in this version of the kit" ;;
esac
# Always reported, like the hook: this is the line that says whether two branches of one
# task can merge their task logs without a conflict.
case "$attr_status" in
  created)  [ "$DRY_RUN" -eq 1 ] && echo "  merge attribute:        would be written (new $ATTR_REL)" \
                                 || echo "  merge attribute:        written (new $ATTR_REL)" ;;
  added)    [ "$DRY_RUN" -eq 1 ] && echo "  merge attribute:        would be written (appended to your $ATTR_REL)" \
                                 || echo "  merge attribute:        written (appended to your $ATTR_REL)" ;;
  present)  echo "  merge attribute:        already present" ;;
  present-uncommitted)
            echo "  merge attribute:        already present — but $ATTR_REL is not committed (or git ignores it)" ;;
  excluded) echo "  merge attribute:        declared out — ${attr_detail}" ;;
  conflict) echo "  merge attribute:        needs a manual line — see below" ;;
esac
# Always reported, like the two above: this is the line that says whether the project can
# tell, on its next commit, that a kit file was edited.
case "$manifest_status" in
  excluded)    echo "  kit manifest:           declared out — ${manifest_detail}" ;;
  dry-run)     echo "  kit manifest:           would be written (${#manifest_paths[@]} files)" ;;
  written)     echo "  kit manifest:           written ($MANIFEST_REL, ${#manifest_paths[@]} files)" ;;
  failed)      echo "  kit manifest:           NOT written — see below" ;;
esac
[ -n "$PREVIOUS" ] && echo "  previous version:       $PREVIOUS"
echo

if [ "$skipped" -gt 0 ]; then
  echo "→ Skipped per .ae-kit-excluded, with the reason the project declares:"
  printf '%s' "$skipped_list"
  echo
fi
if [ -n "$required_override_list" ]; then
  echo "⚠ Installed even though .ae-kit-excluded declares them out. The skills write to the"
  echo "  task log through these, so without them no entry can be recorded:"
  printf '%s' "$required_override_list"
  echo
fi
if [ -n "$skipped_present_list" ]; then
  echo "⚠ These are declared out and yet EXIST in the project (left over from an earlier"
  echo "  install, most likely). A declared-out file is not deleted — remove them yourself:"
  printf '%s' "$skipped_present_list"
  echo
fi
if [ "$marker_excluded_unsound" -eq 1 ]; then
  # The message names the SAME condition tested above (kit/.claude/skills). It used to name
  # kit/VERSION, inherited from the previous predicate: in the typical case — a kit/ folder
  # with a VERSION inside — the warning pointed at a file sitting in plain sight, and a
  # warning that contradicts itself reads as a bug and gets ignored. This is precisely the
  # warning that cannot afford that.
  echo "⚠ .ae-kit-version is declared out and this project does NOT contain the kit source"
  echo "  (there is no kit/.claude/skills/ here). That exclusion exists for the repo that"
  echo "  PRODUCES the kit, where its own VERSION is already the source of the version."
  echo "  There is no such source here — having a kit/ folder with a VERSION inside is not"
  echo "  enough — so this project is left with no way to know whether its skills fell"
  echo "  behind: check-kit-current.mjs has nothing to read, and open-session will no longer"
  echo "  ask. If you copied .ae-kit-excluded from another project, drop that line and"
  echo "  reinstall."
  echo
fi
if [ "$excluded_malformed" -gt 0 ]; then
  echo "⚠ $excluded_malformed line(s) in .ae-kit-excluded declare no reason and were IGNORED."
  echo "  What they named was installed. An exclusion with no reason is not obeyed blindly."
  echo
fi

# What was replaced, sorted by what the previous manifest knew. The edited ones come last
# and loudest: they are the only ones where the project loses something it did on purpose,
# and the line under each one is how to get it back.
if [ -n "$updated_list" ]; then
  [ "$DRY_RUN" -eq 1 ] && echo "→ Would be replaced with the new version — unchanged since the last install:" \
                       || echo "→ Replaced with the new version — unchanged since the last install:"
  printf '%s' "$updated_list"
  echo
fi
if [ -n "$nomanifest_list" ]; then
  case "$prev_manifest_state" in
    broken)      why_none="the previous $MANIFEST_REL has a malformed line, so it was not trusted" ;;
    uncommitted) why_none="$MANIFEST_REL exists but was never committed, so it was not trusted" ;;
    excluded)    why_none="$MANIFEST_REL is declared out in .ae-kit-excluded" ;;
    unhashable)  why_none="no SHA-256 tool on this machine to compare against $MANIFEST_REL" ;;
    *)           why_none="there is no previous $MANIFEST_REL (no install has left one yet, or it was never committed)" ;;
  esac
  [ "$DRY_RUN" -eq 1 ] && echo "⚠ Would be replaced, with no manifest to compare against: nobody can tell whether" \
                       || echo "⚠ Replaced, with no manifest to compare against: nobody can tell whether"
  echo "  the project edited them — ${why_none}:"
  printf '%s' "$nomanifest_list"
  if [ "$IN_GIT" -eq 0 ]; then
    echo "  This is not a git repository: their previous content cannot be recovered."
  elif [ -n "$HEAD_SHA" ]; then
    echo "  Previous content of any of them, even after this install is committed:"
    echo "    git show $HEAD_SHORT:${GIT_PREFIX}<path>"
  else
    echo "  This repository has no commit yet: their previous content cannot be recovered."
  fi
  echo
fi
if [ -n "$edited_list" ]; then
  [ "$DRY_RUN" -eq 1 ] && echo "⚠ EDITED IN THE PROJECT, and would be replaced — they differ from ${base_desc}:" \
                       || echo "⚠ EDITED IN THE PROJECT, and replaced — they differed from ${base_desc}:"
  printf '%s' "$edited_list"
  echo "  A kit file is overwritten on every install. A fix the project needs belongs in"
  echo "  \"Local kit adjustments\" of CLAUDE.md (see ae-kit-templates/local-adjustments.md)."
  echo
fi

if [ "$base_ok" -eq 1 ] && [ "$base_desc" != "the previous manifest" ]; then
  case "$prev_manifest_state" in
    broken)      echo "→ The previous $MANIFEST_REL has a malformed line and was not trusted." ;;
    uncommitted) echo "→ $MANIFEST_REL exists but was never committed, and was not trusted." ;;
    *)           echo "→ There is no previous $MANIFEST_REL." ;;
  esac
  echo "  What the project changed, and what the kit dropped, were judged against ${base_desc}."
  echo
fi
if [ -n "$suspicious_list" ]; then
  echo "⚠ SUSPICIOUS lines in the previous $MANIFEST_REL — paths the installer never writes"
  echo "  (outside the four kit folders, absolute, or with . or ..). Nothing there was touched:"
  printf '%s' "$suspicious_list"
  echo
fi
if [ -n "$retired_list" ]; then
  [ "$DRY_RUN" -eq 1 ] && echo "→ Would be RETIRED — the kit no longer ships them, and they are unchanged:" \
                       || echo "→ RETIRED — the kit no longer ships them, and they were unchanged:"
  printf '%s' "$retired_list"
  if [ "$IN_GIT" -eq 1 ] && [ -n "$HEAD_SHA" ]; then
    echo "  Previous content of any of them: git show $HEAD_SHORT:${GIT_PREFIX}<path>"
  fi
  echo
fi
if [ "$retire_held" -eq 1 ]; then
  echo "⚠ NOT retired, because a kit file could not be written — the kit no longer ships these,"
  echo "  and they are unchanged. The next install does not track them: remove them by hand:"
  for rp in "${retire_paths[@]}"; do echo "  $rp"; done
  echo
fi
if [ -n "$kept_changed_list" ]; then
  [ "$DRY_RUN" -eq 1 ] && echo "⚠ The kit no longer ships these, but the project CHANGED them — they would be left:" \
                       || echo "⚠ The kit no longer ships these, but the project CHANGED them — left in place:"
  printf '%s' "$kept_changed_list"
  echo "  This is said once: they are no longer kit files, so the next install does not track"
  echo "  them. Keep them as the project's own (declare them in .ae-kit-local) or remove them."
  echo
fi
if [ -n "$retire_skip_list" ]; then
  echo "⚠ The kit no longer ships these, and they were NOT removed:"
  printf '%s' "$retire_skip_list"
  echo
fi
if [ -n "$retire_failed_list" ]; then
  echo "⚠ These files the kit dropped could NOT be removed (a permission, most likely):"
  printf '%s' "$retire_failed_list"
  echo
fi
if [ -n "$adj_rows" ]; then
  echo "⚠ \"Local kit adjustments\" in CLAUDE.md names a retired file — check-local-adjustments.mjs"
  echo "  rejects such a row on the next commit. Update or remove it:"
  printf '%s' "$adj_rows"
  echo
fi
# C-5: a project that ran the kit before, with nothing to compare against.
if [ "$base_ok" -eq 0 ] && [ -n "$PREVIOUS_VERSION" ] && [ "$prev_manifest_state" != "excluded" ]; then
  echo "⚠ The files the kit stopped shipping could NOT be identified, so none was removed:"
  echo "  there is no usable $MANIFEST_REL, and ${base_note:-the published v$PREVIOUS_VERSION could not be read}."
  echo
fi

if [ "$hook_conflict" -eq 1 ]; then
  echo "⚠ The SubagentStop hook was NOT written, and this file was left untouched:"
  echo "    $HOOK_SETTINGS"
  echo "  Reason: ${hook_detail}"
  echo
  echo "  Without it the subagent collector is installed and never runs, so every subagent"
  echo "  transcript in this project is lost when Claude Code expires it. Merge this into"
  echo "  that file by hand — keeping whatever is already there:"
  echo
  hook_paste_block
  echo
fi

if [ "$attr_conflict" -eq 1 ]; then
  echo "⚠ The task-log merge attribute was NOT settled in $ATTR_FILE"
  echo "  Reason: ${attr_detail}"
  echo
  echo "  Without it, two branches that each append to the same task log stop on a merge"
  echo "  conflict. If the project's own rule is deliberate, keep it and declare"
  echo "  .gitattributes in .ae-kit-excluded with the reason. Otherwise make git answer"
  echo "  'union' for logs/tasks/*.md — this line, placed after any rule that also matches:"
  echo
  echo "    $ATTR_LINE"
  echo
fi

if [ -n "$copy_failed_list" ]; then
  echo "⚠ These kit files could NOT be written (a permission, a full disk, a folder in the way):"
  printf '%s' "$copy_failed_list"
  echo
fi

if [ "$manifest_failed" -eq 1 ]; then
  echo "⚠ $MANIFEST_REL was NOT written. Reason: ${manifest_detail}"
  echo "  Without it this project cannot tell, on a commit, whether a kit file was edited."
  echo "  An empty or partial manifest would be worse than none, so none was written."
  echo
fi
if [ "$manifest_removed" -eq 1 ]; then
  echo "⚠ The previous $MANIFEST_REL was REMOVED. This install replaced kit files, so its"
  echo "  hashes no longer describe the disk, and keeping it would block every commit over"
  echo "  files the kit itself just changed. The next install that can hash writes a new one."
  echo
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run complete — nothing written."
  if [ "$notes_stop" -eq 1 ]; then
    echo
    notes_stop_message
    exit "$NOTES_EXIT"
  fi
  exit 0
fi

if [ "$conflicts" -gt 0 ] || [ "$copy_failed" -gt 0 ] || [ "$manifest_failed" -eq 1 ] || [ "$retire_failed" -gt 0 ]; then
  if [ "$conflicts" -gt 0 ]; then
    echo "✗ INCOMPLETE install — $conflicts file(s) of the project's need a manual line (see above)."
  else
    echo "✗ INCOMPLETE install — see the warnings above."
  fi
  [ "$copy_failed" -gt 0 ] && echo "  $copy_failed kit file(s) could not be written."
  [ "$retire_failed" -gt 0 ] && echo "  $retire_failed file(s) the kit dropped could not be removed."
  # The kit files that could be written were; the manifest describes them (D032).
  if [ "$manifest_status" = "written" ]; then
    echo "  The kit files were installed and $MANIFEST_REL describes them: commit it with them."
  fi
  if [ "$marker_excluded" -eq 1 ]; then
    echo "  The .ae-kit-version marker is declared out in .ae-kit-excluded: it is never"
    echo "  written, not even on a complete install. This is not a consequence of the above."
  else
    echo "  The .ae-kit-version marker did NOT move: it is still at '${PREVIOUS:-(none)}'."
  fi
  if [ "$hook_conflict" -eq 1 ]; then
    echo "  $HOOK_REL: paste the block above, then run again."
  fi
  if [ "$attr_conflict" -eq 1 ]; then
    echo "  $ATTR_REL: see the line above, then run again."
  fi
  [ "$copy_failed" -gt 0 ] && echo "  Fix what stopped those files from being written, then run again."
  # B-7 on this path too (T070 U6): the kit files were copied, so what the notes ask after
  # installing is already relevant — but it is said that the install has not finished, and
  # those steps come once it has.
  if [ "${#notes_after[@]}" -gt 0 ]; then
    echo
    echo "→ After installing — the install has NOT finished yet: fix the above and run again first."
    echo "  Then the release notes ask for these steps, which the install does not do:"
    for entry in "${notes_after[@]}"; do
      echo
      echo "  ${entry%%|*}:"
      printf '%s\n' "${entry#*|}" | grep -v '^[[:space:]]*$' | sed 's/^/  /'
    done
  fi
  exit 3
fi

echo "✓ Kit v$KIT_VERSION installed."
echo
echo "Next:"
# Numbered as printed: steps 3 to 5 appear only when they apply, and a fixed number left
# gaps ("1, 2, 3, 5") whenever one of them did not.
step=0
next_step() { step=$((step + 1)); echo "  $step. $1"; }
next_step "Open Claude Code in $TARGET and run the \`setup\` skill — it runs the stack"
echo "     interview and generates CLAUDE.md and SETUP_CHECKLIST.md from the templates"
echo "     now in ae-kit-templates/ (it asks for the migrations folder and the database"
echo "     env vars rather than assuming a platform)."
next_step "Install the trigger points from SETUP_CHECKLIST.md section 4c — a rule with"
echo "     no hook behind it is a rule that will not fire."
case "$hook_status" in
  created|added)
    next_step "The SubagentStop hook is now declared in $HOOK_REL. Commit that file: a"
    echo "     hook nobody else has is a hook that only collects on one machine." ;;
  present)
    next_step "The SubagentStop hook was already declared in $HOOK_REL — nothing to do." ;;
esac
case "$attr_status" in
  created|added|present-uncommitted)
    next_step "The task-log merge attribute is declared in $ATTR_REL. Commit that file:"
    echo "     git only applies it where the file is." ;;
esac
if [ "$manifest_status" = "written" ]; then
  next_step "$MANIFEST_REL records the hash of every kit file just installed. Commit it:"
  echo "     a clone, a worktree or CI only has it if it is committed, and without it a"
  echo "     kit file edited by hand goes unnoticed. The next install reads the committed one."
fi

# B-7: what the install did not do by itself, last, after the report, so it is what is read
# when the run ends. Every version in the range whose "After installing" is not empty.
if [ "${#notes_after[@]}" -gt 0 ]; then
  echo
  echo "→ After installing — the release notes ask for these steps, which the install does not do:"
  for entry in "${notes_after[@]}"; do
    echo
    echo "  ${entry%%|*}:"
    printf '%s\n' "${entry#*|}" | grep -v '^[[:space:]]*$' | sed 's/^/  /'
  done
fi
