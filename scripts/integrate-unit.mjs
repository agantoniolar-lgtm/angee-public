#!/usr/bin/env node
/**
 * integrate-unit.mjs — takes a unit of work built in its own worktree back into the tracked branch.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * When a unit is delegated, a builder writes it in a git worktree on its own branch
 * `ai/<task>-<unit>`, commits it, and returns. What the session does next — compare the
 * branch against what the unit declared, rebase it, review it, integrate it, or throw it
 * away — used to be paragraphs in `build` and `ship`, and paragraphs are the step an agent
 * skips. So each step is a subcommand here, with a suite, and the skills only call it.
 *
 * ── check ────────────────────────────────────────────────────────────────────────────
 * Compares the unit's branch against its `touches:`, the write contract `scope` agreed:
 * - exactly one commit, not a merge: one unit is one commit;
 * - nothing uncommitted left in the builder's worktree, which is kept either way;
 * - no task-state file (`tasks/`, `logs/tasks/`, the three indexes): only the session that
 *   dispatched the unit writes those;
 * - no overlap. A file the unit wrote counts as overlapping when another unit of the task
 *   still in flight declared it, or when it changed on the tracked branch after the unit's
 *   branch started — declared or not, and whoever changed it: a unit of this task or of
 *   another. Then the unit is rebuilt on the new version, and nothing is merged over
 *   another's edit. Overlap is measured per file, never per line: git merging two edits
 *   cleanly says nothing about whether they agree. Deleted and renamed files count under
 *   both names;
 * - no file another task has. A file another task has is not written by anyone else until
 *   that task lets go of it. Who has what is task-units.mjs's `collectHolds`, from git: a
 *   unit of another task dispatched and not integrated has what it declared, what its
 *   branch wrote and what its worktree has uncommitted; the branch `ai/<task>` of a task
 *   held or in progress has what it wrote. A file of the unit, declared or not, that one of
 *   them has is refused, with what the declared outranks: when only this unit declared it
 *   and the other wrote it without declaring it, this unit passes, and the other is the one
 *   refused at its own check; when both declared it, or neither did, check does not choose
 *   (each would wait for the other), and the project owner decides which waits. The
 *   instruction differs from the overlap's: the unit is not rebuilt now, it waits until the
 *   other lets go of the file (or the owner decides) and goes through `rebase`, which checks
 *   again and says whether it has to be rebuilt — no promise that it will not: by then the
 *   other unit has usually changed the file. A file another task has that also changed on the
 *   tracked branch gets one refusal, with that same instruction. A unit is told one thing per
 *   run: when any of its files is one another task has, its overlap, merge-commit and
 *   main-checkout-write refusals of that run say to wait too, never to rebuild now — what
 *   rebase says afterwards decides. A task-state file is had by nobody;
 * - no write into the main checkout: a file of the unit that is dirty there was written by
 *   path, outside the worktree;
 * - the branch never reached a remote, and the tracked branch's own pre-commit hook passes
 *   on the commit, so a `--no-verify` does not go through unseen.
 * An undeclared file that nobody else touched is accepted, and listed for the reviewer.
 * `task-units.mjs --plan` keeps two tasks off the same file before building; check is the
 * net for what that cannot prevent: a file written without declaring it, two plans at the
 * same instant, and the limits stated in task-units.mjs's header.
 *
 * ── rebase ───────────────────────────────────────────────────────────────────────────
 * The order is compare, rebase onto the current tip, review, integrate (the owner, 2026-09-28).
 * `rebase` runs `check`, replays the one commit onto the tip, and runs `check` again on the
 * replayed commit, whose parent is now the tip — so the pre-commit's trusted run applies
 * the rules the tracked branch gained after the unit started. A conflict aborts the rebase
 * and leaves the branch where it was: the unit is rebuilt, never repaired (B-5, as B-2).
 * The old and the new hash are printed — to stderr as soon as the branch moves, so a run cut
 * short still leaves them. Since check refuses a unit whose files the tip changed, the
 * replay never meets one of them, and a review of the old commit carries over by the rule
 * integrate reads (D020). Run again after a review, when another unit landed first, it does
 * the same. A unit branch is rebased only through here: a `git rebase` by hand in a unit's
 * worktree skips the check, merges by line over files the tip changed, and leaves a branch
 * whose history no longer says when the unit was dispatched — which record reads (below).
 * Without --base it refuses, like integrate, when the main checkout is on a detached HEAD
 * or in the middle of a rebase, merge or cherry-pick: its HEAD is then no tip to rebase on.
 * The replay needs git 2.40 or later (`git merge-tree --merge-base`); an older git makes
 * rebase impossible (exit 2), says so, and moves nothing.
 *
 * ── integrate ────────────────────────────────────────────────────────────────────────
 * Runs `check`, then the suites in the unit's worktree, and only when they come out green
 * fast-forwards the branch checked out in the main checkout to the unit's commit with
 * `--ff-only` (D026). It holds the order compare, rebase, review, verify, integrate, and
 * refuses, changing nothing:
 * - with no `--verify <command>` (D026, D-5): nothing enters untested;
 * - with no review of the commit (B-10). The review is a `review-round` in the task's own log,
 *   logs/tasks/<task-id>.md, with the fields `unit:` (the unit), `commit:` (a sha) and
 *   `blocking:` (a count); neither its body nor its `result:` is read. It covers that commit, or
 *   one with the same `git patch-id --verbatim` of `git show --binary` whose replay changed none
 *   of the unit's files on the way (D020) — an amended commit, even by indentation alone, or
 *   one rebased through a conflict, needs a new round. A replaced round is not read; of the
 *   rest, the latest naming that exact sha decides, and only with none, the latest by same
 *   patch. Its `blocking:` must be 0, or every blocking finding written under it must be closed
 *   by a `decision` (the owner accepting the risk in writing, D062); a fix needs a new round,
 *   and the decisions it relied on are printed;
 * - when the task has a blocking finding open (D025), by the rule of the task log's view (a
 *   finding that stands and nothing in the log resolves), whatever the round's `blocking:` says;
 * - when the commit lacks this task's `Task:` line or the unit's `Unit:` line (B-10);
 * - when a unit this one depends on has no `commit:` recorded in the task file that is in the
 *   tracked branch (B-5, B-13): the record decides, not the check mark. One checked off with
 *   no commit carrying its Unit: line was integrated before those lines: the refusal says the
 *   task is finished with the kit it started with;
 * - when the commit does not sit on the current tip (run `rebase`), or the main checkout has
 *   uncommitted changes to a file the commit changes (R-8). It never forces;
 * - when the unit's branch has no worktree of its own to run the command in;
 * - when the command fails there (D-2): the tracked branch never moved, so there is nothing to
 *   take out, and its last lines are given; when it moved the worktree's HEAD; or when the
 *   tracked branch moved while it ran (D-3): what was verified sits on the old tip; or when,
 *   while it ran, a round with blocking findings or an open blocking finding was recorded: the
 *   review and D025 are read again after it. It runs with GIT_TERMINAL_PROMPT=0.
 * The command runs with `sh -c` in the unit's worktree — which `rebase` left on the current tip
 * — with what that worktree has: an ignored file of the main checkout (a .env) is not there,
 * and a suite that needs one fails red, not green (D-7). Whatever it leaves uncommitted there
 * as a new file is listed and never integrated: only the commit goes in (D-4); a tracked file it
 * changed is a refusal, since the suites then passed on a tree that is not the commit. The
 * command is returned as `verifiedWith` and printed with the integration, for the task log.
 * Then it checks the unit off in the task file, writes the commit
 * under it as `  - commit: <full sha>` — keeping one that is already the unit's and in the
 * branch, as for a fix (R-8), and replacing one that is not, as after a rebuild (B-8) — and regenerates the
 * indexes with generate-task-index.mjs, in the main checkout and uncommitted: the session
 * that runs it writes the state, and the task's closing commit carries it (C-2). The
 * worktree and the branch are left as they are. Last, it lists the units of other tasks
 * `in progress` or `waiting on owner`, not dispatched yet, that declare a file of the commit
 * nobody else has now (`released`): each one no longer waits for that file — which is not
 * that it can start, since it may wait on something else, and `--plan` is what dispatches.
 * Until the state is written, the unit's worktree keeps having its files for everyone else.
 *
 * ── discard ──────────────────────────────────────────────────────────────────────────
 * Throws a unit's branch away, integrated or not: after an integration (B-12), when check
 * refuses it and the unit is rebuilt from the current base (B-2, B-7), and before its
 * branch is recreated for a rebuild (R-5). It removes the unit's worktree and deletes its
 * branch with -D. A commit of the branch that is not in the tracked branch would lose its
 * last reference with it, so it is first kept on a backup branch `ai/<task>-<unit>-backup-<n>`,
 * never integrated and deleted when the task ships. Work left uncommitted in the worktree is
 * never forced away (R-6, the owner 2026-09-28): it is first committed, through scratch indexes,
 * on such a backup branch — as two commits, the index and then the disk, when a file has a
 * staged version that differs from both — and the worktree is pointed at that commit, so
 * `git worktree remove` runs without --force and git itself refuses if anything is still not
 * in the backup. A retry whose content matches an existing backup reuses it. Before moving
 * HEAD, discard writes a mark in the worktree's own git directory (task, unit, branch,
 * backup); a worktree a discard cut short left detached on a backup with that mark is taken
 * up again, and one on a backup without it — opened by hand, a check's scratch — is left. Ignored
 * files (node_modules, a .env written by hand) are in no backup and go with the worktree
 * (the owner, 2026-09-30): they are listed in the output and in the JSON (`ignored`), for the
 * session to copy into the task log. It refuses, changing nothing, when the main checkout is on a detached
 * HEAD or halfway through an operation (integrated is measured against its branch), when the
 * branch is checked out in the main checkout, or its worktree is locked, missing or in the
 * middle of a rebase or merge. A unit is U<digits>, so it only ever deletes ai/<task>-U<n>,
 * never a backup or another branch. A unit not checked off lets go of its files with its
 * branch, and discard lists, as integrate does, the units of other tasks that no longer wait
 * for them. Discarding a unit whose builder is gone releases its files; when that unit is
 * another task's work, running discard is the project owner's call.
 *
 * There is no `undo` (T123 U3): the suites run before the tracked branch moves, so nothing red
 * is ever integrated. A unit already integrated comes out with a plain `git revert`, and
 * whoever reverts it unchecks it and removes its `commit:` (B-6).
 *
 * ── record ───────────────────────────────────────────────────────────────────────────
 * With a single writer the unit is committed on the tracked branch and no integrate runs, so
 * record writes what integrate would (D024): it finds in the branch's history the one commit
 * whose `Task:` names this task and whose `Unit:` names the unit, checks the unit off and
 * writes `  - commit: <sha>` under it, uncommitted — the session's next commit carries it.
 * With several (a fix carries the unit's Unit: line too) the oldest is recorded, unless a later
 * commit reverted it ("This reverts commit <sha>"): then it refuses and --commit chooses. A
 * unit that already records a commit of the branch keeps it (R-8): a fix never replaces it.
 * `--commit` chooses, among the commits with the unit's lines, only while there is no such
 * record. None is refused. It reads no review: run it once the unit's review round came back
 * clean. It does check the files the unit's commits wrote against what other tasks have, by
 * the same rule as check, and refuses the same way; since the commit is already on the
 * tracked branch, what to do then is the project owner's to say. A holder whose branch
 * already contains the commit does not count: that is read as dispatched after it, and built
 * on it. The limit: a unit dispatched before the commit and then rebased by hand (`git
 * rebase` in its worktree, not `integrate-unit.mjs rebase`) onto a tip that holds it also
 * contains it, and is left out the same way although it was built on the older version.
 * Nothing in git tells the two apart, and nothing here catches it later either: the rebase
 * moved that unit's starting point past the commit, so its own check sees no overlap. Only
 * build's rule against rebasing a unit by hand prevents it.
 *
 * ── status ───────────────────────────────────────────────────────────────────────────
 * Says what is alive of a task and whether its record is right, and only reads: nothing is
 * moved, removed or deleted, whatever it finds (C-6). Alive: the worktrees on a branch of the
 * task, or detached on one of its backups (where a discard cut short leaves one, with its
 * mark), each with its uncommitted paths; the unit branches ai/<task>-U<n>, integrated or
 * not (C-5); and the backups discard left, ai/<task>-U<n>-backup-<k>. The record: each unit's
 * `commit:` line in "## Done when", written by integrate or record. Nothing is deduced from
 * the history (D019): a `commit:` must be the hex sha of a commit of the tracked branch whose
 * Task: and Unit: lines are the unit's (B-2), a unit
 * checked off must have one (B-3; a task closed before this version reads "no record" per
 * unit, D028, B-7), one with it must be checked off (B-4), and a unit's commit sits at or
 * above the commit of every unit it depends on. A revert is not looked for (B-6): whoever
 * reverts a unit unchecks it and removes its `commit:`. Exit 0 nothing out of place; 1
 * something to attend to, each finding with what to do; 2 it could not be read (no task, a
 * "## Done when" that cannot be parsed, a main checkout with no tracked branch and no --base).
 *
 * ── Usage ────────────────────────────────────────────────────────────────────────────
 *   integrate-unit.mjs check     <task-id | tasks/<file>.md> <unit> [--branch <name>] [--base <ref>]
 *                                [--in-flight U4,U5] [--root <path>] [--json]
 *   integrate-unit.mjs rebase    <task-id | tasks/<file>.md> <unit> [same options as check]
 *   integrate-unit.mjs integrate <task-id | tasks/<file>.md> <unit> --verify <command> [--branch <name>]
 *                                [--in-flight U4,U5] [--root <path>] [--json]
 *   integrate-unit.mjs discard   <task-id | tasks/<file>.md> <unit> [--branch <name>] [--root <path>] [--json]
 *   integrate-unit.mjs record    <task-id | tasks/<file>.md> <unit> [--base <ref>] [--commit <sha>] [--root <path>] [--json]
 *   integrate-unit.mjs status    <task-id | tasks/<file>.md> [--base <ref>] [--root <path>] [--json]
 *
 *   --commit     record: which of several commits of the unit to record
 *   --verify     integrate, required: the command that runs the suites, in the unit's worktree,
 *                before the tracked branch moves; red, nothing moves
 *   --branch     the unit's branch; by default the existing one of ai/<Tnnn>-<unit> and
 *                ai/<task-id>-<unit>
 *   --base       the tracked branch the unit returns to; by default HEAD of the main checkout
 *   --in-flight  units still being built, beyond the ones whose ai/ branch holds work
 *                that is not in the base yet
 *
 * Exit codes for check: 0 the unit keeps its contract, go on to review; 3 it passes, but it
 * wrote files it did not declare and nobody else touched — widen its `touches:`, note it in
 * the task log, and tell the reviewer (the list is printed); 1 refused, each reason with
 * what to do about it; 2 the check could not be made (no task, unit or branch, a remote that
 * did not answer). 2 is never a pass.
 * rebase and integrate use the same codes: 0 and 3 mean rebased (or integrated) with a
 * check that passes after it, 1 means refused, and for integrate that nothing changed —
 * a red verification included. For integrate, 2 after the fast-forward (the state could not
 * be written) says what moved: the unit IS integrated then.
 * `verdicts` in rebase's JSON lists every verdict that applies, pass-undeclared included.
 * discard and record: 0 done (or, for discard, nothing left to discard), 1 refused and
 * nothing changed, 2 could not be done — what moved before the failure, if anything, is said.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync, renameSync, realpathSync, accessSync, constants } from 'node:fs';
import { join, resolve, isAbsolute, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// An inherited GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE (a hook inside a linked worktree
// exports them) must reach no git at all — also in task-units.mjs, which builds its git
// environment from process.env as it loads. Run as a command, they are gone from process.env
// for good. Imported as a library, they are gone only while task-units.mjs loads, and put
// back after: the host's environment is its own, and what task-units.mjs runs is not.
const LOAD_CLEAN = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX'];
const hostGitEnv = Object.fromEntries(LOAD_CLEAN.filter((v) => v in process.env).map((v) => [v, process.env[v]]));
for (const v of LOAD_CLEAN) delete process.env[v];
let unitsModule;
try { unitsModule = await import(join(HERE, 'task-units.mjs')); }
finally { if (!isMain()) Object.assign(process.env, hostGitEnv); }
const { parseUnits, touchesProblems, pathsOverlap, normalizePath, rewriteField, collectHolds, holderName, readFrontmatter, CannotCheck: HoldsCannotCheck } = unitsModule;

/**
 * check-commit-task.mjs, the commit-msg hook's reader, or null when a project excluded it.
 * Its taskIdOf is the one rule for a task's short id (T104, TT-12); without it, the same
 * rule, copied, keeps every subcommand working.
 */
let commitTask = null;
try { commitTask = await import(join(HERE, 'check-commit-task.mjs')); }
catch (e) { if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
/** task-log.mjs, the one parser of a task log: integrate reads the review-round there. */
let taskLog = null;
try { taskLog = await import(join(HERE, 'task-log.mjs')); }
catch (e) { if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
const taskIdOf = commitTask?.taskIdOf
  ?? ((name) => { const base = name.replace(/^.*\//, '').replace(/\.md$/, ''); return base.match(/^([A-Za-z]+[-_.]?\d+)(?=$|[-_.])/)?.[1] ?? base; });

/** Files only the dispatching session writes (C-1). */
const STATE_DIRS = ['tasks/', 'logs/tasks/'];
const STATE_FILES = ['TASKS.md', 'BACKLOG.md', 'TASKS_ARCHIVE.md'];

/** Compared without case: on a case-insensitive filesystem `Tasks/` is `tasks/`. */
export function isStateFile(path) {
  const p = normalizePath(path).toLowerCase();
  return STATE_DIRS.some((d) => p.startsWith(d)) || STATE_FILES.some((f) => f.toLowerCase() === p);
}

class CannotCheck extends Error {
  constructor(message, extra = null) { super(message); this.extra = extra; }
}

// Git never prompts here for a password over HTTPS. An SSH key that asks for its passphrase
// is cut by the timeout on ls-remote instead: forcing an SSH command would override the
// project's own core.sshCommand.
// Every call names its repository by cwd. A GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE inherited
// from a hook (one inside a linked worktree exports them) would send every git here, and the
// project's hook, to that other repository, whatever the cwd says.
const INHERITED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX'];
const HOOK_ENV = { ...process.env };
for (const v of INHERITED) delete HOOK_ENV[v];
const GIT_ENV = { ...HOOK_ENV, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
const HOOK_TIMEOUT = 10 * 60 * 1000;
// A scratch checkout never fetches LFS objects: the hook sees their pointers, and a server
// that does not answer cannot hang the check.
const CHECKOUT = { timeout: 5 * 60 * 1000 };

function git(cwd, args, { allowFail = false, timeout = 0, env = GIT_ENV } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env, timeout });
  if (r.error && !allowFail) throw new CannotCheck(`git ${args.join(' ')} failed: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new CannotCheck(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r;
}

const zlist = (out) => out.split('\0').filter(Boolean);

/** Paths a range changed. Renames are split into a deletion and an addition, so both names count. */
function changedFiles(cwd, from, to) {
  return zlist(git(cwd, ['diff', '--name-only', '--no-renames', '-z', from, to]).stdout);
}

/** Every worktree, with its path and branch; the first one is the main checkout. */
function worktrees(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']).stdout;
  return out.split('\n\n').filter(Boolean).map((block) => {
    const path = block.match(/^worktree (.*)$/m)?.[1];
    const listed = block.match(/^branch refs\/heads\/(.*)$/m)?.[1] ?? null;
    const { op, branch } = inProgress(path);
    return { path, branch: listed ?? branch, op, locked: /^locked\b/m.test(block) };
  });
}

/**
 * An operation left half done in a checkout: a rebase stopped on a conflict or an `edit`,
 * a merge, cherry-pick or revert waiting on its conflicts, a bisect. Mid-rebase, git lists
 * the worktree as detached, but the branch being rebased is still its branch — its
 * `--abort` puts that branch back where it was — so it is read from `head-name`.
 */
function inProgress(path) {
  const r = git(path, ['rev-parse', '--absolute-git-dir'], { allowFail: true });
  const gd = (r.stdout || '').trim();
  if (r.error || r.status !== 0 || !gd) return { op: null, branch: null };
  for (const d of ['rebase-merge', 'rebase-apply']) {
    if (!existsSync(join(gd, d))) continue;
    let head = '';
    try { head = readFileSync(join(gd, d, 'head-name'), 'utf8').trim(); } catch { /* an `am` has none */ }
    const op = d === 'rebase-apply' && existsSync(join(gd, d, 'applying')) ? 'am' : 'rebase';
    return { op, branch: head.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : null };
  }
  const ops = [['MERGE_HEAD', 'merge'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'], ['sequencer', 'cherry-pick or revert'], ['BISECT_LOG', 'bisect']];
  for (const [f, op] of ops) if (existsSync(join(gd, f))) return { op, branch: null };
  return { op: null, branch: null };
}

function taskIds(file) {
  const text = readFileSync(file, 'utf8');
  const id = text.match(/^id:\s*(\S+)\s*$/m)?.[1] ?? file.replace(/^.*\//, '').replace(/\.md$/, '');
  const short = taskIdOf(id);
  return { id, short, text };
}

function resolveTaskFile(arg, root) {
  if (arg.endsWith('.md')) return isAbsolute(arg) ? arg : join(root, arg);
  const dir = join(root, 'tasks');
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f === `${arg}.md` || f.startsWith(`${arg}-`));
  return hit ? join(dir, hit) : null;
}

/** The unit branches of this task that exist locally: ai/<Tnnn>-U<n> or ai/<task-id>-U<n>. */
function unitBranches(root, ids) {
  const out = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/ai/']).stdout;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^ai/(?:${esc(ids.short)}|${esc(ids.id)})-(U\\d+)$`);
  return out.split('\n').filter(Boolean).map((b) => ({ branch: b, unit: b.match(re)?.[1] })).filter((x) => x.unit);
}

/**
 * Re-runs the tracked branch's pre-commit hook on the unit's commit, which is how a commit
 * made with --no-verify gets caught. The hook's entry point is resolved in the main checkout,
 * whatever checkout the command was run from. But a hook calls other files — its scripts,
 * its config — and those live in the tree, where the unit may have changed them. So it runs
 * twice, in scratch worktrees added with hooks off, and the unit passes only if both pass:
 *
 * - `content`: the commit's tree on disk, reset softly to its parent so its changes are
 *   staged. Every check sees the unit's files, but the scripts it runs are the unit's too.
 * - `trusted`: the parent's tree on disk, and the commit's tree only in the index. The
 *   scripts that run are the tracked branch's as of where the unit started, and a check
 *   that reads the index (a staged secret scan) sees the unit's files. A rule the tracked
 *   branch gained after that is applied once the unit is rebased onto the current tip and
 *   checked again, which is the order `rebase` follows.
 *
 * What neither run catches: a check that reads the working tree, whose script the unit
 * changed to let its own violation through — the `content` run executes the changed script,
 * and the `trusted` run reads the old files. That change is in the diff the reviewer gets.
 * Also declared: the scratch worktrees have no ignored files (no node_modules), so a hook
 * that needs them refuses the unit — a false refusal, never a false pass; and a process
 * killed mid-check leaves a scratch worktree registered until its folder is gone and
 * `git worktree prune` runs. A hook still running after ten minutes makes the check
 * impossible, never a pass.
 */
function rerunHook(mainRoot, sha) {
  const hookRel = git(mainRoot, ['rev-parse', '--git-path', 'hooks/pre-commit']).stdout.trim();
  const hook = isAbsolute(hookRel) ? hookRel : join(mainRoot, hookRel);
  if (!existsSync(hook)) return { ran: false, ok: true, output: 'no pre-commit hook in this repository' };
  try { accessSync(hook, constants.X_OK); } catch { return { ran: false, ok: true, output: 'the pre-commit hook is not executable, so git does not run it either' }; }
  const runs = [];
  for (const mode of ['content', 'trusted']) {
    const dir = mkdtempSync(join(tmpdir(), 'integrate-unit-'));
    const wt = join(dir, 'wt');
    try {
      if (mode === 'content') {
        git(mainRoot, ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--quiet', wt, sha], CHECKOUT);
        git(wt, ['reset', '--soft', '--quiet', 'HEAD~1']);
      } else {
        git(mainRoot, ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--quiet', wt, `${sha}~1`], CHECKOUT);
        git(wt, ['read-tree', sha]);
      }
      const r = spawnSync(hook, [], { cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: HOOK_TIMEOUT, env: HOOK_ENV });
      if (r.error?.code === 'ETIMEDOUT') throw new CannotCheck(`the pre-commit hook was still running after ${HOOK_TIMEOUT / 60000} minutes`);
      const output = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-15).join('\n');
      if (r.error) runs.push({ mode, ok: false, output: `the hook could not be run: ${r.error.message}` });
      else runs.push({ mode, ok: r.status === 0, output });
    } finally {
      // Only this scratch worktree: a prune would also drop the user's own worktrees whose
      // folder is missing for now, such as one on an unmounted disk.
      git(mainRoot, ['worktree', 'remove', '--force', wt], { allowFail: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const failed = runs.filter((x) => !x.ok);
  return { ran: true, ok: failed.length === 0, runs, output: failed.map((x) => `[${x.mode}] ${x.output}`).join('\n') };
}

/**
 * Remotes that hold the branch: its name, or its tip under any other name. A commit pushed
 * and then amended is not caught — the remote holds its old hash. A remote that does not
 * answer within 30 seconds makes the check impossible, never a pass.
 */
function remotesHolding(root, branch, tip) {
  const remotes = git(root, ['remote']).stdout.split('\n').filter(Boolean);
  const holding = [];
  for (const remote of remotes) {
    const r = git(root, ['ls-remote', remote], { allowFail: true, timeout: 30000 });
    if (r.error || r.status !== 0) throw new CannotCheck(`remote ${remote} did not answer, so nobody can say whether ${branch ?? tip} was pushed there: ${r.error ? r.error.message : (r.stderr || '').trim()}`);
    const refs = r.stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
    if (refs.some(([sha, ref]) => (branch && ref === `refs/heads/${branch}`) || sha === tip)) holding.push(remote);
  }
  return holding;
}

/** Paths that are modified, staged or untracked in a checkout, with renames under both names. */
function dirtyPaths(cwd) {
  // --no-optional-locks: a read never takes the index.lock a builder committing there needs.
  const entries = zlist(git(cwd, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout);
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    paths.push(e.slice(3));
    if (/^[RC]/.test(e)) paths.push(entries[++i]);
  }
  return paths;
}

const REBUILD = 'discard the branch without integrating or repairing it, and rebuild the unit from the current base';

/**
 * What every other task has, as task-units.mjs computes it from git (`collectHolds`), against
 * `baseSha`. `file` is the asking task's file, so its own units are left out: within a task,
 * the units in flight are compared here, by what they declare and write. What cannot be read
 * is exit 2, never a pass.
 */
function othersHolds(root, file, baseSha) {
  try { return collectHolds({ root, base: baseSha, task: file }); }
  catch (e) {
    if (e instanceof HoldsCannotCheck) throw new CannotCheck(`nobody can say which files other tasks have: ${e.message}`);
    throw e;
  }
}

const HELD_HOW = { declared: 'declared', branch: 'its branch wrote it', worktree: 'uncommitted in its worktree' };

/**
 * Who of another task has `f` and counts against a unit that wrote it, by the precedence
 * of the declared (D049). A holder counts when it is a task's own branch (held or in
 * progress: nothing there was declared, and it has what it wrote), when it declared `f`, or
 * when the unit did not declare `f` either. A unit of another task that only wrote `f`
 * without declaring it does not count against a unit that declared it: the one that wrote
 * it undeclared is the one refused, at its own check. Returns null when nobody counts, or
 * { file, holders, kind }. `kind` is 'held' when this unit waits; 'both-declared' when this
 * unit and a holder each declared `f`; 'both-undeclared' when neither this unit nor any
 * holder declared it and a unit of another task wrote it too — each would be refused waiting
 * for the other, with no way out. In both of those check does not choose: the project owner
 * decides. `counts(claim)`, when given, leaves out the claims that do not count here.
 */
function heldBy(f, claims, declaredHere, counts = null) {
  const byHolder = new Map();
  for (const c of claims) {
    if (!pathsOverlap(c.file, f)) continue;
    if (counts && !counts(c)) continue;
    const k = `${c.task}\0${c.unit ?? ''}\0${c.branch}`;
    if (!byHolder.has(k)) byHolder.set(k, { name: holderName(c), task: c.task, short: c.short, unit: c.unit, branch: c.branch, idle: c.idle, hows: [] });
    const h = byHolder.get(k);
    if (!h.hows.includes(c.how)) h.hows.push(c.how);
  }
  const holders = [...byHolder.values()].filter((h) => !h.unit || h.hows.includes('declared') || !declaredHere);
  if (!holders.length) return null;
  const someDeclared = holders.some((h) => h.unit && h.hows.includes('declared'));
  const kind = declaredHere && someDeclared ? 'both-declared'
    : !declaredHere && !someDeclared && holders.some((h) => h.unit) ? 'both-undeclared'
      : 'held';
  return { file: f, holders, kind };
}

/**
 * The refusal of a file another task has, as [code, detail, action]; `changed` says the
 * tracked branch changed the file after the unit's branch started. Every action is the same
 * instruction: wait (for the other unit, or for the owner's decision), then rebase, which
 * says whether the unit has to be rebuilt — never a promise that it will not.
 */
function heldRefusal(h, { unit, short, declaredHere, changed, baseRef, branch }) {
  const then = `integrate-unit.mjs rebase ${short} ${unit}, which checks again and says whether ${short} ${unit} has to be rebuilt`;
  const also = changed ? `; ${baseRef} also changed the file after ${branch} started, so it will say so` : '';
  if (h.kind === 'both-declared') return ['held-both-declared', `${h.file}: ${unit} declared it, and so did ${holdersText(h)}, of another task, which has it now`, `check does not choose between two units that both declared the file: the project owner decides which one waits. Until then nothing is integrated, discarded or rebuilt; the one that waits then runs ${then}${also}`];
  if (h.kind === 'both-undeclared') return ['held-both-undeclared', `${h.file}: ${unit} wrote it without declaring it, and so did ${holdersText(h)}, of another task, which has it now`, `neither declared the file, so each would wait for the other: check does not choose, and the project owner decides which one waits and declares it. Until then nothing is integrated, discarded or rebuilt; the one that waits then runs ${then}${also}`];
  const how = declaredHere ? '' : `, and ${short} ${unit} wrote it without declaring it`;
  const detail = `${h.file}: ${holdersText(h)}, of another task, has it until ${untilText(h)}${how}${changed ? `; and ${baseRef} changed it after ${branch} started` : ''}`;
  return ['held', detail, `wait until ${untilText(h)}: the file is not this unit's yet. Then run ${then}${changed ? ' (the version it was built on is gone, so it will)' : ' (by then the other unit has usually changed it)'}.${idleText(h)}`];
}

/** In a run where a file of the unit is also one another task has, no refusal says to rebuild now: the unit waits as that refusal says. */
const waitFirst = (unit) => `do not rebuild yet: ${unit} also has a file another task has (refused here too), and it waits for that first`;
const overlapWhileHeld = (short, unit) => `${waitFirst(unit)}. Once that wait is over, integrate-unit.mjs rebase ${short} ${unit} checks again and says whether ${short} ${unit} has to be rebuilt; with this overlap still there, it will`;
const MERGE_REBUILD = 'rebuild the unit as one plain commit';
const LEAK_ACTION = (rebuild) => `if they are the session's own work, commit or set it aside and check again; if nobody in the session wrote them, the builder wrote outside its worktree: ${rebuild}. Do not restore or discard those files until whoever wrote them is known`;

/** The holders of a file, named with how each has it. */
const holdersText = (held) => held.holders.map((h) => `${h.name} (${h.hows.map((x) => HELD_HOW[x] ?? x).join(', ')})`).join(' and ');

/** When a holder lets go of its files: a unit when it integrates; a task's branch when it is integrated or the task is closed. */
const untilText = (held) => held.holders.map((h) => (h.unit ? `${h.name} integrates` : `${h.name}'s branch is integrated or ${h.short} is done or dropped`)).join(', and ');

/**
 * A dispatched unit with no commit yet may be one whose builder is gone (D053): it keeps its
 * files with no deadline, and discard releases it. Running discard on another task's work is
 * the owner's call, never this script's.
 */
const idleText = (held) => held.holders.filter((h) => h.unit && h.idle).map((h) => ` ${h.name} has no commit yet: if its builder is gone, integrate-unit.mjs discard ${h.short} ${h.unit} releases it, and discarding another task's work is the project owner's call`).join('');

/**
 * The units of other tasks that no longer wait for a file of `files` (C-6, C-7, R-7, R-5):
 * not dispatched (no claim of their own), of a task `in progress` or `waiting on owner`, that
 * declare one of those files, and only for the files nobody else has now. They are told that
 * they no longer wait for that file, never that they can start: they may wait on something
 * else, and `task-units.mjs --plan` is what dispatches.
 */
function noLongerWaiting(holds, files) {
  const dir = join(holds.mainRoot, 'tasks');
  if (!existsSync(dir)) return [];
  const dispatched = new Set(holds.claims.filter((c) => c.unit).map((c) => `${c.task}\0${c.unit}`));
  const free = [...new Set(files)].filter((f) => !isStateFile(f) && !holds.claims.some((c) => pathsOverlap(c.file, f)));
  if (!free.length) return [];
  const out = [];
  for (const name of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const text = readFileSync(join(dir, name), 'utf8');
    const t = readFrontmatter(text, name.replace(/\.md$/, ''));
    if (t.id === holds.task || !/^(in progress|waiting on owner)$/i.test(t.status ?? '')) continue;
    for (const u of parseUnits(text)?.units ?? []) {
      if (u.done || u.replaced || dispatched.has(`${t.id}\0${u.id}`)) continue;
      const mine = free.filter((f) => (u.touches ?? []).some((d) => pathsOverlap(d, f)));
      if (mine.length) out.push({ task: t.id, short: t.short, status: t.status, unit: u.id, files: mine });
    }
  }
  return out;
}

/** noLongerWaiting after something was let go; a failure to read is a note, never a failure of what already happened. */
function releasedAfter(root, file, baseSha, files, result) {
  try { result.released = noLongerWaiting(othersHolds(root, file, baseSha), files); }
  catch (e) {
    if (!(e instanceof CannotCheck)) throw e;
    result.released = null;
    result.notes.push(`which units of other tasks no longer wait for its files could not be said: ${e.message}; run task-units.mjs --plan on those tasks`);
  }
}

function printReleased(r) {
  for (const x of r.released ?? []) console.log(`  ! ${x.short} ${x.unit} (${x.status}) no longer waits for ${x.files.join(', ')}; it may still wait on something else: run task-units.mjs ${x.short} --plan before dispatching it`);
}

export function check({ root, task, unit, branch = null, base = null, inFlight = [] }) {
  // The contract is read from the main checkout, wherever the command runs: the task file
  // there is the one the session keeps current (a unit checked off, a touches: widened after
  // dispatch), and the builder's worktree holds a copy of it from when the unit started.
  const mainRoot = worktrees(root)[0].path;
  const file = resolveTaskFile(task, mainRoot);
  if (!file || !existsSync(file)) throw new CannotCheck(`no task file for ${task}`);
  const ids = taskIds(file);
  const parsed = parseUnits(ids.text);
  if (!parsed) throw new CannotCheck(`${file} has no "## Done when" section`);
  // A line that could not be read may be carrying files of some unit's touches:, so no
  // contract in the task is known whole — this one's, or the ones it is compared against.
  if (parsed.malformed.length) throw new CannotCheck(`${parsed.malformed.length} line(s) in "## Done when" of ${file} could not be read as units (line ${parsed.malformed.map((m) => m.line).join(', ')}); run task-units.mjs on the task, fix them, and check again`);
  const u = parsed.units.find((x) => x.id === unit);
  if (!u) throw new CannotCheck(`${unit} is not a unit of ${ids.id}`);
  const refusals = [];
  const refuse = (code, detail, action) => refusals.push({ code, detail, action });

  if (u.done) refuse('closed', `${unit} is already checked off in the task file`, 'nothing to integrate; if it was rebuilt, uncheck it first');
  const touchProblems = touchesProblems(u, mainRoot);
  if (touchProblems.length) {
    const what = touchProblems[0].entry === null ? 'has no touches:' : `has an invalid touches: entry "${touchProblems[0].entry}"`;
    refuse('no-contract', `${unit} ${what}, so there is nothing to compare the branch against`, 'the unit goes back to scope, which writes its touches: in the task file; then check again');
  }

  const baseRef = base ?? 'HEAD';
  const baseSha = git(mainRoot, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { allowFail: true }).stdout.trim();
  if (!baseSha) throw new CannotCheck(`base ${baseRef} is not a commit`);

  const existing = unitBranches(root, ids);
  if (!branch) {
    const mine = existing.filter((b) => b.unit === unit);
    if (mine.length === 0) throw new CannotCheck(`no branch ai/${ids.short}-${unit} or ai/${ids.id}-${unit}; pass --branch`);
    if (mine.length > 1) throw new CannotCheck(`two branches for ${unit}: ${mine.map((b) => b.branch).join(', ')}; pass --branch`);
    branch = mine[0].branch;
  }
  const tip = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], { allowFail: true }).stdout.trim();
  if (!tip) throw new CannotCheck(`branch ${branch} does not exist`);
  const forkPoint = git(root, ['merge-base', baseSha, tip], { allowFail: true }).stdout.trim();
  if (!forkPoint) throw new CannotCheck(`${branch} shares no history with ${baseRef}`);

  // B-7, B-8: one unit is one commit.
  const commits = git(root, ['rev-list', '--reverse', `${baseSha}..${tip}`]).stdout.split('\n').filter(Boolean);
  if (commits.length === 0) refuse('no-commit', `${branch} has no commit that is not already in ${baseRef}`, 'dispatch the unit again; its worktree stays until that is decided');
  if (commits.length > 1) refuse('several-commits', `${branch} has ${commits.length} commits; a unit is one`, 'have the builder squash them, or split the unit in the task file (build step 1)');
  const merges = git(root, ['rev-list', '--merges', `${baseSha}..${tip}`]).stdout.split('\n').filter(Boolean);
  // Its action is settled once it is known whether another task has a file of the unit.
  if (merges.length) refuse('merge-commit', `${branch} contains a merge commit`, MERGE_REBUILD);
  const mergeRefusal = merges.length ? refusals[refusals.length - 1] : null;

  // B-7: work left uncommitted in the builder's worktree is never thrown away here.
  const wt = worktrees(root).find((w) => w.branch === branch) ?? null;
  // A worktree in the middle of a rebase, merge or cherry-pick of this branch is in use,
  // the main checkout included: whoever started it may still --abort or --continue and
  // move the branch. Nothing here touches it.
  if (wt?.op) refuse('worktree-busy', `the worktree at ${wt.path} is in the middle of a ${wt.op} on ${branch}`, `do not rebase or integrate; have whoever started it finish or abort the ${wt.op}, then check again. Its work is never touched here`);
  const wtDirty = wt && wt.path !== mainRoot ? dirtyPaths(wt.path) : [];
  if (wtDirty.length) refuse('worktree-dirty', `the worktree at ${wt.path} has uncommitted work: ${wtDirty.join(', ')}`, 'do not integrate; have the builder commit or dispatch again, and keep the worktree until that is decided');

  const files = commits.length ? changedFiles(root, forkPoint, tip) : [];
  const declared = u.touches ?? [];
  // Declared means named exactly: not a path that sits over others (`docs/guide`, not yet a
  // folder), and not another spelling (`SRC/a.mjs` is another file on Linux). A near miss
  // only puts the file on the reviewer's list. pathsOverlap stays for overlap, where a
  // prefix or a different case is the cautious answer.
  const isDeclared = (f) => declared.some((d) => normalizePath(d) === normalizePath(f));

  // C-1, B-14.
  const state = files.filter(isStateFile);
  if (state.length) refuse('task-state', `the commit writes task state: ${state.join(', ')}`, 'amend the commit without them; only the dispatching session writes task state');

  // Other units still in flight: named, or with a branch that has work not yet in the base
  // or a live worktree — a builder still writing has a worktree and no commit yet. A unit
  // already checked off in the task file has landed, whatever is left of its branch.
  const stray = inFlight.filter((id) => !parsed.units.some((x) => x.id === id));
  if (stray.length) throw new CannotCheck(`--in-flight names ${stray.join(', ')}, which is not a unit of ${ids.id}`);
  const flying = new Set(inFlight);
  const all = worktrees(root);
  const live = new Map(all.filter((w) => w.branch).map((w) => [w.branch, w.path]));
  const branchOf = new Map();
  for (const b of existing) {
    if (b.unit === unit || parsed.units.some((x) => x.id === b.unit && x.done)) continue;
    const ahead = git(root, ['rev-list', '--count', `${baseSha}..${b.branch}`]).stdout.trim();
    if (ahead === '0' && !live.has(b.branch)) continue;
    if (!parsed.units.some((x) => x.id === b.unit)) throw new CannotCheck(`branch ${b.branch} holds work, but ${b.unit} is not a unit of ${ids.id} (renumbered or removed?); integrate, rename or delete that branch first, since nobody can say what it writes`);
    flying.add(b.unit);
    branchOf.set(b.unit, b.branch);
  }
  const flyingUnits = parsed.units.filter((x) => flying.has(x.id) && x.id !== unit);

  // What each unit in flight may write: what it declared, plus what its branch and its
  // worktree already wrote, declared or not. One with no valid touches: could write anything.
  const claims = new Map();
  for (const x of flyingUnits) {
    if (touchesProblems(x, mainRoot).length) throw new CannotCheck(`${x.id} is in flight with no valid touches:, so nobody can say whether it writes the same files as ${unit}`);
    const paths = [...x.touches];
    const b = branchOf.get(x.id);
    if (b) {
      const fork = git(root, ['merge-base', baseSha, b]).stdout.trim();
      paths.push(...changedFiles(root, fork, b));
      if (live.has(b) && live.get(b) !== mainRoot) paths.push(...dirtyPaths(live.get(b)));
    }
    claims.set(x.id, paths);
  }

  // What other tasks have, read once and only when the unit wrote something to compare.
  const others = files.some((f) => !isStateFile(f)) ? othersHolds(root, file, baseSha) : { claims: [] };

  // A-7, A-8, B-2, B-4, R-7: overlap is per file. D027, E-3, E-4: a file of the unit that
  // changed on the tracked branch after it started is an overlap, declared or not and
  // whoever changed it — a sibling or another task. The unit is rebuilt on that version.
  // A file another task has now is a different refusal, with a different instruction: the
  // unit waits and is rebased, it is not rebuilt now: rebase says afterwards whether it must be.
  const upstream = changedFiles(root, forkPoint, baseSha);
  const overlaps = [];
  const held = [];
  const undeclared = [];
  for (const f of files) {
    if (isStateFile(f)) continue;
    const other = flyingUnits.find((x) => claims.get(x.id).some((t) => pathsOverlap(t, f)));
    if (other) { overlaps.push({ file: f, with: `${other.id}, still in flight, declares or writes it` }); continue; }
    const h = heldBy(f, others.claims, declared.some((d) => pathsOverlap(d, f)));
    const changed = upstream.some((p) => pathsOverlap(p, f));
    // A file another task has and the tracked branch changed gets one refusal, with one
    // instruction: wait, then rebase — never a wait and a rebuild that contradict each other.
    if (h) { held.push({ ...h, changed }); continue; }
    if (changed) { overlaps.push({ file: f, with: `${baseRef} changed it after ${branch} started: whoever integrated it first keeps it, and ${unit} is rebuilt on that version` }); continue; }
    if (isDeclared(f)) continue;
    const later = parsed.units.find((x) => x.id !== unit && !x.done && (x.touches ?? []).some((t) => pathsOverlap(t, f)));
    undeclared.push({ file: f, note: later ? `${later.id}, not started yet, declares it and will build on this version` : null });
  }
  // One instruction per unit: with a file another task has, the overlaps of this run wait too.
  for (const o of overlaps) refuse('overlap', `${o.file}: ${o.with}`, held.length ? overlapWhileHeld(ids.short, unit) : REBUILD);
  for (const h of held) refuse(...heldRefusal(h, { unit, short: ids.short, declaredHere: declared.some((d) => pathsOverlap(d, h.file)), changed: h.changed, baseRef, branch }));
  if (mergeRefusal && held.length) mergeRefusal.action = `${waitFirst(unit)}. Once that wait is over, ${MERGE_REBUILD}`;

  // R-1: a file of the unit that is dirty in the main checkout was written there by path.
  // Only the unit's files: a stray write to any other file cannot be told apart from what the
  // session itself has uncommitted there, so it goes undetected.
  const mainDirty = dirtyPaths(mainRoot);
  const unitFiles = [...declared, ...files];
  const leaked = mainDirty.filter((p) => !isStateFile(p) && unitFiles.some((f) => pathsOverlap(f, p)));
  if (leaked.length) refuse('main-checkout-write', `files of ${unit} are uncommitted in the main checkout: ${leaked.join(', ')}`, LEAK_ACTION(held.length ? `treat it as an overlap, but ${waitFirst(unit)}; once that wait is over, rebuild the unit` : 'treat it as an overlap and rebuild the unit'));

  // R-2.
  const pushed = remotesHolding(root, branch, tip);
  if (pushed.length) refuse('pushed', `${branch} is on ${pushed.join(', ')}`, 'delete the remote branch before integrating; unit branches never reach a remote');
  const hook = commits.length === 1 ? rerunHook(mainRoot, commits[0]) : { ran: false, ok: true, output: 'not run: the branch does not hold exactly one commit' };
  if (!hook.ok) refuse('hook', `the pre-commit hook fails on ${commits[0].slice(0, 7)}:\n${hook.output}`, 'fix the commit in its branch and check again; it was most likely made with --no-verify');

  const verdict = refusals.length ? 'refused' : undeclared.length ? 'pass-undeclared' : 'pass';
  return { task: ids.id, unit, branch, base: baseRef, baseSha, forkPoint, commits, files, declared, undeclared, held, leaked, refusals, hook, inFlight: flyingUnits.map((x) => x.id), verdict };
}


/** `git patch-id --stable` of one commit: equal ids mean the rebase left the unit's change as it was. */
function patchId(root, sha) {
  const show = git(root, ['show', '--no-color', '--no-ext-diff', sha]).stdout;
  const r = spawnSync('git', ['patch-id', '--stable'], { cwd: root, input: show, encoding: 'utf8', env: GIT_ENV });
  return (r.stdout || '').split(' ')[0] || null;
}

const REPLAY = { timeout: 5 * 60 * 1000 };

/**
 * Computes the unit's one commit replayed onto `onto`, without moving anything: the merge
 * is made in memory (`git merge-tree`), so no checkout is ever left half-rebased, and no
 * project hook runs — the pre-commit runs again in the `check` that follows. Author, date
 * and message are kept; the commit is signed when the project signs its commits, as a
 * rebase would. Returns { conflict: [files] } when the change does not apply, { empty }
 * when the tip already holds it, or { newTip }. Any other failure makes the rebase
 * impossible (exit 2), with git's error, and nothing moved.
 */
function replay(root, oldTip, onto) {
  const failed = (what, r) => new CannotCheck(`${what} failed, nothing was moved: ${r.error ? r.error.message : (r.stderr || '').trim()}`);
  const mt = git(root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', `--merge-base=${oldTip}~1`, onto, oldTip], { ...REPLAY, allowFail: true });
  const lines = (mt.stdout || '').split('\n');
  // Told by `git version`, not by git's message: that is translated in a localized git, and
  // a git older than 2.38 fails on --write-tree before it gets to --merge-base.
  if (!mt.error && mt.status !== 0) {
    const v = git(root, ['version'], { allowFail: true });
    const version = (v.stdout || '').trim();
    const [, major, minor] = version.match(/(\d+)\.(\d+)/) ?? [];
    if (major !== undefined && (Number(major) < 2 || (Number(major) === 2 && Number(minor) < 40))) {
      throw new CannotCheck(`rebase needs git 2.40 or later (git merge-tree --merge-base), and this is ${version}: update git and run rebase again. Nothing was moved`);
    }
  }
  if (!mt.error && mt.status === 1) return { conflict: [...new Set(lines.slice(1).filter(Boolean))] };
  if (mt.error || mt.status !== 0) throw failed('git merge-tree', mt);
  const tree = lines[0].trim();
  if (tree === git(root, ['rev-parse', `${onto}^{tree}`]).stdout.trim()) return { empty: true };
  const [name, email, date] = git(root, ['log', '-1', '--format=%an%x00%ae%x00%ad', '--date=raw', oldTip]).stdout.replace(/\n$/, '').split('\0');
  const raw = git(root, ['cat-file', 'commit', oldTip]).stdout;
  const message = raw.slice(raw.indexOf('\n\n') + 2);
  const sign = git(root, ['config', '--type=bool', '--get', 'commit.gpgsign'], { allowFail: true }).stdout.trim() === 'true' ? ['-S'] : [];
  const env = { ...GIT_ENV, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: `@${date}` };
  const ct = spawnSync('git', ['commit-tree', tree, '-p', onto, ...sign], { cwd: root, input: message, encoding: 'utf8', env, ...REPLAY });
  if (ct.error || ct.status !== 0) throw failed('git commit-tree', ct);
  return { newTip: ct.stdout.trim() };
}

/**
 * Moves the branch from `oldTip` to `newTip`, only if it is still at `oldTip`. In the
 * builder's worktree — which check has just found clean and not mid-operation — with
 * `reset --keep`, so that worktree keeps matching its branch; with no worktree, with a
 * compare-and-swap on the ref.
 */
function moveBranch(root, mainRoot, branch, oldTip, newTip) {
  const wt = worktrees(root).find((w) => w.branch === branch) ?? null;
  if (wt?.op) throw new CannotCheck(`the worktree at ${wt.path} started a ${wt.op} on ${branch}; nothing was moved`);
  if (wt && wt.path === mainRoot) throw new CannotCheck(`${branch} is checked out in the main checkout; a unit branch lives in its own worktree. Nothing was moved`);
  const at = git(root, ['rev-parse', `refs/heads/${branch}`]).stdout.trim();
  if (at !== oldTip) throw new CannotCheck(`${branch} moved to ${at} while it was being rebased; nothing was moved`);
  const r = wt
    ? git(wt.path, ['reset', '--quiet', '--keep', newTip], { ...REPLAY, allowFail: true })
    : git(root, ['update-ref', `refs/heads/${branch}`, newTip, oldTip], { ...REPLAY, allowFail: true });
  const now = git(root, ['rev-parse', `refs/heads/${branch}`]).stdout.trim();
  if (r.error || r.status !== 0 || now !== newTip) throw new CannotCheck(`moving ${branch} from ${oldTip} to ${newTip} failed, and it is at ${now}: ${r.error ? r.error.message : (r.stderr || '').trim()}`);
}

/**
 * rebase: check, replay onto the current tip, check again. The first check is the one that
 * sees what the tracked branch changed since the unit started — after the replay that
 * history is below the unit and no longer visible — so a refusal there stops everything.
 * The second one runs the tracked branch's pre-commit with the current tip as the commit's
 * parent, so its trusted run applies the rules the tracked branch gained after the unit
 * started. The review of the old commit carries over to the new one (the owner, 2026-09-28)
 * because the first check refused any unit whose files the tip changed (D027): nobody else
 * changed them. Both hashes are returned, also when the branch moved and the check after it
 * could not be made.
 */
export function rebase({ root, task, unit, branch = null, base = null, inFlight = [] }) {
  const mainRoot = worktrees(root)[0].path;
  // With no --base the tip is the main checkout's HEAD, which is a tip only when it is on a
  // branch and not halfway through something: mid-rebase it is a commit on its way, and a
  // unit rebased onto it would carry that commit.
  if (base === null) {
    // Busy first: mid-rebase the HEAD is detached too, and the operation is the real reason.
    const busy = worktrees(root)[0].op;
    if (busy) throw new CannotCheck(`the main checkout is in the middle of a ${busy}, so its HEAD is not a tip to rebase onto; finish or abort it first. Nothing was moved`);
    const onBranch = git(mainRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).stdout.trim();
    if (!onBranch) throw new CannotCheck('the main checkout is on a detached HEAD, so there is no tip to rebase onto; check out the tracked branch, or pass --base. Nothing was moved');
  }
  const before = check({ root, task, unit, branch, base, inFlight });
  const result = { action: 'rebase', task: before.task, unit, branch: before.branch, onto: before.baseSha, oldTip: before.commits[0] ?? null, newTip: null, rebased: false, samePatch: null, before, after: null, refusals: before.refusals, verdict: before.verdict, verdicts: [before.verdict] };
  if (before.verdict === 'refused') return result;
  const oldTip = before.commits[0];
  if (before.forkPoint === before.baseSha) return { ...result, newTip: oldTip, samePatch: true, after: before };
  const plan = replay(root, oldTip, before.baseSha);
  if (plan.conflict) {
    const refusals = [{ code: 'rebase-conflict', detail: `${oldTip.slice(0, 7)} does not apply cleanly onto ${before.baseSha.slice(0, 7)}${plan.conflict.length ? ` (conflicts in ${plan.conflict.join(', ')})` : ''}; nothing was moved, and ${before.branch} is where it was`, action: REBUILD }];
    return { ...result, refusals, verdict: 'refused', verdicts: ['refused'] };
  }
  if (plan.empty) {
    const refusals = [{ code: 'already-upstream', detail: `the tip ${before.baseSha.slice(0, 7)} already holds the change of ${oldTip.slice(0, 7)}: replayed onto it, the commit is empty. ${before.branch} was not moved`, action: `nothing to integrate: run ${unit}'s verification on the tip and decide in the task log whether it is done; then discard the branch` }];
    return { ...result, refusals, verdict: 'refused', verdicts: ['refused'] };
  }
  const { newTip } = plan;
  moveBranch(root, mainRoot, before.branch, oldTip, newTip);
  // Written the moment the branch moves, before anything that can take minutes (the hook
  // runs twice more) or fail: a run cut short still leaves both hashes behind.
  process.stderr.write(`! ${before.branch} moved: old commit ${oldTip}, new commit ${newTip}\n`);
  const moved = { oldTip, newTip, moved: true };
  let after, samePatch;
  try {
    after = check({ root, task, unit, branch: before.branch, base: before.baseSha, inFlight });
    samePatch = patchId(root, oldTip) === patchId(root, newTip);
  } catch (e) {
    const why = e instanceof CannotCheck ? e.message : `unexpected error: ${e?.stack ?? e}`;
    throw new CannotCheck(`${before.branch} WAS moved: old commit ${oldTip}, new commit ${newTip}. Then the check after the rebase could not be made: ${why}`, moved);
  }
  if (after.commits.length !== 1 || after.commits[0] !== newTip) throw new CannotCheck(`${before.branch} WAS moved (old commit ${oldTip}, new commit ${newTip}), but it does not hold exactly that commit now`, moved);
  const verdicts = [after.verdict];
  const verdict = after.verdict;
  return { ...result, newTip, rebased: true, samePatch, after, refusals: after.refusals, verdict, verdicts: verdicts.length ? verdicts : [verdict] };
}

/** The `Task:` and `Unit:` values of a commit, read by git's own trailer parser. */
function commitTrailers(root, sha) {
  const out = git(root, ['log', '-1', '--format=%(trailers:key=Task,valueonly,separator=%x1e)%x1f%(trailers:key=Unit,valueonly,separator=%x1e)', sha]).stdout;
  const [tasks, units = ''] = out.replace(/\n$/, '').split('\x1f');
  return { tasks: valueList(tasks), units: valueList(units) };
}

const valueList = (x) => [...new Set(x.split('\x1e').map((v) => v.trim()).filter(Boolean))];

/**
 * The commit a unit's `commit:` line records, or why it does not count: it must be a hex sha
 * (never a ref such as HEAD or main) of a commit whose Task: and Unit: lines are this unit's.
 */
function recordedCommit(root, ids, u) {
  if (!u.commit) return { sha: null, why: null };
  if (!/^[0-9a-f]{7,64}$/.test(u.commit)) return { sha: null, why: 'is not a commit sha (7 to 64 hex characters)' };
  const full = git(root, ['rev-parse', '--verify', '--quiet', `${u.commit}^{commit}`], { allowFail: true }).stdout.trim();
  if (!full) return { sha: null, why: 'is no commit here' };
  const problem = unitLineProblem(root, full, ids, u.id);
  return problem ? { sha: null, why: `is not ${u.id}'s commit: ${problem}` } : { sha: full, why: null };
}

const isTask = (value, ids) => [ids.short.toLowerCase(), ids.id.toLowerCase()].includes(value.toLowerCase());

/**
 * Whether a commit is the unit's: its `Task:` line names this task and its `Unit:` line the
 * unit (B-10). The subject is not read (G-2). Every task has a U1, so `Unit:` alone does not
 * tell tasks apart, and a commit with no `Task:` line is never taken as anybody's unit.
 */
function unitLineProblem(root, sha, ids, unit) {
  const { tasks, units } = commitTrailers(root, sha);
  if (!tasks.length) return `it has no Task: line, so nothing can tell it is ${ids.short}'s`;
  if (tasks.length > 1) return `it has ${tasks.length} Task: lines (${tasks.join(', ')}); a unit's commit names one task`;
  if (!isTask(tasks[0], ids)) return `its Task: line names ${tasks[0]}, not ${ids.short}`;
  if (!units.length) return `it has no Unit: line`;
  if (units.length > 1 || units[0] !== unit) return `its Unit: line says ${units.join(', ')}, not ${unit}`;
  return null;
}

/**
 * The review of a unit's commit, read as data (T123 U2): a `review-round` in this task's own
 * log, logs/tasks/<task-id>.md (read from the main checkout), whose fields say `unit:` (this
 * unit), `commit:` (a hex sha) and `blocking:` (the blocking findings it left). Neither the
 * body nor `result:` is read (G-2). A round without the three, or with one malformed, counts
 * for nothing (C-3, C-13). An entry another one `replaces:` — by bare id or as
 * <this task>#<id> — counts for nothing (C-7); of the rest, the latest that names the exact
 * commit decides (C-6), and only with none, the latest that covers it by the same patch.
 * The sha must resolve to one commit here, short or full alike (C-5). It covers the commit
 * integrated when it is that commit, or one with the same `git patch-id --verbatim` over
 * `git show --binary` (whitespace and binary content count) whose replay onto the tip changed
 * none of the unit's files on the way (D020, C-8 to C-10). A git without --verbatim makes the
 * check impossible (exit 2), never a pass.
 */
function exactPatchId(root, sha) {
  const show = git(root, ['show', '--binary', '--no-color', '--no-ext-diff', '--format=', sha]).stdout;
  const r = spawnSync('git', ['patch-id', '--verbatim'], { cwd: root, input: `commit ${sha}\n${show}`, encoding: 'utf8', env: GIT_ENV });
  if (r.error || r.status !== 0) throw new CannotCheck(`git patch-id --verbatim is not available here (${(git(root, ['version'], { allowFail: true }).stdout || '').trim()}), so nobody can say whether a reviewed commit is the same change as ${sha.slice(0, 7)}: update git (2.39 or later). Nothing was changed`);
  return (r.stdout || '').split(' ')[0] || null;
}

/** The task log, and the ids of its entries that another entry of it replaces. */
function readLog(root, ids) {
  if (!taskLog) throw new CannotCheck(`task-log.mjs is not next to this script (${HERE}), so the task log of ${ids.id} cannot be read. Nothing was changed`);
  const log = taskLog.readTaskLog(root, ids.id);
  const own = new Set([ids.id, ids.short].map((x) => x.toLowerCase()));
  // A link names an entry of this log by its bare id, or as <this task>#<id>.
  const target = (v) => { const at = v.indexOf('#'); return at === -1 ? v.trim() : own.has(v.slice(0, at).trim().toLowerCase()) ? v.slice(at + 1).trim() : null; };
  const replaced = new Set(log.entries.map((e) => e.fields.replaces).filter(Boolean).map(target).filter(Boolean));
  return { log, rel: relative(root, log.path), replaced };
}

function reviewOf(root, ids, unit, sha, files) {
  const { log, rel, replaced } = readLog(root, ids);
  const rounds = log.entries.filter((e) => e.type === 'review-round' && !replaced.has(e.id) && e.fields.unit === unit).sort(taskLog.entryOrder);
  let pid;
  const parent = parentOf(root, sha);
  const covering = [];
  const ignored = [];
  for (const e of rounds) {
    const f = e.fields;
    if (!taskLog.SHA_FIELD_RE.test(f.commit ?? '') || !taskLog.COUNT_FIELD_RE.test(f.blocking ?? '')) { ignored.push(`${e.id}: it lacks a well-formed commit: and blocking:`); continue; }
    const full = git(root, ['rev-parse', '--verify', '--quiet', `${f.commit}^{commit}`], { allowFail: true }).stdout.trim();
    if (!full) { ignored.push(`${e.id}: ${f.commit} is no commit here, or names more than one`); continue; }
    let how = null;
    if (full === sha) how = 'same commit';
    else if ((pid ??= exactPatchId(root, sha)) && exactPatchId(root, full) === pid) {
      const was = parentOf(root, full);
      const moved = was && parent ? changedFiles(root, was, parent).filter((x) => files.some((g) => pathsOverlap(g, x))) : files;
      if (moved.length) { ignored.push(`${e.id}: it reviewed ${f.commit}, the same change, but the replay onto the tip met the unit's files ${moved.join(', ')} changed; the two edits together were never reviewed`); continue; }
      how = 'same patch';
    } else { ignored.push(`${e.id}: it reviewed ${f.commit}, which is not ${sha.slice(0, 7)} and not the same change (amended, or rebased through a conflict)`); continue; }
    covering.push({ entry: e.id, cited: f.commit, commit: full, how, by: f.by ?? null, blocking: Number(f.blocking) });
  }
  // A late round of the old commit does not outrank one of this very commit.
  const same = covering.filter((c) => c.how === 'same commit');
  const pool = same.length ? same : covering;
  return { log: rel, latest: pool[pool.length - 1] ?? null, covering, ignored };
}

/**
 * T168 U14 (D062): a round that left blocking findings still lets its unit through when the
 * project owner accepted the risk of each one in writing — code-review's only other way past a
 * BLOCKING finding. The findings of a round are the ones written below it and above the next
 * `review-round` of any unit (the ontology's rule for a finding's round). The round passes when
 * it has at least as many standing blocking findings as its `blocking:` says, and every one of
 * them is closed by a `decision`: the last standing entry of its closer's replacement chain, as
 * the view reads it. `by:` is not read, as in the other two gates (openBlocking, the round cap):
 * the session records only decisions the owner took. A finding closed by a `fix` still needs a
 * new round of the fixed commit, and one left open, or dropped by a note, still refuses. The
 * standing decision must itself name the finding in resolves: (one that replaced a mistyped
 * decision, or revoked it, accepts nothing it does not name), and must carry no unit: — that
 * one opens a review round, it does not accept a risk.
 * Returns { ok, decisions: [{ decision, by, finding }], why }.
 */
export function acceptedByDecision(root, ids, round) {
  const { log } = readLog(root, ids);
  const at = log.entries.findIndex((e) => e.id === round.entry);
  if (at === -1) return { ok: false, decisions: [], why: `${round.entry} is not in the task log any more` };
  const next = log.entries.findIndex((e, i) => i > at && e.type === 'review-round');
  const below = log.entries.slice(at + 1, next === -1 ? undefined : next);
  const { live, statusOf } = taskLog.closures(log.entries);
  const findings = below.filter((e) => e.type === 'finding' && live(e) && taskLog.isBlocking(e));
  if (findings.length < round.blocking) return { ok: false, decisions: [], why: `it left blocking: ${round.blocking}, and only ${findings.length} standing blocking finding(s) are written under it` };
  const decisions = [];
  const notAccepted = [];
  for (const f of findings) {
    const { status, closer } = statusOf(f);
    // The standing end of the closer's chain must itself still name the finding: a decision
    // that replaced a mistyped one, or revoked it, accepts nothing it does not name.
    const names = String(closer?.fields?.resolves ?? '').trim() === f.id;
    if (status === 'open') notAccepted.push(`${f.id} is open`);
    else if (closer.type !== 'decision') notAccepted.push(`${f.id} was closed by a ${closer.type} (${closer.id})`);
    else if (!names) notAccepted.push(`${f.id} was closed by a decision that ${closer.id} replaced, and ${closer.id} does not name it in resolves:`);
    else if (String(closer.fields.unit ?? '').trim()) notAccepted.push(`${f.id} is resolved by ${closer.id}, a decision with unit: ${closer.fields.unit}, which opens one more review round of that unit; it does not accept a risk`);
    else decisions.push({ decision: closer.id, by: closer.fields.by ?? null, finding: f.id });
  }
  if (notAccepted.length) return { ok: false, decisions, why: `not every blocking finding under it was accepted by a decision: ${notAccepted.join('; ')}` };
  return { ok: true, decisions, why: null };
}

const acceptedText = (round, decisions) => `the latest review-round (${round.entry}) left blocking: ${round.blocking}, and a decision accepted the risk of each: ${decisions.map((d) => `${d.decision} (by: ${d.by ?? 'none'}) resolves ${d.finding}`).join('; ')}`;

/**
 * D025: the blocking findings of the task still open, by the rule the view uses
 * (task-log.mjs closures), and never attributed to a unit (R-13).
 */
function openBlocking(root, ids) {
  const { log, rel } = readLog(root, ids);
  return { log: rel, open: taskLog.openBlockingFindings(log.entries).map((e) => e.id) };
}

/**
 * The record of an integrated unit, in "## Done when": its line checked off and its commit
 * under it as `  - commit: <sha>`, replacing an older one (B-8). Written whole, read back;
 * put back as it was if it does not read as intended. Returns whether anything changed.
 */
function writeUnitState(file, unit, sha) {
  const text = readFileSync(file, 'utf8');
  const u = parseUnits(text)?.units.find((x) => x.id === unit);
  if (!u) throw new Error(`${unit} is no longer in "## Done when"`);
  if (u.done && u.commit === sha) return false;
  const lines = text.split('\n');
  if (!u.done) {
    if (!/^- \[ \] /.test(lines[u.line])) throw new Error(`the line of ${unit} does not start with "- [ ] "`);
    lines[u.line] = `- [x] ${lines[u.line].slice(6)}`;
  }
  // Whole, through a renamed temporary file: written, and put back, never half (wz5o).
  const put = (content) => {
    const tmp = join(dirname(file), `.${file.replace(/^.*\//, '')}.${process.pid}.tmp`);
    writeFileSync(tmp, content);
    renameSync(tmp, file);
  };
  const next = rewriteField(lines.join('\n'), u, 'commit', sha);
  if (readFileSync(file, 'utf8') !== text) throw new Error(`${file} changed while it was being written; nothing was written`);
  put(next);
  const back = parseUnits(readFileSync(file, 'utf8'));
  const after = back?.units.find((x) => x.id === unit);
  if (!after?.done || after.commit !== sha || back.malformed.length) {
    put(text);
    throw new Error(`${unit} did not read back as checked off with commit ${sha}; the file was put back as it was`);
  }
  return true;
}

/**
 * integrate: fast-forwards the branch checked out in the main checkout to the unit's commit,
 * and then writes the unit's state. It refuses, and changes nothing, when check refuses; when
 * the commit has no review-round that covers it with no blocking finding left (see reviewOf);
 * when the commit does not carry this task's Task: line and the unit's Unit: line; when a unit
 * this one depends on has no recorded commit: in the tracked branch (B-5, B-13); when the unit
 * still waits in a file's queue; when
 * the commit's parent is not the current tip, since that is `rebase`'s job; when the main
 * checkout has uncommitted changes to a file the commit changes (R-8), never forcing over them;
 * and with no --verify (D026). Then the command runs in the unit's worktree, and the tracked
 * branch moves only if it came out green and nothing moved meanwhile (D-1 to D-3). Green, the
 * unit is checked off with its commit: in the task file and the indexes are regenerated — in the main checkout,
 * uncommitted: the task's closing commit carries them (C-2). The worktree and the branch stay.
 */
export async function integrate({ root, task, unit, branch = null, inFlight = [], verify = null }) {
  const mainRoot = worktrees(root)[0].path;
  const target = git(mainRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).stdout.trim();
  if (!target) throw new CannotCheck('the main checkout is on a detached HEAD, so there is no tracked branch to integrate into');
  const busy = worktrees(root)[0].op;
  if (busy) throw new CannotCheck(`the main checkout is in the middle of a ${busy}; finish or abort it first. Nothing was changed`);
  const r = check({ root, task, unit, branch, base: null, inFlight });
  const result = { action: 'integrate', task: r.task, unit, branch: r.branch, into: target, from: r.baseSha, to: null, tip: r.commits[0] ?? null, integrated: false, review: null, verify: null, verifiedWith: null, state: null, released: [], notes: [], check: r, refusals: [...r.refusals], verdict: r.verdict };
  const refuse = (code, detail, action) => result.refusals.push({ code, detail, action });
  // D026, D-5: nothing enters without the suites having run on it.
  if (verify === null || !String(verify).trim()) refuse('no-verify', 'integrate needs --verify <command>: the suites run in the unit\'s worktree, and the tracked branch moves only if they come out green (D026)', 'run integrate again with --verify "<the command that runs this project\'s suites>"');

  const file = resolveTaskFile(r.task, mainRoot) ?? resolveTaskFile(task, mainRoot);
  const ids = taskIds(file);
  const parsed = parseUnits(ids.text);
  const u = parsed.units.find((x) => x.id === unit);

  // B-5, B-13: the record decides whether a dependency is in, not its check mark.
  for (const d of u.dependsOn) {
    const dep = parsed.units.find((x) => x.id === d);
    if (!dep) throw new CannotCheck(`${unit} depends on ${d}, which is not a unit of ${r.task}`);
    if (dep.replaced) continue;
    const at = recordedCommit(mainRoot, ids, dep);
    if (at.sha && git(mainRoot, ['merge-base', '--is-ancestor', at.sha, r.baseSha], { allowFail: true }).status === 0) continue;
    // A dependency checked off with no commit: and no commit carrying its Unit: line was
    // integrated before Unit: lines existed (a task in flight across a kit update, jo5h).
    const legacy = !dep.commit && dep.done && !unitCommits(mainRoot, r.baseSha, ids, d).length;
    const why = legacy ? `${d} is checked off with no commit: line, and no commit of ${target} carries Task: ${ids.short} and Unit: ${d}: it was integrated before Unit: lines existed`
      : !dep.commit ? `${d} has no commit: recorded in the task file` : `the commit recorded for ${d}, ${dep.commit}, ${at.why ?? `is not in ${target}`}`;
    refuse('depends', `${unit} depends on ${d}, and ${why}`, legacy
      ? `this task started before Unit: lines; finish it with the kit it started with, and update the kit after it closes`
      : `integrate ${d} first (or record it, with a single writer); ${unit} waits, its branch and review stay as they are`);
  }
  if (u.external) result.notes.push(`${unit} also waits on "${u.external}", which no script can check; confirm it before going on`);

  if (r.commits.length === 1) {
    const sha = r.commits[0];
    const notMine = unitLineProblem(mainRoot, sha, ids, unit);
    if (notMine) refuse('not-the-unit', `${sha.slice(0, 7)} is not ${unit} of ${ids.short}: ${notMine}`, `amend the commit in its branch so its last paragraph carries "Task: ${ids.short}" and "Unit: ${unit}", then compare and review it again`);
    const review = reviewOf(mainRoot, ids, unit, sha, r.files);
    result.review = review;
    const seen = review.ignored.length ? ` Rounds of ${unit} that do not cover it: ${review.ignored.join('; ')}.` : '';
    const how = `append a review-round to ${review.log} with --unit ${unit} --commit ${sha.slice(0, 7)} --blocking <count left>`;
    if (!review.latest) refuse('not-reviewed', `no review-round in ${review.log} with unit: ${unit} covers ${sha.slice(0, 7)}.${seen}`, `run code-review on ${sha.slice(0, 7)}, then ${how}`);
    else if (review.latest.blocking > 0) {
      const accepted = acceptedByDecision(mainRoot, ids, review.latest);
      review.accepted = accepted.decisions;
      if (accepted.ok) result.notes.push(acceptedText(review.latest, accepted.decisions));
      else refuse('review-blocking', `the latest review-round of ${sha.slice(0, 7)} (${review.latest.entry}) left blocking: ${review.latest.blocking}; ${accepted.why}`, `fix them in the unit's branch (amend), compare and review again (B-10); a fix is a new commit and needs its own round. The other way past a BLOCKING finding is the project owner accepting its risk in writing: a decision whose resolves: names it`);
    }
  }
  // D025, C-11, R-13, R-14: a round's blocking: 0 does not outweigh a blocking finding still open
  // anywhere in the task.
  const blockers = openBlocking(mainRoot, ids);
  if (blockers.open.length) refuse('open-blocking', `${ids.id} has ${blockers.open.length} blocking finding(s) open in ${blockers.log}: ${blockers.open.join(', ')}`, `resolve each with a fix (or a decision by the owner) whose resolves: names it by its id, then integrate again; the task's count decides, not the round's`);

  if (r.commits.length === 1 && r.forkPoint !== r.baseSha) refuse('behind', `${r.branch} starts at ${r.forkPoint.slice(0, 7)}, not at the tip of ${target} (${r.baseSha.slice(0, 7)})`, `run integrate-unit.mjs rebase ${task} ${unit}, then integrate`);

  const local = dirtyPaths(mainRoot).filter((p) => r.files.some((f) => pathsOverlap(f, p)));
  // R-8: the session's own unit, uncommitted, is the likely writer, so what comes first is
  // what keeps that work. check's main-checkout-write says the same about the same files
  // and is folded in here; it stays only for a file the commit itself does not change.
  if (local.length) {
    if (r.leaked.every((p) => local.includes(p))) result.refusals = result.refusals.filter((x) => x.code !== 'main-checkout-write');
    result.refusals.unshift({ code: 'local-changes', detail: `the main checkout has uncommitted changes to files the commit changes: ${local.join(', ')}; git merge --ff-only would refuse`, action: 'commit or set aside the session\'s own work on those files (a commit, or git stash), then integrate again. Only if nobody in this session wrote them did the builder write outside its worktree: then treat it as an overlap and rebuild the unit. Never restore or discard those files to make room: nothing is forced over them' });
  }

  // The suites run where the unit is: its own worktree, already on the tip (rebase put it there).
  const wt = r.commits.length === 1 ? worktrees(root).find((w) => w.branch === r.branch && w.path !== mainRoot) ?? null : null;
  if (r.commits.length === 1 && !wt) refuse('no-worktree', `${r.branch} has no worktree of its own to run the verification in`, `create one (git worktree add .claude/worktrees/${ids.short}-${unit} ${r.branch}), then integrate again; the suites run there, before ${target} moves`);
  if (result.refusals.length) return { ...result, verdict: 'refused' };

  const sha = r.commits[0];
  // A git in the suites that asks for credentials fails instead of waiting on a prompt nobody sees.
  const v = spawnSync('sh', ['-c', verify], { cwd: wt.path, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...HOOK_ENV, GIT_TERMINAL_PROMPT: '0' } });
  const output = `${v.stdout || ''}${v.stderr || ''}`.trim().split('\n').slice(-20).join('\n');
  result.verify = { command: verify, cwd: wt.path, exit: v.status, signal: v.signal ?? null, error: v.error?.message ?? null, output };
  // D-2: red, nothing moved — there is nothing to take out.
  if (v.error || v.status !== 0) {
    const red = v.error ? `could not be run (${v.error.message})` : v.status === null ? `was killed (${v.signal})` : `exited ${v.status}`;
    refuse('verify-failed', `\`${verify}\` ${red} in ${wt.path}, with ${unit} on ${r.baseSha.slice(0, 7)}; ${target} did not move`, `read its last lines; fix the unit in its branch (amend: a new commit needs a new review round) or discard it and rebuild it from the current tip. If it broke against another unit through no shared file, say so in the task log (B-15)`);
    return { ...result, verdict: 'refused' };
  }
  // What was verified is the commit only if the command left the worktree on it.
  const after = git(wt.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true }).stdout.trim();
  if (after !== sha || branchTip(root, r.branch) !== sha) {
    refuse('verify-moved', `the verification moved ${r.branch} or its worktree off ${sha.slice(0, 7)} (now ${short(after)})`, `${target} did not move. Put the branch back on its commit, and make the command leave the worktree's HEAD alone; then integrate again`);
    return { ...result, verdict: 'refused' };
  }
  // A tracked file the command changed means the suites passed on a tree that is not the commit.
  const touched = zlist(git(wt.path, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']).stdout);
  if (touched.length) {
    refuse('verify-dirtied', `the verification changed tracked file(s) of ${r.branch} in ${wt.path}: ${touched.join(', ')}; the suites passed on a tree that is not ${sha.slice(0, 7)}`, `${target} did not move. Make the command leave tracked files as they are (or commit what it changes, amend, and review again); restore them in the worktree, then integrate again`);
    return { ...result, verdict: 'refused' };
  }
  // D-4: new files the command left behind are listed, never integrated.
  const left = dirtyPaths(wt.path);
  if (left.length) result.notes.push(`the verification left uncommitted files in ${wt.path}: ${left.join(', ')}; they are not integrated, only the commit is`);
  // The review and the task's blocking findings were read before the command ran, which can take
  // minutes: one recorded meanwhile counts as if it had been there (D025).
  const reviewNow = reviewOf(mainRoot, ids, unit, sha, r.files);
  const acceptedNow = reviewNow.latest && reviewNow.latest.blocking > 0 ? acceptedByDecision(mainRoot, ids, reviewNow.latest) : null;
  if (!reviewNow.latest || (acceptedNow && !acceptedNow.ok)) refuse('review-blocking', `while the verification ran, the review of ${sha.slice(0, 7)} changed: ${reviewNow.latest ? `the latest round (${reviewNow.latest.entry}) left blocking: ${reviewNow.latest.blocking}; ${acceptedNow.why}` : 'no round covers it any more'}`, `${target} did not move. Fix what the round found (amend), compare and review again`);
  else if (acceptedNow) {
    result.review = { ...reviewNow, accepted: acceptedNow.decisions };
    const text = acceptedText(reviewNow.latest, acceptedNow.decisions);
    if (!result.notes.includes(text)) result.notes.push(`while the verification ran, ${text}`);
  }
  const blockersNow = openBlocking(mainRoot, ids);
  if (blockersNow.open.length) refuse('open-blocking', `while the verification ran, ${ids.id} got ${blockersNow.open.length} blocking finding(s) open in ${blockersNow.log}: ${blockersNow.open.join(', ')}`, `${target} did not move. Resolve each with a fix (or a decision by the owner) whose resolves: names it, then integrate again`);
  if (result.refusals.length) return { ...result, verdict: 'refused' };
  // D-3: what was verified sits on the tip read before; another integration meanwhile means a rebase.
  const tipNow = git(mainRoot, ['rev-parse', 'HEAD']).stdout.trim();
  const onNow = git(mainRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).stdout.trim();
  if (tipNow !== r.baseSha || onNow !== target) {
    refuse('tip-moved', `${target} moved from ${r.baseSha.slice(0, 7)} to ${tipNow.slice(0, 7)}${onNow !== target ? ` (the main checkout is now on ${onNow || 'a detached HEAD'})` : ''} while the verification ran`, `run integrate-unit.mjs rebase ${task} ${unit}, then integrate again: what was verified sits on the old tip`);
    return { ...result, verdict: 'refused' };
  }
  const m = git(mainRoot, ['merge', '--ff-only', '--quiet', sha], { allowFail: true });
  if (m.status !== 0) {
    refuse('ff-failed', `git merge --ff-only refused: ${`${m.stderr || ''}${m.stdout || ''}`.trim()}`, 'nothing was forced; resolve what git names and integrate again');
    return { ...result, verdict: 'refused' };
  }
  const to = git(mainRoot, ['rev-parse', 'HEAD']).stdout.trim();
  if (to !== sha) throw new CannotCheck(`git merge --ff-only reported success, but ${target} is at ${to}, not at ${sha}`);
  // Which command verified the unit, said where the integration is reported: a field in the task
  // file would be a line task-units.mjs does not read, and it refuses the whole "## Done when".
  Object.assign(result, { to, integrated: true, verifiedWith: verify });
  process.stderr.write(`! ${unit} integrated into ${target}: ${r.baseSha} → ${to}\n`);

  // The state, written by the session that runs this, in the main checkout: the check mark and
  // the commit: (B-1), then the indexes. Uncommitted: the task's closing commit carries them (C-2).
  // R-8: a fix of a unit that already records a commit of the branch keeps that commit, which
  // anchors the order; only a unit with none that counts (a rebuild after a revert, B-8) gets `to`.
  const state = { checkedOff: false, commit: keptCommit(mainRoot, ids, u, to) ?? to, indexes: null, file: relative(mainRoot, file) };
  result.state = state;
  try { state.checkedOff = writeUnitState(file, unit, state.commit); }
  catch (e) { throw new CannotCheck(`${unit} WAS integrated into ${target} (${r.baseSha} → ${to}), but it could not be recorded in ${state.file}: ${e.message}. Check it off by hand with one line "  - commit: ${state.commit}" under it (replacing its commit: line if it has one, never adding a second) and regenerate the indexes`, { integrated: true, from: r.baseSha, to, commit: state.commit }); }
  const gen = join(HERE, 'generate-task-index.mjs');
  if (!existsSync(gen)) { state.indexes = 'not installed'; result.notes.push(`generate-task-index.mjs is not next to this script, so the indexes were not regenerated`); }
  else {
    const g = spawnSync(process.execPath, [gen, mainRoot], { cwd: mainRoot, encoding: 'utf8', env: HOOK_ENV });
    if (g.error || g.status !== 0) throw new CannotCheck(`${unit} WAS integrated into ${target} (${r.baseSha} → ${to}) and checked off in ${state.file}, but generate-task-index.mjs failed: ${g.error ? g.error.message : `${g.stdout || ''}${g.stderr || ''}`.trim()}. Fix that and run it again`, { integrated: true, from: r.baseSha, to });
    state.indexes = 'regenerated';
  }
  // C-6, C-7, R-7: the units of other tasks that waited for these files are told, after the
  // state is written: until then the unit's worktree, which is still there, keeps having them
  // for everyone else (C-8).
  releasedAfter(root, file, to, r.files, result);
  return result;
}

/** The task file, its ids and its parsed units, read from the main checkout. */
function readTask(task, mainRoot) {
  const file = resolveTaskFile(task, mainRoot);
  if (!file || !existsSync(file)) throw new CannotCheck(`no task file for ${task}`);
  const ids = taskIds(file);
  return { file, ids, parsed: parseUnits(ids.text) };
}

const branchTip = (root, b) => git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}^{commit}`], { allowFail: true }).stdout.trim();
const treeOf = (root, rev) => git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{tree}`], { allowFail: true }).stdout.trim();
const parentOf = (root, rev) => git(root, ['rev-parse', '--verify', '--quiet', `${rev}^1`], { allowFail: true }).stdout.trim();

/**
 * A unit is named U<digits>, as in "## Done when" and as unitBranches reads it. Anything
 * else — `U1-backup-1` — would make ai/<task>-<that> the name of a branch that is not a
 * unit's, such as a backup, and discard deletes that branch.
 */
function assertUnitName(unit) {
  if (!/^U\d+$/.test(unit)) throw new CannotCheck(`${unit} is not a unit name: a unit is U followed by digits (U1, U12). Nothing was changed`);
}

/**
 * The unit's own branch: ai/<Tnnn>-<unit> or ai/<task-id>-<unit>, and never another one —
 * discard deletes it, so a --branch naming anything else is not taken.
 */
function ownBranch(root, ids, unit, branch) {
  assertUnitName(unit);
  const names = [...new Set([`ai/${ids.short}-${unit}`, `ai/${ids.id}-${unit}`])];
  if (branch && !names.includes(branch)) throw new CannotCheck(`${branch} is not a branch of ${unit}; only ${names.join(' or ')} can be named here`);
  const found = (branch ? [branch] : names).filter((b) => branchTip(root, b));
  if (found.length > 1) throw new CannotCheck(`two branches for ${unit}: ${found.join(', ')}; pass --branch`);
  return { names, branch: found[0] ?? null };
}

/**
 * The mark discard leaves in a worktree's own git directory before it moves that worktree's
 * HEAD onto a backup: task, unit, branch and backup. It goes with the worktree when the
 * worktree is removed; one still there means a discard of that unit stopped halfway.
 */
const MARK = 'integrate-unit-discard.json';
const markPath = (wtPath) => join(git(wtPath, ['rev-parse', '--absolute-git-dir']).stdout.trim(), MARK);
function readMark(wtPath) {
  try { return JSON.parse(readFileSync(markPath(wtPath), 'utf8')); } catch { return null; }
}
function writeMark(wtPath, mark) { writeFileSync(markPath(wtPath), `${JSON.stringify(mark, null, 2)}\n`); }
function clearMark(wtPath) { try { rmSync(markPath(wtPath), { force: true }); } catch { /* best effort */ } }

/** The backup branches of a unit branch that exist: <branch>-backup-<n>, in order. */
function backups(root, branch) {
  const out = git(root, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${branch}-backup-*`]).stdout;
  return out.split('\n').filter((b) => new RegExp(`^${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-backup-\\d+$`).test(b))
    .sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
}

/** Creates <branch>-backup-<n> at `commit` with the first free n; never overwrites a branch. */
function newBackup(root, branch, commit) {
  let n = 1;
  while (branchTip(root, `${branch}-backup-${n}`)) n++;
  const name = `${branch}-backup-${n}`;
  git(root, ['update-ref', `refs/heads/${name}`, commit, '']);
  if (branchTip(root, name) !== commit) throw new CannotCheck(`the backup branch ${name} does not point at ${commit}; nothing was removed or deleted`);
  return name;
}

/**
 * Commits everything uncommitted in a worktree — modified, deleted, untracked, not ignored —
 * on a backup branch, through scratch indexes, so neither the worktree's index nor its files
 * nor its branch change. What is staged is kept too: when the index differs from both the
 * commit and the disk, the backup is two commits, the index first and the disk on top. A
 * backup of the same unit with exactly that content is reused, not made again (a retry).
 * Checks that the scratch index holds the whole worktree before anything is created.
 */
function backUp(mainRoot, wtPath, branch, ids, dirty) {
  const dir = mkdtempSync(join(tmpdir(), 'integrate-unit-backup-'));
  try {
    const head = git(wtPath, ['rev-parse', 'HEAD']).stdout.trim();
    const headTree = treeOf(wtPath, head);
    // The index as it is, read from a copy so the real one is not even refreshed.
    const realIndex = git(wtPath, ['rev-parse', '--path-format=absolute', '--git-path', 'index']).stdout.trim();
    const indexEnv = { ...GIT_ENV, GIT_INDEX_FILE: join(dir, 'staged') };
    let indexTree = headTree;
    if (existsSync(realIndex)) {
      writeFileSync(join(dir, 'staged'), readFileSync(realIndex));
      const w = git(wtPath, ['write-tree'], { env: indexEnv, allowFail: true });
      if (w.error || w.status !== 0) throw new CannotCheck(`the index of ${wtPath} could not be read as a tree (${(w.stderr || '').trim()}); nothing was removed or deleted`);
      indexTree = w.stdout.trim();
    }
    const env = { ...GIT_ENV, GIT_INDEX_FILE: join(dir, 'disk') };
    const at = (args) => git(wtPath, args, { env, timeout: CHECKOUT.timeout });
    at(['read-tree', head]);
    at(['add', '-A']);
    const diskTree = at(['write-tree']).stdout.trim();
    const left = [
      ...zlist(at(['diff-files', '--name-only', '-z']).stdout),
      ...zlist(at(['ls-files', '--others', '--exclude-standard', '-z']).stdout),
    ];
    if (left.length) throw new CannotCheck(`the backup of ${wtPath} would leave out ${left.join(', ')}; nothing was removed or deleted`);
    // A discard cut short between moving HEAD and the index leaves the worktree on one of
    // the unit's backups with the old index: its disk is that backup already.
    const onBackup = backups(mainRoot, branch).find((x) => branchTip(mainRoot, x) === head);
    if (onBackup && diskTree === headTree) return { branch: onBackup, commit: head, files: dirty, indexTree, staged: false, reused: true };
    const staged = indexTree !== headTree && indexTree !== diskTree;

    // A retry: an existing backup with the same disk, the same staged state and the same base.
    for (const b of backups(mainRoot, branch)) {
      if (treeOf(mainRoot, b) !== diskTree) continue;
      const p = parentOf(mainRoot, b);
      if (staged ? (treeOf(mainRoot, p) === indexTree && parentOf(mainRoot, p) === head) : p === head) {
        return { branch: b, commit: branchTip(mainRoot, b), files: dirty, indexTree, staged, reused: true };
      }
    }

    const commitTree = (tree, parent, message) => {
      const ct = spawnSync('git', ['commit-tree', tree, '-p', parent], { cwd: wtPath, input: message, encoding: 'utf8', env: GIT_ENV, ...CHECKOUT });
      if (ct.error || ct.status !== 0) throw new CannotCheck(`committing the backup of ${wtPath} failed, so nothing was removed or deleted: ${ct.error ? ct.error.message : (ct.stderr || '').trim()}`);
      return ct.stdout.trim();
    };
    const trailer = `\n\nTask: ${ids.short}\n`;
    let parent = head;
    if (staged) parent = commitTree(indexTree, head, `backup: staged work of ${branch}, set aside by integrate-unit.mjs discard\n\nNever integrated. The commit on top holds the files as they were on disk.${trailer}`);
    const commit = commitTree(diskTree, parent, `backup: uncommitted work of ${branch}, set aside by integrate-unit.mjs discard\n\nNever integrated. ${dirty.length} path(s): ${dirty.join(', ')}${trailer}`);
    return { branch: newBackup(mainRoot, branch, commit), commit, files: dirty, indexTree, staged, reused: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * discard: removes the unit's worktree and deletes its branch, after committing whatever was
 * uncommitted in the worktree on a backup branch, and after keeping a commit that is not
 * integrated under a backup branch too. See the header for why there is no --force.
 */
export function discard({ root, task, unit, branch = null }) {
  const all = worktrees(root);
  const mainRoot = all[0].path;
  const { file, ids, parsed } = readTask(task, mainRoot);
  const own = ownBranch(mainRoot, ids, unit, branch);
  const isUnit = Boolean(parsed?.units.some((x) => x.id === unit));
  const result = { action: 'discard', task: ids.id, unit, branch: own.branch, tip: null, integrated: null, worktree: null, backup: null, kept: null, ignored: [], released: [], notes: [], refusals: [], verdict: 'discarded' };
  if (!own.branch) {
    // A rebuild runs discard before recreating the branch; a second run finds nothing left.
    if (!isUnit) throw new CannotCheck(`${unit} is not a unit of ${ids.id}, and there is no branch ${own.names.join(' or ')}`);
    return { ...result, verdict: 'nothing' };
  }
  const b = own.branch;
  const tip = branchTip(mainRoot, b);
  const refuse = (code, detail, action) => result.refusals.push({ code, detail, action });
  let wt = all.find((w) => w.branch === b) ?? null;
  // A discard that stopped halfway leaves the worktree detached on one of this unit's
  // backups, no longer on the branch, with the mark it wrote before moving HEAD: that one is
  // taken up again as the unit's worktree. A worktree on a backup without that mark — opened
  // by hand to look at the backup, or a check's scratch worktree — is someone else's: it is
  // reported and left as it is.
  let adopted = null;
  if (!wt) {
    const held = new Map(backups(mainRoot, b).map((x) => [branchTip(mainRoot, x), x]));
    for (const w of all.slice(1)) {
      if (w.branch || w.op || !existsSync(w.path)) continue;
      const head = git(w.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true }).stdout.trim();
      if (!held.has(head)) continue;
      const mark = readMark(w.path);
      if (!adopted && mark && mark.task === ids.short && mark.unit === unit && mark.branch === b && mark.commit === head) {
        adopted = { path: w.path, head, mark };
        wt = w;
        result.notes.push(`the worktree at ${w.path} was left detached on ${held.get(head)} by a discard of ${b} that stopped halfway (its mark says so); it is removed now, like the unit's own`);
      } else result.notes.push(`the worktree at ${w.path} stands detached on ${held.get(head)}, but no discard of ${b} left it there; it is left as it is`);
    }
  }
  // The tracked branch is what "integrated" is measured against: a detached HEAD or one
  // halfway through an operation is no such branch, and a commit only it reaches would lose
  // its last reference with the unit's branch.
  if (all[0].op) refuse('main-busy', `the main checkout is in the middle of a ${all[0].op}`, `finish or abort the ${all[0].op}, then discard again. Nothing was changed`);
  else if (!git(mainRoot, ['symbolic-ref', '--quiet', 'HEAD'], { allowFail: true }).stdout.trim()) refuse('main-detached', 'the main checkout is on a detached HEAD, so there is no tracked branch to tell whether the unit was integrated', 'check out the tracked branch there, then discard again. Nothing was changed');
  if (wt && wt.path === mainRoot) refuse('main-checkout', `${b} is checked out in the main checkout`, 'a unit branch lives in its own worktree; check out the tracked branch there first. Nothing was changed');
  else if (wt) {
    if (!existsSync(wt.path)) refuse('worktree-missing', `the worktree of ${b} is registered at ${wt.path}, but that folder is not there`, 'if it is not on a disk that is just unmounted, run git worktree prune, then discard again. Nothing was changed');
    else if (wt.op) refuse('worktree-busy', `the worktree at ${wt.path} is in the middle of a ${wt.op} on ${b}`, `have whoever started it finish or abort the ${wt.op}, then discard again. Nothing was changed`);
    if (wt.locked) refuse('worktree-locked', `the worktree at ${wt.path} is locked`, 'someone locked it on purpose; unlock it (git worktree unlock) only if nobody uses it, then discard again. Nothing was changed');
  }
  const mainHead = git(mainRoot, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { allowFail: true }).stdout.trim();
  const integrated = Boolean(mainHead) && git(mainRoot, ['merge-base', '--is-ancestor', tip, mainHead], { allowFail: true }).status === 0;
  Object.assign(result, { tip, integrated, worktree: wt?.path ?? null });
  if (result.refusals.length) return { ...result, verdict: 'refused' };

  const tracking = git(mainRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/']).stdout.split('\n').filter((r) => r.endsWith(`/${b}`));
  if (tracking.length) result.notes.push(`${b} is still on a remote (${tracking.join(', ')}): discard deletes only the local branch; delete the remote one by hand, since unit branches never reach a remote`);

  // R-5: what the unit had for other tasks — what it declares, what its branch wrote and what
  // its worktree has uncommitted — is let go with it, unless it is checked off: then it had
  // nothing left, and integrate already said who no longer waits.
  const u = parsed?.units.find((x) => x.id === unit) ?? null;
  const had = [];
  if (u && !u.done) {
    had.push(...(u.touches ?? []));
    if (!integrated && mainHead) had.push(...changedFiles(mainRoot, git(mainRoot, ['merge-base', mainHead, tip]).stdout.trim(), tip));
    if (wt && existsSync(wt.path)) had.push(...dirtyPaths(wt.path));
  }

  if (wt) {
    const dirty = dirtyPaths(wt.path);
    // Ignored files (a .env written by hand, node_modules) are in no backup and go with the
    // worktree (the owner, 2026-09-30): they are listed, for the session to copy into the task log.
    result.ignored = zlist(git(wt.path, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']).stdout);
    if (dirty.length) {
      result.backup = backUp(mainRoot, wt.path, b, ids, dirty);
      // Stand the worktree on the backup: detached, so the unit's branch does not move, and
      // with its index at the backup, so git sees it clean only if the backup holds it all.
      process.stderr.write(`! uncommitted work of ${b} ${result.backup.reused ? 'already ' : ''}backed up on ${result.backup.branch} (${result.backup.commit})\n`);
      // The mark, then HEAD: from here on, a run cut short leaves the worktree detached on the
      // backup with the mark that says whose it is, which is how the next discard finds it.
      writeMark(wt.path, { task: ids.short, unit, branch: b, backup: result.backup.branch, commit: result.backup.commit });
      git(wt.path, ['update-ref', '--no-deref', 'HEAD', result.backup.commit]);
      git(wt.path, ['read-tree', result.backup.commit]);
    }
    const rm = git(mainRoot, ['worktree', 'remove', wt.path], { allowFail: true });
    if (rm.error || rm.status !== 0) {
      const why = rm.error ? rm.error.message : (rm.stderr || '').trim();
      if (result.backup) {
        // Back as it was, files untouched and what was staged staged again: the unit's own
        // worktree on its branch, without the mark; an adopted one detached where it stood.
        if (adopted) {
          git(wt.path, ['update-ref', '--no-deref', 'HEAD', adopted.head], { allowFail: true });
          writeMark(wt.path, adopted.mark);
        }
        else git(wt.path, ['symbolic-ref', 'HEAD', `refs/heads/${b}`], { allowFail: true });
        git(wt.path, ['read-tree', result.backup.indexTree], { allowFail: true });
        if (!adopted) clearMark(wt.path);
      }
      throw new CannotCheck(`git worktree remove ${wt.path} refused, and it is never forced: ${why}. The worktree and ${b} are kept${result.backup ? `; the backup branch ${result.backup.branch} (${result.backup.commit}) stays too, and a retry reuses it` : ''}`, { backup: result.backup });
    }
    if (existsSync(wt.path) || worktrees(mainRoot).some((w) => w.path === wt.path)) throw new CannotCheck(`git worktree remove ${wt.path} reported success, but the worktree is still there`, { backup: result.backup });
  }

  if (branchTip(mainRoot, b) !== tip) throw new CannotCheck(`${b} moved from ${tip} while it was being discarded; it was not deleted${wt ? ', though its worktree was removed' : ''}`, { backup: result.backup });
  // A commit not in the tracked branch loses its last reference with the branch (and its
  // reflog): it is kept under a backup branch first, unless one already has it in its history.
  if (!integrated) {
    if (result.backup) result.kept = { branch: result.backup.branch, commit: tip, reused: true };
    else {
      const holder = backups(mainRoot, b).find((x) => git(mainRoot, ['merge-base', '--is-ancestor', tip, `refs/heads/${x}`], { allowFail: true }).status === 0);
      result.kept = { branch: holder ?? newBackup(mainRoot, b, tip), commit: tip, reused: Boolean(holder) };
    }
  }
  const del = git(mainRoot, ['branch', '-D', '--quiet', b], { allowFail: true });
  if (del.error || del.status !== 0 || branchTip(mainRoot, b)) throw new CannotCheck(`deleting ${b} failed${wt ? ' after its worktree was removed' : ''}: ${del.error ? del.error.message : (del.stderr || '').trim()}`, { backup: result.backup, kept: result.kept });
  if (had.length && mainHead) releasedAfter(root, file, mainHead, had, result);
  return result;
}

/**
 * The task, read whole, and the tracked branch to read it against: --base, or the branch the
 * main checkout is on — never a detached HEAD or one halfway through an operation.
 */
function taskAndBase(root, task, base, cmd) {
  const all = worktrees(root);
  const mainRoot = all[0].path;
  const { file, ids, parsed } = readTask(task, mainRoot);
  if (!parsed) throw new CannotCheck(`the task file of ${ids.id} has no "## Done when" section`);
  if (parsed.malformed.length) throw new CannotCheck(`${parsed.malformed.length} line(s) in "## Done when" of ${ids.id} could not be read as units (line ${parsed.malformed.map((m) => m.line).join(', ')}); run task-units.mjs on the task, fix them, and run ${cmd} again`);
  let baseName = base;
  if (base === null) {
    if (all[0].op) throw new CannotCheck(`the main checkout is in the middle of a ${all[0].op}, so its HEAD is not the tracked branch; finish or abort it, or pass --base`);
    baseName = git(mainRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).stdout.trim();
    if (!baseName) throw new CannotCheck('the main checkout is on a detached HEAD, so there is no tracked branch to read; check it out there, or pass --base');
  }
  const baseSha = git(mainRoot, ['rev-parse', '--verify', '--quiet', `${baseName}^{commit}`], { allowFail: true }).stdout.trim();
  if (!baseSha) throw new CannotCheck(`base ${baseName} is not a commit`);
  return { all, mainRoot, file, ids, parsed, baseName, baseSha };
}

/** The commits of `baseSha`'s history whose Task: names this task and whose Unit: names the unit, oldest first. */
function unitCommits(root, baseSha, ids, unit) {
  const out = git(root, ['log', '-z', '--topo-order', '--reverse', '-i', '-E', '--grep=^unit[[:space:]]*:', '--format=%H%x1f%(trailers:key=Task,valueonly,separator=%x1e)%x1f%(trailers:key=Unit,valueonly,separator=%x1e)', baseSha]).stdout;
  return out.split('\0').filter(Boolean).map((rec) => rec.replace(/^\n/, '').split('\x1f'))
    .filter(([, t = '', u = '']) => { const ts = valueList(t); return ts.length === 1 && isTask(ts[0], ids) && valueList(u).join() === unit; })
    .map(([sha]) => sha);
}

/** The unit's recorded commit: value when it still counts (its own, in `tipSha`), or null: then it may be written anew. */
function keptCommit(root, ids, u, tipSha) {
  const { sha } = recordedCommit(root, ids, u);
  return sha && git(root, ['merge-base', '--is-ancestor', sha, tipSha], { allowFail: true }).status === 0 ? u.commit : null;
}

/** Whether a commit of `baseSha`'s history reverts `sha` ("This reverts commit <sha>"). */
const isReverted = (root, baseSha, sha) => Boolean(git(root, ['log', '-1', '--format=%H', '-F', `--grep=This reverts commit ${sha}`, baseSha]).stdout.trim());

/** record: with a single writer, writes the unit's commit: as integrate would (D024). See the header. */
export function record({ root, task, unit, base = null, commit = null }) {
  assertUnitName(unit);
  const { mainRoot, file, ids, parsed, baseName, baseSha } = taskAndBase(root, task, base, 'record');
  const u = parsed.units.find((x) => x.id === unit);
  if (!u) throw new CannotCheck(`${unit} is not a unit of ${ids.id}`);
  const found = unitCommits(mainRoot, baseSha, ids, unit);
  const result = { action: 'record', task: ids.id, unit, base: baseName, commit: null, candidates: found, written: false, file: relative(mainRoot, file), held: [], refusals: [], verdict: 'recorded' };
  const refuse = (code, detail, action) => result.refusals.push({ code, detail, action });
  const list = found.map((c) => c.slice(0, 7)).join(', ');
  // R-8: a commit: that still counts is kept; a fix commit never takes its place.
  const kept = keptCommit(mainRoot, ids, u, baseSha);
  const picked = commit ? git(mainRoot, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], { allowFail: true }).stdout.trim() : null;
  if (commit && kept) refuse('already-recorded', `${unit} already records ${kept}, a commit of ${baseName}; a fix does not replace it`, 'nothing to record; --commit only chooses while the unit has no commit: that counts');
  else if (commit && !found.includes(picked)) refuse('not-the-unit', `${commit} is not a commit of ${baseName} with Task: ${ids.short} and Unit: ${unit}${found.length ? ` (those are: ${list})` : ''}`, 'pass one of those, or none');
  else if (!found.length) refuse('no-commit', `no commit of ${baseName} carries Task: ${ids.short} and Unit: ${unit}`, `commit ${unit} with both lines in its last paragraph, then record it`);
  // mdbn: the oldest is the unit's commit unless a later one reverted it; then nothing here
  // can tell a rebuild from a fix, and the choice is made explicitly.
  else if (!commit && !kept && isReverted(mainRoot, baseSha, found[0])) refuse('reverted', `the oldest commit of ${unit}, ${found[0].slice(0, 7)}, was reverted later in ${baseName} (of ${list})`, `pass --commit with ${unit}'s commit`);
  if (result.refusals.length) return { ...result, verdict: 'refused' };
  // D052, C-5: the same review check makes against other tasks, over every commit carrying the
  // unit's lines (a fix included). The commit is on the tracked branch already, so waiting is
  // no longer possible: nothing is recorded, and the instruction says what is left.
  // A holder counts against a file only for a commit its branch does not already contain. The
  // reading is that such a unit of another task was dispatched after the commit, started from
  // it and built on that version, so nothing of it is rebuilt — the commit was first. That is
  // an assumption, not a fact git states: a branch rebased by hand onto a tip holding the
  // commit contains it too (the header says so). The ancestry is read against the branch's tip.
  const byFile = new Map();
  for (const c of found) for (const f of changedFiles(mainRoot, `${c}~1`, c)) if (!isStateFile(f)) byFile.set(f, [...(byFile.get(f) ?? []), c]);
  const others = byFile.size ? othersHolds(mainRoot, file, baseSha) : { claims: [] };
  const declared = u.touches ?? [];
  const containsCache = new Map();
  const contains = (branch, c) => {
    const k = `${branch}\0${c}`;
    if (!containsCache.has(k)) containsCache.set(k, git(mainRoot, ['merge-base', '--is-ancestor', c, `refs/heads/${branch}`], { allowFail: true }).status === 0);
    return containsCache.get(k);
  };
  result.held = [...byFile].map(([f, cs]) => heldBy(f, others.claims, declared.some((d) => pathsOverlap(d, f)), (claim) => cs.some((c) => !contains(claim.branch, c)))).filter(Boolean);
  for (const h of result.held) {
    if (h.kind === 'both-undeclared') refuse('held-both-undeclared', `${h.file}: ${unit} wrote it without declaring it, and so did ${holdersText(h)}, of another task, which has it now; ${unit}'s commit already wrote it on ${baseName}`, `nothing is recorded: neither declared the file, and the project owner decides which of the two gives way`);
    else if (h.kind === 'both-declared') refuse('held-both-declared', `${h.file}: ${unit} declared it, and so did ${holdersText(h)}, of another task, which has it now; ${unit}'s commit already wrote it on ${baseName}`, `nothing is recorded: the project owner decides which of the two gives way`);
    else refuse('held', `${h.file}: ${holdersText(h)}, of another task, has it until ${untilText(h)}, and ${unit}'s commit already wrote it on ${baseName}${declared.some((d) => pathsOverlap(d, h.file)) ? '' : ' without declaring it'}`, `nothing is recorded. The file was not ${unit}'s to write yet, and that commit will make the other unit be rebuilt: ask the project owner whether to take it out with git revert and build ${unit} again once ${untilText(h)}`);
  }
  if (result.refusals.length) return { ...result, verdict: 'refused' };
  result.commit = kept ?? picked ?? found[0];
  result.written = writeUnitState(file, unit, result.commit);
  return result;
}

/**
 * status: what is alive of a task and what its record says, without moving or deleting
 * anything. See the header.
 */
export function status({ root, task, base = null }) {
  const { all, mainRoot, ids, parsed, baseName, baseSha } = taskAndBase(root, task, base, 'status');

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^ai/(?:${esc(ids.short)}|${esc(ids.id)})-(U\\d+)(?:-backup-(\\d+))?$`);
  const refs = git(mainRoot, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads/ai/']).stdout.split('\n').filter(Boolean)
    .map((l) => { const [branch, tip] = l.split('\0'); const m = branch.match(re); return m ? { branch, tip, unit: m[1], backup: m[2] !== undefined } : null; })
    .filter(Boolean);
  if (refs.some((r) => r.branch === baseName)) throw new CannotCheck(`the tracked branch read is ${baseName}, a branch of ${ids.id}'s units; check out the tracked branch in the main checkout, or pass --base`);
  const known = new Map(parsed.units.map((u) => [u.id, u]));
  const findings = [];
  const find = (code, detail, action) => findings.push({ code, detail, action });
  const inBase = (sha) => git(mainRoot, ['merge-base', '--is-ancestor', sha, baseSha], { allowFail: true }).status === 0;

  // The record (D019): each unit's commit: line, never the history.
  const units = parsed.units.map((u) => {
    const { sha, why } = recordedCommit(mainRoot, ids, u);
    return { id: u.id, done: u.done, replaced: u.replaced, dependsOn: u.dependsOn, recorded: u.commit, why, commit: sha && inBase(sha) ? sha : null };
  });
  const byId = new Map(units.map((u) => [u.id, u]));
  const recordIt = (id) => `integrate-unit.mjs record ${ids.short} ${id}`;
  for (const u of units) {
    if (u.recorded && !u.commit) find('bad-record', `${u.id} records commit ${u.recorded}, which ${u.why ?? `is not in ${baseName}`}`, `if ${u.id} was rebuilt or rebased, write the commit that is in ${baseName} (${recordIt(u.id)}); if it was taken out, uncheck it and remove its commit: line`);
    else if (u.commit && !u.done) find('not-checked-off', `${u.id} records ${u.commit.slice(0, 7)}, in ${baseName}, but is not checked off`, `check it off; if it should not be there, take it out and remove its commit: line`);
    else if (u.done && !u.replaced && !u.recorded) find('no-record', `${u.id} is checked off with no commit: line, so nothing says which commit it is`, `run ${recordIt(u.id)} (it finds the commit with Task: ${ids.short} and Unit: ${u.id}); a task closed before commit: lines existed stays as it is`);
    if (!u.commit) continue;
    // In an order that respects depends on: each dependency's commit at or below the unit's.
    for (const d of u.dependsOn) {
      const dep = byId.get(d);
      if (!dep || dep.replaced || (dep.done && !dep.commit)) continue;
      if (!dep.commit) find('out-of-order', `${u.id} is in ${baseName}, but ${d}, which it depends on, has no commit: there`, `${u.id} was integrated before its dependency: take it out, integrate ${d}, then ${u.id} again`);
      else if (git(mainRoot, ['merge-base', '--is-ancestor', dep.commit, u.commit], { allowFail: true }).status !== 0) find('out-of-order', `${u.id} (${u.commit.slice(0, 7)}) is in ${baseName} below ${d} (${dep.commit.slice(0, 7)}), which it depends on`, `take the commits out from ${u.id} up, newest first, and integrate them again in order: ${d} first`);
    }
  }

  const live = all.slice(1).map((w) => ({ ...w, missing: !existsSync(w.path) }));
  const backupRefs = refs.filter((r) => r.backup);
  const wtOf = (branch) => live.find((w) => w.branch === branch) ?? null;

  const branches = refs.filter((r) => !r.backup).map((r) => {
    const ahead = Number(git(mainRoot, ['rev-list', '--count', `${baseSha}..${r.tip}`]).stdout.trim());
    // Integrated when its tip, in the base, is a commit of the unit: its recorded one, or a fix
    // carrying its Unit: line (wa91). A tip that is someone else's is a branch never built on.
    const own = ahead === 0 && known.has(r.unit) && !unitLineProblem(mainRoot, r.tip, ids, r.unit);
    const integrated = own && Boolean(known.get(r.unit).done || known.get(r.unit).commit);
    const b = { branch: r.branch, unit: r.unit, tip: r.tip, ahead, integrated, worktree: wtOf(r.branch)?.path ?? null };
    if (!known.has(r.unit)) find('unknown-unit', `${r.branch} is a branch of ${r.unit}, which is not a unit of ${ids.id} (renumbered or removed?)`, `look at what it holds; then discard it (discard ${ids.short} ${r.unit} keeps a commit that is not integrated on a backup)`);
    else if (ahead > 0) find('not-integrated', `${r.branch} holds ${ahead} commit(s) that are not in ${baseName}`, `integrate it (check, rebase, review, integrate) or discard it, which keeps its commit on a backup; nothing ships while it is there`);
    else if (own && !integrated) find('unrecorded', `${r.branch} is in ${baseName} with its Unit: line (${r.tip.slice(0, 7)}), but ${r.unit} is neither checked off nor recorded`, `run ${recordIt(r.unit)}; then discard the branch`);
    else if (integrated) find('integrated-branch-left', `${r.branch} is integrated (${r.tip.slice(0, 7)}) and still there${b.worktree ? `, with its worktree at ${b.worktree}` : ''}`, `discard ${ids.short} ${r.unit}: nothing of it is lost`);
    else find('no-commit', `${r.branch} has no commit of its own${b.worktree ? `; its worktree is at ${b.worktree}` : ''}`, `a builder may still be working there; if not, discard ${ids.short} ${r.unit}`);
    return b;
  });

  const backupsOut = backupRefs.map((r) => {
    const integrated = inBase(r.tip);
    if (integrated) find('backup-integrated', `the backup ${r.branch} (${r.tip.slice(0, 7)}) is in ${baseName}`, 'a backup is never integrated: take it out with git revert');
    return { branch: r.branch, unit: r.unit, tip: r.tip, integrated, worktree: wtOf(r.branch)?.path ?? null };
  });

  // A worktree belongs to the task when it is on one of its branches, or detached on one of
  // its backups — where a discard cut short leaves it, with its mark.
  const backupAt = new Map(backupRefs.map((r) => [r.tip, r]));
  const wts = [];
  for (const w of live) {
    const onRef = refs.find((r) => r.branch === w.branch) ?? null;
    let head = null;
    if (!w.branch && !w.missing) head = git(w.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true }).stdout.trim() || null;
    const onBackup = !onRef && head ? backupAt.get(head) ?? null : null;
    const mark = onBackup ? readMark(w.path) : null;
    if (!onRef && !onBackup) continue;
    const unit = (onRef ?? onBackup).unit;
    const interrupted = Boolean(mark && mark.task === ids.short && mark.commit === head);
    const entry = { path: w.path, branch: w.branch, unit, detachedOn: onBackup?.branch ?? null, interruptedDiscard: interrupted, missing: w.missing, locked: w.locked, op: w.op, dirty: [] };
    if (w.missing) find('worktree-missing', `the worktree of ${unit} is registered at ${w.path}, but that folder is not there`, 'if it is not on a disk that is just unmounted, run git worktree prune');
    else {
      entry.dirty = dirtyPaths(w.path);
      if (w.op) find('worktree-busy', `the worktree at ${w.path} is in the middle of a ${w.op}`, `have whoever started it finish or abort the ${w.op}; nothing here touches it`);
      if (entry.dirty.length) find('worktree-dirty', `the worktree of ${unit} at ${w.path} has uncommitted work: ${entry.dirty.join(', ')}`, `nothing deletes it here. Have the builder commit it, or run discard ${ids.short} ${unit}, which backs it up on a branch first`);
    }
    if (interrupted) find('discard-interrupted', `the worktree at ${w.path} stands detached on ${onBackup.branch}, left there by a discard of ${mark.branch} that stopped halfway`, `run discard ${ids.short} ${unit} again: it takes this worktree up`);
    wts.push(entry);
  }

  const verdict = findings.length ? 'attention' : 'clean';
  return { action: 'status', task: ids.id, base: baseName, baseSha, worktrees: wts, branches, backups: backupsOut, units, findings, verdict };
}

function listOf(value) {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

const USAGE = [
  'usage: integrate-unit.mjs check     <task-id | tasks/<file>.md> <unit> [--branch <name>] [--base <ref>] [--in-flight U4,U5] [--root <path>] [--json]',
  '       integrate-unit.mjs rebase    <task-id | tasks/<file>.md> <unit> [--branch <name>] [--base <ref>] [--in-flight U4,U5] [--root <path>] [--json]',
  '       integrate-unit.mjs integrate <task-id | tasks/<file>.md> <unit> --verify <command> [--branch <name>] [--in-flight U4,U5] [--root <path>] [--json]',
  '       integrate-unit.mjs discard   <task-id | tasks/<file>.md> <unit> [--branch <name>] [--root <path>] [--json]',
  '       integrate-unit.mjs record    <task-id | tasks/<file>.md> <unit> [--base <ref>] [--commit <sha>] [--root <path>] [--json]',
  '       integrate-unit.mjs status    <task-id | tasks/<file>.md> [--base <ref>] [--root <path>] [--json]',
].join('\n');
const COMMANDS = { check, rebase, integrate, discard, record, status };
/** Subcommands taken out, with what does their job now: asked for, they say it instead of the usage. */
const GONE = { undo: 'undo no longer exists (T123): integrate runs the suites before the tracked branch moves, so nothing red goes in. A unit already integrated comes out with a plain git revert of its commit; then uncheck it in the task file and remove its commit: line' };

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (Object.hasOwn(GONE, cmd ?? '')) { console.error(`✗ ${GONE[cmd]}`); return 2; }
  if (!Object.hasOwn(COMMANDS, cmd ?? '')) { console.error(cmd ? `✗ unknown command ${cmd}\n${USAGE}` : `✗ ${USAGE}`); return 2; }
  // --json is read first, so an error in any other option still comes out as JSON.
  const opts = { root: process.cwd(), json: rest.includes('--json'), inFlight: null, branch: null, base: null, commit: null, verify: null };
  const pos = [];
  const needs = (a, v) => { if (!v || v.startsWith('--')) throw new CannotCheck(`${a} needs a value`); return v; };
  try {
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--root') opts.root = resolve(needs(a, rest[++i]));
      else if (a === '--branch') opts.branch = needs(a, rest[++i]);
      else if (a === '--base') opts.base = needs(a, rest[++i]);
      else if (a === '--in-flight') opts.inFlight = listOf(needs(a, rest[++i]));
      else if (a === '--commit') opts.commit = needs(a, rest[++i]);
      else if (a === '--verify') { opts.verify = rest[++i]; if (!opts.verify?.trim()) throw new CannotCheck('--verify needs a command'); }
      else if (a === '--json') opts.json = true;
      else if (a.startsWith('--')) throw new CannotCheck(`unknown option ${a}`);
      else pos.push(a);
    }
    if (pos.length !== (cmd === 'status' ? 1 : 2)) throw new CannotCheck(USAGE);
    const top = git(opts.root, ['rev-parse', '--show-toplevel'], { allowFail: true }).stdout.trim();
    if (!top) throw new CannotCheck(`${opts.root} is not inside a git repository`);
    if (cmd === 'integrate' && opts.base) throw new CannotCheck('--base does not apply to integrate: it integrates into the branch checked out in the main checkout');
    if (cmd === 'discard' && (opts.base || opts.inFlight)) throw new CannotCheck(`--base and --in-flight do not apply to ${cmd}`);
    if (cmd !== 'record' && opts.commit) throw new CannotCheck('--commit applies only to record');
    if (cmd === 'record' && (opts.branch || opts.inFlight)) throw new CannotCheck('--branch and --in-flight do not apply to record: it reads the tracked branch');
    if (cmd !== 'integrate' && opts.verify !== null) throw new CannotCheck('--verify applies only to integrate');
    if (cmd === 'status' && (opts.branch || opts.inFlight)) throw new CannotCheck('--branch and --in-flight do not apply to status: it reads every branch of the task');
    const r = await COMMANDS[cmd]({ root: realpathSync(top), task: pos[0], unit: pos[1], branch: opts.branch, base: opts.base, inFlight: opts.inFlight ?? [], commit: opts.commit, verify: opts.verify });
    if (opts.json) console.log(JSON.stringify(r, null, 2));
    else PRINTERS[cmd](r);
    return r.verdict === 'refused' || r.verdict === 'attention' ? 1 : r.verdict === 'pass-undeclared' ? 3 : 0;
  } catch (e) {
    if (!(e instanceof CannotCheck)) throw e;
    if (opts.json) console.log(JSON.stringify({ verdict: 'cannot-check', reason: e.message, ...(e.extra ?? {}) }, null, 2));
    else console.error(`✗ Could not ${cmd}: ${e.message}`);
    return 2;
  }
}

function printCheckBody(r, refusals = r.refusals) {
  console.log(`\n  ${r.unit} of ${r.task}, branch ${r.branch}, against ${r.base} (${r.baseSha.slice(0, 7)})\n`);
  console.log(`  Commits: ${r.commits.length ? r.commits.map((c) => c.slice(0, 7)).join(', ') : 'none'}`);
  console.log(`  Files: ${r.files.length}, ${r.files.length - r.undeclared.length} of them declared or refused below`);
  if (r.inFlight.length) console.log(`  Units in flight: ${r.inFlight.join(', ')}`);
  console.log(`  Pre-commit hook: ${r.hook.ran ? (r.hook.ok ? 'passes' : 'fails') : r.hook.output}`);
  for (const x of refusals) console.log(`\n  ✗ ${x.code}: ${x.detail}\n      → ${x.action}`);
  if (r.undeclared.length) {
    console.log('\n  Written without being declared, and nobody else touched them:');
    for (const x of r.undeclared) console.log(`    · ${x.file}${x.note ? ` — ${x.note}` : ''}`);
  }
  console.log('');
}

function printCheck(r) {
  printCheckBody(r);
  if (r.verdict === 'refused') console.log(`✗ ${r.unit} is not integrated: ${r.refusals.length} reason(s) above.`);
  else if (r.verdict === 'pass-undeclared') console.log(`✓ ${r.unit} passes, with ${r.undeclared.length} undeclared file(s): widen its touches:, note it in the task log, and give the list to the reviewer.`);
  else console.log(`✓ ${r.unit} keeps its contract: one commit, only declared files. Go on to review.`);
}

const short = (sha) => (sha ? sha.slice(0, 7) : 'none');

function printRebase(r) {
  printCheckBody(r.after ?? r.before, r.refusals);
  if (r.verdict === 'refused') {
    const where = r.rebased ? `after the rebase (old commit ${r.oldTip}, new commit ${r.newTip})` : `and ${r.branch} is where it was`;
    console.log(`✗ ${r.unit} is refused ${where}: ${r.refusals.length} reason(s) above. It is not integrated.`);
    return;
  }
  if (!r.rebased) console.log(`✓ ${r.unit} already starts at the tip (${short(r.onto)}); nothing to rebase. Commit ${r.oldTip}.`);
  else {
    console.log(`✓ ${r.unit} rebased onto ${short(r.onto)} and checked again.`);
    console.log(`  Old commit: ${r.oldTip}\n  New commit: ${r.newTip}`);
    console.log('  The tip changed no file of the unit, so a review of the old commit carries over; note both hashes in the task log.');
  }
  if (r.verdicts.includes('pass-undeclared')) console.log(`  ${r.after.undeclared.length} undeclared file(s) above: widen its touches:, note it in the task log, and give the list to the reviewer.`);
}

function printIntegrate(r) {
  printCheckBody(r.check, r.refusals);
  if (r.review?.latest) console.log(`  Review: ${r.review.latest.entry} in ${r.review.log} (${r.review.latest.how}, commit ${r.review.latest.cited}): blocking: ${r.review.latest.blocking}`);
  if (r.verify) console.log(`  Verification: \`${r.verify.command}\` in ${r.verify.cwd} exited ${r.verify.exit ?? r.verify.signal ?? r.verify.error}${r.verify.exit !== 0 && r.verify.output ? `; its last lines:\n${r.verify.output.split('\n').map((l) => `      ${l}`).join('\n')}` : ''}`);
  for (const n of r.notes) console.log(`  ! ${n}`);
  if (r.verdict === 'refused') { console.log(`✗ ${r.unit} is not integrated, and nothing changed: ${r.refusals.length} reason(s) above.`); return; }
  console.log(`✓ ${r.unit} integrated into ${r.into}: ${short(r.from)} → ${r.to}, verified with \`${r.verifiedWith}\`.`);
  console.log(`  Checked off with commit: ${r.to} in ${r.state.file}${r.state.indexes === 'regenerated' ? ', and the indexes regenerated' : ''}, uncommitted: the task's closing commit carries them. Its worktree and branch are left as they are.`);
  if (r.verdict === 'pass-undeclared') console.log(`  ${r.check.undeclared.length} undeclared file(s) above: widen its touches: and note it in the task log.`);
  printReleased(r);
}

function printRefusals(r) {
  for (const x of r.refusals) console.log(`\n  ✗ ${x.code}: ${x.detail}\n      → ${x.action}`);
  console.log('');
}

function printDiscard(r) {
  if (r.verdict === 'nothing') { console.log(`✓ ${r.unit} of ${r.task} has no branch left; nothing to discard.`); return; }
  console.log(`\n  ${r.unit} of ${r.task}, branch ${r.branch} at ${r.tip}, worktree ${r.worktree ?? 'none'}`);
  if (r.verdict === 'refused') { printRefusals(r); console.log(`✗ ${r.branch} is not discarded, and nothing changed: ${r.refusals.length} reason(s) above.`); return; }
  console.log('');
  if (r.backup) console.log(`  ! Uncommitted work ${r.backup.reused ? 'already ' : ''}backed up on ${r.backup.branch} (${r.backup.commit})${r.backup.staged ? ', staged version and disk version as two commits' : ''}, never to be integrated: ${r.backup.files.join(', ')}. Note it in the task log; it is deleted when the task ships.`);
  if (r.ignored.length) console.log(`  ! Ignored files went with the worktree, not backed up: ${r.ignored.join(', ')}`);
  for (const n of r.notes) console.log(`  ! ${n}`);
  printReleased(r);
  console.log(`✓ ${r.branch} discarded: ${r.worktree ? 'worktree removed, ' : ''}branch deleted.`);
  console.log(r.integrated ? `  Its commit ${r.tip} is in the tracked branch; nothing of it was lost.` : `  Its commit ${r.tip} was not integrated: it is kept on ${r.kept.branch}, never to be integrated. Note it in the task log; it is deleted when the task ships.`);
}

function printRecord(r) {
  console.log(`\n  ${r.unit} of ${r.task}, against ${r.base}`);
  if (r.verdict === 'refused') { printRefusals(r); console.log(`✗ ${r.unit} is not recorded, and nothing changed: ${r.refusals.length} reason(s) above.`); return; }
  console.log(`\n✓ ${r.unit} ${r.written ? 'checked off' : 'was already checked off'} with commit: ${r.commit} in ${r.file}, uncommitted: the session's next commit carries it.`);
}

function printStatus(r) {
  console.log(`\n  ${r.task}, against ${r.base} (${short(r.baseSha)})\n`);
  console.log(`  Worktrees: ${r.worktrees.length ? '' : 'none'}`);
  for (const w of r.worktrees) {
    const state = [w.missing ? 'folder missing' : null, w.op ? `in the middle of a ${w.op}` : null, w.locked ? 'locked' : null, w.dirty.length ? `${w.dirty.length} uncommitted path(s)` : null].filter(Boolean);
    console.log(`    · ${w.unit} at ${w.path}, ${w.branch ? `on ${w.branch}` : `detached on ${w.detachedOn}`}${state.length ? ` — ${state.join(', ')}` : ''}`);
  }
  console.log(`  Unit branches: ${r.branches.length ? '' : 'none'}`);
  for (const b of r.branches) console.log(`    · ${b.branch} at ${short(b.tip)}, ${b.ahead ? `${b.ahead} commit(s) not in ${r.base}` : b.integrated ? 'integrated' : 'no commit of its own'}`);
  console.log(`  Backups: ${r.backups.length ? '' : 'none'}`);
  for (const b of r.backups) console.log(`    · ${b.branch} at ${short(b.tip)} — never integrated; deleted when the task ships`);
  console.log('  Units, as the task file records them:');
  for (const u of r.units) console.log(`    · ${u.id} ${u.replaced ? 'replaced' : u.done ? 'checked off' : 'open'}: ${u.recorded ? `commit ${short(u.recorded)}` : 'no commit recorded'}`);
  for (const x of r.findings) console.log(`\n  ✗ ${x.code}: ${x.detail}\n      → ${x.action}`);
  console.log('');
  if (r.verdict === 'attention') console.log(`✗ ${r.task} has ${r.findings.length} thing(s) to attend to above. Nothing was moved or deleted.`);
  else console.log(`✓ ${r.task}: nothing out of place — every unit checked off records a commit of ${r.base}, in order, and nothing of it is left alive.`);
}

const PRINTERS = { check: printCheck, rebase: printRebase, integrate: printIntegrate, discard: printDiscard, record: printRecord, status: printStatus };

// Compared as real paths: run through a symlink (macOS's /var is one), the two spellings
// differ, and a plain comparison would skip main() and exit 0 — a pass nobody checked.
// An argv[1] that is not a file (`node -e "import(...)" foo`) means this was imported.
function isMain() {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  process.exit(await main(process.argv.slice(2)));
}
