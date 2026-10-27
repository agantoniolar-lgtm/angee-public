#!/usr/bin/env node
/**
 * check-push-tasks.mjs — says whether a push would carry the code of a task that is not closed.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * Units of every task are integrated into the same local tracked branch, and a push carries
 * the whole history between the remote and HEAD. So the push of a finished task can carry
 * the integrated units of another task still in progress — and where the tracked branch is
 * production, half of that task reaches users. Every commit names its task in a `Task:`
 * line (the commit-msg hook, check-commit-task.mjs), so which task travels can be read
 * before pushing instead of guessed. `ship` runs this before its closing commit and again
 * right before the push, and at a session close too (T122, the owner 2026-10-15).
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────
 * Every non-merge commit in the range must be one of:
 *   - of the task that ships (`--task`), whatever state it ends in;
 *   - of a task whose status, at the tip of the range, is `done` or `dropped`;
 *   - `Task: none`;
 *   - record-only — every path it touches, both sides of a rename included, is under
 *     RECORD_PATHS — whatever the state of its task: it changes no code.
 * A closed task's code committed after its last closing commit holds too, when that close is
 * inside the range: it is a fix that no ship reviewed (T122, U2 round 2). A close already on
 * the remote is not looked for, so a fix after it passes as the task's: stated, not covered.
 * Anything else holds the push: code of a task not closed (any other status, or one this
 * script does not know, counts as not closed), a commit with no readable `Task:` line, or
 * one naming a task that does not exist at the tip. Each is named with its task, and every
 * task that holds is listed. The `Unit:` line is not read: a unit replaced or renumbered
 * since does not change whose commit it is.
 *
 * Ids and states are read at the tip of the range (`--tip`, default HEAD) from the
 * committed tree — never from the index or the disk, where an uncommitted `status: done`
 * would let a task through. The id is matched as the commit-msg hook matches it
 * (`trailers` and `taskIdOf` of check-commit-task.mjs): case does not matter, and a file
 * name written where the id goes is refused as the hook refuses it.
 *
 * ── The range ────────────────────────────────────────────────────────────────────────
 * `--base <ref>` if given (the pull-request mode passes the tracked branch's upstream, and
 * a replay of an old push passes its old remote head); otherwise the upstream of the
 * current branch, after `git fetch` so a stale remote ref does not count commits the remote
 * already has; with no upstream, whatever is in no remote branch. With no remote branch at
 * all, or a detached HEAD and no `--base`, there is no range to judge: exit 2.
 *
 * ── What it does not see, stated ─────────────────────────────────────────────────────
 * A commit that says `Task: none`, or names the task that ships, while carrying another
 * task's code passes: the line is what is read, not the diff. A push made by hand, outside
 * `ship`, does not run this (an accepted risk, the owner 2026-10-15).
 *
 * ── Usage ────────────────────────────────────────────────────────────────────────────
 *   check-push-tasks.mjs --task <id> | --session-close
 *                        [--base <ref>] [--tip <ref>] [--no-fetch] [--root <path>] [--json]
 *
 * Exit codes:
 *   0  nothing in the range holds the push (or the range is empty)
 *   1  something holds it: each commit and its task are named
 *   2  could not judge: no commit-msg hook running check-commit-task.mjs (the line is
 *      required in every project), no range, a fetch that failed, the task that ships not
 *      found, or a task file whose frontmatter cannot be read. Never a pass.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** What a record-only commit may touch. `ship` reads its session-close exemption from here. */
export const RECORD_PATHS = {
  dirs: ['logs/', 'tasks/', 'docs/'],
  files: ['TASKS.md', 'BACKLOG.md', 'TASKS_ARCHIVE.md', 'STATUS.md', 'PENDINGS.md', 'PRODUCT.md'],
};

export const CLOSED = ['done', 'dropped'];

export class CannotJudge extends Error {}

function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.error) throw new CannotJudge(`git ${args[0]} could not run: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new CannotJudge(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r;
}

export function isRecordPath(path) {
  return RECORD_PATHS.dirs.some((d) => path.startsWith(d)) || RECORD_PATHS.files.includes(path);
}

/** Every path a commit touches, both sides of a rename or copy. */
function touched(root, sha) {
  const out = git(root, ['diff-tree', '--no-commit-id', '-r', '-z', '--name-status', '-M', '-C', '--root', sha]).stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < out.length; i++) {
    const status = out[i];
    if (/^[RC]/.test(status)) { paths.push(out[i + 1], out[i + 2]); i += 2; }
    else { paths.push(out[i + 1]); i += 1; }
  }
  return paths.filter(Boolean);
}

/**
 * Whether a commit-msg hook that runs check-commit-task.mjs is installed in this checkout.
 * The hook git runs must exist and be executable; the call may sit in it or, with husky
 * (core.hooksPath = .husky/_, where every hook is a two-line wrapper), in .husky/commit-msg
 * one folder up — the layout SETUP_CHECKLIST names as valid.
 */
export function hookInstalled(root) {
  const dir = git(root, ['rev-parse', '--git-path', 'hooks']).stdout.trim();
  const hooks = isAbsolute(dir) ? dir : join(root, dir);
  const file = join(hooks, 'commit-msg');
  const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
  const runs = (text) => text !== null && text.split('\n').some((l) => !/^\s*#/.test(l) && /check-commit-task/.test(l));
  try { if (!(statSync(file).mode & 0o111)) return false; } catch { return false; }
  if (runs(read(file))) return true;
  return basename(hooks) === '_' && runs(read(join(dirname(hooks), 'commit-msg')));
}

/** The range to judge: { base, tip, label }. */
function range(root, { base, tip, fetch }) {
  const tipSha = git(root, ['rev-parse', '--verify', `${tip}^{commit}`], { allowFail: true });
  if (tipSha.status !== 0) throw new CannotJudge(`the tip ${tip} is not a commit`);
  if (base) {
    // A base that is a remote-tracking ref (origin/main, in the pull-request mode) is fetched first,
    // so a stale one does not count commits the remote already has.
    const remoteOf = git(root, ['remote']).stdout.split('\n').filter(Boolean).find((r) => base.startsWith(`${r}/`));
    if (fetch && remoteOf) {
      const f = git(root, ['fetch', '--quiet', remoteOf], { allowFail: true });
      if (f.status !== 0) throw new CannotJudge(`git fetch ${remoteOf} failed, so what the remote already has is unknown: ${(f.stderr || '').trim()}`);
    }
    const b = git(root, ['rev-parse', '--verify', `${base}^{commit}`], { allowFail: true });
    if (b.status !== 0) throw new CannotJudge(`the base ${base} is not a commit`);
    return { args: [`${b.stdout.trim()}..${tipSha.stdout.trim()}`], label: `${base}..${tip}` };
  }
  const branch = git(root, ['symbolic-ref', '-q', '--short', 'HEAD'], { allowFail: true }).stdout.trim();
  if (!branch && tip === 'HEAD') throw new CannotJudge('HEAD is detached and no --base was given: there is no range to judge');
  const remotes = git(root, ['remote']).stdout.split('\n').filter(Boolean);
  if (!remotes.length) throw new CannotJudge('this repository has no remote: there is no range to judge');
  const up = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFail: true });
  if (fetch) {
    // Only the remote the push goes to: another remote that cannot be reached says nothing about this push.
    const remote = (up.status === 0 && up.stdout.trim()) ? (git(root, ['config', '--get', `branch.${branch}.remote`], { allowFail: true }).stdout.trim() || remotes[0]) : null;
    const f = git(root, ['fetch', '--quiet', ...(remote ? [remote] : ['--all'])], { allowFail: true });
    if (f.status !== 0) throw new CannotJudge(`git fetch failed, so what the remote already has is unknown: ${(f.stderr || '').trim()}`);
  }
  if (up.status === 0 && up.stdout.trim()) return { args: [`${up.stdout.trim()}..${tipSha.stdout.trim()}`], label: `${up.stdout.trim()}..${tip}` };
  const remoteRefs = git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/']).stdout.split('\n').filter(Boolean);
  if (!remoteRefs.length) throw new CannotJudge('no remote branch exists yet: there is no range to judge (a first push has nothing to compare against)');
  return { args: [tipSha.stdout.trim(), '--not', '--remotes'], label: `${tip}, not in any remote branch` };
}

/** Task files at the tip: id (lowercase) → { file, status }. */
async function tasksAt(root, tip) {
  const { taskIdOf } = await import(join(HERE, 'check-commit-task.mjs'));
  const { frontmatter } = await import(join(HERE, 'task-frontmatter.mjs'));
  const { normalizeStatus } = await import(join(HERE, 'task-states.mjs'));
  const ls = git(root, ['ls-tree', '-z', '--name-only', tip, '--', 'tasks/'], { allowFail: true });
  const files = ls.status === 0 ? ls.stdout.split('\0').filter((p) => /^tasks\/[^/]+\.md$/.test(p)) : [];
  const byId = new Map();
  for (const file of files) {
    const id = taskIdOf(file);
    let fm;
    try { fm = frontmatter(git(root, ['show', `${tip}:${file}`]).stdout); } catch (e) { throw new CannotJudge(`${file} at ${tip}: its frontmatter cannot be read (${e.message})`); }
    if (fm === null || fm === undefined) throw new CannotJudge(`${file} at ${tip}: its frontmatter cannot be read`);
    // Read through the kit's one state model: `Done` and `"done"` are done here as everywhere else.
    const status = typeof fm.status === 'string' ? normalizeStatus(fm.status.replace(/^(["'])(.*)\1$/, '$2')) : null;
    const list = byId.get(id.toLowerCase()) ?? [];
    list.push({ id, file, status });
    byId.set(id.toLowerCase(), list);
  }
  return { byId, files };
}

/** Whose a commit is: { kind: 'none'|'task'|'unreadable'|'file-name'|'unknown-task', id?, reason? }. */
async function ownerOf(root, sha, tasks) {
  const { trailers, taskIdOf } = await import(join(HERE, 'check-commit-task.mjs'));
  const message = git(root, ['log', '-1', '--format=%B', sha]).stdout;
  const { task: values, stray } = trailers(message, { cwd: root, comment: '#' });
  if (!values.length) return { kind: 'unreadable', reason: stray.task ? 'its Task: line is not where git reads trailers' : 'no Task: line' };
  const distinct = [...new Set(values.map((v) => v.toLowerCase()))];
  if (distinct.length > 1) return { kind: 'unreadable', reason: `two Task: lines (${values.join(', ')})` };
  const value = values[0];
  if (!value || /\s/.test(value)) return { kind: 'unreadable', reason: `Task: "${value}" is not one id` };
  if (value.toLowerCase() === 'none') return value === 'none' ? { kind: 'none' } : { kind: 'unreadable', reason: `Task: ${value} (write none in lowercase)` };
  const hit = tasks.byId.get(value.toLowerCase());
  if (hit?.length === 1) return { kind: 'task', id: hit[0].id, status: hit[0].status };
  if (hit && hit.length > 1) return { kind: 'unreadable', reason: `${hit.length} task files answer to ${value}` };
  const asFile = tasks.files.find((f) => f.replace(/^tasks\//, '').replace(/\.md$/, '').toLowerCase() === value.toLowerCase());
  if (asFile) return { kind: 'file-name', reason: `Task: ${value} is a file name, not the id ${taskIdOf(asFile)}` };
  return { kind: 'unknown-task', reason: `Task: ${value} names no task in tasks/ at the tip` };
}

export async function checkPush({ root, task = null, sessionClose = false, base = null, tip = 'HEAD', fetch = true }) {
  if (!task && !sessionClose) throw new CannotJudge('say which task ships (--task <id>) or that this is a session close (--session-close)');
  if (!hookInstalled(root)) throw new CannotJudge('no commit-msg hook runs check-commit-task.mjs in this checkout, so no commit is required to name its task. Install it (SETUP_CHECKLIST: the commit-msg hook) and run this again; the Task: line is required in every project');
  const r = range(root, { base, tip, fetch });
  const tasks = await tasksAt(root, tip);
  let shipping = null;
  if (task) {
    const hit = tasks.byId.get(task.toLowerCase());
    if (!hit || hit.length !== 1) throw new CannotJudge(`the task that ships, ${task}, is not one task file at ${tip}`);
    shipping = hit[0].id;
  }
  const shas = git(root, ['rev-list', '--no-merges', '--reverse', ...r.args]).stdout.split('\n').filter(Boolean);
  // A closed task's commit that comes after its closing commit is a fix nobody's ship reviewed:
  // its own task already left the gate, and the task now shipping reviews only itself.
  const closedAt = new Map();
  const { normalizeStatus } = await import(join(HERE, 'task-states.mjs'));
  const statusIn = (ref, file) => {
    const r2 = git(root, ['show', `${ref}:${file}`], { allowFail: true });
    if (r2.status !== 0) return null;
    const m = r2.stdout.match(/^---\n[\s\S]*?^status:\s*(.+)$/m);
    return m ? normalizeStatus(m[1].trim().replace(/^(["'])(.*)\1$/, '$2')) : null;
  };
  // Only the task files the range touches can have closed in it: one git log lists them, so
  // the cost follows the commits that change tasks/, not every closed task × every commit.
  const closedByFile = new Map();
  for (const [, list] of tasks.byId) if (list.length === 1 && CLOSED.includes(list[0].status)) closedByFile.set(list[0].file, list[0].id);
  const log = git(root, ['log', '--reverse', '--no-merges', '--format=%x00%H', '--name-only', ...r.args, '--', 'tasks/']).stdout.split('\0').filter(Boolean);
  for (const block of log) {
    const [sha, ...files] = block.split('\n').map((x) => x.trim()).filter(Boolean);
    for (const file of files) {
      const id = closedByFile.get(file);
      if (!id) continue;
      // The last close wins: a task reopened, fixed and closed again is judged from its last close.
      if (CLOSED.includes(statusIn(sha, file) ?? '') && !CLOSED.includes(statusIn(`${sha}^`, file) ?? '')) closedAt.set(id, sha);
    }
  }
  const after = new Set();
  for (const [id, sha] of closedAt) {
    const late = git(root, ['rev-list', '--no-merges', `${sha}..${r.args[0].includes('..') ? r.args[0].split('..')[1] : r.args[0]}`]).stdout.split('\n').filter(Boolean);
    for (const s2 of late) after.add(`${id} ${s2}`);
  }
  const commits = [];
  for (const sha of shas) {
    const o = await ownerOf(root, sha, tasks);
    const subject = git(root, ['log', '-1', '--format=%s', sha]).stdout.trim();
    const record = touched(root, sha).every(isRecordPath);
    let verdict;
    if (o.kind === 'none') verdict = 'pass:none';
    else if (o.kind === 'task' && o.id === shipping) verdict = 'pass:ships';
    else if (record && o.kind === 'task') verdict = 'pass:record-only';
    else if (o.kind === 'task' && CLOSED.includes(o.status) && after.has(`${o.id} ${sha}`)) verdict = 'hold:after-close';
    else if (o.kind === 'task' && CLOSED.includes(o.status)) verdict = `pass:${o.status}`;
    else if (o.kind === 'task') verdict = 'hold:not-closed';
    else verdict = `hold:${o.kind}`;
    const reason = verdict === 'hold:after-close' ? `committed after ${o.id} closed: a fix its ship never reviewed — reopen ${o.id}, review it, and ship it again` : (o.reason ?? null);
    commits.push({ sha, short: sha.slice(0, 7), subject, task: o.id ?? null, status: o.status ?? null, record, verdict, reason });
  }
  const held = commits.filter((c) => c.verdict.startsWith('hold'));
  const holders = [...new Set(held.map((c) => c.task ?? '(no task)'))];
  return { range: r.label, shipping, sessionClose, commits, held, holders, code: held.length ? 1 : 0 };
}

function report(res) {
  const lines = [`\n  Push range: ${res.range} — ${res.commits.length} commit(s), merges not judged`];
  lines.push(res.shipping ? `  Ships: ${res.shipping}` : '  Session close: no task ships');
  for (const c of res.commits) {
    const who = c.task ? `${c.task}${c.status ? ` (${c.status})` : ''}` : (c.verdict === 'pass:none' ? 'none' : '—');
    lines.push(`  ${c.verdict.startsWith('hold') ? '✗' : '·'} ${c.short} ${who.padEnd(24)} ${c.verdict.replace(/^(pass|hold):/, '')}${c.reason ? ` — ${c.reason}` : ''}  ${c.subject.slice(0, 60)}`);
  }
  if (!res.commits.length) lines.push('  ✓ nothing to push.');
  else if (!res.held.length) lines.push('  ✓ nothing in this push belongs to a task that is not closed.');
  else {
    lines.push(`\n✗ ${res.held.length} commit(s) hold this push, of: ${res.holders.join(', ')}.`);
    lines.push('  They leave when their own task ships. Hold this one (ship step 5c), naming each task above.');
  }
  return lines.join('\n');
}

async function main(argv) {
  const o = { root: process.cwd(), task: null, sessionClose: false, base: null, tip: 'HEAD', fetch: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (!v) throw new CannotJudge(`${a} needs a value`); return v; };
    if (a === '--task') o.task = val();
    else if (a === '--session-close') o.sessionClose = true;
    else if (a === '--base') o.base = val();
    else if (a === '--tip') o.tip = val();
    else if (a === '--no-fetch') o.fetch = false;
    else if (a === '--root') o.root = resolve(val());
    else if (a === '--json') o.json = true;
    else throw new CannotJudge(`unknown option ${a}. Usage: check-push-tasks.mjs --task <id> | --session-close [--base <ref>] [--tip <ref>] [--no-fetch] [--root <path>] [--json]`);
  }
  if (o.task && o.sessionClose) throw new CannotJudge('--task and --session-close exclude each other');
  const top = git(o.root, ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (top.status !== 0) throw new CannotJudge(`${o.root} is not inside a git checkout`);
  const res = await checkPush({ ...o, root: top.stdout.trim() });
  console.log(o.json ? JSON.stringify(res, null, 2) : report(res));
  return res.code;
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) {
  // exitCode, not exit(): on a pipe stdout is asynchronous, and exit() cut a long report at 64 KB.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`✗ Could not judge the push: ${e.message}`);
    process.exitCode = 2;
  });
}
