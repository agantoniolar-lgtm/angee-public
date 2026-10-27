#!/usr/bin/env node
/**
 * check-commit-task.mjs — every commit says which task it belongs to.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * To hold a task back (keep its commits off a push) something has to know which unpushed
 * commit belongs to which task. Guessing it from the subject or from the files a commit
 * touched fails both ways: a commit of task A that edits a file of task B, a session close
 * that touches five tasks. So each commit says it, once, in a line git itself can read:
 *
 *     Task: T104
 *
 * at the end of the message, in its final block of trailers (next to `Co-Authored-By:`), or
 *
 *     Task: none
 *
 * for a commit that belongs to no task (a session close, the deploy ledger). This script is
 * the `commit-msg` hook that refuses a message without it, and the reader `hold` uses to get
 * the task of a commit: both call `checkCommitMessage`, so they can never read two different
 * ids out of the same message.
 *
 * ── What it checks ───────────────────────────────────────────────────────────────────
 * - The line is a trailer, read by `git interpret-trailers --parse`: in the last paragraph,
 *   in a block git recognizes as trailers. A `Task:` in the middle of the body, in a
 *   paragraph of prose, or in the title of a one-paragraph message is not one, and the
 *   message is refused as if it had none (saying where the stray line is). The key is
 *   matched as git matches it, without regard to case: `task: T104` counts.
 * - The message is read as git will store it: comment lines (`core.commentString`,
 *   `core.commentChar`, default `#`) are dropped and everything after the `>8` scissors line
 *   of `git commit -v` is cut. A commented `# Task: T104` does not count.
 * - Exactly one task: two `Task:` lines naming the same task are one (an autosquash joins
 *   two messages that both carry it); two naming different tasks are refused.
 * - The value is a task id, not a file name: `T104`, never `T104-some-slug` — a slug changes
 *   when a task is renamed and the id does not. It is resolved against the files in
 *   `tasks/` of the commit being made: the index git is committing (`GIT_INDEX_FILE`, so
 *   `git commit -- <paths>` is read right, and a task file created in this very commit
 *   counts) and, when the id is not there, `HEAD` (a commit that deletes its task's file).
 *   The id of a file is the start of its name — letters, an optional separator, digits
 *   (`T104`, `TT-12`, `B011`, `T1000`) — or the whole name when it has no such start. The
 *   comparison is exact except for case, so `T10` is not `T104`, and `t104` reads the same
 *   on a case-insensitive disk as on a case-sensitive one. Two files with the named id are
 *   refused rather than picked from. `none` is written in lowercase.
 * - A unit's commit says which unit it builds in a second trailer, next to `Task:`:
 *       Unit: U4
 *   One unit per commit (two lines naming the same unit are one; a fix to two units is two
 *   commits), written exactly `U<digits>` with no leading zero, of a unit that exists in that
 *   task's `## Done when` (read with `parseUnits` from task-units.mjs) and is not struck out
 *   as replaced; a unit already checked off is fine, since a fix to it is its commit too. A
 *   `Unit:` on a `Task: none` commit is refused: a unit belongs to a task. A commit without
 *   `Unit:` is fine: a task's closing commit, or its scope, is not a unit. A `(U<n>)` in the
 *   subject is no longer read by anything. A `Unit:` line outside the trailers is refused as
 *   misplaced only at the left margin, with a unit for value, on a commit of a task:
 *   indented, as prose, or under `Task: none`, it is a quoted example.
 * - On a branch `ai/<task>…` (a unit's or a task's branch), a commit that names another
 *   existing task is refused (hook only: `branch` is passed by main()).
 *
 * A merge in progress (MERGE_HEAD exists) whose message has no `Task:` line is let through by
 * the hook with a warning, because git merge and a diverging git pull write that message
 * themselves; checkCommitMessage does not make the exception, so hold refuses the stored
 * merge. git revert and git cherry-pick run no commit-msg hook at all (measured on git 2.50).
 *
 * What it does not see, stated: `git commit --no-verify`, a rebase and `git commit-tree`
 * run no hook. The line survives a rebase untouched, and `hold` refuses an unpushed commit
 * without it, which is where a skipped hook gets caught. A squash merge on the remote can
 * drop the line from the tracked branch; `hold` only reads unpushed commits, so it is not
 * affected.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────────────
 *   check-commit-task.mjs <file with the commit message> [--root <path>] [--json]
 *   (as a commit-msg hook: `node scripts/check-commit-task.mjs "$1"`)
 *
 * Exit codes:
 *   0  the message names one task that exists (or none), and its Unit: line is right
 *   1  refused, with what to write instead
 *   2  could not check (no git, no tasks/, unreadable file): a hook warns and lets the
 *      commit through; it never reports a pass it did not verify
 *
 * As a module:
 *   checkCommitMessage(message, { root, branch }) → { code, kind, id, unit, reason }
 *     kind, on a refusal (code 1), is stable for a caller to branch on: missing,
 *     not-in-trailers, empty, two-tasks, not-one-id, none-uppercase, none-with-unit,
 *     file-name, unknown-task, duplicate-id, other-task-branch, unit-not-in-trailers,
 *     two-units, bad-unit, no-units, unknown-unit, replaced-unit. It throws CannotCheck
 *     (exported) when it cannot check; anything else thrown is a bug, not a verdict.
 *   trailers(message, { cwd }) → { task, unit, stray, text }   the raw values, as git reads them
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Thrown when the message cannot be checked (no git, no tasks/, no task-units.mjs): exit 2, never a verdict. */
export class CannotCheck extends Error {}

function gitEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  // A hook gets GIT_INDEX_FILE relative to where git started it; spawned from another folder
  // a relative one would point nowhere.
  if (env.GIT_INDEX_FILE && !isAbsolute(env.GIT_INDEX_FILE)) env.GIT_INDEX_FILE = resolve(env.GIT_INDEX_FILE);
  return env;
}

function git(cwd, args, { input, allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: gitEnv() });
  if (r.error) throw new CannotCheck(`git ${args[0]} could not run: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new CannotCheck(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r;
}

/** The string that starts a comment line in a commit message, as git will apply it. */
function commentString(cwd, message) {
  const get = (key) => git(cwd, ['config', '--get', key], { allowFail: true }).stdout.trim();
  const value = get('core.commentString') || get('core.commentChar') || '#';
  if (value !== 'auto') return value;
  // `auto` picks a character the message does not use; git wrote its template with it.
  const template = message.match(/^(\S+) Please enter the commit message/m);
  return template ? template[1] : '#';
}

/**
 * The message as git will store it: CRLF and trailing blanks gone, everything after the
 * scissors line cut, comment lines dropped. Read the same way for a hook's file (which still
 * has git's comments) and for a stored message (which has none left).
 */
export function cleanMessage(message, comment = '#') {
  const out = [];
  for (const raw of message.split('\n')) {
    const line = raw.replace(/\r$/, '').replace(/\s+$/, '');
    if (line === `${comment} ------------------------ >8 ------------------------`) break;
    if (line.startsWith(comment)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
}

/**
 * The `Task:` and `Unit:` values of a message, read by git's own trailer parser, and for each
 * key whether a line sits somewhere git does not read as a trailer (`stray`), to say so.
 */
export function trailers(message, { cwd = process.cwd(), comment } = {}) {
  const text = cleanMessage(message, comment ?? commentString(cwd, message));
  const parsed = git(cwd, ['interpret-trailers', '--parse', '--no-divider'], { input: text }).stdout;
  const out = { task: [], unit: [], stray: {}, text };
  for (const line of parsed.split('\n')) {
    const m = line.match(/^([^:]+?)\s*:\s?(.*)$/);
    const key = m?.[1].trim().toLowerCase();
    if (key === 'task' || key === 'unit') out[key].push(m[2].trim());
  }
  // A Task: line is stray however it is indented; a Unit: line only at the margin and with a
  // unit for value: indented it is a quoted example, and "Unit: tests now …" is prose.
  out.stray.task = !out.task.length && text.split('\n').some((l) => /^\s*task\s*:/i.test(l));
  out.stray.unit = !out.unit.length && text.split('\n').some((l) => /^unit\s*:\s*u\d+\s*$/i.test(l));
  return out;
}

/** The id a task file answers to: the start of its name (T104, TT-12), or the whole name. */
export function taskIdOf(fileName) {
  const base = fileName.replace(/^.*\//, '').replace(/\.md$/, '');
  return base.match(/^([A-Za-z]+[-_.]?\d+)(?=$|[-_.])/)?.[1] ?? base;
}

/** Task files in `tasks/` of the index being committed, or of HEAD. */
function taskFiles(root, where) {
  const r = where === 'index'
    ? git(root, ['ls-files', '-z', '--', 'tasks/'])
    : git(root, ['ls-tree', '-z', '--name-only', 'HEAD', '--', 'tasks/'], { allowFail: true });
  if (r.status !== 0) return [];
  return r.stdout.split('\0').filter((p) => /^tasks\/[^/]+\.md$/.test(p));
}

function readBlob(root, where, path) {
  return git(root, ['show', `${where === 'index' ? '' : 'HEAD'}:${path}`]).stdout;
}

const refuse = (kind, reason) => ({ code: 1, kind, id: null, unit: null, reason });

async function loadParseUnits() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, 'task-units.mjs');
  if (!existsSync(path)) throw new CannotCheck(`task-units.mjs is not next to this script (${here}), so the Unit: line cannot be checked`);
  return (await import(path)).parseUnits;
}

/**
 * The verdict on one message, for the hook and for `hold` alike.
 * `root` is the top of the checkout whose tasks/ the id is resolved against.
 */
export async function checkCommitMessage(message, { root = process.cwd(), comment, branch = null } = {}) {
  const { task: values, unit: units, stray, text } = trailers(message, { cwd: root, comment });
  const add = 'Add a last paragraph with the line `Task: <id>` (the task this commit belongs to, as `T104`), or `Task: none` for a commit of no task, next to Co-Authored-By.';
  const where = 'not in the final block of trailers git reads (it is in the body, in a paragraph with prose, or in the title)';

  if (!values.length) {
    if (stray.task) return refuse('not-in-trailers', `there is a \`Task:\` line, but ${where}. ${add}`);
    return refuse('missing', `no \`Task:\` line. ${add}`);
  }
  const empty = values.find((v) => !v);
  if (empty !== undefined) return refuse('empty', 'the `Task:` line is empty. Write the task id, as `Task: T104`, or `Task: none`.');
  const distinct = [...new Set(values.map((v) => v.toLowerCase()))];
  if (distinct.length > 1) return refuse('two-tasks', `${values.length} \`Task:\` lines naming different tasks (${values.join(', ')}). A commit belongs to one task: keep one line, or split the commit.`);
  const value = values[0];
  if (/\s/.test(value)) return refuse('not-one-id', `\`Task: ${value}\` is not one id. Write only the id, as \`Task: T104\`.`);

  // A-5, A-6, A-8, R-10: the Unit: line, read like Task:.
  // A stray Unit: on a Task: none commit is a quotation (a session close citing a message): no unit to name.
  if (stray.unit && value.toLowerCase() !== 'none') return refuse('unit-not-in-trailers', `there is a \`Unit:\` line, but ${where}. Put \`Unit: U<n>\` next to \`Task:\` in the last paragraph.`);
  const unitIds = [...new Set(units)];
  if (unitIds.length > 1) return refuse('two-units', `${unitIds.length} \`Unit:\` lines (${unitIds.join(', ')}). A unit is one commit: split the commit, one per unit.`);
  const unit = unitIds[0] ?? null;
  if (unit !== null && !/^U[1-9]\d*$/.test(unit)) return refuse('bad-unit', `\`Unit: ${unit}\` is not a unit name: write it exactly as in \`## Done when\`, \`U\` and its number with no leading zero (\`Unit: U2\`).`);

  if (value.toLowerCase() === 'none') {
    if (value !== 'none') return refuse('none-uppercase', `write \`Task: none\` in lowercase, not \`Task: ${value}\`.`);
    if (unit) return refuse('none-with-unit', `the message says \`Unit: ${unit}\` but the line is \`Task: none\`. A unit belongs to a task: name it, as \`Task: T104\`, or drop the \`Unit:\` line.`);
    return { code: 0, kind: null, id: 'none', unit: null, reason: null };
  }

  let at = 'index';
  let files = taskFiles(root, 'index');
  const named = (id) => files.filter((f) => taskIdOf(f).toLowerCase() === id.toLowerCase());
  let hits = named(value);
  if (!hits.length) {
    const head = taskFiles(root, 'HEAD');
    const headHits = head.filter((f) => taskIdOf(f).toLowerCase() === value.toLowerCase());
    if (headHits.length) { at = 'HEAD'; hits = headHits; }
    files = [...new Set([...files, ...head])];
  }
  if (!files.length) throw new CannotCheck('no task file in tasks/, in the commit being made nor in HEAD, to resolve the id against');
  if (!hits.length) {
    const asFile = files.find((f) => f.replace(/^tasks\//, '').replace(/\.md$/, '').toLowerCase() === value.toLowerCase());
    if (asFile) return refuse('file-name', `\`Task: ${value}\` is a file name; write the task id, \`Task: ${taskIdOf(asFile)}\`. The id stays when a task is renamed, the file name does not.`);
    return refuse('unknown-task', `\`Task: ${value}\` names no task in tasks/ of this commit (nor of HEAD). Write the id of the task this commit belongs to; a pending or anything that is not a task file is not one. If it belongs to no task, write \`Task: none\`.`);
  }
  if (hits.length > 1) return refuse('duplicate-id', `${hits.length} files in tasks/ answer to ${value}: ${hits.join(', ')}. Rename one so each id has one file; nothing here picks between them.`);
  const file = hits[0];
  const id = taskIdOf(file);

  // R-17: on a branch of a task (ai/<task>, ai/<task>-U<n>), a commit of another task is refused.
  const own = branch?.match(/^ai\/(.+)$/)?.[1];
  const branchTask = own ? taskIdOf(own) : null;
  if (branchTask && branchTask.toLowerCase() !== id.toLowerCase() && named(branchTask).length) {
    return refuse('other-task-branch', `this checkout is on ${branch}, a branch of ${branchTask}, and the commit says \`Task: ${id}\`. Commit ${id}'s work on its own branch, or name ${branchTask}.`);
  }

  if (unit) {
    const parseUnits = await loadParseUnits();
    const parsed = parseUnits(readBlob(root, at, file));
    if (!parsed || !parsed.units.length) return refuse('no-units', `the message says \`Unit: ${unit}\`, but ${file} has no units readable in \`## Done when\`. Fix the task (task-units.mjs ${id}) or drop the line.`);
    const u = parsed.units.find((x) => x.id === unit);
    if (!u) {
      // ys1i: the units are read from the task file as this commit stages it, not from disk. A
      // unit just split (build step 1) is on disk and not staged: say that, not "no such unit".
      const where = at === 'index' ? `${file} as staged in the index for this commit` : `${file} of HEAD (it is not staged)`;
      let onDisk = false;
      try { onDisk = Boolean(parseUnits(readFileSync(join(root, file), 'utf8'))?.units.some((x) => x.id === unit)); } catch { /* no file on disk */ }
      const fix = onDisk ? `${file} on disk has ${unit}: stage it (git add ${file}) and commit again. A unit split while building is committed in the task file before it is built or dispatched.`
        : 'Name the unit this commit builds, or the task it belongs to; a unit split while building is committed in the task file first.';
      return refuse('unknown-unit', `\`Unit: ${unit}\` is not a unit of ${id} in ${where} (its units: ${parsed.units.map((x) => x.id).join(', ')}). ${fix}`);
    }
    if (u.replaced) return refuse('replaced-unit', `${unit} of ${id} is struck out as replaced; nothing builds it any more. Name the unit that replaced it.`);
  }
  return { code: 0, kind: null, id, file, unit, reason: null };
}

/** Whether this checkout is in the middle of a merge (MERGE_HEAD exists). */
function mergeInProgress(root) {
  const r = spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root, encoding: 'utf8', env: gitEnv() });
  return !r.error && r.status === 0;
}

async function main(argv) {
  let msgFile = null;
  let root = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') { root = argv[++i]; if (!root) { console.error('✗ --root needs a value'); return 2; } root = resolve(root); }
    else if (argv[i] === '--json') json = true;
    else if (argv[i].startsWith('--')) { console.error(`✗ unknown option ${argv[i]}`); return 2; }
    else msgFile = argv[i];
  }
  if (!msgFile) { console.error('✗ usage: check-commit-task.mjs <commit message file> [--root <path>] [--json]'); return 2; }
  let message;
  try { message = readFileSync(msgFile, 'utf8'); }
  catch (e) { console.error(`✗ Could not check the Task: line: cannot read ${msgFile} (${e.code ?? e.message})`); return 2; }
  if (!root) {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', env: gitEnv() });
    if (r.error || r.status !== 0) { console.error('✗ Could not check the Task: line: not inside a git checkout'); return 2; }
    root = r.stdout.trim();
  }
  let v;
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).stdout.trim() || null;
  try { v = await checkCommitMessage(message, { root, branch }); }
  catch (e) {
    if (!(e instanceof CannotCheck)) throw e;
    if (json) console.log(JSON.stringify({ code: 2, reason: e.message }));
    console.error(`✗ Could not check the Task: line: ${e.message}`);
    return 2;
  }
  // A merge in progress (git merge, or a git pull that diverged) writes its own message, with
  // no Task: line. As a hook only, it is let through with a warning: hold refuses an unpushed
  // merge anyway, and blocking it would leave the merge half done. A merge whose line is there
  // but wrong is still refused. checkCommitMessage itself never makes this exception, so a
  // stored merge commit read by hold is refused.
  if (v.code === 1 && (v.kind === 'missing' || v.kind === 'not-in-trailers') && mergeInProgress(root)) {
    console.error(`⚠ A merge commit with no Task: line: let through, unchecked. Add \`Task: <id>\` or \`Task: none\` to its message if you can (git commit --amend before pushing).`);
    if (json) console.log(JSON.stringify({ ...v, code: 0, kind: 'merge-without-line' }));
    return 0;
  }
  if (json) console.log(JSON.stringify(v));
  else if (v.code === 0) console.log(`✓ Task: ${v.id}${v.unit ? `, Unit: ${v.unit}` : ''}`);
  else console.error(`✗ Commit refused: ${v.reason}`);
  return v.code;
}

// Compared as real paths, as in task-units.mjs: through a symlink a plain comparison would
// skip main() and exit 0 — a pass nobody checked.
function isMain() {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  // An error nobody foresaw is "could not check" (2), never a verdict: 1 means refused.
  let code;
  try { code = await main(process.argv.slice(2)); }
  catch (e) { console.error(`✗ Could not check the Task: line: unexpected error: ${e?.message ?? e}`); code = 2; }
  process.exit(code);
}
