#!/usr/bin/env node
/**
 * hold-task.mjs — sets a held task aside on its own branch, and releases it later.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * Shipping straight to the tracked branch, a task can be held: its commits are local and
 * reviewed, but something the owner must decide has not arrived. A push carries the whole
 * history between the remote and HEAD, so the next task's push used to carry the held
 * commits with it, and the hold existed only in the chat that decided it. So the held
 * commits move to a branch `ai/<task>`, the tracked branch goes back to the remote, and
 * the task says in its own file that it waits and where its work is. Moving branches by
 * hand is the step an agent gets wrong, so each step is a subcommand here, with a suite.
 *
 * ── hold ─────────────────────────────────────────────────────────────────────────────
 * Run in the checkout of the tracked branch, with the held task's commits on top:
 * - which task each unpushed commit belongs to is read from its `Task:` line, with the same
 *   function the commit-msg hook uses (`checkCommitMessage`, check-commit-task.mjs). Nothing
 *   is guessed from subjects, files or `touches:`. A commit without a valid line, or a
 *   merge, refuses the hold: nobody can say whose it is;
 * - the held task's commits must be the top of the history, one run. Commits of another
 *   task, or of none, underneath leave first, since history cannot be split without
 *   rewriting it: the hold refuses and lists them. Whether and how they are pushed is the
 *   session's call (ship), not this script's;
 * - `ai/<task>` is created at HEAD, and never over a branch that already exists;
 * - the tracked branch goes back to its upstream with `git reset --keep`, which refuses
 *   rather than overwrite uncommitted work. Nothing here forces;
 * - the task file on the tracked branch gets `status: waiting on owner`, with the question
 *   and the branch in `waiting_on:`, the indexes are regenerated, and that is committed.
 *   The held work's own closing status stays on its branch.
 *
 * ── release ──────────────────────────────────────────────────────────────────────────
 * Readies the held branch for the pull-request mode of `ship` (step 6 onward):
 * - in a worktree of its own, created if the branch has none; the main checkout never
 *   changes branch;
 * - rebased onto the tracked branch's upstream. A conflict in the three indexes is solved
 *   by regenerating them, never by hand; a conflict in the task file whose only change on
 *   the tracked side is the hold takes the branch's version (also when both sides added the
 *   file: a task created in the held commits). Any other conflict stops the
 *   rebase and is reported: it is new content, and goes back to review;
 * - the hold is removed from the task file, so once the pull request merges the record no
 *   longer says the task waits.
 * Pushing the branch, CI and the merge stay with `ship` 6c–6h.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────────────
 *   hold-task.mjs hold <task-id | tasks/<file>.md> --reason "<what the owner must decide>"
 *                      [--root <path>] [--json]
 *   hold-task.mjs release <task-id | tasks/<file>.md> [--root <path>] [--json]
 *
 * Exit codes: 0 done; 1 refused, each reason with what to do about it — nothing was moved,
 * unless the refusal says what was (`moved` for hold, `oldTip` and `newTip` for release:
 * everything that can fail is checked before moving, and what fails after says so); 2 it
 * could not be checked, and nothing moved (no repository, no task file,
 * no upstream, a remote that did not answer). 2 is never a success.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { normalizePath } = await import(join(HERE, 'task-units.mjs'));
// The hook's own reader, from beside this script. Without it nobody can say whose a commit
// is, so its absence is "could not check" (2), never a crash that reads as a refusal.
const COMMIT_TASK = join(HERE, 'check-commit-task.mjs');
const commitTask = existsSync(COMMIT_TASK) ? await import(COMMIT_TASK) : null;
const { frontmatter } = await import(join(HERE, 'task-frontmatter.mjs'));

const INDEXES = ['TASKS.md', 'BACKLOG.md', 'TASKS_ARCHIVE.md'];
// Every call names its repository by cwd. A GIT_DIR or GIT_INDEX_FILE inherited from a hook
// (git exports them there, with absolute paths, inside a linked worktree) would override
// that and aim every write at whatever repository exported them, so they are dropped.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' };
for (const v of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX']) delete GIT_ENV[v];

class CannotCheck extends Error {}
class Refused extends Error {
  constructor(refusals, extra = {}) { super('refused'); this.refusals = refusals; this.extra = extra; }
}

function git(cwd, args, { allowFail = false, timeout = 0 } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: GIT_ENV, timeout });
  if (r.error && !allowFail) throw new CannotCheck(`git ${args.join(' ')} failed: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new CannotCheck(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r;
}
const out = (cwd, args) => git(cwd, args).stdout.trim();
const zlist = (s) => s.split('\0').filter(Boolean);
const isIndex = (p) => INDEXES.some((f) => f.toLowerCase() === normalizePath(p).toLowerCase());

function resolveTaskFile(arg, root) {
  if (arg.endsWith('.md')) return isAbsolute(arg) ? arg : join(root, arg);
  const dir = join(root, 'tasks');
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f === `${arg}.md` || f.startsWith(`${arg}-`));
  return hit ? join(dir, hit) : null;
}

/**
 * The task's ids: the full one (`T104-trabajo-…`) and the short one (`T104`) that a `Task:`
 * line names and the branch uses. The short one comes from `taskIdOf`, the hook's own rule,
 * so the id hold compares is the one the hook resolved.
 */
function taskIds(file) {
  if (!commitTask) throw new CannotCheck(`check-commit-task.mjs is not beside this script (${HERE}), so nobody can read which task a commit belongs to`);
  const text = readFileSync(file, 'utf8');
  const id = frontmatter(text)?.id || file.replace(/^.*\//, '').replace(/\.md$/, '');
  return { id, short: commitTask.taskIdOf(file), text };
}

/** Every worktree, with its path and branch; the first one is the main checkout. */
function worktrees(cwd) {
  return git(cwd, ['worktree', 'list', '--porcelain']).stdout.split('\n\n').filter(Boolean).map((block) => ({
    path: block.match(/^worktree (.*)$/m)?.[1],
    branch: block.match(/^branch refs\/heads\/(.*)$/m)?.[1] ?? null,
  }));
}

/** Paths modified, staged or untracked, with renames under both names. */
function dirtyPaths(cwd) {
  const entries = zlist(git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout);
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    paths.push(entries[i].slice(3));
    if (/^[RC]/.test(entries[i])) paths.push(entries[++i]);
  }
  return paths;
}

/** A rebase, merge or cherry-pick left half done: moving the branch now would lose it. */
function operationInProgress(cwd) {
  for (const p of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    const rel = out(cwd, ['rev-parse', '--git-path', p]);
    if (existsSync(isAbsolute(rel) ? rel : join(cwd, rel))) return p;
  }
  return null;
}

/** The branch checked out in `cwd`, its remote and its upstream ref, or why not. */
function trackedBranch(cwd) {
  const branch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).stdout.trim();
  if (!branch) throw new Refused([{ code: 'detached', detail: `${cwd} is not on a branch (detached HEAD)`, action: 'check out the tracked branch and run this again' }]);
  const remote = git(cwd, ['config', `branch.${branch}.remote`], { allowFail: true }).stdout.trim();
  const upstream = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{u}`], { allowFail: true }).stdout.trim();
  if (!remote || !upstream) throw new CannotCheck(`${branch} has no upstream, so nobody can say which commits are not pushed; set one with git branch --set-upstream-to`);
  return { branch, remote, upstream };
}

function fetch(cwd, remote) {
  const r = git(cwd, ['fetch', '--quiet', remote], { allowFail: true, timeout: 60000 });
  if (r.error || r.status !== 0) throw new CannotCheck(`remote ${remote} did not answer, so nobody can say what is already pushed: ${r.error ? r.error.message : (r.stderr || '').trim()}`);
}

/**
 * Sets `status:` and `waiting_on:` in a task file's frontmatter, and nothing else. A
 * `waiting_on:` already there is replaced, with any indented lines that continue it.
 * `waitingOn` null removes the field.
 */
export function setHoldFields(text, status, waitingOn) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new CannotCheck('the task file has no frontmatter');
  const lines = m[1].split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^waiting_on:/.test(lines[i])) {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  const at = kept.findIndex((l) => /^status:/.test(l));
  if (at === -1) throw new CannotCheck('the task file has no status: in its frontmatter');
  kept[at] = `status: ${status}`;
  if (waitingOn !== null) kept.splice(at + 1, 0, `waiting_on: ${waitingOn}`);
  return `---\n${kept.join('\n')}\n---${text.slice(m[0].length)}`;
}

/** Whether a task file says it is held on `branch`. */
export function holdOf(text, branch) {
  const fm = frontmatter(text);
  if (!fm) return null;
  const held = String(fm.status || '').toLowerCase().replace(/\s+/g, ' ').trim() === 'waiting on owner'
    && new RegExp(`(^|[^\\w/-])${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w/-])`).test(fm.waiting_on || '');
  return held ? { status: fm.status, waitingOn: fm.waiting_on } : null;
}

/** The frontmatter with `status:` and `waiting_on:` taken out: what a hold does not change. */
function withoutHoldFields(text) {
  if (text === null) return null;
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return text;
  const lines = m[1].split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^(status|waiting_on):/.test(lines[i])) {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  return `${kept.join('\n')}${text.slice(m[0].length)}`;
}

/**
 * In a rebase that stopped on the task file: the branch's version (`theirs`) may be taken
 * only when the tracked side (`ours`) really holds the task on this branch, and differs
 * from what it was built from in nothing but `status:` and `waiting_on:`. Anything else is
 * a change somebody made while the task waited, and taking the branch's side would drop it.
 *
 * What `ours` was built from: the common base, when the file existed before the hold. When
 * it did not (`baseSide` null: a task created in the held commits, so both sides added the
 * file), the hold wrote the version at the held branch's tip (`tipVersion`) — so that is
 * what `ours` must equal, the hold aside.
 */
export function canTakeBranchVersion(baseSide, ours, theirs, branch, tipVersion = null) {
  if (theirs === null || ours === null || !holdOf(ours, branch)) return false;
  const builtFrom = baseSide ?? tipVersion;
  if (builtFrom === null) return false;
  return withoutHoldFields(ours) === withoutHoldFields(builtFrom);
}

/** Regenerates the three indexes with the generator installed beside this script. */
function regenerate(cwd) {
  const gen = join(HERE, 'generate-task-index.mjs');
  // With no generator, a project with no indexes has nothing to regenerate. One with indexes
  // would get them committed stale, or with conflict markers inside: refused, never a pass.
  if (!existsSync(gen)) {
    const present = INDEXES.filter((f) => existsSync(join(cwd, f)));
    return present.length
      ? { ran: false, ok: false, output: `generate-task-index.mjs is not beside this script, and ${present.join(', ')} would be left unregenerated` }
      : { ran: false, ok: true, output: 'no indexes in this project' };
  }
  const r = spawnSync(process.execPath, [gen, cwd], { cwd, encoding: 'utf8', env: GIT_ENV });
  return { ran: true, ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/** Whether the indexes on disk in `cwd` are what the generator would write. */
function indexesInSync(cwd) {
  const gen = join(HERE, 'generate-task-index.mjs');
  if (!existsSync(gen) || !INDEXES.some((f) => existsSync(join(cwd, f)))) return { ok: true, output: '' };
  const r = spawnSync(process.execPath, [gen, cwd, '--check'], { cwd, encoding: 'utf8', env: GIT_ENV });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function showFile(cwd, spec) {
  const r = git(cwd, ['show', spec], { allowFail: true });
  return r.status === 0 ? r.stdout : null;
}

// ── hold ─────────────────────────────────────────────────────────────────────────────

export async function hold({ root, task, reason }) {
  if (!reason || !reason.trim()) throw new Refused([{ code: 'no-reason', detail: 'no --reason given', action: 'pass --reason with the question the owner must answer; it goes into waiting_on:' }]);
  if (/[\r\n]/.test(reason)) throw new Refused([{ code: 'no-reason', detail: '--reason spans several lines', action: 'write the question on one line' }]);
  const top = root;
  const op = operationInProgress(top);
  if (op) throw new Refused([{ code: 'operation-in-progress', detail: `${op} is present: a rebase, merge or cherry-pick is half done`, action: 'finish or abort it first' }]);
  const { branch, remote, upstream } = trackedBranch(top);
  const file = resolveTaskFile(task, top);
  if (!file || !existsSync(file)) throw new CannotCheck(`no task file for ${task}`);
  const ids = taskIds(file);
  const taskRel = relative(top, realpathSync(file));

  fetch(top, remote);
  const head = out(top, ['rev-parse', 'HEAD']);
  const base = out(top, ['rev-parse', `${upstream}^{commit}`]);
  if (git(top, ['merge-base', '--is-ancestor', base, head], { allowFail: true }).status !== 0) {
    throw new Refused([{ code: 'diverged', detail: `${upstream} has commits that ${branch} does not`, action: `bring them in first (git pull --rebase), review what moved, then hold again` }]);
  }
  const shas = out(top, ['rev-list', '--reverse', `${base}..${head}`]).split('\n').filter(Boolean);
  if (!shas.length) throw new Refused([{ code: 'nothing-to-hold', detail: `${branch} has no commit that ${upstream} does not`, action: 'there is nothing unpushed to set aside' }]);

  const merges = new Set(out(top, ['rev-list', '--merges', `${base}..${head}`]).split('\n').filter(Boolean));
  const commits = [];
  for (const sha of shas) {
    const c = {
      sha,
      subject: out(top, ['log', '-1', '--format=%s', sha]),
      files: zlist(git(top, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', '-z', '--root', sha]).stdout),
      task: null, kind: null, reason: null,
    };
    if (merges.has(sha)) { c.kind = 'merge'; c.reason = 'a merge commit belongs to no single task'; }
    else {
      let v;
      try { v = await commitTask.checkCommitMessage(git(top, ['log', '-1', '--format=%B', sha]).stdout, { root: top }); }
      catch (e) { if (e instanceof commitTask.CannotCheck) throw new CannotCheck(`the Task: line of ${sha.slice(0, 7)} could not be read: ${e.message}`); throw e; }
      if (v.code === 0) c.task = v.id; else { c.kind = v.kind; c.reason = v.reason; }
    }
    c.held = c.task !== null && c.task.toLowerCase() === ids.short.toLowerCase();
    commits.push(c);
  }

  const refusals = [];
  const refuse = (code, detail, action) => refusals.push({ code, detail, action });
  const name = (c) => `${c.sha.slice(0, 7)} ${c.subject}`;
  const whoseOf = (c) => `${name(c)} [Task: ${c.task}${c.files.some((f) => normalizePath(f) === normalizePath(taskRel)) ? `, changes ${taskRel}` : ''}]`;
  const whose = whoseOf;

  // R-20, R-21: no Task: line, or one the hook would refuse, or a merge: nobody can say whose.
  const unreadable = commits.filter((c) => c.kind);
  if (unreadable.length) {
    refuse('no-task-line', `commit(s) whose Task: line nobody can read:\n${unreadable.map((c) => `      ${name(c)} [${c.kind}]: ${c.reason}`).join('\n')}`, `fix each message as its line above says (git rebase -i, reword, before anything is pushed), then hold again; a merge cannot be held: undo it, or decide by hand what leaves and what waits`);
  } else {
    // D-6, R-31: the held task's commits must be the top of the history, and alone.
    if (!commits.some((c) => c.held)) {
      throw new Refused([{ code: 'nothing-to-hold', detail: `none of the ${commits.length} unpushed commit(s) is ${ids.short}'s: ${commits.map(whoseOf).join('; ')}`, action: `there is nothing of ${ids.short} to set aside; what is unpushed belongs to other work` }]);
    }
    let firstHeld = commits.length;
    while (firstHeld > 0 && commits[firstHeld - 1].held) firstHeld--;
    const below = commits.slice(0, firstHeld);
    if (firstHeld === commits.length) {
      const top1 = commits[commits.length - 1];
      refuse('not-on-top', `the newest unpushed commit is not ${ids.short}'s: ${whose(top1)}`, top1.task === 'none'
        ? `the normal order is to hold before the session-close commit, not after it (R-19). To undo the order now: git reset --soft ${top1.sha.slice(0, 12)}~1 (undoes only that commit; its changes stay), git stash push --include-untracked (puts them aside), hold-task.mjs hold ${ids.short} --reason "…", git stash pop (if it conflicts, resolve it by hand: it is the session close meeting the hold), and commit the session close again`
        : `nothing can leave without taking ${ids.short} along. The ways out: push nothing until the owner clears ${ids.short}; or reorder the unpushed commits with git rebase -i so ${ids.short}'s are on top and in one run (a conflict there sends the units it touched back to code-review), then hold again; or take it to the owner`);
    } else if (below.some((c) => c.held)) {
      refuse('interleaved', `commits of ${ids.short} and of other work alternate: ${below.map(whose).join('; ')}`, `history cannot be split without rewriting it. The ways out: reorder the unpushed commits with git rebase -i so ${ids.short}'s are on top (a conflict there sends the units it touched back to code-review), then hold again; or push nothing until the owner clears ${ids.short}, and then push it all`);
    } else if (below.length) {
      refuse('other-task-below', `${below.length} commit(s) of other work sit below ${ids.short}'s: ${below.map(whose).join('; ')}`, `they leave before the hold: once reviewed, the session pushes them (ship) and holds ${ids.short} again`);
    }
  }

  // D-3: never over an existing branch, local or on the remote.
  const target = `ai/${ids.short}`;
  for (const name of new Set([target, `ai/${ids.id}`])) {
    if (git(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { allowFail: true }).status === 0) refuse('branch-exists', `branch ${name} already exists`, `nothing was overwritten; release or delete ${name} first (hold-task.mjs release ${ids.short}), then hold again`);
    if (git(top, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${name}`], { allowFail: true }).status === 0) refuse('branch-exists', `branch ${name} already exists on ${remote}`, 'nothing was overwritten; decide what that branch is before holding again');
  }

  // D-2: reset --keep would refuse over these; say it before anything moves. The task file
  // and the indexes are written by the hold itself, so they must be clean too.
  const moving = zlist(git(top, ['diff', '--name-only', '--no-renames', '-z', base, head]).stdout);
  const dirty = dirtyPaths(top);
  // Any task file not committed, of any task, too: the hold commit regenerates the indexes,
  // and a pre-commit that checks them against the working tree would refuse it (after the
  // branches moved), while indexes built without that file would leave CI red.
  const blocking = dirty.filter((p) => moving.includes(p) || isIndex(p) || normalizePath(p).startsWith('tasks/'));
  if (blocking.length) refuse('uncommitted', `uncommitted changes in files the hold moves or writes, or task files not committed: ${blocking.join(', ')}`, `what is work of ${ids.short}: commit it with Task: ${ids.short}, and hold again. Anything else (another task's file, a draft): git stash push --include-untracked, hold again, then git stash pop. The hold never forces over uncommitted work`);

  if (refusals.length) throw new Refused(refusals, { commits: commits.map(({ sha, subject, task, kind }) => ({ sha, subject, task, kind })) });

  // Everything that can be known before moving is checked before moving: the hold written
  // into the task file reads back, and the indexes can be regenerated.
  const current = showFile(top, `${base}:${taskRel}`) ?? showFile(top, `${head}:${taskRel}`);
  if (current === null) throw new CannotCheck(`${taskRel} is neither on ${upstream} nor at HEAD`);
  const waitingOn = `${reason.trim().replace(/\s+#/g, ' ')} — held on branch ${target} at ${head.slice(0, 7)}; release with hold-task.mjs release ${ids.short}`;
  const written = setHoldFields(current, 'waiting on owner', waitingOn);
  if (!holdOf(written, target)) throw new CannotCheck(`the hold written into ${taskRel} would not read back as held on ${target}`);
  if (!existsSync(join(HERE, 'generate-task-index.mjs')) && INDEXES.some((f) => existsSync(join(top, f)))) {
    throw new Refused([{ code: 'index', detail: `generate-task-index.mjs is not beside this script, and the hold has to regenerate ${INDEXES.filter((f) => existsSync(join(top, f))).join(', ')}`, action: 'install it (it is part of the kit), then hold again; nothing moved' }]);
  }

  // Act. From here, every failure says what already moved.
  git(top, ['branch', target, head]);
  const reset = git(top, ['reset', '--quiet', '--keep', base], { allowFail: true });
  if (reset.status !== 0) {
    git(top, ['branch', '-d', target], { allowFail: true });
    throw new Refused([{ code: 'reset-refused', detail: `git reset --keep refused: ${(reset.stderr || '').trim()}`, action: `nothing moved (${target} was removed again); commit or stash the files it names, then hold again` }]);
  }

  // The task file on the tracked branch: the remote's version if it has one, else the
  // branch's (a task scoped and built without a push), with the hold written in.
  const moved = { branch: target, heldAt: head, trackedWas: head, trackedNow: base };
  const movedText = `${target} was created at ${head.slice(0, 7)} with the work, and ${branch} moved from ${head.slice(0, 7)} back to ${base.slice(0, 7)} (${upstream})`;
  try {
    mkdirSync(dirname(join(top, taskRel)), { recursive: true });
    writeFileSync(join(top, taskRel), written);
    git(top, ['add', '--', taskRel]);
    const regen = regenerate(top);
    if (!regen.ok) throw new Refused([{ code: 'index', detail: `the indexes could not be regenerated:\n${regen.output}`, action: 'fix the task files, regenerate the indexes and commit the hold by hand' }]);
    const toAdd = [taskRel, ...INDEXES.filter((f) => existsSync(join(top, f)))];
    git(top, ['add', '--', ...toAdd]);
    const commit = git(top, ['commit', '--quiet', '-m', `chore: hold ${ids.short} on ${target}\n\nTask: ${ids.short}`, '--', ...toAdd], { allowFail: true });
    if (commit.status !== 0) throw new Refused([{ code: 'commit', detail: `the hold commit failed:\n${`${commit.stdout}${commit.stderr}`.trim()}`, action: 'the hold is written and staged: fix what the hook says and commit it' }]);
  } catch (e) {
    // Never "could not check" here: something already moved, and the reader must know what.
    const refusals = e instanceof Refused ? e.refusals : [{ code: 'after-move', detail: e.message, action: 'finish the hold by hand: write it into the task file, regenerate the indexes and commit' }];
    throw new Refused(refusals.map((x) => ({ ...x, action: `${movedText}; ${x.action}` })), { moved });
  }

  return {
    command: 'hold', task: ids.id, branch, upstream, held: target, heldAt: head, heldCommits: commits.map(({ sha, subject }) => ({ sha, subject })),
    holdCommit: out(top, ['rev-parse', 'HEAD']), waitingOn, verdict: 'held',
  };
}

// ── release ──────────────────────────────────────────────────────────────────────────

export function release({ root, task }) {
  const mainRoot = worktrees(root)[0].path;
  const file = resolveTaskFile(task, mainRoot);
  if (!file || !existsSync(file)) throw new CannotCheck(`no task file for ${task}`);
  const ids = taskIds(file);
  const taskRel = relative(mainRoot, realpathSync(file));
  const target = `ai/${ids.short}`;
  const { branch, remote, upstream } = trackedBranch(mainRoot);

  const refusals = [];
  const refuse = (code, detail, action) => refusals.push({ code, detail, action });
  const tip = git(mainRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${target}^{commit}`], { allowFail: true }).stdout.trim();
  if (!tip) throw new Refused([{ code: 'no-branch', detail: `branch ${target} does not exist`, action: `nothing to release; if the work is on ${remote}, fetch ${target} first` }]);

  fetch(mainRoot, remote);
  const base = out(mainRoot, ['rev-parse', `${upstream}^{commit}`]);
  const local = out(mainRoot, ['rev-parse', branch]);
  if (git(mainRoot, ['merge-base', '--is-ancestor', local, base], { allowFail: true }).status !== 0) {
    refuse('unpushed', `${branch} has commits ${upstream} does not`, `push ${branch} first (ship): the pull request is rebased onto ${upstream}, and the hold commit has to be there`);
  }
  const onRemote = showFile(mainRoot, `${base}:${taskRel}`);
  const heldLocally = holdOf(readFileSync(file, 'utf8'), target);
  if ((!onRemote || !holdOf(onRemote, target)) && !(refusals.length && heldLocally)) {
    refuse('not-held', `${taskRel} on ${upstream} does not say the task is held on ${target}`, `hold it with hold-task.mjs hold ${ids.short}, and push that, before releasing`);
  }

  // R-13: the branch gets a worktree of its own; the main checkout is never switched.
  const all = worktrees(mainRoot);
  let wt = all.find((w) => w.branch === target)?.path ?? null;
  if (wt && realpathSync(wt) === realpathSync(mainRoot)) refuse('in-main-checkout', `${target} is checked out in the main checkout`, `check ${branch} out there again; the release makes a worktree for ${target}`);
  else if (wt) {
    if (operationInProgress(wt)) refuse('operation-in-progress', `a rebase or merge is half done in ${wt}`, 'finish or abort it there, then release again');
    else if (dirtyPaths(wt).length) refuse('worktree-dirty', `the worktree at ${wt} has uncommitted work: ${dirtyPaths(wt).join(', ')}`, 'commit or discard it there first; nothing is forced');
  }
  const newWt = join(mainRoot, '.claude', 'worktrees', ids.short);
  if (!wt && existsSync(newWt)) refuse('worktree-path', `${newWt} already exists and is not ${target}'s worktree`, 'move it away, then release again');
  // A worktree inside the checkout that git does not ignore shows up there as untracked, and
  // the next `git add -A` commits a dangling reference to it.
  if (!wt && git(mainRoot, ['check-ignore', '--quiet', '--no-index', `.claude/worktrees/${ids.short}/x`], { allowFail: true }).status !== 0) {
    refuse('worktree-not-ignored', `.claude/worktrees/ is not ignored in ${mainRoot}`, 'add the line .claude/worktrees/ to .gitignore, commit it, and release again');
  }
  if (refusals.length) throw new Refused(refusals);

  const created = !wt;
  if (created) {
    git(mainRoot, ['worktree', 'add', '--quiet', newWt, target]);
    wt = newWt;
  }

  // Rebase, solving only what has a mechanical answer.
  const resolved = [];
  let r = git(wt, ['rebase', '--quiet', base], { allowFail: true });
  for (let guard = 0; r.status !== 0; guard++) {
    const conflicted = zlist(git(wt, ['diff', '--name-only', '--diff-filter=U', '-z']).stdout);
    const abort = (code, detail, action) => { git(wt, ['rebase', '--abort'], { allowFail: true }); throw new Refused([{ code, detail, action }], { worktree: wt }); };
    if (guard > 200 || !conflicted.length || !operationInProgress(wt)) abort('rebase', `the rebase stopped: ${`${r.stdout}${r.stderr}`.trim()}`, `the rebase was aborted and ${target} is untouched; rebase it by hand onto ${upstream} in ${wt}, then run release again`);
    const other = conflicted.filter((f) => !isIndex(f) && normalizePath(f) !== normalizePath(taskRel));
    if (other.length) abort('conflict', `the rebase onto ${upstream} conflicts in ${other.join(', ')}`, `the rebase was aborted and ${target} is untouched; rebase it by hand onto ${upstream} in ${wt} (the units whose content changed go back to code-review, ship 6b), then run release again`);
    const step = out(wt, ['rev-parse', '--short', 'REBASE_HEAD']);
    if (conflicted.some((f) => normalizePath(f) === normalizePath(taskRel))) {
      // Take the branch's version only when the tracked side changed nothing but the hold.
      const baseSide = showFile(wt, `:1:${taskRel}`);
      const ours = showFile(wt, `:2:${taskRel}`);
      const theirs = showFile(wt, `:3:${taskRel}`);
      if (!canTakeBranchVersion(baseSide, ours, theirs, target, showFile(wt, `${tip}:${taskRel}`))) {
        abort('conflict', `${taskRel} changed on ${upstream} in more than the hold on ${target}, and on ${target} too`, `the rebase was aborted and ${target} is untouched; rebase it by hand onto ${upstream} in ${wt}, keeping both changes to ${taskRel}, then run release again`);
      }
      writeFileSync(join(wt, taskRel), theirs);
      git(wt, ['add', '--', taskRel]);
      resolved.push({ commit: step, file: taskRel, how: `the branch's version (the tracked side only added the hold)` });
    }
    const regen = regenerate(wt);
    if (!regen.ok) abort('index', `the indexes could not be regenerated while rebasing ${step}:\n${regen.output}`, `the rebase was aborted and ${target} is untouched; fix the task files, rebase by hand onto ${upstream} in ${wt}, then run release again`);
    const idx = INDEXES.filter((f) => existsSync(join(wt, f)));
    git(wt, ['add', '--', ...idx]);
    for (const f of conflicted.filter(isIndex)) resolved.push({ commit: step, file: f, how: 'regenerated from tasks/' });
    r = git(wt, ['rebase', '--continue'], { allowFail: true });
  }

  // From here the branch is rewritten: every refusal names the tip it had before.
  const rewritten = () => `${target} is rebased in ${wt} and now ends at ${out(wt, ['rev-parse', '--short', 'HEAD'])}; its tip before the release was ${tip.slice(0, 12)} (git -C ${wt} reset --keep ${tip.slice(0, 12)} puts it back)`;

  // D-7: the hold leaves the record. A branch whose own commits never set a status keeps
  // the hold after a clean rebase; its status goes back to the one it had on the branch.
  let releaseCommit = null;
  const now = readFileSync(join(wt, taskRel), 'utf8');
  if (holdOf(now, target)) {
    const tipText = showFile(wt, `${tip}:${taskRel}`);
    const before = tipText && !holdOf(tipText, target) ? frontmatter(tipText) ?? {} : {};
    const status = before.status || 'in progress';
    writeFileSync(join(wt, taskRel), setHoldFields(now, status, before.status && before.waiting_on ? before.waiting_on : null));
    const regen = regenerate(wt);
    if (!regen.ok) throw new Refused([{ code: 'index', detail: `the indexes could not be regenerated:\n${regen.output}`, action: `${rewritten()}; fix it there and commit the release by hand` }], { worktree: wt, oldTip: tip, newTip: out(wt, ['rev-parse', 'HEAD']) });
    const toAdd = [taskRel, ...INDEXES.filter((f) => existsSync(join(wt, f)))];
    git(wt, ['add', '--', ...toAdd]);
    const c = git(wt, ['commit', '--quiet', '-m', `chore: release ${ids.short} from ${target}\n\nTask: ${ids.short}`, '--', ...toAdd], { allowFail: true });
    if (c.status !== 0) throw new Refused([{ code: 'commit', detail: `the release commit failed:\n${`${c.stdout}${c.stderr}`.trim()}`, action: `${rewritten()}; fix what the hook says and commit the release there` }], { worktree: wt, oldTip: tip, newTip: out(wt, ['rev-parse', 'HEAD']) });
    releaseCommit = out(wt, ['rev-parse', 'HEAD']);
  }

  const newTip = out(wt, ['rev-parse', 'HEAD']);
  // A step that git merged cleanly can still leave an index that tasks/ does not produce.
  const sync = indexesInSync(wt);
  if (!sync.ok) throw new Refused([{ code: 'index', detail: `after the rebase the indexes do not match tasks/:\n${sync.output}`, action: `${rewritten()}; regenerate them there, commit (Task: ${ids.short}), and run release again` }], { worktree: wt, oldTip: tip, newTip });
  const commits = out(wt, ['log', '--reverse', '--format=%h %s', `${base}..${newTip}`]).split('\n').filter(Boolean);
  return { command: 'release', task: ids.id, branch: target, onto: upstream, worktree: wt, worktreeCreated: created, oldTip: tip, newTip, commits, resolved, releaseCommit, remote, verdict: 'released' };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────

const USAGE = 'usage: hold-task.mjs hold <task> --reason "<question>" [--root <path>] [--json]\n       hold-task.mjs release <task> [--root <path>] [--json]';

async function main(argv) {
  // The same reason as GIT_ENV, for the git calls check-commit-task.mjs makes on its own.
  for (const v of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX']) delete process.env[v];
  const [cmd, ...rest] = argv;
  const json = rest.includes('--json');
  const opts = { root: process.cwd(), reason: null };
  const pos = [];
  const emit = (obj, text, code) => { if (json) console.log(JSON.stringify(obj, null, 2)); else text(); return code; };
  try {
    if (cmd !== 'hold' && cmd !== 'release') throw new CannotCheck(cmd ? `unknown command ${cmd}\n${USAGE}` : USAGE);
    const needs = (a, v) => { if (v === undefined || v.startsWith('--')) throw new CannotCheck(`${a} needs a value`); return v; };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--root') opts.root = resolve(needs(a, rest[++i]));
      else if (a === '--reason' && cmd === 'hold') opts.reason = needs(a, rest[++i]);
      else if (a === '--json') continue;
      else if (a.startsWith('--')) throw new CannotCheck(`unknown option ${a}`);
      else pos.push(a);
    }
    if (pos.length !== 1) throw new CannotCheck(USAGE);
    const top = git(opts.root, ['rev-parse', '--show-toplevel'], { allowFail: true }).stdout.trim();
    if (!top) throw new CannotCheck(`${opts.root} is not inside a git repository`);
    const args = { root: realpathSync(top), task: pos[0], reason: opts.reason };
    const r = cmd === 'hold' ? await hold(args) : release(args);
    return emit(r, () => (cmd === 'hold' ? printHold(r) : printRelease(r)), 0);
  } catch (e) {
    if (e instanceof Refused) {
      return emit({ verdict: 'refused', refusals: e.refusals, ...e.extra }, () => {
        for (const x of e.refusals) console.log(`\n  ✗ ${x.code}: ${x.detail}\n      → ${x.action}`);
        console.log(`\n✗ Not ${cmd === 'release' ? 'released' : 'held'}: ${e.refusals.length} reason(s) above.`);
      }, 1);
    }
    if (!(e instanceof CannotCheck)) throw e;
    return emit({ verdict: 'cannot-check', reason: e.message }, () => console.error(`✗ Could not check: ${e.message}`), 2);
  }
}

function printHold(r) {
  console.log(`\n  ${r.task} set aside on ${r.held} (${r.heldAt.slice(0, 7)}), ${r.heldCommits.length} commit(s):`);
  for (const c of r.heldCommits) console.log(`    · ${c.sha.slice(0, 7)} ${c.subject}`);
  console.log(`  ${r.branch} is back at ${r.upstream}, plus the hold commit ${r.holdCommit.slice(0, 7)}.`);
  console.log(`  waiting_on: ${r.waitingOn}\n`);
  console.log(`✓ Held. The next push of ${r.branch} carries the hold and nothing of ${r.held}; release it with hold-task.mjs release ${r.task.match(/^[A-Za-z]+\d+/)?.[0] ?? r.task}.`);
}

function printRelease(r) {
  console.log(`\n  ${r.branch} rebased onto ${r.onto} in ${r.worktree}${r.worktreeCreated ? ' (worktree created)' : ''}: ${r.oldTip.slice(0, 7)} → ${r.newTip.slice(0, 7)}`);
  for (const c of r.commits) console.log(`    · ${c}`);
  for (const x of r.resolved) console.log(`  Solved at ${x.commit}: ${x.file} — ${x.how}`);
  if (r.releaseCommit) console.log(`  The hold is removed from the task file in ${r.releaseCommit.slice(0, 7)}.`);
  console.log(`\n✓ Ready for the pull request. From ${r.worktree}: git push -u ${r.remote} ${r.branch}, then ship 6c–6h (open the pull request, CI green, merge, verify, delete the branch and the worktree).`);
}

// Compared as real paths: run through a symlink (macOS's /var is one), the two spellings
// differ, and a plain comparison would skip main() and exit 0 — a pass nobody checked.
function isMain() {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  process.exit(await main(process.argv.slice(2)));
}
