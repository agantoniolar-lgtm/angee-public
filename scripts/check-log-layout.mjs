#!/usr/bin/env node
/**
 * check-log-layout.mjs — session logs sit where they belong, and links to them resolve.
 *
 * Session logs live in `logs/sessions/<YYYY-MM>/session-YYYY-MM-DD.md`, one folder per
 * month, with no cap and no `archive/`. This checks that layout and — the part nothing
 * else in the kit does — that every reference pointing at a session log actually resolves.
 *
 * Why the link half exists: `check-task-links.mjs` validates tasks against pendings and
 * nothing else. A broken link to a log produces no error anywhere; it is found months
 * later by someone opening an old document. Moving logs into month folders rewrote dozens
 * of references at once, which is exactly the operation that needs a net under it.
 *
 * Exit codes:
 *   0 — layout is correct and every link resolves
 *   1 — something is wrong; each problem is named with what to do about it
 *   2 — this project has no `logs/` at all; nothing to check
 *   3 — advisory: logs are still in the flat pre-0.34.0 layout. NOT a failure. A project
 *       updates the kit and migrates when it chooses to; see
 *       `ae-kit-templates/migrate-logs-to-months.md`.
 *
 * Usage: node check-log-layout.mjs [root] [--verbose]
 *
 * ── Why a green run prints one line ──────────────────────────────────────────────────
 * It runs on every commit. What a green run used to list — that `logs/subagents/` is not
 * read, each document exempt by its marker, each log accepted without a single date — is
 * an inventory of exceptions already declared, the same on every run (T189). A green run
 * now prints the summary line, which still COUNTS those exceptions so none of them goes
 * silent, plus every advisory with content: loose lesson files, an empty month folder, a
 * file in logs/ that is not a log, a dead reference inside a committed task log entry.
 * `--verbose` lists the exceptions one by one. A failure prints its full detail, as before.
 */

import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const root = args.find((a) => !a.startsWith('--')) ?? process.cwd();
const logsDir = join(root, 'logs');

const problems = [];
const notes = [];
// Declared or built-in exceptions, the same on every run: listed only with --verbose, and
// counted in the summary line so that none of them disappears from view.
const inventory = [];
let acceptedNames = 0;
const err = (what, fix) => problems.push({ what, fix });

if (!existsSync(logsDir)) {
  console.log('  · This project has no logs/. Nothing to check.');
  process.exit(2);
}

const SESSION_RE = /^session-(\d{4})-(\d{2})-(\d{2})[a-z]?\.md$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// ── 1. Is this project migrated at all? ────────────────────────────────────────────
const topLevel = readdirSync(logsDir);
const loose = topLevel.filter((f) => /^session-.*\.md$/.test(f));
const hasArchive = topLevel.includes('archive');
const sessionsDir = join(logsDir, 'sessions');
let hasSessions = existsSync(sessionsDir) && statSync(sessionsDir).isDirectory();
// An empty `sessions/` is not a migration. The setup checklist and the migration
// procedure both have you create the folder before anything moves, and treating that
// moment as "migrated" would turn the advisory into a blocked commit for someone who has
// not decided to migrate yet.
const sessionsIsEmpty = hasSessions &&
  readdirSync(sessionsDir).filter((e) => !/^(\.DS_Store|Thumbs\.db|\.gitkeep|\.keep|desktop\.ini)$/i.test(e)).length === 0;
if (sessionsIsEmpty) hasSessions = false;

// ── 1bis. Lesson files still loose in logs/ ────────────────────────────────────────
// Until 0.36.0 `emit-lessons.mjs` wrote its report straight into `logs/`, and the session
// that built the payload JSON put it there too. Both moved into `logs/lessons/`. What is
// already loose was put there by the kit itself, so this warns and never blocks: a project
// migrates when it decides to, not because it updated — the same call 0.34.0 made for the
// month folders.
//
// The advisory is printed on EVERY way out of this script: the flat-layout early exit
// below, a run that fails for some other reason, and the clean report. A notice that only
// appears on the happy path is the one nobody ever sees.
const LESSON_FILE_RE = /^lesson-payload.*\.(json|md)$/;
const looseLessons = topLevel.filter((f) => LESSON_FILE_RE.test(f)).sort();
// One command, printed once, that has to survive three things at once: the shell it is
// pasted into, the directory it is pasted from, and a destination that is not empty.
//
// 1. The shell. It walks the files with `find`, not with a glob, because a pattern that
//    matches nothing is a fatal error in zsh — the default shell on macOS — and not a
//    literal word. A project that never consented to the lesson channel only ever
//    accumulates .json files, so the .md half of a glob pair matches nothing, zsh aborts
//    the whole line, and nothing moves. `find` prints nothing and exits 0 when a name
//    matches nothing, in every shell, and the loop runs under `sh` so its body is POSIX
//    whatever pasted it. The patterns are quoted, so no shell ever expands them.
//
// 2. The directory. The line used to assume the repo root and say nothing when it was
//    wrong: pasted from a subfolder it created an orphan logs/lessons/ there, moved
//    nothing, and exited 0. Now it resolves the root itself with `git rev-parse`, so it
//    works from anywhere in the repo; outside a repo it falls back to the current
//    directory and refuses out loud when there is no logs/ in it. Nothing is created
//    before that check passes.
//
// 3. The destination. It never overwrites. A project that closed a session after
//    updating already has a FRESH logs/lessons/lesson-payload.md, and the old line
//    deleted it (`git rm -f`) to make room for the stale loose copy — silently. Now an
//    existing target is kept, the loose file is left where it is, and the command says
//    which file it did not move, so the person decides.
//
// `mkdir -p logs/lessons` sits inside the loop, not before it: outside, it would create
// the folder even on a run that moves nothing.
const MOVE_CMD =
  'sh -c \'r=$(git rev-parse --show-toplevel 2>/dev/null); [ -n "$r" ] || r=$PWD; ' +
  'cd "$r" || exit 1; ' +
  '[ -d logs ] || { echo "No logs/ here: run this from the project root."; exit 1; }; ' +
  'for f in $(find logs -maxdepth 1 "(" -name "lesson-payload*.json" ' +
  '-o -name "lesson-payload*.md" ")"); do t=logs/lessons/${f#logs/}; mkdir -p logs/lessons; ' +
  'if [ -e "$t" ]; then echo "kept the newer $t; $f was NOT moved"; continue; fi; ' +
  'git mv "$f" "$t" 2>/dev/null || mv "$f" "$t"; done\'';
function reportLooseLessons() {
  if (!looseLessons.length) return;
  console.log(`  · ${looseLessons.length} lesson file(s) still loose in logs/; since 0.36.0 they live in logs/lessons/:`);
  for (const f of looseLessons) console.log(`      logs/${f}`);
  console.log('  · Not a failure, and it does not block the commit. Move them with:\n');
  console.log(`      ${MOVE_CMD}\n`);
}

if (!hasSessions && (loose.length || hasArchive)) {
  console.log('  Session log layout\n');
  console.log(`  · ${loose.length} loose log(s) in logs/${hasArchive ? ', and a logs/archive/' : ''}.`);
  console.log('  · This project still uses the flat layout from before 0.34.0.');
  console.log('\n  Not a failure. The migration runs when the project decides to,');
  console.log('  following ae-kit-templates/migrate-logs-to-months.md\n');
  reportLooseLessons();
  process.exit(3);
}

// Past this point the project is migrated, so a leftover is a real defect.
if (loose.length) {
  err(`${loose.length} loose session log(s) in logs/ next to sessions/: ${loose.join(', ')}`,
      'Move them to logs/sessions/<YYYY-MM>/ with git mv. A half-done migration leaves logs that open-session cannot find.');
}
if (hasArchive) {
  err('logs/archive/ still exists, and it was retired in 0.34.0',
      'Move what it holds to its month folder in logs/sessions/ and delete archive/.');
}

// ── 2. What lives directly in logs/ ────────────────────────────────────────────────
// `tasks/` holds the per-task task log (T067), `subagents/` the saved prompt and reply of
// each subagent (T058). Both are declared here, in one place, because two tasks that each
// added their own entry would collide on this line.
// `lessons/` joined them in 0.36.0: it holds the payload a close builds and the report
// emit-lessons.mjs writes beside it.
const ALLOWED_TOP = new Set(['deploy-checks.md', 'sessions', 'tasks', 'subagents', 'lessons']);
// Finder, Windows and editors drop these into any folder they display. They are not the
// project's doing and cannot be fixed by moving them, so reporting them would block a
// commit over something the person never wrote.
const NOISE = /^(\.DS_Store|Thumbs\.db|\.gitkeep|\.keep|desktop\.ini)$/i;
for (const entry of topLevel) {
  if (NOISE.test(entry)) continue;
  if (ALLOWED_TOP.has(entry) || /^session-.*\.md$/.test(entry) || entry === 'archive') continue;
  // A loose lesson file is not "ignored" any more: section 1bis already named it and
  // printed the command that moves it. Saying nothing here is what left ten of them piling
  // up in a real project with the verifier reporting green.
  if (LESSON_FILE_RE.test(entry)) continue;
  // A project that never migrated never agreed to this convention: 0.34.0 introduced it.
  // Blocking its commit over a file it has kept in logs/ for months would be the kit
  // imposing a layout the project did not choose. Once it is migrated, it is a defect.
  if (!hasSessions) { notes.push(`logs/${entry} is not a session log; it would be better off in docs/`); continue; }
  err(`logs/${entry} is neither a session log nor the deploy-checks log`,
      'logs/ holds deploy-checks.md, sessions/, tasks/, subagents/ and lessons/. A findings document or a comparison goes in docs/.');
}

// ── 2bis. What lives directly in logs/subagents/ ──────────────────────────────────────
// Only the date folders the collector creates, plus the one log it writes when it fails.
// Anything else there is a file somebody put by hand, and it would otherwise hide behind
// the fact that this folder's content is never read (section 4).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const subagentsDir = join(logsDir, 'subagents');
if (existsSync(subagentsDir) && statSync(subagentsDir).isDirectory()) {
  for (const entry of readdirSync(subagentsDir)) {
    if (NOISE.test(entry) || entry === 'collector-errors.log' || entry === '.gitignore') continue;
    let isDir = false;
    try { isDir = statSync(join(subagentsDir, entry)).isDirectory(); } catch { /* reported below */ }
    if (isDir && DATE_RE.test(entry)) continue;
    err(`logs/subagents/${entry} is not a date folder`,
        'logs/subagents/ only holds YYYY-MM-DD/ folders written by the collector, collector-errors.log and a .gitignore.\n      A document about subagents goes in docs/.');
  }
}

// ── 2ter. What lives directly in logs/lessons/ ────────────────────────────────────────
// Modelled on 2bis, and stricter than section 2 on purpose: this folder is new in 0.36.0,
// so it has no inherited files to respect. Only the payload a close builds
// (`lesson-payload-YYYY-MM-DD.json`) and the report `emit-lessons.mjs` writes beside it
// (`lesson-payload.md`). Anything else was put there by hand.
const lessonsDir = join(logsDir, 'lessons');
if (existsSync(lessonsDir)) {
  let lessonsStat = null;
  try { lessonsStat = statSync(lessonsDir); } catch { /* reported below */ }
  // `lessons` is in ALLOWED_TOP, so without this a FILE named `logs/lessons` would be
  // waved through by section 2 purely because its name is on the allowed list.
  if (!lessonsStat || !lessonsStat.isDirectory()) {
    err('logs/lessons is a file, and logs/lessons/ is a folder',
        'Move it out of logs/ or rename it. The lesson payload and its report go INSIDE logs/lessons/.');
  } else {
    for (const entry of readdirSync(lessonsDir)) {
      if (NOISE.test(entry)) continue;
      let isFile = false;
      try { isFile = statSync(join(lessonsDir, entry)).isFile(); } catch { /* reported below */ }
      if (isFile && LESSON_FILE_RE.test(entry)) continue;
      err(`logs/lessons/${entry} is not a lesson file`,
          'logs/lessons/ only holds lesson-payload-YYYY-MM-DD.json and the lesson-payload.md that\n      emit-lessons.mjs writes. A folder, a backup or a note about lessons goes elsewhere.');
    }
  }
}

if (!existsSync(join(logsDir, 'deploy-checks.md'))) {
  notes.push('logs/deploy-checks.md does not exist yet — it is created on the first push verification');
}

// ── 3. The month folders and what they hold ────────────────────────────────────────
let sessionCount = 0;
const monthFolders = [];
if (hasSessions) {
  for (const month of readdirSync(sessionsDir)) {
    if (NOISE.test(month)) continue;
    const monthPath = join(sessionsDir, month);
    let monthStat;
    try { monthStat = statSync(monthPath); }
    catch { notes.push(`could not read logs/sessions/${month}, skipped`); continue; }
    if (!monthStat.isDirectory()) {
      err(`logs/sessions/${month} is a file, and only month folders go there`,
          'Move it to the month folder it belongs in, named session-YYYY-MM-DD.md.');
      continue;
    }
    if (!MONTH_RE.test(month)) {
      err(`logs/sessions/${month}/ is not shaped YYYY-MM`,
          'Month folders are named this way so they sort on their own as text: 2027-01 comes after 2026-12.');
      continue;
    }
    monthFolders.push(month);

    const files = readdirSync(monthPath).filter((f) => !NOISE.test(f));
    if (!files.length) {
      notes.push(`logs/sessions/${month}/ is empty — open-session falls back to the previous month`);
      continue;
    }
    for (const f of files) {
      const m = SESSION_RE.exec(f);
      if (!m) {
        // A ranged reconstruction log is a legitimate exception: it has no single date.
        if (/^session-.*\.md$/.test(f)) {
          inventory.push(`logs/sessions/${month}/${f} — name without a single date; accepted, placed by hand`);
          acceptedNames++;
          sessionCount++;
          continue;
        }
        err(`logs/sessions/${month}/${f} is not named session-YYYY-MM-DD.md`,
            'The file name plus its folder are the index of the logs. Rename it.');
        continue;
      }
      sessionCount++;
      const own = `${m[1]}-${m[2]}`;
      if (own !== month) {
        err(`logs/sessions/${month}/${f} is dated ${own}, but it is in the ${month} folder`,
            `Move it to logs/sessions/${own}/. A log in the wrong month makes open-session read the wrong one.`);
      }
    }
  }
}

// ── 4. Every reference to a session log resolves ───────────────────────────────────
// This is the half no other verifier covers.
const skipDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', 'vendor', '.venv', 'venv', '__pycache__', '.tox']);
// `logs/subagents/` holds what a subagent was told and what it answered, saved verbatim
// (T058). Two reasons it is walked past rather than read, and they are different reasons:
//
//   1. Nobody can fix what a subagent already wrote. If it quoted a log path that has since
//      moved — a pre-migration path, a file from another repo, a path it invented — this
//      verifier would report a broken link with no possible correction, and the only way
//      out of the commit would be skipping the hooks entirely.
//   2. The transcripts are the one thing in a repo that grows every session without bound.
//      Reading them would make the pre-commit slower every day, and a slow pre-commit is
//      one that gets skipped.
//
// The layout half above still applies: section 2bis checks that `subagents/` holds only
// date folders. This exemption is only about not reading the CONTENT of saved transcripts.
const transcriptsDir = join(logsDir, 'subagents');
// A git worktree inside the project — `.claude/worktrees/<unit>` where subagents build in
// parallel, `.worktrees/<slug>` where `prototype` works — is a whole copy of the repo at some
// earlier commit: its references are that commit's, already checked when it landed, and reading
// them reports this project's own files a second time, stale. A worktree is recognised by what
// makes it one, a `.git` FILE at its top, not by its folder name: that covers every place one
// can live, and it cannot hide committed files, because git never commits inside a worktree.
// Found by an installed project, 2026-09-23.
const isNestedCheckout = (dir) => {
  try { return statSync(join(dir, '.git')).isFile(); } catch { return false; }
};
let transcriptsSkipped = false;
const mdFiles = [];
(function walk(dir) {
  let entries;
  // An unreadable directory or a broken symlink is not this project's layout being wrong.
  // Dying here would abort a commit with a Node stack trace, in a script that reports
  // everything else in prose.
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { notes.push(`could not read ${relative(root, dir) || '.'}, skipped`); return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = join(dir, e.name);
      if (sub === transcriptsDir) { transcriptsSkipped = true; continue; }
      if (isNestedCheckout(sub)) continue;
      if (!skipDirs.has(e.name)) walk(sub);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      try { mdFiles.push(join(dir, e.name)); } catch { /* ignore */ }
    }
  }
})(root);

// A path carrying another project's marker (`OTHER:logs/…`) is not ours to resolve or rewrite.
const FOREIGN = /[A-Za-z][\w-]*:$/;
// Both shapes matter, and the flat one matters MORE: after a migration it is the shape
// that is broken, because the file moved and the citation didn't. Matching only the new
// shape would check the half that cannot fail.
// The leading `/` and `../` forms matter as much as the bare one: the kit's own skills
// write `/logs/sessions/<YYYY-MM>/…`, so a project that copied that style into its
// STATUS.md writes its citations that way too. Missing them would leave the verifier
// blind on exactly the documents read every session. The delimiter before the prefix is
// what still keeps `some-other-repo/logs/…` out.
//
// `logs/tasks/…` is in here for the same reason the session shapes are: it is the only
// thing in the kit that checks a reference to a log resolves, and a task's task log is a
// log. Without it, a document citing the task log of a task that was never opened — or
// one whose task got renamed — reads as correct forever, which is exactly the hole this
// verifier was built to close for session logs.
const LINK_RE = /(^|[\s(`"'|<[])((?:[A-Za-z][\w-]*:)?(?:\/|(?:\.\.\/)+)?logs\/(?:sessions\/[^\s)`"'|>\]]+|tasks\/[^\s)`"'|>\]]+|session-[^\s)`"'|>\]]+)\.md)/g;

const OPT_OUT = /<!--\s*check-log-layout:\s*ignore\b[^>]*-->/;
let checked = 0;
const broken = [];
const brokenInTaskLog = [];
const optedOut = [];
// A task log entry is never edited once committed (T067). A dead path inside a committed
// entry cannot be corrected, so blocking over it would leave no way out but skipping the
// hooks: it is reported as a note instead. A line that is NOT yet in HEAD is still being
// written and can still be fixed, so it blocks like any other document — otherwise a typo
// in today's entry would pass and become permanent on the next commit.
const tasksLogPrefix = join(logsDir, 'tasks') + sep;
function committedLines(rel) {
  try {
    const text = execFileSync('git', ['show', `HEAD:${rel.split(sep).join('/')}`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(text.split('\n'));
  } catch { return new Set(); } // no repo, no HEAD, or a new file: every line is new
}
function ownTaskLog(rel, target) {
  const m = rel.split(sep).join('/').match(/^tasks\/([^/]+)\.md$/);
  // Three forms: the task log, its view since 0.36.0, and the view of the old layout. The
  // old one stays exempt for good — every task created with the 0.35.0 template carries
  // that link, and dropping the exemption would block each of those tasks' own commits in
  // the projects that already installed it.
  return !!m && (target === `logs/tasks/${m[1]}.md` ||
                 target === `logs/tasks/current/${m[1]}.md` ||
                 target === `logs/tasks/${m[1]}.current.md`);
}
for (const file of mdFiles) {
  const rel = relative(root, file);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  // A document can quote pre-migration paths on purpose — a migration inventory, a
  // procedure, a sealed log. It says so in a marker on its own line, and then it is not
  // checked. The marker is deliberate and visible, unlike a filename hardcoded here,
  // which would only ever fit this one repo.
  if (OPT_OUT.test(text)) { optedOut.push(rel); continue; }
  const committed = file.startsWith(tasksLogPrefix) ? committedLines(rel) : null;
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(LINK_RE)) {
      let target = m[2];
      const prefix = target.slice(0, target.indexOf('logs/'));
      if (prefix && FOREIGN.test(prefix)) continue; // another project's log
      // `/logs/…` and `../logs/…` both mean the repo's own logs folder here; strip the
      // prefix so they resolve against the root like the bare form does.
      target = target.slice(target.indexOf('logs/'));
      if (target.includes('YYYY') || target.includes('AAAA') || target.includes('*')) continue;
      checked++;
      // A task file pointing at its OWN task log (or that log's view) before the first
      // entry exists is the task template's fixed link, not a dead reference: the first
      // append creates the file. Only the task's own id qualifies — a task citing another
      // task's log that does not exist is still a broken link (T054, review round 2).
      if (ownTaskLog(rel, target)) continue;
      if (!existsSync(join(root, target))) {
        const where = committed?.has(line) ? brokenInTaskLog : broken;
        where.push(`${rel}:${i + 1} → ${target}`);
      }
    }
  });
}
if (broken.length) {
  err(`${broken.length} reference(s) to a session log or task log that does not exist:\n      ` + broken.join('\n      '),
      'Fix the path; or add the project prefix if the log belongs to another repo; or, if the document\n      quotes pre-migration paths on purpose, declare <!-- check-log-layout: ignore --> in its text.\n      Nothing else in the kit checks this.');
}

// ── Report ─────────────────────────────────────────────────────────────────────────
if (transcriptsSkipped) inventory.push('logs/subagents/ — subagent transcripts; their content is not read or audited');
for (const r of optedOut) inventory.push(`${r} — quotes earlier paths on purpose, declared with the marker`);
for (const b of brokenInTaskLog) notes.push(`${b} — dead reference inside a committed task log entry; committed entries are never edited, so it is reported and not blocked. Record the correction in a new entry.`);
const unresolved = brokenInTaskLog.length ? ` (${brokenInTaskLog.length} dead inside task logs, reported above)` : '';
const exceptions = [];
if (optedOut.length) exceptions.push(`${optedOut.length} document(s) exempt by marker`);
if (acceptedNames) exceptions.push(`${acceptedNames} log name(s) accepted without a single date`);
const exceptionNote = exceptions.length && !verbose ? `; ${exceptions.join(', ')} (--verbose lists them)` : '';
const summary = `✓ ${sessionCount} log(s) in ${monthFolders.length} month folder(s), and the ${checked - brokenInTaskLog.length} reference(s) (to session logs and task logs) resolve${unresolved}${exceptionNote}.`;
// H-3: green with nothing to say is the summary alone — no header, no inventory.
if (!problems.length && !notes.length && !looseLessons.length && !verbose) {
  console.log(summary);
  process.exit(0);
}
console.log(`  Session log layout   (${root})\n`);
// Before the problems, not after: notes are only printed on a clean run, and an advisory
// that disappears the moment anything else goes wrong is one a project never acts on.
reportLooseLessons();
if (problems.length) {
  for (const p of problems) {
    console.log(`  ✗ ${p.what}`);
    console.log(`      ${p.fix}\n`);
  }
  console.log(`✗ ${problems.length} problem(s) with the log layout.`);
  process.exit(1);
}
const shown = verbose ? [...inventory, ...notes] : notes;
for (const n of shown) console.log(`  · ${n}`);
if (shown.length) console.log('');
console.log(summary);
process.exit(0);
