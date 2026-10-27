#!/usr/bin/env node
/**
 * check-task-log.mjs — the task logs are well-formed and their links resolve.
 *
 * ── What it reports ──────────────────────────────────────────────────────────────────
 * Two entries with the same identifier; a link to an entry that does not exist; two
 * entries closing the same one; an entry closing something already closed; a loop; and
 * anything out of shape or over the size cap. Each with the file, the line and what to do.
 *
 * ── Why it judges the shape and not the provenance ───────────────────────────────────
 * An entry typed into an editor that meets the format passes here, and one written by
 * `task-log-append.mjs` that was later broken by hand does not. `task-log-append.mjs` is
 * the convenient door, not the only one: if only the script could produce a valid entry,
 * every manual correction would break a commit and people would learn to skip the hook.
 *
 * ── What it deliberately does NOT report ─────────────────────────────────────────────
 * That an old entry was edited, or that entries were deleted. Nothing here can see it —
 * the file has no history of its own. `ae-kit-templates/task-log-ontology.md` says so in
 * writing rather than implying a protection that does not exist, and the decision about
 * whether to build one is a pending.
 *
 * Exit codes:
 *   0 — every task log is well-formed and every link resolves
 *   1 — something is wrong; each problem is named with what to do about it
 *   2 — this project has no logs/tasks/; it does not keep task logs, and that is fine
 *   3 — advisory: the task log's own module is not installed here, so only the checks
 *       that need no format knowledge ran. NOT a failure — a project declares the piece
 *       in `.ae-kit-excluded` and the rest of the kit has to survive that.
 *
 * Usage: node check-task-log.mjs [root] [--verbose]
 *
 * ── Why a green run prints one line ──────────────────────────────────────────────────
 * It runs on every commit, and every session reads its output. The per-log inventory —
 * one line per task log with its entries and how many are open — grew with every task and
 * said nothing anyone acted on (T189). A green run prints the summary line, plus any
 * warning with content (a renumbered unit, a file that could not be read); `--verbose`
 * brings the inventory back. A failure prints its full detail, as it always did.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const root = args.find((a) => !a.startsWith('--')) ?? process.cwd();
const dir = join(root, 'logs', 'tasks');

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.log('  · This project does not keep task logs (there is no logs/tasks/). Nothing to check.');
  process.exit(2);
}

// F-5: the module can be absent — a project declares `scripts/task-log.mjs` in
// `.ae-kit-excluded`, or is running a kit older than this check. Dying here with a stack
// trace is how a person learns to commit with --no-verify, and it already happened once
// in this kit with the pendings reader.
let B;
try {
  B = await import(join(dirname(fileURLToPath(import.meta.url)), 'task-log.mjs'));
} catch {
  console.log('  Task logs\n');
  console.log('  · The half that reads the format (scripts/task-log.mjs) is not installed here.');
  console.log('  · What does not need it was checked: that every logs/tasks/<id>.md has a task.');
  const orphans = [];
  for (const f of readdirSync(dir)) {
    if (f === 'current') continue; // the folder the generated views live in
    if (!f.endsWith('.md') || f.endsWith('.current.md')) continue;
    const id = f.slice(0, -3);
    if (!existsSync(join(root, 'tasks', `${id}.md`))) orphans.push(f);
  }
  for (const f of orphans) console.log(`  · logs/tasks/${f} has no task in tasks/`);
  console.log('\n  Not a failure. Install the full kit, or remove the declaration from .ae-kit-excluded.');
  process.exit(3);
}

// R-12: a review round's unit: must name a unit of its task; task-units.mjs reads them.
let parseUnits = null;
try { ({ parseUnits } = await import(join(dirname(fileURLToPath(import.meta.url)), 'task-units.mjs'))); } catch { /* not installed */ }

const problems = [];
const notes = [];
const inventory = []; // one line per task log; printed only with --verbose
const warnings = [];
const err = (what, fix) => problems.push({ what, fix });

// ── Which files are task logs ────────────────────────────────────────────────────────
const NOISE = /^(\.DS_Store|Thumbs\.db|\.gitkeep|\.keep|desktop\.ini)$/i;
const files = [];
for (const name of readdirSync(dir)) {
  if (NOISE.test(name)) continue;
  if (name.endsWith('.lock')) continue; // a live append; it disappears on its own
  // The generated views have their own check, and they live in `current/` since 0.36.0.
  // The old `<id>.current.md` form is skipped forever, not just while projects migrate: it
  // is the generator that retires those files, and reading one here as the task log of a
  // task called `<id>.current` would report an orphan nobody can fix.
  if (name === 'current') continue;
  if (name.endsWith('.current.md')) continue;
  if (!name.endsWith('.md')) {
    err(`logs/tasks/${name} is not a task log`,
        'logs/tasks/ holds <task-id>.md, and its view goes in logs/tasks/current/. Anything else goes in docs/.');
    continue;
  }
  files.push(name);
}

// Every task log read once, so a cross-task link can be checked without re-reading.
const parsed = new Map(); // taskId -> { entries, ids:Set }
for (const name of files) {
  const taskId = name.slice(0, -3);
  let text;
  try { text = readFileSync(join(dir, name), 'utf8'); }
  catch { notes.push(`could not read logs/tasks/${name}, skipped`); continue; }
  const { entries, problems: own } = B.parseTaskLog(text);
  parsed.set(taskId, { entries, own, ids: new Set(entries.map((e) => e.id)) });
}

let entryCount = 0;

for (const [taskId, { entries, own, ids }] of parsed) {
  const where = `logs/tasks/${taskId}.md`;
  entryCount += entries.length;

  // A-5, seen from the other side: a task log whose task does not exist is a file nobody
  // will ever open, and the cheapest moment to notice is the commit that created it.
  if (!existsSync(join(root, 'tasks', `${taskId}.md`))) {
    err(`${where} has no task: tasks/${taskId}.md is missing`,
        'Either the task was renamed and the task log was not, or the id was mistyped. Rename the task log, or open the task.');
  }

  for (const p of own) {
    err(`${where}:${p.line} — ${p.what}`, p.fix ?? 'Fix it by hand; the entry stays, only its shape is corrected.');
  }
  const taskFile = join(root, 'tasks', `${taskId}.md`);
  const taskText = parseUnits && existsSync(taskFile) ? readFileSync(taskFile, 'utf8') : null;
  for (const e of entries) {
    const unknown = B.unknownUnitProblem(e, taskText, parseUnits);
    // A warning, not a block: the unit may have been renumbered or removed after the round was
    // written, and entries are never edited. The appender refuses it at write time.
    if (unknown) warnings.push(`${where}:${e.line} — ${unknown} If the unit was renumbered or removed after the round, the entry stays as written; no unit's integration counts it.`);
  }

  // ── B-4 · two entries with the same identifier ─────────────────────────────────────
  // The same defect the kit already chases in the pendings table: with the id repeated,
  // the first entry stops existing for every check that walks ids, and every link that
  // points at it becomes ambiguous.
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.id)) {
      err(`${where} repeats the identifier ${e.id} — line ${seen.get(e.id)} and line ${e.line}`,
          `Rename the SECOND one (line ${e.line}): the first may already have links pointing at it. ` +
          `An id is YYYY-MM-DD-hhmmss-xxxx; change the last four characters.`);
    } else seen.set(e.id, e.line);
  }

  const g = B.linkAnalysis(entries);

  // ── C-1 · a link to an entry that does not exist ───────────────────────────────────
  for (const d of g.dangling) {
    err(`${where} — entry ${d.from} says "${d.field}: ${d.target}", and that id is not in this task log`,
        'Fix the id, or remove the link. A broken link makes something still open look closed,\n' +
        `      and if the entry belongs to another task the link is written <task-id>#${d.target}.`);
  }

  // ── C-2 · a link that names another task ───────────────────────────────────────────
  // Allowed, and checked: without the task id, an entry from elsewhere and an entry that
  // does not exist are the same string, and no verifier can tell them apart.
  for (const x of g.external) {
    if (!existsSync(join(root, 'tasks', `${x.task}.md`))) {
      err(`${where} — entry ${x.from} links to task ${x.task}, which does not exist`,
          'Fix the task id, or remove the link.');
      continue;
    }
    const other = parsed.get(x.task);
    if (!other) {
      err(`${where} — entry ${x.from} links to ${x.task}#${x.target}, and ${x.task} has no task log`,
          `If that entry exists, its task log should be at logs/tasks/${x.task}.md.`);
      continue;
    }
    if (!other.ids.has(x.target)) {
      err(`${where} — entry ${x.from} links to ${x.task}#${x.target}, and that id is not in that task log`,
          'Fix the entry id, or remove the link.');
    }
  }

  // ── T026 R-6 · an induced-by: that points at nothing ───────────────────────────────
  // Checked here and not by the appender, which never reads the file. It is a reference,
  // not an edge: linkAnalysis does not read it, so it closes and hides nothing (R-7).
  for (const e of entries) {
    if (e.type !== 'finding' || !('induced-by' in e.fields)) continue;
    const l = B.parseLink(e.fields['induced-by']);
    if (!l.ok) continue; // its shape is reported by validateEntry
    if (!l.task) {
      if (!ids.has(l.id)) {
        err(`${where} — entry ${e.id} says "induced-by: ${l.id}", and that id is not in this task log`,
            `Fix the id, or remove the field. If the finding belongs to another task, it is written <task-id>#${l.id}.`);
      }
      continue;
    }
    const other = parsed.get(l.task);
    if (!existsSync(join(root, 'tasks', `${l.task}.md`)) || !other || !other.ids.has(l.id)) {
      err(`${where} — entry ${e.id} says "induced-by: ${l.task}#${l.id}", and that entry does not exist`,
          'Fix the task id or the entry id, or remove the field.');
    }
  }

  // ── C-4 · two entries closing the same one ─────────────────────────────────────────
  // The cheap signal of duplicated work: two people believed they closed the same thing,
  // and one of them is not describing what happened.
  const resolvers = new Map();
  for (const e of entries) {
    if (!('resolves' in e.fields)) continue;
    const link = B.parseLink(e.fields.resolves);
    if (!link.ok || link.task) continue;
    if (!resolvers.has(link.id)) resolvers.set(link.id, []);
    resolvers.get(link.id).push(e.id);
  }
  for (const [target, who] of resolvers) {
    if (who.length > 1) {
      // C-4 and C-5 are the same condition read two ways, so they are reported once with
      // both readings rather than twice with half an explanation each. Splitting them
      // would print two messages about one line and make the second look like noise.
      err(`${where} — ${who.length} entries claim to resolve the same one, ${target}: ${who.join(', ')}`,
          'Either two people closed the same thing —duplicated work—, or the first close did not hold and this\n' +
          '      is a reopening. Reopening is legitimate; doing it silently erases that the first fix failed.\n' +
          '      Keep the close that held and replace the other with an entry that says so.');
    }
  }

  // ── C-5 · closing something that had already been superseded ───────────────────────
  // Distinct from the case above: the target was not closed twice, it was REPLACED, and
  // then someone closed the version that no longer stands. Either the fix went to the
  // wrong entry, or the replacement should not have happened.
  const replacedAt = new Map();
  for (const e of entries) {
    if (!('replaces' in e.fields)) continue;
    const l = B.parseLink(e.fields.replaces);
    if (l.ok && !l.task) replacedAt.set(l.id, e.id);
  }
  for (const e of entries) {
    if (!('resolves' in e.fields)) continue;
    const l = B.parseLink(e.fields.resolves);
    if (!l.ok || l.task) continue;
    const replacer = replacedAt.get(l.id);
    if (replacer && replacer < e.id) {
      err(`${where} — entry ${e.id} resolves ${l.id}, which ${replacer} had already replaced`,
          `An entry that no longer stood was closed. Either the fix belongs against ${replacer}, or the replacement is superfluous.`);
    }
  }

  // ── C-3 · a loop ───────────────────────────────────────────────────────────────────
  for (const loop of g.cycles) {
    err(`${where} — ${loop.length} entries resolve or replace each other in a loop: ${loop.join(' → ')} → ${loop[0]}`,
        'A loop would make work that is still open disappear from the view, so the view shows them anyway.\n' +
        '      Remove one of the links: only one of them really closed the other.');
  }

  if (entries.length) {
    inventory.push(`logs/tasks/${taskId}.md — ${entries.length} entry(ies), ${g.open.length} open`);
  } else {
    inventory.push(`logs/tasks/${taskId}.md — no entries yet`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────────
const summary = `✓ ${parsed.size} task log(s) with ${entryCount} entry(ies): the shape is valid and the links resolve.`;
// H-1: green with nothing to say is the summary alone — no header, no inventory.
if (!problems.length && !warnings.length && !notes.length && !verbose) {
  console.log(summary);
  process.exit(0);
}
console.log(`  Task logs   (${root})\n`);
for (const w of warnings) console.log(`  ⚠ ${w}\n`);
if (problems.length) {
  for (const p of problems) {
    console.log(`  ✗ ${p.what}`);
    console.log(`      ${p.fix}\n`);
  }
  console.log(`✗ ${problems.length} problem(s) in the task logs.`);
  process.exit(1);
}
const shown = verbose ? [...notes, ...inventory] : notes;
for (const n of shown) console.log(`  · ${n}`);
if (shown.length) console.log('');
console.log(summary);
process.exit(0);
