#!/usr/bin/env node
/**
 * check-local-adjustments.mjs — a kit file is never edited in place, and every local fix to
 * the kit is declared, complete, and accounted for (T130, U2).
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────
 * A project sometimes needs a fix before the kit ships it. Editing the kit file directly
 * works until the next install, which overwrites it without a word. So a fix like that is
 * declared instead, as a row of the "Local kit adjustments" section of CLAUDE.md, and lives
 * either in prose or in a local file outside the kit's paths. This checker holds the three
 * things that make that arrangement trustworthy, on every commit:
 *
 *   1. No kit file changed since it was installed. `.ae-kit-manifest`, written by install.sh
 *      on a clean install, holds the SHA-256 of every kit file it left on disk. A project
 *      has no kit/ to compare against, so this footprint is the only reference there is.
 *      Both the working tree (what Claude runs) and the index (what the commit records) are
 *      compared, so an edit can neither hide in the working tree nor in the staged copy.
 *   2. Every row of the section is complete: what it modifies (a kit file, folder, skill or
 *      script that IS in the footprint), how it is applied, an ae-setup issue, and a real,
 *      non-future date.
 *   3. Every local file of an adjustment is accounted for. A local adjustment file is a line
 *      of `.ae-kit-local` whose reason starts with `adjustment:` (D011). Each such line must
 *      be named by some row, and each local file a row names must be declared that way and
 *      exist. Other `.ae-kit-local` lines — a project's own skills — are not adjustments
 *      and are left alone.
 *
 * ── The section ───────────────────────────────────────────────────────────────────────
 * A heading (any level) titled "Local kit adjustments" or "Ajustes locales al kit". It runs
 * until the next heading of the same or a higher level; a subheading inside it does not cut
 * it. Every table inside it is read; tables inside a fenced code block are ignored. Columns
 * are read BY NAME, in English or Spanish, in any order, extra columns ignored:
 *
 *   What it modifies   (also: Modifies, Qué modifica)
 *   How it is applied  (also: How it's applied, Cómo se aplica)
 *   Local files        (also: Archivos locales)
 *   Issue              (also: ae-setup issue, Issue en ae-setup)
 *   Date               (also: Fecha)
 *
 * A row whose every cell is empty or only a dash (—, –, -) or an ellipsis is the template's
 * filler, and counts as no row. `\|` inside a cell is a literal pipe.
 *
 * Values:
 *   - What it modifies: one or more items, in backticks or comma-separated. Each is a kit
 *     path from the footprint, a kit folder holding footprint paths, the name of a kit skill
 *     (`code-review` → `.claude/skills/code-review/`), or the name of a kit script, with or
 *     without its extension. Anything else is rejected (D014).
 *   - How it is applied: required, free text. It is never interpreted: a prose row that
 *     mentions `CLAUDE.md` or `0.36.0` asks nothing of anyone (D018). Guessing local files
 *     from it blocked every commit over a file name written as an example.
 *   - Local files: the adjustment's local files and nothing else, in backticks or
 *     comma-separated; empty or a dash for a prose-only adjustment. Each one must exist, must
 *     not be a kit path, and must be declared in `.ae-kit-local` with `adjustment:`.
 *   - Issue: one or more of `ae-setup#12`, `agantoniolar-lgtm/ae-setup#12` or
 *     `https://github.com/agantoniolar-lgtm/ae-setup/issues/12`. A bare `#12` does not say
 *     which repo, and is rejected (D015). Only the shape is checked; the network is not.
 *   - Date: YYYY-MM-DD, a real calendar date, not in the future.
 *
 * ── `.ae-kit-excluded` and `.ae-kit-local` ────────────────────────────────────────────
 * Parsed with exactly the rules of check-installed-copy.mjs and install.sh: separator = the
 * FIRST `#`, `—` or `--`; path before, reason after, both trimmed; no reason, or a path with
 * spaces, is malformed and not obeyed; a leading `./` is normalized; a trailing `/` makes a
 * folder line. Change one parser and the others must follow, or the tools disagree.
 * A footprint file declared out in `.ae-kit-excluded` may be deleted without reinstalling
 * (R-8). While it is still on disk it is still compared: the declaration does not take it
 * out of the comparison. The task log's pieces cannot be declared out at all (T054).
 *
 * ── Never writes ──────────────────────────────────────────────────────────────────────
 * It reads files and asks git read-only questions (with optional locks off, so not even the
 * index stat cache is refreshed). It never writes, moves or deletes a file (E-4).
 * A stray `.ae-kit-manifest.tmp.<pid>` from an interrupted install is never read.
 *
 * Usage: node scripts/check-local-adjustments.mjs [repo-root]
 *   The root defaults to the git top level of the current directory, so it can be run from
 *   a subfolder or from a worktree.
 *
 * Exit codes (every check runs, and every failure is reported in the same run):
 *   0  nothing to report
 *   1  at least one failure
 *   3  no failure, but there is no footprint (installed before it existed, an install that
 *      did not complete, or declared out): kit files could not be compared. A state, not a
 *      defect — it warns and does not block.
 */

import { readFileSync, existsSync, lstatSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// ── The root ─────────────────────────────────────────────────────────────────────────
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
function git(args, cwd, { buffer = false, input } = {}) {
  try {
    return execFileSync('git', args, {
      cwd, env: gitEnv, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}
const base = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const top = existsSync(base) ? git(['rev-parse', '--show-toplevel'], base) : null;
const root = top ? top.trim() : base;
const inGit = Boolean(top);

const failures = [];   // { title, items: [string], fix: [string] }
const warnings = [];   // same shape; never change the exit code
const fail = (title, items, fix) => failures.push({ title, items, fix });
const warn = (title, items, fix) => warnings.push({ title, items, fix });

const GUIDE = 'ae-kit-templates/local-adjustments.md';
const SECTION_NAME = '"Local kit adjustments" in CLAUDE.md';

// ── The declaration lists (same rules as check-installed-copy.mjs) ───────────────────
function parseDeclList(file, label, malformed) {
  const entries = [];
  if (!existsSync(file)) return entries;
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = i + 1;
    const text = raw.trim();
    if (!text || text.startsWith('#')) return;
    const sep = [text.indexOf('#'), text.indexOf('—'), text.indexOf('--')].filter((n) => n >= 0);
    if (sep.length === 0) {
      malformed.push(`${label} line ${line}: ${text.split(/\s+/)[0]} — declares no reason`);
      return;
    }
    const at = Math.min(...sep);
    const path = text.slice(0, at).trim().replace(/^\.\//, '');
    const reason = text.slice(at).replace(/^(#|—|--)/, '').trim();
    if (!path || /\s/.test(path)) {
      malformed.push(`${label} line ${line}: ${path || text} — the path is empty or contains spaces`);
      return;
    }
    if (!reason) {
      malformed.push(`${label} line ${line}: ${path} — the reason is empty`);
      return;
    }
    entries.push({ path, isDir: path.endsWith('/'), reason, line });
  });
  return entries;
}
const matchIn = (list, relPath) =>
  list.find((e) => (e.isDir ? relPath.startsWith(e.path) : relPath === e.path)) || null;

// The task log's pieces cannot be declared out (T054) — the same list as install.sh and
// check-installed-copy.mjs. A declaration for one of them is ignored here too.
const REQUIRED = new Set([
  'scripts/task-log.mjs', 'scripts/task-log-append.mjs', 'scripts/check-task-log.mjs',
  'scripts/generate-task-log-view.mjs', 'ae-kit-templates/task-log-ontology.md',
]);

const malformedDecl = [];
const exclusions = parseDeclList(join(root, '.ae-kit-excluded'), '.ae-kit-excluded', malformedDecl);
const locals = parseDeclList(join(root, '.ae-kit-local'), '.ae-kit-local', malformedDecl);
const ADJUSTMENT = /^adjustment:/i;
const adjustmentLocals = locals.filter((e) => ADJUSTMENT.test(e.reason));
if (malformedDecl.length) {
  warn('Malformed declaration lines, ignored (' + malformedDecl.length + ')', malformedDecl, [
    'A line with no reason or a path with spaces is not obeyed, even if it says adjustment:.',
    'Fix: write it as `<path> # <reason>`.',
  ]);
}

// ── 1. The footprint ─────────────────────────────────────────────────────────────────
const MANIFEST_REL = '.ae-kit-manifest';
const manifestAbs = join(root, MANIFEST_REL);
const manifestDeclaredOut = Boolean(matchIn(exclusions, MANIFEST_REL));
const manifest = new Map(); // path -> sha256
let manifestState = 'absent'; // absent | declared-out | read
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

if (manifestDeclaredOut) {
  manifestState = 'declared-out';
} else if (existsSync(manifestAbs)) {
  manifestState = 'read';
  const broken = [];
  readFileSync(manifestAbs, 'utf8').split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw === '' || raw.startsWith('#')) return;
    const m = /^([0-9a-f]{64}) {2}(\S(?:.*\S)?)$/.exec(raw);
    if (!m) { broken.push(`line ${line}: not "<64 hex>  <path>"`); return; }
    const p = m[2];
    // Never a path that resolves outside the repo: such a line is a broken footprint, and
    // reading it would mean reading a file the kit never put there.
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\\') ||
        `/${p}/`.includes('/../') || `/${p}/`.includes('/./') || p.includes('//')) {
      broken.push(`line ${line}: ${p} — not a plain path inside the repo`);
      return;
    }
    if (manifest.has(p)) { broken.push(`line ${line}: ${p} — listed twice`); return; }
    manifest.set(p, m[1]);
  });
  if (broken.length) {
    fail(`The footprint ${MANIFEST_REL} is broken (${broken.length} line(s))`, broken, [
      'A broken footprint does not switch the check off: the lines that are well formed were',
      'still compared. Fix: reinstall the kit, which rewrites it whole; never edit it by hand.',
    ]);
  }
}
const haveManifest = manifestState === 'read';

// The index, read once. `git ls-files -s` lists `<mode> <oid> <stage>\t<path>`.
const indexOid = new Map();
let stagedDeletions = new Set();
if (haveManifest && inGit) {
  const ls = git(['ls-files', '-s', '-z'], root);
  if (ls) {
    for (const rec of ls.split('\0')) {
      const tab = rec.indexOf('\t');
      if (tab < 0) continue;
      const [, oid, stage] = rec.slice(0, tab).split(' ');
      if (stage === '0') indexOid.set(rec.slice(tab + 1), oid);
    }
  }
  const del = git(['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=D', '-z'], root);
  if (del) stagedDeletions = new Set(del.split('\0').filter(Boolean));
}
const edited = [], editedOut = [], deleted = [], deletedRequired = [], stagedEdited = [], stagedDeleted = [];
let compared = 0, skippedOut = 0;
const intactInIndex = []; // footprint paths intact in the working tree and present in the index
if (haveManifest) {
  for (const [p, want] of manifest) {
    // A declaration only ignores a file that is GONE (R-8). While it is still on disk it is
    // still what runs, so it is still compared: otherwise one line in .ae-kit-excluded
    // would silence an edit the next install overwrites.
    const out = Boolean(matchIn(exclusions, p)) && !REQUIRED.has(p);
    const required = REQUIRED.has(p);
    const abs = join(root, p);
    let st = null;
    try { st = lstatSync(abs); } catch { /* absent */ }
    if (!st) {
      if (out) skippedOut++;
      else (required ? deletedRequired : deleted).push(p);
      continue;
    }
    compared++;
    if (!st.isFile()) { (out ? editedOut : edited).push(`${p} (no longer a regular file)`); continue; }
    if (sha256(readFileSync(abs)) !== want) { (out ? editedOut : edited).push(p); continue; }
    if (!inGit) continue;
    // The working tree is intact; now what the commit would record. Deleting a file the
    // project declared out is exactly what the declaration asks for.
    if (stagedDeletions.has(p)) { if (!out) stagedDeleted.push(p); continue; }
    if (indexOid.has(p)) intactInIndex.push(p);
  }
}
// The blob git would stage for each intact file, computed by git itself so the same
// attributes apply as on `git add` — autocrlf, `text eol=`, a clean filter. Comparing the
// index against the raw bytes instead blocked every commit in a repo that normalizes line
// endings. `hash-object` without -w writes no object; each path is hashed as itself, so its
// own attributes are used.
if (intactInIndex.length) {
  const oids = git(['hash-object', '--stdin-paths'], root, { input: intactInIndex.join('\n') + '\n' });
  const expected = oids ? oids.trim().split('\n') : [];
  intactInIndex.forEach((p, i) => {
    const oid = indexOid.get(p);
    if (expected.length === intactInIndex.length && oid === expected[i]) return;
    // Not what an intact copy would stage. It may still be the installed bytes, staged raw.
    const staged = git(['cat-file', 'blob', oid], root, { buffer: true });
    if (!staged || sha256(staged) !== manifest.get(p)) stagedEdited.push(p);
  });
}
if (editedOut.length) {
  fail(`Kit files declared out in .ae-kit-excluded, still on disk, and edited (${editedOut.length})`, editedOut, [
    'Declaring a kit file out does not take it out of the comparison while it is still on disk:',
    'it is still what runs, and the next install overwrites it.',
    'Fix: delete it, or put it back to the kit\'s version (reinstall, or `git checkout -- <path>`).',
    `A change it needs is carried as a row of ${SECTION_NAME}. The guide: ${GUIDE}.`,
  ]);
}
if (edited.length) {
  fail(`Kit files edited since they were installed (${edited.length})`, edited, [
    'A kit file is never edited in place: the next install overwrites it without a word.',
    'Fix: restore it (reinstall the kit, or `git checkout -- <path>`), and carry the change',
    `as a row of ${SECTION_NAME}, applied in prose or in a local file`,
    `outside the kit's paths. The guide: ${GUIDE}.`,
  ]);
}
if (stagedEdited.length) {
  fail(`Kit files whose STAGED version differs from the installed one (${stagedEdited.length})`, stagedEdited, [
    'The working tree is intact, but this commit would record an edited kit file.',
    'Fix: `git restore --staged <path>` (or `git add <path>` from the intact copy), and carry',
    `the change as a row of ${SECTION_NAME}. The guide: ${GUIDE}.`,
  ]);
}
if (stagedDeleted.length) {
  fail(`Kit files this commit would delete (${stagedDeleted.length})`, stagedDeleted, [
    'Fix: `git restore --staged <path>`, or, if the project stops using it, declare it in',
    '.ae-kit-excluded with its reason.',
  ]);
}
if (deleted.length) {
  fail(`Kit files deleted since they were installed, and not declared out (${deleted.length})`, deleted, [
    'Fix: restore it (reinstall the kit, or `git checkout -- <path>`), or, if the project',
    'does not use it, declare it in .ae-kit-excluded with its reason.',
  ]);
}
if (deletedRequired.length) {
  fail(`Required kit files deleted (${deletedRequired.length})`, deletedRequired, [
    'These are the task log\'s pieces: the skills write through them, so they cannot be',
    'declared out, and a declaration for them is ignored.',
    'Fix: restore them — reinstall the kit, or `git checkout -- <path>`.',
  ]);
}

// What the footprint says about a path: a kit file, a kit folder, or nothing.
const kitFolder = (p) => {
  const dir = p.replace(/\/+$/, '') + '/';
  for (const k of manifest.keys()) if (k.startsWith(dir)) return true;
  return false;
};
const isKitPath = (p) => manifest.has(p.replace(/\/+$/, '')) || kitFolder(p);

// ── 2. The section ───────────────────────────────────────────────────────────────────
const SECTION_TITLE = /^(local kit adjustments|ajustes locales al kit)\b/;
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const COLUMNS = {
  modifies: ['what it modifies', 'modifies', 'que modifica'],
  applied: ['how it is applied', "how it's applied", 'como se aplica'],
  local: ['local files', 'archivos locales'],
  issue: ['issue', 'ae-setup issue', 'issue en ae-setup'],
  date: ['date', 'fecha'],
};
const COLUMN_LABEL = {
  modifies: 'What it modifies', applied: 'How it is applied', local: 'Local files',
  issue: 'Issue', date: 'Date',
};

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}
const SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const rows = [];       // { line, modifies, applied, local, issue, date }
const sections = [];   // line numbers of the section headings
const claudeMd = join(root, 'CLAUDE.md');
if (existsSync(claudeMd)) {
  const lines = readFileSync(claudeMd, 'utf8').split('\n');
  let fence = null;          // the fence marker while inside a code block
  let sectionLevel = 0;      // >0 while inside the section
  const tables = [];         // [{ start, lines: [[lineNo, text]] }]
  let table = null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(text);
    if (fm) {
      if (!fence) fence = fm[1][0];
      else if (fm[1][0] === fence) fence = null;
      table = null;
      continue;
    }
    if (fence) continue;
    const hm = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(text);
    if (hm) {
      const level = hm[1].length;
      if (sectionLevel && level <= sectionLevel) sectionLevel = 0;
      if (SECTION_TITLE.test(norm(hm[2]))) {
        sections.push(i + 1);
        sectionLevel = level;
      }
      table = null;
      continue;
    }
    if (!sectionLevel) { table = null; continue; }
    if (text.trim().startsWith('|')) {
      if (!table) { table = { start: i + 1, lines: [] }; tables.push(table); }
      table.lines.push([i + 1, text]);
    } else {
      table = null;
    }
  }
  if (sections.length > 1) {
    fail(`The section ${SECTION_NAME} appears more than once`, sections.map((n) => `CLAUDE.md line ${n}`), [
      'Two sections leave it ambiguous which rows are the adjustments. Fix: merge them into one.',
    ]);
  }
  for (const t of tables) {
    if (t.lines.length < 2 || !SEPARATOR.test(t.lines[1][1])) {
      fail('A table in the section has no header row', [`CLAUDE.md line ${t.start}`], [
        'Fix: give it a header row and a `|---|` separator line.',
      ]);
      continue;
    }
    const header = splitRow(t.lines[0][1]).map(norm);
    const pos = {};
    const dup = [];
    for (const [key, aliases] of Object.entries(COLUMNS)) {
      const at = header.map((h, i) => (aliases.includes(h) ? i : -1)).filter((i) => i >= 0);
      if (at.length > 1) dup.push(COLUMN_LABEL[key]);
      if (at.length) pos[key] = at[0];
    }
    const missingCols = Object.keys(COLUMNS).filter((k) => pos[k] === undefined).map((k) => COLUMN_LABEL[k]);
    if (missingCols.length || dup.length) {
      const items = [];
      if (missingCols.length) items.push(`CLAUDE.md line ${t.start}: missing column(s): ${missingCols.join(', ')}`);
      if (dup.length) items.push(`CLAUDE.md line ${t.start}: column(s) given twice: ${dup.join(', ')}`);
      fail('A table in the section does not have the five columns', items, [
        'Columns are read by name, in English or Spanish: What it modifies / Qué modifica,',
        'How it is applied / Cómo se aplica, Local files / Archivos locales, Issue, Date / Fecha.',
      ]);
      continue;
    }
    for (const [lineNo, text] of t.lines.slice(2)) {
      const cells = splitRow(text);
      if (cells.length !== header.length) {
        fail('A row of the section has a different number of cells than its header', [
          `CLAUDE.md line ${lineNo}: ${cells.length} cell(s), the header has ${header.length}`,
        ], ['Fix: one cell per column; a literal pipe inside a cell is written `\\|`.']);
        continue;
      }
      // The template's filler row is no row.
      if (cells.every((c) => /^[\s—–\-….]*$/.test(c.replace(/[`*_]/g, '')))) continue;
      rows.push({
        line: lineNo,
        modifies: cells[pos.modifies], applied: cells[pos.applied], local: cells[pos.local],
        issue: cells[pos.issue], date: cells[pos.date],
      });
    }
  }
}

const plain = (s) => s.replace(/`/g, '').replace(/^[*_]+|[*_]+$/g, '').trim();
const spans = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);

const ISSUE_FORMS = [
  /^ae-setup#[1-9]\d*$/i,
  /^agantoniolar-lgtm\/ae-setup#[1-9]\d*$/i,
  /^https?:\/\/github\.com\/agantoniolar-lgtm\/ae-setup\/issues\/[1-9]\d*\/?(#\S*)?$/i,
];
function badIssueRefs(cell) {
  const s = plain(cell.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$2'));
  const refs = s.split(/[\s,;]+/).filter(Boolean);
  if (!refs.length) return null;
  return refs.filter((r) => !ISSUE_FORMS.some((re) => re.test(r)));
}

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
function dateProblem(cell) {
  const s = plain(cell);
  if (!s) return 'has no date';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return `date "${s}" is not YYYY-MM-DD`;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return `date "${s}" does not exist on the calendar`;
  }
  if (s > today) return `date "${s}" is in the future (today is ${today})`;
  return null;
}

function resolvesInFootprint(item) {
  const p = item.replace(/^\.\//, '');
  if (!p || p.includes('..') || p.startsWith('/')) return false;
  if (manifest.has(p) || kitFolder(p)) return true;
  if (/^[\w.-]+$/.test(p)) {
    if (kitFolder(`.claude/skills/${p}`)) return true;
    if (manifest.has(`scripts/${p}`)) return true;
    for (const k of manifest.keys()) {
      if (k.startsWith('scripts/') && !k.slice(8).includes('/') &&
          k.slice(8).replace(/\.[^.]+$/, '') === p) return true;
    }
  }
  return false;
}

const isDirPath = (p) => {
  if (p.endsWith('/')) return true;
  try { return statSync(join(root, p)).isDirectory(); } catch { return false; }
};
const asDir = (p) => p.replace(/\/+$/, '') + '/';
// Does a declaration line cover a file a row names, or the row's folder cover the line?
function covers(entry, cand) {
  const c = cand.replace(/\/+$/, '');
  const e = entry.path.replace(/\/+$/, '');
  if (c === e) return true;
  if (entry.isDir && cand.startsWith(entry.path)) return true;        // D-8
  if (isDirPath(cand) && entry.path.startsWith(asDir(cand))) return true; // R-27
  return false;
}

const rowProblems = [];
const localProblems = [];
const namedLocal = []; // every local file a row names
for (const r of rows) {
  const where = `CLAUDE.md line ${r.line}`;
  // What it modifies
  const mods = spans(r.modifies).length ? spans(r.modifies)
    : plain(r.modifies).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (!mods.length) rowProblems.push(`${where}: has no "${COLUMN_LABEL.modifies}"`);
  else if (haveManifest) {
    for (const m of mods) {
      if (!resolvesInFootprint(m)) {
        rowProblems.push(`${where}: "${m}" is not a kit file, folder, skill or script in ${MANIFEST_REL}`);
      }
    }
  }
  // How it is applied: required, and never interpreted (D018).
  if (!plain(r.applied)) rowProblems.push(`${where}: has no "${COLUMN_LABEL.applied}"`);
  // Issue
  const bad = badIssueRefs(r.issue);
  if (bad === null) rowProblems.push(`${where}: has no issue`);
  else for (const b of bad) {
    rowProblems.push(`${where}: issue "${b}" does not name ae-setup (write ae-setup#N, agantoniolar-lgtm/ae-setup#N or the issue's URL)`);
  }
  // Date
  const dp = dateProblem(r.date);
  if (dp) rowProblems.push(`${where}: ${dp}`);

  // Local files: only what this column names (D018). Empty or a dash is a prose-only
  // adjustment (D-9).
  const localItems = (spans(r.local).length ? spans(r.local) : plain(r.local).split(/[,;]/))
    .map((x) => x.trim()).filter((x) => x && !/^[—–\-….]+$/.test(x));
  for (const raw of localItems) {
    const cand = raw.replace(/^\.\//, '');
    if (cand.startsWith('/') || `/${cand}/`.includes('/../')) {
      localProblems.push(`${where}: \`${raw}\` is outside the repo`);
      continue;
    }
    if (haveManifest && isKitPath(cand)) {
      // D-5: an adjustment is never applied by editing the kit.
      localProblems.push(`${where}: \`${cand}\` is a kit path, not a local file: an adjustment is never applied by editing the kit`);
      continue;
    }
    namedLocal.push({ cand, where });
    if (!existsSync(join(root, cand))) {
      localProblems.push(`${where}: local file \`${cand}\` does not exist`);
    }
    if (!adjustmentLocals.some((e) => covers(e, cand))) {
      const plainDecl = locals.find((e) => covers(e, cand));
      localProblems.push(plainDecl
        ? `${where}: \`${cand}\` is in .ae-kit-local (line ${plainDecl.line}), but its reason does not start with "adjustment:"`
        : `${where}: \`${cand}\` is not declared in .ae-kit-local with a reason starting "adjustment:"`);
    }
  }
}
if (rowProblems.length) {
  fail(`Incomplete rows in ${SECTION_NAME} (${rowProblems.length})`, rowProblems, [
    'Every row says what it modifies, how it is applied, its local files (or a dash), the',
    'ae-setup issue that will bring the fix into the kit, and the date (YYYY-MM-DD).',
    `The guide: ${GUIDE}.`,
  ]);
}

// ── 3. Local adjustment files nobody names, or that claim a kit path ─────────────────
const orphans = [];
const claimsKit = [];
for (const e of adjustmentLocals) {
  if (haveManifest && (manifest.has(e.path.replace(/\/+$/, '')) || kitFolder(e.path))) {
    claimsKit.push(`.ae-kit-local line ${e.line}: ${e.path}`);
    continue;
  }
  if (!namedLocal.some(({ cand }) => covers(e, cand))) {
    orphans.push(`.ae-kit-local line ${e.line}: ${e.path}`);
  }
}
if (localProblems.length) {
  fail(`Local files of an adjustment that are not accounted for (${localProblems.length})`, localProblems, [
    'A local file of an adjustment exists, lives outside the kit\'s paths, and is declared in',
    '.ae-kit-local as `<path> # adjustment: <what it fixes>`.',
  ]);
}
if (claimsKit.length) {
  fail(`Adjustment lines in .ae-kit-local that name a kit path (${claimsKit.length})`, claimsKit, [
    'An adjustment is never applied by editing the kit, and a kit path cannot be the',
    'project\'s own. Fix: move the change to a file outside the kit\'s paths and declare that.',
  ]);
}
if (orphans.length) {
  fail(`Adjustment files no row names (${orphans.length})`, orphans, [
    `Fix: add the row to ${SECTION_NAME} that names it in "Local files",`,
    'or, if the adjustment is gone, remove the file and its line.',
  ]);
}

// ── Report ───────────────────────────────────────────────────────────────────────────
const out = [];
const say = (s = '') => out.push(s);
say(`\n  Local kit adjustments   (${root})\n`);
if (haveManifest) {
  say(`  ✓ kit files compared with the footprint: ${compared}`);
  if (skippedOut) say(`  · footprint files declared out and removed: ${skippedOut}`);
}
say(`  · adjustment rows: ${rows.length}   adjustment files in .ae-kit-local: ${adjustmentLocals.length}`);

const block = (mark, { title, items, fix }) => {
  say(`\n  ${mark} ${title}:`);
  for (const it of items) say(`      ${it}`);
  for (const f of fix) say(`    ${f}`);
};
for (const w of warnings) block('⚠', w);
for (const f of failures) block('✗', f);

if (!haveManifest) {
  const why = manifestState === 'declared-out'
    ? `${MANIFEST_REL} is declared out in .ae-kit-excluded`
    : `there is no ${MANIFEST_REL}`;
  // Deleting a committed footprint turns every edit into a warning. It does not block — an
  // install that replaced kit files and then could not write a new one removes it on
  // purpose (D012) — but it is said, so the deletion
  // is seen for what it is and not mistaken for a project that never had one.
  const goneFromHead = manifestState === 'absent' && inGit &&
    git(['cat-file', '-e', `HEAD:${MANIFEST_REL}`], root) !== null &&
    !(git(['ls-files', '-z', '--', MANIFEST_REL], root) || '').length;
  block('⚠', {
    title: `Kit files were NOT compared: ${why}`,
    items: goneFromHead
      ? [`${MANIFEST_REL} was committed in HEAD and is now gone, from the working tree and the index.`,
        'If nobody meant to delete it: `git checkout HEAD -- .ae-kit-manifest`. If an install',
        'removed it, it said why; a clean install writes it again.']
      : [],
    fix: [
      'Without the footprint nothing here can tell an edited kit file from an intact one, and',
      '"What it modifies" could not be checked against it. Every install that gets through',
      'copying the kit writes it — unless the machine has no SHA-256 tool or the file cannot be',
      'written, and the install says so. Install again, and commit it once it is there.',
    ],
  });
}

if (failures.length) {
  say(`\n✗ ${failures.length} problem group(s). This commit is rejected.\n`);
  console.error(out.join('\n'));
  process.exit(1);
}
if (!haveManifest) {
  say('\n⚠ No failures, but the kit files could not be compared. Not blocking.\n');
  console.log(out.join('\n'));
  process.exit(3);
}
say('\n✓ No kit file changed since install, and every adjustment is complete and accounted for.\n');
console.log(out.join('\n'));
process.exit(0);
