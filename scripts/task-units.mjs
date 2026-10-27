#!/usr/bin/env node
/**
 * task-units.mjs — reads the units of work of one task, and says which can be built together.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * `scope` writes a task's units into its `## Done when`, one checkbox per commit, each with
 * `verified by:`, `depends on:` and `touches:` (and, once integrated, the `commit:` that
 * integrate-unit.mjs records). `touches:` is a write contract: the files
 * that unit's builder may write, and nothing else. Two units can be built at the same time,
 * each in its own worktree, only when neither waits on the other and they declare no file
 * in common. Deciding that by reading prose is exactly the step an agent skips, so it is
 * computed here instead.
 *
 * ── What it checks ───────────────────────────────────────────────────────────────────
 * - Every `touches:` entry is one file path: not a directory, not a pattern, not a phrase.
 *   A directory or a glob makes "do these two units overlap?" unanswerable, and a phrase
 *   like "and its installed copies" hides the files it means.
 * - A unit with no `touches:` is reported as missing, with its own exit code (3), not as an
 *   error of the task: tasks written before the field existed have none. A 3 is a stop for
 *   that unit, not for the task: it is not built or dispatched; it goes back to `scope`,
 *   which writes its `touches:`. The task's other units go on, and `--plan` still lists
 *   them.
 *
 * ── A file another task has ──────────────────────────────────────────────────────────
 * A file another task has is not written by anyone else until that task's unit integrates.
 * `--plan` enforces it when dispatching: a unit whose `touches:` overlaps a file another task
 * has waits, and the reason names that task and unit. The first to be dispatched wins.
 * Who has what is computed from git, never from a task's `status:` (`collectHolds`):
 * - a unit already dispatched and not integrated — its branch `ai/<task>-U<n>` has commits
 *   the base lacks, or a live worktree — has what its `touches:` declares, what its branch
 *   wrote, and what its worktree has uncommitted. Each file says how it is had (`declared`,
 *   `branch`, `worktree`), since a file declared outranks one written without declaring;
 * - a held task has what its branch `ai/<task>` wrote, and what that branch's worktree has
 *   uncommitted. Task-state files (`tasks/`, `logs/tasks/`, the indexes) are had by nobody,
 *   whether a branch wrote them or a unit declared them.
 * A unit never dispatched has nothing. A unit checked off whose `commit:` is in the base has
 * nothing, whatever is left of its branch; checked off without one, while its branch still
 * has commits or its live worktree has uncommitted files, it keeps its files and that is noted. A branch of a task `done` or `dropped` has
 * nothing, even when it looks ahead (a squash changes every SHA): it is reported as left
 * over. An `ai/*` branch of no task, and a backup `ai/<task>-U<n>-backup-<n>` that
 * `integrate-unit.mjs discard` leaves, have nothing; the first is noted.
 * A unit dispatched whose builder is gone keeps its files with no deadline: the wait names it
 * and says that `integrate-unit.mjs discard` releases it.
 * The tasks are read from `tasks/` of the main checkout, also when this runs in a worktree;
 * a project installed in a folder of its repo (`app/`) is read from that folder there, and
 * what git says about files outside it does not count. A branch of the asking task itself
 * with work but no unit (`ai/<task>`, or a unit that no longer exists) is noted, not counted;
 * so is one of its own units checked off whose work is not in the base. The project's
 * `tasks/` is the nearest one that holds a task file, so `logs/tasks/` or a code folder
 * named `tasks/` is never taken for it.
 * Every branch is compared against the base: by default the branch the main checkout is
 * on. A repository with no commit yet has no base and no branch with commits: only
 * uncommitted work in a live worktree on an `ai/` branch is had, and that is noted. A
 * repository whose refs git cannot list (a branch pointing at a missing object) is not one
 * with no commit: with a base that does not resolve, it is exit 2. What cannot be read —
 * no repository, a base that is not a commit, a main checkout on a detached HEAD, on an `ai/` branch or halfway through a rebase, another task in flight
 * with no valid `touches:` or with lines that cannot be read as units — is exit 2: nothing
 * is dispatched blind. Limits, stated: another clone or machine is not seen; a single writer
 * building in the main checkout has no `ai/` branch, so nothing here sees what it has (it is
 * noted); and two sessions planning at the same instant can both dispatch the same file —
 * `integrate-unit.mjs check` is the net that catches the second.
 * There is no queue for a file. The one that used to live here (`--holds`, `--enqueue`,
 * `--take`, `--dequeue`, and its `queued for:` field) was removed; those options now say so,
 * and a `queued for:` line left in a task is reported as a field nothing reads, not as an error.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────────────
 *   task-units.mjs <task-id | tasks/<file>.md> [--root <path>] [--plan [--base <ref>]] [--done U1,U2] [--in-flight U3] [--json]
 *
 *   --plan       list the pending units that can be dispatched together now; a unit whose
 *                files another task has waits. Needs git: run inside the repository
 *   --base       the tracked branch other branches are compared against; by default the
 *                branch the main checkout is on
 *   --done       units to count as integrated, beyond the ones checked `[x]` in the file
 *   --in-flight  units already dispatched and still working; their files count as taken.
 *                A unit of the task whose branch has work or a live worktree counts anyway
 *   --json       print the parsed units (and the plan) as JSON, for other scripts
 *
 * Exit codes: 0 every pending unit has a valid `touches:` and `depends on:`; 1 a field is
 * invalid, a `depends on:` is missing, a line looks like a unit and is not one, or the plan
 * was refused; 2 the task could not be read (no file, no `## Done when`, no units), an
 * option that does not exist, or — with --plan — what other tasks have could not be checked;
 * a unit waiting for a file is not a failure; 3 all readable, but not plannable yet: some
 * pending unit has no `touches:`, or the task predates units altogether (checkboxes with no
 * **U<n>**). 3 is not a failure, but it is a stop: a unit without `touches:` is not built
 * or dispatched until it goes back to `scope` and `scope` writes its `touches:`, while
 * the task's other units go on; a task with no units is not built at all until `scope`
 * writes them, each with its `touches:`.
 */

import { readFileSync, existsSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, isAbsolute, posix, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNIT_LINE = /^- \[( |x|X)\] \*\*(U\d+)\*\* — (.*)$/;
// A unit closed by being replaced: `- [x] ~~**U5** — …~~ — replaced by **U7**`. It counts as done.
const STRUCK_LINE = /^- \[(x|X)\] ~~\*\*(U\d+)\*\* — (.*)$/;
// `queued for:` is read only to be reported: the queue it belonged to was removed, and a task
// written while it existed still parses, with a warning, instead of refusing its whole list.
const FIELD_LINE = /^\s+- (verified by|depends on|touches|queued for|commit):\s*(.*)$/;
const GLOB_CHARS = /[*?[\]{}]/;
// What a path in touches: may contain. Anything else — a trailing period, a semicolon, a
// quote — is prose leaking into the list, and it would hide an overlap: `b.js.` and `b.js`
// compare as two files.
const PATH_CHARS = /^[\p{L}\p{N}._\-\/@+]+$/u;
const PLACEHOLDER = /^(tbd|tba|todo|n\/a|na|none|nothing|pendiente|por-definir)$/i;

/**
 * Which lines a reader of the rendered file would see: not the inside of a code block
 * (``` or ~~~) and not the inside of an HTML comment. An example of the unit format shown
 * in either — the header included — is not the task's list.
 */
function visibleLines(lines) {
  const visible = [];
  let fence = null;
  let fenceLine = -1;
  let comment = false;
  lines.forEach((line, i) => {
    if (comment) { if (line.includes('-->')) comment = false; visible.push(false); return; }
    if (fence) {
      // As in Markdown, only a bare run of the same marker, at least as long, closes a block:
      // a ```js line inside one is content, not its end.
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      visible.push(false);
      return;
    }
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) { fence = open[1]; fenceLine = i; visible.push(false); return; }
    if (/^\s*<!--/.test(line)) { if (!line.includes('-->')) comment = true; visible.push(false); return; }
    visible.push(true);
  });
  visible.unclosedFence = fence ? fenceLine : -1;
  return visible;
}

/**
 * Parse the `## Done when` section of a task file. Returns null if the section is absent,
 * otherwise `{ units, malformed, legacy }`.
 *
 * A line that looks like a unit but does not match the format is never skipped: skipping
 * it would hand its fields to the unit above it, and its `touches:` would silently replace
 * that unit's. It goes to `malformed`, and no plan is made while `malformed` is not empty.
 * For the same reason, any line at the left margin that is not a unit — a prose bullet, a
 * paragraph — ends the unit above it: a field written under it belongs to nobody, and is
 * refused rather than lent to the unit before.
 *
 * `legacy` holds checkboxes with no unit id, the format of tasks written before units
 * existed. `scope` leaves those alone, so a section made only of them is not an error —
 * it is a task that cannot be planned in parallel. Mixed with real units, they are malformed.
 */
export function parseUnits(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const visible = visibleLines(lines);
  const start = lines.findIndex((l, i) => visible[i] && /^## Done when\s*$/.test(l));
  if (start === -1) return null;
  const units = [];
  const malformed = [];
  const legacy = [];
  // A code block that never closes hides everything after it, units included.
  if (visible.unclosedFence > start) malformed.push({ line: visible.unclosedFence + 1, text: lines[visible.unclosedFence], reason: 'a code block that never closes; everything after it is hidden' });
  let current = null;
  let lastKey = null;
  let afterBlank = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!visible[i]) continue;
    if (/^## /.test(line)) break;
    if (!line.trim()) { lastKey = null; afterBlank = true; continue; }
    const blankBefore = afterBlank;
    afterBlank = false;
    const u = line.match(UNIT_LINE) || line.match(STRUCK_LINE);
    if (u) {
      const struck = !line.match(UNIT_LINE);
      current = { id: u[2], done: struck || u[1] !== ' ', replaced: struck, text: u[3].trim(), verifiedBy: null, dependsOn: [], external: null, touches: null, touchesRaw: null, queuedFor: null, commit: null, line: i, end: i, fieldAt: {}, seen: new Set() };
      if (units.some((x) => x.id === current.id)) malformed.push({ line: i + 1, text: line, reason: `${current.id} appears twice` });
      units.push(current);
      lastKey = null;
      continue;
    }
    // A checkbox with no unit id anywhere is the format from before units existed.
    // Old tasks also used their own marks: `[~]` partial, `[→]` moved elsewhere.
    if (/^- \[[^\]]\] /.test(line) && !/\bU\d+\b/.test(line)) {
      legacy.push({ line: i + 1, text: line });
      current = null;
      lastKey = null;
      continue;
    }
    // Every other checkbox here is a unit (scope step 6), whatever its bullet, and so is a
    // bullet that opens with a unit id. Prose that only mentions a unit further along is
    // allowed around the list.
    if (/^([-*+]|\d+[.)]) \[/.test(line) || /^- (~~)?(\*\*)?U\d+\b/.test(line)) {
      malformed.push({ line: i + 1, text: line, reason: 'looks like a unit but is not `- [ ] **U<n>** — text`' });
      current = null;
      lastKey = null;
      continue;
    }
    if (!/^\s/.test(line)) { current = null; lastKey = null; continue; }
    const f = line.match(FIELD_LINE);
    if (!current) {
      if (f) malformed.push({ line: i + 1, text: line, reason: `${f[1]}: under no unit (the line above it is not a unit)` });
      continue;
    }
    if (f) {
      const [, key, value] = f;
      if (current.seen.has(key)) malformed.push({ line: i + 1, text: line, reason: `${current.id} declares ${key}: twice` });
      current.seen.add(key);
      setField(current, key, value);
      current.fieldAt[key] = { start: i, end: i };
      current.end = i;
      lastKey = key;
      continue;
    }
    // An indented line that is not a new field continues the field above it.
    if (lastKey && !/^\s+- /.test(line)) {
      setField(current, lastKey, `${fieldRaw(current, lastKey)} ${line.trim()}`);
      current.fieldAt[lastKey].end = i;
      current.end = i;
      continue;
    }
    // Any other bullet nested under a unit is refused rather than dropped: a file listed as a
    // sub-bullet of touches: would otherwise vanish from the contract without a word.
    if (/^\s+- /.test(line)) {
      malformed.push({ line: i + 1, text: line, reason: `nested bullet under ${current.id} that is not verified by:, depends on:, touches: or commit:; write a field's list on its own line` });
      continue;
    }
    // Indented text under a unit after a blank line is most likely the rest of a field whose
    // list was broken by the blank: refused, since reading it as nothing would drop files.
    if (blankBefore) {
      malformed.push({ line: i + 1, text: line, reason: `indented text under ${current.id} after a blank line; keep a field's list without blank lines` });
      continue;
    }
    current.end = i;
    lastKey = null;
  }
  for (const unit of units) delete unit.seen;
  if (units.length) for (const l of legacy) malformed.push({ ...l, reason: 'a checkbox with no unit id, among units' });
  return { units, malformed, legacy: units.length ? [] : legacy };
}

/** A cycle among pending units, as `U1 → U2 → U1`, or null. */
function findCycle(units, done) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const state = new Map();
  const path = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'open') return [...path.slice(path.indexOf(id)), id].join(' → ');
    state.set(id, 'open');
    path.push(id);
    for (const d of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(d) || done.has(d)) continue;
      const c = visit(d);
      if (c) return c;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };
  for (const u of units) { if (done.has(u.id)) continue; const c = visit(u.id); if (c) return c; }
  return null;
}

function fieldRaw(unit, key) {
  if (key === 'verified by') return unit.verifiedBy ?? '';
  if (key === 'depends on') return unit.dependsRaw ?? '';
  if (key === 'queued for') return unit.queuedFor ?? '';
  if (key === 'commit') return unit.commit ?? '';
  return unit.touchesRaw ?? '';
}

function setField(unit, key, value) {
  if (key === 'verified by') unit.verifiedBy = value.trim();
  if (key === 'depends on') { unit.dependsRaw = value.trim(); Object.assign(unit, parseDepends(value)); }
  if (key === 'touches') { unit.touchesRaw = value.trim(); unit.touches = splitList(value); }
  if (key === 'queued for') unit.queuedFor = value.trim();
  if (key === 'commit') unit.commit = value.trim();
}


/** `depends on:` holds unit ids and, sometimes, a condition that is not a unit. */
export function parseDepends(value) {
  const v = value.replace(/`/g, '').trim();
  if (/^(nothing|none|nada|ninguna|ninguno|—|-)?\.?$/i.test(v)) return { dependsOn: [], external: null };
  const dependsOn = [...v.matchAll(/\bU\d+\b/g)].map((m) => m[0]);
  const rest = v.replace(/\bU\d+\b/g, ' ').replace(/(^|[\s,;&])(and|y|e)(?=[\s,;&]|$)/gi, ' ').replace(/[\s,;&.]+/g, ' ').trim();
  return { dependsOn, external: rest ? rest : null };
}

function splitList(value) {
  return value.split(',').map((s) => s.trim().replace(/^`|`$/g, '').trim());
}

/** The path as compared: `./` dropped, `a/../b` folded. */
export function normalizePath(entry) {
  return posix.normalize(entry.replace(/^\.\//, ''));
}

/**
 * Each entry must be one file path inside the repo. Returns the reasons an entry is not.
 * An empty entry is a list that ends in a comma, or two commas in a row: something was
 * lost, most likely the rest of the list on a line nobody read.
 */
export function touchesProblems(unit, root) {
  if (unit.touches === null) return [{ entry: null, reason: 'missing' }];
  const problems = [];
  for (const entry of unit.touches) {
    if (!entry) { problems.push({ entry, reason: 'an empty entry (a trailing or doubled comma)' }); continue; }
    const norm = normalizePath(entry);
    if (/\s/.test(entry)) problems.push({ entry, reason: 'not a path (contains spaces)' });
    else if (GLOB_CHARS.test(entry)) problems.push({ entry, reason: 'a pattern, not a file' });
    else if (!PATH_CHARS.test(entry)) problems.push({ entry, reason: 'not a path (a character a path here does not use: punctuation or a quote)' });
    else if (entry.endsWith('.')) problems.push({ entry, reason: 'not a path (ends in a period)' });
    else if (PLACEHOLDER.test(entry)) problems.push({ entry, reason: 'a placeholder, not a file' });
    else if (GLOB_CHARS.test(entry)) problems.push({ entry, reason: 'a pattern, not a file' });
    else if (entry.endsWith('/')) problems.push({ entry, reason: 'a directory, not a file' });
    else if (isAbsolute(entry)) problems.push({ entry, reason: 'absolute path; write it relative to the repo root' });
    else if (norm === '..' || norm.startsWith('../')) problems.push({ entry, reason: 'outside the repo' });
    else if (existsSync(join(root, norm)) && statSync(join(root, norm)).isDirectory()) problems.push({ entry, reason: 'a directory, not a file' });
  }
  return problems;
}

/**
 * Two declared paths overlap when they name the same file, compared without case (a
 * case-insensitive filesystem makes `README.md` and `readme.md` one file), or when one
 * sits inside the other — `newdir` and `newdir/z.mjs` cannot both be written as declared.
 */
export function pathsOverlap(a, b) {
  const x = normalizePath(a).toLowerCase();
  const y = normalizePath(b).toLowerCase();
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/**
 * Which pending units can be dispatched together now.
 *
 * `inFlight` are units already dispatched and still working: they are not planned again,
 * and the files they declared count as taken. Without them, replanning after one unit
 * lands would hand a file to a new builder while another is still writing it.
 *
 * A unit is ready when every unit it depends on is done and it names no condition outside
 * the list. Ready units are grouped in list order: a unit joins the group only if none of
 * its files overlaps a file already taken. A unit without a valid `touches:` never shares
 * a group — nobody can say whether it overlaps.
 *
 * `together` can start now. `serial` runs one at a time, each once the group before it has
 * landed. `waiting` cannot start yet: a dependency, a condition, or a unit in flight.
 *
 * `held` are the files other tasks have, as `collectHolds` returns them (`claims` of other
 * tasks): a ready unit that declares one waits, and the reason names who has it. A unit
 * dispatched with no commit yet (`idle`) may be one whose builder is gone, so the reason
 * also says how it is released. In `waiting`, such a unit carries `heldBy`, every holder.
 *
 * Takes what `parseUnits` returned, and refuses to plan while any line was malformed.
 */
export function planDispatch(parsed, { done: extraDone = [], inFlight = [], root = '.', held = [] } = {}) {
  const { units, malformed, legacy = [] } = parsed;
  if (malformed.length) return { refused: `${malformed.length} line(s) in "## Done when" could not be read as units` };
  if (!units.length && legacy.length) return { refused: 'the task was written before units existed, so it has none to plan, and nothing of it is built or dispatched: scope writes its units, each with its touches:, first' };
  const known = new Set(units.map((u) => u.id));
  const stray = [...extraDone, ...inFlight].filter((id) => !known.has(id));
  if (stray.length) return { refused: `${stray.join(', ')} is not a unit of this task` };
  const markedDone = new Set(units.filter((u) => u.done).map((u) => u.id));
  const both = inFlight.filter((id) => extraDone.includes(id) || markedDone.has(id));
  if (both.length) return { refused: `${both.join(', ')} is given as in flight but is already done` };
  const done = new Set([...units.filter((u) => u.done).map((u) => u.id), ...extraDone]);
  const cycle = findCycle(units, done);
  if (cycle) return { refused: `the units wait on each other: ${cycle}` };
  const running = new Set(inFlight.filter((id) => !done.has(id)));
  const together = [];
  const waiting = [];
  const serial = [];
  const taken = [];
  for (const u of units) {
    if (!running.has(u.id)) continue;
    if (touchesProblems(u, root).length) return { refused: `${u.id} is in flight with no valid touches:, so no file can be known free` };
    for (const f of u.touches) taken.push({ file: f, by: u.id });
  }
  for (const u of units) {
    if (done.has(u.id) || running.has(u.id)) continue;
    if (u.dependsRaw === undefined) { waiting.push({ id: u.id, reason: 'no depends on: declared, so nobody knows what it waits for' }); continue; }
    const unknown = u.dependsOn.filter((d) => !known.has(d));
    const pending = u.dependsOn.filter((d) => known.has(d) && !done.has(d));
    if (unknown.length) { waiting.push({ id: u.id, reason: `depends on ${unknown.join(', ')}, which is not a unit of this task` }); continue; }
    if (pending.length) { waiting.push({ id: u.id, reason: `depends on ${pending.join(', ')}` }); continue; }
    if (u.external) { waiting.push({ id: u.id, reason: `waits on: ${u.external}` }); continue; }
    if (touchesProblems(u, root).length) {
      if (running.size) waiting.push({ id: u.id, reason: `no valid touches:, so it is not built or dispatched: the unit goes back to scope, which writes its touches:` });
      else serial.push({ id: u.id, reason: 'no valid touches:, so it is not built or dispatched: the unit goes back to scope, which writes its touches:' });
      continue;
    }
    const heldBy = held.filter((h) => u.touches.some((f) => pathsOverlap(h.file, f)));
    if (heldBy.length) { waiting.push({ id: u.id, reason: heldReason(heldBy), heldBy }); continue; }
    let clash = null;
    for (const f of u.touches) { clash = taken.find((t) => pathsOverlap(t.file, f)); if (clash) break; }
    if (clash && running.has(clash.by)) { waiting.push({ id: u.id, reason: `shares ${clash.file} with ${clash.by}, still in flight` }); continue; }
    if (clash) { serial.push({ id: u.id, reason: `shares ${clash.file} with ${clash.by}` }); continue; }
    together.push(u.id);
    for (const f of u.touches) taken.push({ file: f, by: u.id });
  }
  return { together, waiting, serial, inFlight: [...running] };
}

// ── What other tasks have ────────────────────────────────────────────────────────────

/** What cannot be checked: exit 2, never a verdict. */
export class CannotCheck extends Error {}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };

function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: GIT_ENV });
  if (r.error && !allowFail) throw new CannotCheck(`git ${args.join(' ')} failed: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new CannotCheck(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r;
}

const zlist = (out) => out.split('\0').filter(Boolean);

/**
 * An operation left half done in a checkout, and the branch it belongs to: mid-rebase git
 * lists the worktree as detached, but the branch being rebased is still its branch.
 */
function inProgress(path) {
  const r = git(path, ['rev-parse', '--absolute-git-dir'], { allowFail: true });
  const gd = (r.stdout || '').trim();
  if (r.error || r.status !== 0 || !gd) return { op: null, branch: null };
  for (const d of ['rebase-merge', 'rebase-apply']) {
    if (!existsSync(join(gd, d))) continue;
    let head = '';
    try { head = readFileSync(join(gd, d, 'head-name'), 'utf8').trim(); } catch { /* an `am` has none */ }
    return { op: 'rebase', branch: head.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : null };
  }
  const ops = [['MERGE_HEAD', 'merge'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'], ['sequencer', 'cherry-pick or revert']];
  for (const [f, op] of ops) if (existsSync(join(gd, f))) return { op, branch: null };
  return { op: null, branch: null };
}

/** Every worktree, with its path and branch; the first one is the main checkout. */
function worktrees(cwd) {
  return git(cwd, ['worktree', 'list', '--porcelain']).stdout.split('\n\n').filter(Boolean).map((block, i) => {
    const path = block.match(/^worktree (.*)$/m)?.[1];
    // A worktree whose folder was removed by hand stays registered until `git worktree prune`.
    const gone = i > 0 && (/^prunable/m.test(block) || !path || !existsSync(path));
    const listed = block.match(/^branch refs\/heads\/(.*)$/m)?.[1] ?? null;
    const { op, branch } = gone ? { op: null, branch: null } : inProgress(path);
    return { path, branch: listed ?? branch, op, gone };
  });
}

/** Paths a range changed, renames under both names. */
function changedFiles(cwd, from, to) {
  return zlist(git(cwd, ['diff', '--name-only', '--no-renames', '-z', from, to]).stdout);
}

/** Modified, staged or untracked paths in a checkout, each file of a new folder listed. */
function dirtyPaths(cwd) {
  const entries = zlist(git(cwd, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout);
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    paths.push(entries[i].slice(3));
    if (/^[RC]/.test(entries[i])) paths.push(entries[++i]);
  }
  return paths;
}

// The task-state files: written only by the session, never had by a task. The same list as
// integrate-unit.mjs's isStateFile, which imports this file and so cannot be imported here.
const STATE_DIRS = ['tasks/', 'logs/tasks/'];
const STATE_FILES = ['TASKS.md', 'BACKLOG.md', 'TASKS_ARCHIVE.md'];
function isStateFile(path) {
  const p = normalizePath(path).toLowerCase();
  return STATE_DIRS.some((d) => p.startsWith(d)) || STATE_FILES.some((f) => f.toLowerCase() === p);
}

/** id and status of a task file, from its frontmatter. */
export function readFrontmatter(text, fallbackId) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const id = fm.match(/^id:\s*(\S+)\s*$/m)?.[1] ?? fallbackId;
  const status = fm.match(/^status:\s*(.+?)\s*$/m)?.[1] ?? null;
  return { id, short: id.match(/^([A-Z]+\d+)/)?.[1] ?? id, status };
}

/**
 * Whether a folder named `tasks/` is the project's: it holds at least one `.md` with a task's
 * frontmatter (`---` and an `id:`). One check covers both folders that are not: `logs/tasks/`
 * (task logs, which open with a comment, not frontmatter) and a code folder that happens to be
 * called `tasks/` (Rails' `lib/tasks/`, with `.rake` files). Checking only the name of the
 * folder above it would catch the first and not the second.
 */
function holdsTasks(dir) {
  let names;
  try { names = readdirSync(dir).filter((f) => /\.md$/.test(f)); } catch { return false; }
  return names.some((f) => {
    try { return /^id:\s*\S/m.test(readFileSync(join(dir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''); }
    catch { return false; }
  });
}

/** Every task file in `tasks/` of the main checkout, parsed. One that cannot be read stops the check. */
function readTasks(mainRoot) {
  const dir = join(mainRoot, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.md$/.test(f)).sort().map((f) => {
    const file = join(dir, f);
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch (e) { throw new CannotCheck(`${file} cannot be read (${e.code ?? e.message}), so nobody can say what its task has`); }
    return { file, text, ...readFrontmatter(text, f.replace(/\.md$/, '')), parsed: parseUnits(text) };
  });
}

/**
 * Which task, and which unit of it, an `ai/*` branch belongs to: ai/<task>-U<n> or ai/<task>,
 * by the task's whole id or its short one. A backup left by discard belongs to nobody.
 */
export function branchOwner(branch, tasks) {
  const name = branch.replace(/^ai\//, '');
  if (/-U\d+-backup-\d+$/.test(name)) return { task: null, unit: null, backup: true };
  const unit = name.match(/^(.+)-(U\d+)$/);
  for (const t of tasks) {
    if (unit && (unit[1] === t.id || unit[1] === t.short)) return { task: t, unit: unit[2], backup: false };
    if (name === t.id || name === t.short) return { task: t, unit: null, backup: false };
  }
  return { task: null, unit: null, backup: false };
}

const CLOSED = /^(done|dropped)$/i;
/** How a holder is named to a person: `T300 U1`, or `T200 (held, branch ai/T200)`. */
export function holderName(c) {
  return c.unit ? `${c.short} ${c.unit}` : `${c.short} (its branch ${c.branch})`;
}
const HOW = { declared: 'declared', branch: 'its branch wrote it', worktree: 'uncommitted in its worktree' };

/** Why a unit waits: every file and who has it, and how an abandoned unit is released. */
function heldReason(heldBy) {
  const byWho = new Map();
  for (const h of heldBy) {
    const k = holderName(h);
    if (!byWho.has(k)) byWho.set(k, { h, files: [] });
    const e = byWho.get(k);
    const f = `${h.file} (${HOW[h.how] ?? h.how})`;
    if (!e.files.includes(f)) e.files.push(f);
  }
  return [...byWho].map(([k, { h, files }]) => {
    const idle = h.unit && h.idle ? `; ${k} has no commit yet — if its builder is gone, it is released with integrate-unit.mjs discard ${h.short} ${h.unit}` : '';
    return `needs ${files.join(', ')}, which ${k} has, until it integrates${idle}`;
  }).join('; and ');
}

/**
 * What every task has, from git, against `base` in the repository at `root`. The rule is in
 * this file's header. `task`, when given, is the task asking: its own units in flight are
 * returned in `inFlight` (with the ones `inFlight` names), not as claims of another task —
 * within a task, `planDispatch` keeps two units apart by what they declare.
 *
 * Returns `claims` (one per file and holder: task, short, unit or null, branch, file, how,
 * idle), `leftover` (branches of closed tasks), `notes`, `mainRoot`, `base`, `baseSha`, and
 * the asking task (`asking`, with its parsed units). Throws CannotCheck when something
 * cannot be read; never guesses.
 */
export function collectHolds({ root, base = null, task = null, inFlight = [] }) {
  if (!existsSync(root)) throw new CannotCheck(`${root} does not exist`);
  const top = git(root, ['rev-parse', '--show-toplevel'], { allowFail: true }).stdout?.trim();
  if (!top) throw new CannotCheck(`${root} is not inside a git repository, so nobody can say what other tasks have`);
  const listed = worktrees(top);
  const main = listed[0];
  // git runs at the main checkout's top, and every path it prints is from there. The project
  // can live in a folder of its repo (install.sh's GIT_PREFIX, `app/` of a monorepo): its root
  // is the folder of `root` inside its worktree — or the nearest one above it whose tasks/
  // holds task files in the main checkout, so a run from a subfolder still finds them — and the
  // same folder in the main checkout is where tasks/ is read. Paths from git are made relative
  // to it; a path outside it is another project's and has nothing to do with this one.
  const gitRoot = realpathSync(main.path);
  const fromTop = (git(root, ['rev-parse', '--show-prefix'], { allowFail: true }).stdout ?? '').trim();
  const parts = fromTop.split('/').filter(Boolean);
  let prefix = parts.length ? `${parts.join('/')}/` : '';
  for (let n = parts.length; n >= 0; n--) {
    if (holdsTasks(join(gitRoot, ...parts.slice(0, n), 'tasks'))) { prefix = n ? `${parts.slice(0, n).join('/')}/` : ''; break; }
  }
  const mainRoot = prefix ? join(gitRoot, prefix.slice(0, -1)) : gitRoot;
  if (!existsSync(mainRoot)) throw new CannotCheck(`the project folder ${prefix} does not exist in the main checkout (${gitRoot}), so nobody can read its tasks/`);
  const inProject = (paths) => paths.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
  let baseName = base;
  if (!baseName) {
    if (main.op) throw new CannotCheck(`the main checkout is in the middle of a ${main.op}, so its HEAD is not the tracked branch; finish or abort it, or pass --base`);
    baseName = git(gitRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).stdout.trim();
    if (!baseName) throw new CannotCheck('the main checkout is on a detached HEAD, so there is no tracked branch to compare against; check it out there, or pass --base');
    if (/^(ai|proto)\//.test(baseName)) throw new CannotCheck(`the main checkout is on ${baseName}, a branch of work, not the tracked branch; check the tracked branch out there, or pass --base`);
  }
  const baseSha = git(gitRoot, ['rev-parse', '--verify', '--quiet', `${baseName}^{commit}`], { allowFail: true }).stdout.trim() || null;
  // A repository with no commit at all has no base and no branch with commits: there is
  // nothing to compare, and only uncommitted work in a live worktree on an ai/ branch can be
  // had. It counts as having no commit only when git says so cleanly — rev-list over every ref
  // exits 0 and prints nothing. A ref git cannot read (a branch pointing at a missing object)
  // makes rev-list fail, and that is not "no commit": it cannot be checked. Any other base that
  // is not a commit is a mistake (a typo in --base) and cannot be checked either.
  let unborn = false;
  if (!baseSha) {
    const all = git(gitRoot, ['rev-list', '-n', '1', '--all'], { allowFail: true });
    unborn = !all.error && all.status === 0 && !all.stdout.trim();
    if (!unborn) {
      const why = !all.error && all.status === 0 ? '' : ` (and git cannot list the repository's commits: ${(all.error?.message ?? all.stderr ?? '').trim().split('\n')[0]})`;
      throw new CannotCheck(`base ${baseName} is not a commit${why}`);
    }
  }

  const tasks = readTasks(mainRoot);
  let asking = null;
  if (task) {
    // Whatever checkout this runs in, the task is the main checkout's copy (B-6).
    const name = task.endsWith('.md') ? basename(task) : null;
    const file = name ? join(mainRoot, 'tasks', name) : resolveTaskFile(task, mainRoot);
    asking = tasks.find((t) => file && resolve(t.file) === resolve(file)) ?? null;
    if (!asking) throw new CannotCheck(`no task file for ${task} in ${join(mainRoot, 'tasks')}`);
  }

  const inBase = (sha) => Boolean(baseSha) && /^[0-9a-f]{7,40}$/i.test(sha ?? '') && git(gitRoot, ['merge-base', '--is-ancestor', sha, baseSha], { allowFail: true }).status === 0;
  const live = new Map(listed.filter((w, i) => i > 0 && !w.gone && w.branch).map((w) => [w.branch, w.path]));
  const claims = [];
  const notes = [];
  const leftover = [];
  const ownFlying = new Set(inFlight);
  const withBranch = new Set();
  const claim = (owner, file, how) => {
    if (isStateFile(file)) return;
    if (!claims.some((c) => c.task === owner.task && c.unit === owner.unit && c.branch === owner.branch && c.file === file && c.how === how)) claims.push({ ...owner, file, how });
  };

  if (unborn) notes.push(`the repository has no commit yet, so there is no base (${baseName}) to compare against and no branch has commits: only uncommitted work in a live worktree on an ai/ branch counts`);
  for (const w of listed) if (w.gone) notes.push(`the worktree registered at ${w.path} (${w.branch ?? 'detached HEAD'}) has no folder any more, so it is skipped; run git worktree prune`);
  // A live worktree on any other branch, or on a detached HEAD, holds work no task claims.
  for (const w of unborn ? [] : listed.slice(1)) {
    if (w.gone || (w.branch && w.branch.startsWith('ai/'))) continue;
    const dirty = dirtyPaths(w.path);
    const head = git(w.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true }).stdout.trim();
    const ahead = head ? git(gitRoot, ['rev-list', '--count', `${baseSha}..${head}`]).stdout.trim() !== '0' : false;
    if (dirty.length || ahead) notes.push(`the worktree at ${w.path} (${w.branch ?? 'detached HEAD'}) is not on an ai/ branch and has ${[dirty.length ? `uncommitted files: ${dirty.join(', ')}` : '', ahead ? 'commits the base does not have' : ''].filter(Boolean).join(' and ')}; no task has it, so nothing here waits for it — find out whose it is`);
  }

  // With no commit, no ai/ branch exists as a ref yet; the live worktrees on one are the branches.
  const aiBranches = unborn
    ? [...live.keys()].filter((b) => b.startsWith('ai/')).sort()
    : git(gitRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/ai/']).stdout.split('\n').filter(Boolean);
  for (const branch of aiBranches) {
    const { task: t, unit, backup } = branchOwner(branch, tasks);
    if (backup) continue;
    const ahead = !unborn && git(gitRoot, ['rev-list', '--count', `${baseSha}..refs/heads/${branch}`]).stdout.trim() !== '0';
    const wt = live.get(branch) ?? null;
    if (!ahead && !wt) continue;
    if (!t) { notes.push(`${branch} belongs to no task, so it has nothing and makes nobody wait; find out whose it is`); continue; }
    // A closed task has nothing. Its branch can still look ahead of the base when it landed
    // by squash, rebase or cherry-pick, which change every SHA: that branch is left over.
    if (CLOSED.test(t.status ?? '')) {
      // Offered for deletion only when nothing on it is missing from the base: every file the
      // branch changed reads the same at its tip as at the base, and its worktree is clean.
      const fork = ahead ? git(gitRoot, ['merge-base', baseSha, `refs/heads/${branch}`]).stdout.trim() : null;
      const files = ahead ? changedFiles(gitRoot, fork, `refs/heads/${branch}`) : [];
      const differs = files.length ? git(gitRoot, ['diff', '--quiet', baseSha, `refs/heads/${branch}`, '--', ...files], { allowFail: true }).status !== 0 : false;
      const dirty = wt ? dirtyPaths(wt) : [];
      leftover.push({ branch, task: t.id, status: t.status, worktree: wt, integrated: !differs && !dirty.length, unintegrated: [...(differs ? files : []), ...dirty] });
      continue;
    }
    if (t === asking) {
      // Its own units are kept apart by planDispatch; one with work counts as in flight (R-12).
      const own = unit ? t.parsed?.units.find((x) => x.id === unit) : null;
      if (own && !own.done) ownFlying.add(unit);
      // Checked off, but its work is not in the base: a later unit of this task on the same
      // file is not kept apart from it. Noted, as for another task (R-4); not blocked.
      if (own?.done && !inBase(own.commit) && (ahead || (wt && dirtyPaths(wt).length))) notes.push(`${branch} has work, but ${unit} of ${t.id} itself is checked off ${own.commit ? `with a commit: (${own.commit.slice(0, 12)}) that is not in the base` : 'with no commit:'}; its files are not kept apart from this task's other units — find out whether it really integrated`);
      if (!unit) notes.push(`${branch} is a branch of ${t.id} itself, not of one of its units; nothing here keeps its files apart from this task's units — find out what it holds`);
      else if (!own) notes.push(`${branch} has work, but ${unit} is not a unit of ${t.id} (renumbered or removed?); nothing here keeps its files apart from this task's units — find out what it holds`);
      continue;
    }
    if (t.parsed?.malformed.length) throw new CannotCheck(`${t.file} has ${t.parsed.malformed.length} line(s) in "## Done when" that could not be read as units (line ${t.parsed.malformed.map((m) => m.line).join(', ')}), and ${branch} has work in flight; run task-units.mjs on it and fix them`);
    const u = unit ? t.parsed?.units.find((x) => x.id === unit) ?? null : null;
    if (u?.done) {
      // Checked off with its commit: in the base, it landed: nothing is left to have.
      if (inBase(u.commit)) continue;
      // Work it has is commits the base lacks or uncommitted files in its live worktree (R-4).
      if (!ahead && !(wt && dirtyPaths(wt).length)) continue;
      notes.push(`${branch} has work, but ${t.short} ${unit} is checked off ${u.commit ? `with a commit: (${u.commit.slice(0, 12)}) that is not in the base` : 'with no commit:'}; it keeps its files until that is sorted out`);
    }
    withBranch.add(t.id);
    const owner = { task: t.id, short: t.short, unit, branch, idle: Boolean(unit) && !ahead };
    if (unit && !u) notes.push(`${branch} has work, but ${unit} is not a unit of ${t.id} (renumbered or removed?); its branch's files are counted, what it declared is unknown`);
    if (!unit && t.status !== 'waiting on owner') notes.push(`${branch} has work as a held task, but ${t.id} is "${t.status}", not "waiting on owner"; it has its files all the same`);
    if (u) {
      if (touchesProblems(u, mainRoot).length) throw new CannotCheck(`${t.short} ${unit} is in flight with no valid touches:, so nobody can say which files it has; fill it in ${t.file}`);
      for (const f of u.touches) claim(owner, f, 'declared');
    }
    if (ahead) {
      const fork = git(gitRoot, ['merge-base', baseSha, `refs/heads/${branch}`]).stdout.trim();
      for (const f of inProject(changedFiles(gitRoot, fork, `refs/heads/${branch}`))) claim(owner, f, 'branch');
    }
    if (wt) for (const f of inProject(dirtyPaths(wt))) claim(owner, f, 'worktree');
  }

  for (const t of tasks) {
    if (t === asking || withBranch.has(t.id) || t.status !== 'in progress') continue;
    if (t.parsed?.units.some((u) => !u.done)) notes.push(`${t.id} is in progress with no ai/ branch: a single writer building it in the main checkout has files nothing here can see`);
  }
  return { mainRoot, base: baseName, baseSha, task: asking?.id ?? null, asking, inFlight: [...ownFlying], claims, leftover, notes };
}

/**
 * Rewrites one field of one unit in a task's text: the field's lines (continuations included)
 * become one line, or go away when `value` is null; a field the unit lacks is added after
 * its last field.
 */
export function rewriteField(text, unit, key, value) {
  const lines = text.split('\n');
  const cr = text.includes('\r\n') ? '\r' : '';
  const indentOf = (i) => lines[i].match(/^(\s*)/)[1];
  const at = unit.fieldAt[key];
  if (at) {
    lines.splice(at.start, at.end - at.start + 1, ...(value === null ? [] : [`${indentOf(at.start)}- ${key}: ${value}${cr}`]));
  } else if (value !== null) {
    const any = Object.values(unit.fieldAt)[0];
    lines.splice(unit.end + 1, 0, `${any ? indentOf(any.start) : '  '}- ${key}: ${value}${cr}`);
  }
  return lines.join('\n');
}


function resolveTaskFile(arg, root) {
  if (arg.endsWith('.md')) return isAbsolute(arg) ? arg : join(root, arg);
  const dir = join(root, 'tasks');
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f === `${arg}.md` || f.startsWith(`${arg}-`));
  return hit ? join(dir, hit) : null;
}

function idList(value) {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

const USAGE = 'usage: task-units.mjs <task-id | tasks/<file>.md> [--root <path>] [--plan [--base <ref>]] [--done U1,U2] [--in-flight U3] [--json]';

// The options of the queue for a file, removed with it. Named, not "unknown": a session that
// still follows an old skill learns what replaced them instead of guessing at a typo.
const GONE = ['--holds', '--enqueue', '--take', '--dequeue', '--file', '--at'];
const GONE_WHY = 'the queue for a file between tasks was removed. What other tasks have is read by --plan: a unit whose files another task has waits there, named, until that unit integrates, and the first to be dispatched wins';

/** A `queued for:` left in a task from when the queue existed: reported, never refused. */
function warningsOf(units) {
  return units.filter((u) => u.queuedFor !== null).map((u) => ({ unit: u.id, reason: 'queued for: is a field nothing reads any more (the queue for a file was removed); delete the line' }));
}

/** What other tasks have, and what was noticed on the way: printed under the plan. */
function printOthers(seen) {
  const against = seen.baseSha ? `against ${seen.base} (${seen.baseSha.slice(0, 7)})` : `with no base (the repository has no commit yet)`;
  console.log(`\n  Other tasks, ${against}:${seen.claims.length ? '' : ' none has a file.'}`);
  const groups = new Map();
  for (const c of seen.claims) {
    const k = holderName(c);
    if (!groups.has(k)) groups.set(k, { declared: [], branch: [], worktree: [] });
    const g = groups.get(k)[c.how];
    if (!g.includes(c.file)) g.push(c.file);
  }
  for (const [k, g] of groups) {
    console.log(`    ${k}`);
    if (g.declared.length) console.log(`        declared: ${g.declared.join(', ')}`);
    if (g.branch.length) console.log(`        its branch wrote: ${g.branch.join(', ')}`);
    if (g.worktree.length) console.log(`        uncommitted in its worktree: ${g.worktree.join(', ')}`);
  }
  for (const l of seen.leftover) {
    if (l.integrated) console.log(`  · ${l.branch} is left over: ${l.task} is "${l.status}", so it has nothing, and every file it changed already reads the same in the base. Delete it: git branch -D ${l.branch}${l.worktree ? `, after git worktree remove ${l.worktree}` : ''}`);
    else console.log(`  · ${l.branch} belongs to ${l.task}, which is "${l.status}", so it has nothing and makes nobody wait, but it has work that is not in the base: ${l.unintegrated.join(', ')}. Do not delete it: find out whether that work should land, or whether ${l.task} was closed by mistake`);
  }
  for (const n of seen.notes) console.log(`  · ${n}`);
}

function main(argv) {
  const opts = { root: process.cwd(), plan: false, json: false, done: [], inFlight: [], task: null, base: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (GONE.includes(a)) { console.error(`✗ ${a} no longer exists: ${GONE_WHY}.`); return 2; }
    if (a === '--root' || a === '--base') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) { console.error(`✗ ${a} needs a value`); return 2; }
      if (a === '--root') opts.root = resolve(v); else opts.base = v;
    }
    else if (a === '--plan') opts.plan = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--done') opts.done = idList(argv[++i] ?? '');
    else if (a === '--in-flight') opts.inFlight = idList(argv[++i] ?? '');
    else if (a.startsWith('--')) { console.error(`✗ unknown option ${a}`); return 2; }
    else opts.task = a;
  }
  if (!opts.task) { console.error(`✗ ${USAGE}`); return 2; }
  if (opts.base && !opts.plan) { console.error('✗ --base goes with --plan'); return 2; }

  // With --plan, what other tasks have comes first: it is read from git and from tasks/ of
  // the main checkout, and the task planned is that checkout's copy, wherever this runs.
  let holds = null;
  if (opts.plan) {
    try { holds = collectHolds({ root: opts.root, base: opts.base, task: opts.task, inFlight: opts.inFlight }); }
    catch (e) {
      if (!(e instanceof CannotCheck)) throw e;
      if (opts.json) console.log(JSON.stringify({ file: null, cannotCheck: e.message, plan: null }, null, 2));
      console.error(`✗ Could not check what other tasks have, so nothing is dispatched: ${e.message}`);
      return 2;
    }
    opts.root = holds.mainRoot;
  }
  const file = holds ? holds.asking.file : resolveTaskFile(opts.task, opts.root);
  if (!file || !existsSync(file)) { console.error(`✗ no task file for ${opts.task}`); return 2; }
  const parsed = holds ? holds.asking.parsed : parseUnits(readFileSync(file, 'utf8'));
  if (parsed === null) { console.error(`✗ ${file} has no "## Done when" section`); return 2; }
  const { units, malformed, legacy } = parsed;
  if (units.length === 0 && malformed.length === 0 && legacy.length === 0) { console.error(`✗ ${file} lists no units in "## Done when"`); return 2; }
  if (units.length === 0 && malformed.length === 0) {
    if (opts.json) console.log(JSON.stringify({ file, units: [], malformed: [], legacy, plan: opts.plan ? planDispatch(parsed) : null }, null, 2));
    else console.log(`\n  ${opts.task} was written before units existed (${legacy.length} checkbox(es), no **U<n>**).\n  Nothing of it is built or dispatched: scope writes its units first, each with its touches:.\n`);
    return 3;
  }

  // A closed unit is not checked: it was built before the field existed, or already landed.
  const report = units.map((u) => ({ ...u, problems: u.done ? [] : [
    ...touchesProblems(u, opts.root),
    ...(u.dependsRaw === undefined ? [{ entry: null, reason: 'depends on: missing' }] : []),
  ] }));
  const warnings = warningsOf(units);
  const others = holds ? holds.claims.filter((c) => c.task !== holds.task) : [];
  const plan = opts.plan ? planDispatch(parsed, { done: opts.done, inFlight: [...opts.inFlight, ...holds.inFlight.filter((id) => !opts.inFlight.includes(id) && !opts.done.includes(id))], root: opts.root, held: others }) : null;
  const seen = holds ? { base: holds.base, baseSha: holds.baseSha, claims: others, leftover: holds.leftover, notes: holds.notes } : null;
  const isMissingTouches = (p) => p.reason === 'missing';
  const bad = report.filter((u) => u.problems.some((p) => !isMissingTouches(p)));
  const missing = report.filter((u) => u.problems.some(isMissingTouches));
  const failed = bad.length > 0 || malformed.length > 0 || Boolean(plan?.refused);

  if (opts.json) {
    console.log(JSON.stringify({ file, units: report, malformed, warnings, plan, otherTasks: seen }, null, 2));
  } else {
    console.log(`\n  Units of ${opts.task}   (${units.length})\n`);
    for (const m of malformed) console.log(`  ✗ line ${m.line}: ${m.reason}\n      ${m.text}`);
    for (const u of report) {
      const mark = u.done ? 'x' : ' ';
      if (u.done) console.log(`  [${mark}] ${u.id} — closed${u.replaced ? ' (replaced)' : ''}`);
      else if (!u.problems.length) console.log(`  [${mark}] ${u.id} — touches ${u.touches.length} file(s)`);
      for (const p of u.problems) {
        if (isMissingTouches(p)) console.log(`  [${mark}] ${u.id} — touches: missing; not built or dispatched; it goes back to scope, which writes its touches:`);
        else if (p.entry === null) console.log(`  [${mark}] ${u.id} — ✗ ${p.reason}`);
        else console.log(`  [${mark}] ${u.id} — ✗ touches: "${p.entry}" is ${p.reason}`);
      }
    }
    for (const w of warnings) console.log(`  · ${w.unit} — ${w.reason}`);
    if (plan?.refused) {
      console.log(`\n  ✗ No plan: ${plan.refused}.`);
    } else if (plan) {
      console.log('');
      if (plan.inFlight.length) console.log(`  In flight, files taken: ${plan.inFlight.join(', ')}`);
      console.log(`  Can be dispatched together now: ${plan.together.length ? plan.together.join(', ') : 'none'}`);
      for (const s of plan.serial) console.log(report.some((u) => u.id === s.id && u.problems.length) ? `  Not built or dispatched: ${s.id} — ${s.reason}` : `  Then one at a time, each once the group before it lands: ${s.id} — ${s.reason}`);
      for (const w of plan.waiting) console.log(`  Waiting: ${w.id} — ${w.reason}`);
    }
    if (seen) printOthers(seen);
    console.log('');
    if (malformed.length) console.log(`✗ ${malformed.length} line(s) could not be read as units; fix them before planning.`);
    if (bad.length) console.log(`✗ ${bad.length} pending unit(s) with an invalid field.`);
    if (!failed && missing.length) console.log(`· ${missing.length} pending unit(s) still without touches:. Each is not built or dispatched; it goes back to scope, which writes its touches:. The task's other units go on.`);
    if (!failed && !missing.length) console.log('✓ Every pending unit declares the files it writes.');
  }
  if (failed) return 1;
  return missing.length ? 3 : 0;
}

// Compared as real paths: run through a symlink (macOS's /var is one), the two spellings
// differ, and a plain comparison would skip main() and exit 0 — a pass nobody checked.
// An argv[1] that is not a file (`node -e "import(...)" foo`) means this was imported.
function isMain() {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  // An error nobody foresaw is "could not check" (2), never a verdict: 1 means refused.
  let code;
  try { code = main(process.argv.slice(2)); }
  catch (e) { console.error(`✗ Could not check: unexpected error: ${e?.message ?? e}`); code = 2; }
  process.exit(code);
}
