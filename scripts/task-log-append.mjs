#!/usr/bin/env node
/**
 * task-log-append.mjs — adds one entry to a task's task log.
 *
 * ── What it is ───────────────────────────────────────────────────────────────────────
 * The convenient door into `logs/tasks/<task-id>.md`. It validates the entry against the
 * ontology BEFORE writing anything, assigns the identifier without reading the file, and
 * creates the task log on the first entry so nothing has to be set up first.
 *
 * It is not the only door. An entry typed in an editor that meets the format is valid, and
 * `check-task-log.mjs` judges the shape, not the provenance. If only this script could
 * produce a valid entry, every manual correction would break the commit and people would
 * learn to skip the hook.
 *
 * ── Why it never reads the file ──────────────────────────────────────────────────────
 * Reading in order to write is what creates a race. A counter has to be read; a timestamp
 * plus four random characters does not, so two subagents appending in the same second get
 * different ids and appending costs the same at five hundred entries as at none. The
 * consequence, taken deliberately: a task log somebody left malformed yesterday does not
 * stop today's entry from being recorded. Reporting that damage is the verifier's job, at
 * commit time — writing and verifying are separate moments, and a write that fails
 * because of something that happened before loses the record of what is happening now.
 *
 * ── The two reads: the review-round cap and the fix of a flag ────────────────────────
 * Two rules are the exception, and both read this task log inside the lock, so two
 * entries written at once are judged one after the other:
 *
 * - A `review-round` with `unit:` (T147). The script refuses a round past the cap: two
 *   rounds of the unit, the last with blocking findings, and no owner's `decision` with that
 *   `unit:` written after it (the rule is `roundCap` in task-log.mjs).
 * - A `fix` (T026 U4). The script refuses the fix of a flag that came out of a unit's round
 *   unless its `commit:` was reviewed by a round of another unit written after the flag, and
 *   by none of the flag's own unit: a flag is fixed in a new unit, not by reopening its own
 *   (the rule is `flagFixProblem` in task-log.mjs). When the flag's round left blocking
 *   findings, the commit the next round of that same unit reviewed holds too (y1eo); and a
 *   `finding` that gives a flag `destination: fix` is refused unless that is the case
 *   (`flagDestinationProblem`).
 *
 * The principle above still holds where it matters: a damaged entry does not stop either
 * rule, which reads around it, and a file that cannot be read at all lets the entry through
 * with a warning — neither rule may ever cost a record.
 *
 * Usage:
 *   task-log-append.mjs <task-id> <type> --body "text"  [--<field> <value> ...] [--root <path>]
 *   task-log-append.mjs <task-id> review-round --by … --result … --unit U2 --commit <sha> --blocking 0 …
 *   task-log-append.mjs <task-id> fix --resolves <finding-id> --commit <sha> …
 *   ... | task-log-append.mjs <task-id> <type>            # the body via stdin
 *
 * Exit codes:
 *   0 — written; the new entry's id is printed on stdout
 *   1 — rejected; nothing was written, and the reason says what to change — including a
 *       review round past the cap, which waits for the owner's decision, and the fix of a
 *       flag inside the unit it came from
 *   2 — this project has no tasks/ at all; nothing to attach a task log to
 */

import { existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, statSync, fstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const B = await import(join(HERE, 'task-log.mjs'));
// The one rule for a task's short id is check-commit-task.mjs's taskIdOf (T104, TT-12); a
// project that excluded it keeps the same rule, copied, as integrate-unit.mjs does. The cap
// needs it because `<short>#<id>` in a replaces: points inside this same log.
let commitTask = null;
// Any failure to load it — missing, or a broken or adjusted copy that throws — falls back to
// the copy: no entry of any type may fail to be written because of it (T147).
try { commitTask = await import(join(HERE, 'check-commit-task.mjs')); }
catch { commitTask = null; }
const taskIdOf = (typeof commitTask?.taskIdOf === 'function' ? commitTask.taskIdOf : null)
  ?? ((name) => { const base = name.replace(/^.*\//, '').replace(/\.md$/, ''); return base.match(/^([A-Za-z]+[-_.]?\d+)(?=$|[-_.])/)?.[1] ?? base; });

// ── Arguments ────────────────────────────────────────────────────────────────────────
// Any `--name value` that is not one of the two script options becomes a FIELD. That is
// deliberate: `--invented x` has to reach the validator so it can be rejected by name,
// with the list of fields the type accepts. Swallowing it here would turn an unknown
// field into a silently dropped one, which is how a type erodes.
const argv = process.argv.slice(2);
const positional = [];
const fields = {};
let root = process.cwd();
let body = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const name = a.slice(2);
  if (!name) die('An empty option "--" names nothing.');
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) die(`"--${name}" has no value.`);
  i++;
  if (name === 'root') { root = value; continue; }
  if (name === 'body') { body = value; continue; }
  if (name === 'body-file') {
    try { body = readFileSync(value, 'utf8'); }
    catch { die(`Could not read the body from "${value}".`); }
    continue;
  }
  if (name in fields) die(`"--${name}" appears twice. With two values, which one wins depends on the order, and that cannot be read in the file.`);
  fields[name] = value;
}

function die(msg, extra) {
  console.error(`✗ ${msg}`);
  if (extra) console.error(`  ${extra}`);
  process.exit(1);
}

const [taskId, type] = positional;
if (!taskId || !type) {
  console.error('✗ Missing arguments.');
  console.error('  task-log-append.mjs <task-id> <type> --body "text" [--<field> <value> ...]');
  console.error(`  The seven types: ${B.TYPE_NAMES.join(', ')}`);
  process.exit(1);
}

// ── The task has to exist ────────────────────────────────────────────────────────────
// Two defects at once. A task log attached to a task that does not exist is a file nobody
// ever opens; and the id becomes a filename, so `../../something` would write outside
// `logs/tasks/` entirely. Both are caught here, before a single byte moves.
if (!B.validTaskId(taskId)) {
  die(`"${taskId}" is not shaped like a task id.`,
      'An id looks like T067-ontologia-de-la-bitacora: letters, digits, hyphens and dots, no slashes and no "..".\n' +
      '  The id becomes the filename, so a slash would write outside logs/tasks/.');
}
const tasksDir = join(root, 'tasks');
if (!existsSync(tasksDir)) {
  console.error('✗ This project has no tasks/, so there is nothing to attach a task log to.');
  process.exit(2);
}
if (!existsSync(join(tasksDir, `${taskId}.md`))) {
  die(`tasks/${taskId}.md does not exist.`,
      'Either the id is mistyped, or the task has not been opened yet. An orphaned task log is one nobody opens.');
}

// ── The body ─────────────────────────────────────────────────────────────────────────
if (body === null && !process.stdin.isTTY) {
  try { body = readFileSync(0, 'utf8'); } catch { body = null; }
}
if (body === null) {
  die('The entry body is missing.', 'Pass it with --body "text", with --body-file <path>, or via stdin.');
}

// ── Validate before writing ──────────────────────────────────────────────────────────
// C-6 lives here and nowhere else: an entry that links to itself is the one invalid link
// that can be caught at write time, because the id is in hand and no other entry has to
// be read. Everything else about links needs the whole file and belongs to the verifier.
// `AE_TASK_LOG_ID` pins the identifier. It exists ONLY so the kit's own suites can
// exercise a case that is otherwise unreachable from outside — a self-link, which needs
// the id in hand before the call — and so they can build a task log with two identical
// ids on purpose. Same precedent as `install.sh --from`. In real use nothing sets it, and
// a malformed value is refused rather than quietly ignored: a pinned id that silently
// falls back to a fresh one would make a suite pass while testing nothing.
let id;
if (process.env.AE_TASK_LOG_ID) {
  id = process.env.AE_TASK_LOG_ID;
  if (!B.ID_RE.test(id)) die(`AE_TASK_LOG_ID="${id}" is not shaped like an identifier.`);
} else {
  id = B.newId();
}
for (const name of ['resolves', 'replaces']) {
  if (fields[name] && fields[name].trim() === id) {
    die(`The entry would link to itself in "${name}:".`,
        'An entry neither resolves nor replaces itself. Remove the link, or point at the entry that actually closes.');
  }
}

// The id goes in so validateEntry can refuse an induced-by: that points at this same entry.
const problems = B.validateEntry({ id, type, fields, body }, '');
// A finding's severity is blocking or flag — checked here and not in validateEntry, so the
// verifier keeps reading the old findings written with other words (T026 U2).
const severity = B.severityWriteProblem({ type, fields });
if (severity) problems.push(severity);
// R-12: a round's unit: names a unit of the task. task-units.mjs reads "## Done when"; without
// it (a project that excluded it) the name's shape is still checked above.
let parseUnits = null;
try { ({ parseUnits } = await import(join(HERE, 'task-units.mjs'))); } catch { /* not installed */ }
const unknown = B.unknownUnitProblem({ type, fields }, readFileSync(join(tasksDir, `${taskId}.md`), 'utf8'), parseUnits);
if (unknown) problems.push(unknown);
if (problems.length) {
  console.error(`✗ The entry was not written — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error('\n  Nothing was written. Correct it and try again.');
  process.exit(1);
}

const text = B.renderEntry({ id, type, fields, body });

// ── Write ────────────────────────────────────────────────────────────────────────────
const path = B.taskLogPath(root, taskId);
mkdirSync(dirname(path), { recursive: true });

// The first entry creates the file, and its header is written INSIDE the lock below, only
// when the file is still empty. Creating it outside the lock was a real race, found by CI:
// the creator opened the file, another process took the lock and appended its entry, and
// then the creator wrote the header at offset 0 — over that entry. The overwritten process
// had already printed its ✓, so the loss was silent. Checking the size under the lock needs
// no read of the content: an empty file is the only one without a header.
let created = false;

// Thrown inside the lock so its `finally` releases it: process.exit there would leave the
// .lock file behind, and every append for the next 30 seconds would wait on a dead writer.
class CapRefusal extends Error {}
class FixRefusal extends Error {}
let capNotice = null;

/** This task log's text, for one of the rules: '' when there is none yet, null when it cannot be read. */
function readOwnLog(warn) {
  try { return readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return ''; // no task log yet: judged against an empty one
    warn(e.code ?? e.message);
    return null;
  }
}

/** The cap check, run under the lock. Returns nothing; throws CapRefusal to refuse. */
function checkCap() {
  if (type !== 'review-round' || !fields.unit) return;
  const text = readOwnLog((why) => {
    console.error(`⚠ Could not read ${path} to count the review rounds of ${fields.unit} (${why}).`);
    console.error('  The round is written anyway: the cap must never cost a record. Check the rounds by hand.');
  });
  if (text === null) return;
  const short = taskIdOf(taskId);
  const cap = B.roundCap(B.parseTaskLog(text).entries, { id, type, fields }, [taskId, short]);
  if (!cap) return;
  if (cap.refuse) {
    throw new CapRefusal(
      `${fields.unit} already has ${cap.count} review rounds, and the last (${cap.last.id}) left blocking findings.\n` +
      `  At most two rounds per unit: another round past the second is the project owner's call — a class A decision, not the session's.\n` +
      `  The owner accepts the risk, re-scopes the unit (a new unit takes a new number), or opens one more round.\n` +
      `  To open one more, the owner's decision goes in first, and it opens exactly one round:\n` +
      `    task-log-append.mjs ${taskId} decision --by <owner> --unit ${fields.unit} --body "…"`);
  }
  // A correction warns too: correcting the second round from 0 blocking to 2 puts the unit
  // at the cap just as a new round would.
  if (cap.atCap) {
    capNotice = `${fields.unit} now has ${cap.now} review rounds and the last left blocking findings: ` +
      `do not dispatch another reviewer. The next round of ${fields.unit} needs the owner's decision first (class A).`;
  }
}

/** The fix of a flag, run under the lock. Returns nothing; throws FixRefusal to refuse. */
function checkFlagFix() {
  if (type !== 'fix') return;
  const text = readOwnLog((why) => {
    console.error(`⚠ Could not read ${path} to check whether ${fields.resolves} is a flag fixed inside its own unit (${why}).`);
    console.error('  The fix is written anyway: the rule must never cost a record. Check by hand that its commit was reviewed as another unit.');
  });
  if (text === null) return;
  const problem = B.flagFixProblem(B.parseTaskLog(text).entries, { id, type, fields });
  if (problem) throw new FixRefusal(problem);
}

/** A flag's destination: fix, run under the lock. Throws FixRefusal to refuse. */
function checkFlagDestination() {
  if (type !== 'finding' || String(fields.destination ?? '').trim().toLowerCase() !== 'fix') return;
  const text = readOwnLog((why) => {
    console.error(`⚠ Could not read ${path} to check whether the round of this flag left blocking findings (${why}).`);
    console.error('  The finding is written anyway: the rule must never cost a record. Check by hand that "destination: fix" holds.');
  });
  if (text === null) return;
  const problem = B.flagDestinationProblem(B.parseTaskLog(text).entries, { id, type, fields });
  if (problem) throw new FixRefusal(problem);
}

/**
 * A lock around the append.
 *
 * O_APPEND alone gets a single small write right, but "single" and "small" are properties
 * of this entry, not of the format — and with subagents appending in parallel, a half
 * written entry is silent corruption of the only record of what happened. The lock is a
 * create-exclusive file, which is atomic on every filesystem the kit runs on.
 *
 * A lock left behind by a process that died is stolen after 30 seconds. Without that, one
 * crash would block every future append to that task and the fix would be a file nobody
 * knows to delete.
 */
function withLock(target, fn) {
  const lock = `${target}.lock`;
  const giveUpAt = Date.now() + 15000;
  const nap = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best effort */ } };
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; } // vanished: retry at once
      if (age > 30000) { try { unlinkSync(lock); } catch { /* someone else got there */ } continue; }
      if (Date.now() > giveUpAt) throw new Error(`another process has been writing to ${target} for 15s`);
      nap(3 + Math.floor(Math.random() * 12));
      continue;
    }
    closeSync(fd);
    try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
  }
}

try {
  withLock(path, () => {
    checkCap();
    checkFlagFix();
    checkFlagDestination();
    const fd = openSync(path, 'a');
    try {
      if (fstatSync(fd).size === 0) created = true;
      const buf = Buffer.from((created ? B.fileHeader(taskId) : '') + text, 'utf8');
      let off = 0;
      while (off < buf.length) off += writeSync(fd, buf, off);
    } finally { closeSync(fd); }
  });
} catch (e) {
  if (e instanceof CapRefusal) die(`The round was not written. ${e.message}`);
  if (e instanceof FixRefusal) die(`The ${type} was not written: ${e.message}`);
  die(`Could not write to ${path}: ${e.message}`);
}

console.log(id);
if (created) console.error(`  · created logs/tasks/${taskId}.md with its header`);
console.error(`✓ "${type}" entry added to logs/tasks/${taskId}.md`);
if (capNotice) console.error(`⚠ ${capNotice}`);
