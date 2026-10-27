#!/usr/bin/env node
/**
 * roadmap.mjs — what is being done and what comes next, read from the repo.
 *
 * ── What it is ───────────────────────────────────────────────────────────────────────
 * A read-only view of the project's order of work. The owner should be able to tell what
 * comes next without opening STATUS.md or asking in the chat. Nothing in the repo changes.
 *
 * It builds two things. The queue: the items of STATUS.md → `## Next session`, in the order
 * the last session-log wrote them, each with the tasks it names that exist in tasks/. And
 * the lanes: one per epic of PRODUCT.md that still has active work, with that work. Both
 * go into one self-contained page, roadmap.html, that the owner opens at the desk.
 *
 * ── Why the queue comes from STATUS.md ───────────────────────────────────────────────
 * session-log rewrites `Next session` at every close, in priority order. It is the only
 * place where the order is written down: a task's `priority:` ranks it, it does not say
 * what goes first this week.
 *
 * ── How `Next session` is read ───────────────────────────────────────────────────────
 *   - The section runs from `## Next session` (a suffix like `(2026-10-24)` is allowed) to
 *     the next `## ` heading or the end of the file. A `### ` heading never ends it.
 *   - HTML comments are dropped first, so the template's guidance never reads as an item.
 *   - An item is a top-level list entry (`1.`, `1)`, `-`, `*`, `+`). An indented line, a
 *     sub-bullet included, belongs to the item above it. Text with no list at all is read
 *     one paragraph per item. A line that is only a `{{…}}` placeholder is dropped.
 *   - The subsection `### Authorized to start without asking` is not part of the queue.
 *     Its items go to `authorized`, kept apart, because they say what may start without
 *     asking, not what comes next. Any other `###` subsection stays in the queue, and its
 *     items carry the heading as `section`.
 *   - Bold, code spans and markdown links become `segments`, so a page can show simple
 *     formatting and never the asterisks. `text` is the same item as plain text.
 *
 * ── How a task id is found ───────────────────────────────────────────────────────────
 * A task's short id is the head of its filename: `T190` for `T190-vista-de-roadmap.md`,
 * `T017` for `T017.md`, `ACC-1` for `ACC-1-algo.md`. Any token of the item shaped like one
 * (letters, an optional `-`, digits) is looked up among those, exactly: `T1` never matches
 * `T10`, and `T17` never matches `T017`. A token that names no task stays as text (`P014`,
 * `D044`, `R23`, a task that was never created). The full slug resolves too, and so does
 * the target of a markdown link to `tasks/…`. A task named twice in one item appears once.
 *
 * Known limitation, deliberate: an item that names a task of ANOTHER project (STATUS.md
 * in ae-setup says «T162 va al final» about another project) links to this repo's task with the
 * same id, if one exists. Nothing in the text says which project an id belongs to, and
 * guessing from the prose would be worse than a link the reader can see is wrong.
 *
 * ── How the lanes are built ──────────────────────────────────────────────────────────
 * Only `in progress`, `waiting on owner` and `todo` tasks are listed; `backlog` is only
 * counted; `done` and `dropped` never appear nor count.
 *   - The epics are the rows of the first table under `## Épicas` or `## Epics` in
 *     PRODUCT.md. An epic's id is the first `ABC-1` token of the row's FIRST cell, with
 *     backticks and bold stripped; ids in other columns are never epics. Its `title` is the
 *     cell under the header «Qué entrega» / «What it delivers» / «Delivers», or, with no
 *     such header, the second cell (the template's «Capacidad» is a short code, not a
 *     title). Its `priority` is the cell under «Prioridad» / «Priority», as written.
 *     The epic's state column is NOT interpreted: a «cerrada» epic with a todo task
 *     still gets a lane, because the task says there is work left.
 *   - A task's epic is the first `ABC-1` token of its `epic:` that is an id of the table.
 *     No such token (no `epic:`, `Kit`, `ninguna — …`, an id not in the table) puts the
 *     task under «no epic».
 *   - An epic with an active task gets a lane, in the table's order, with its active tasks
 *     and its `backlogCount`. An epic with only backlog goes to `backlogOnly`, one entry
 *     with its id and count. An epic with nothing appears nowhere. The «no epic» lane (or
 *     entry) is always last; its `id` is null and `kind` is `no-epic`.
 *   - Within a lane: by status (in progress, waiting on owner, todo), then `priority:`
 *     (High = alta, Medium = media, Low = baja, case-insensitive; anything else, empty or
 *     «—» included, last), then id.
 *   - With no PRODUCT.md, no epics table, or a table with no rows, the lanes are the three
 *     statuses instead (`kind: 'status'`, an empty one omitted, `backlogCount` null), and
 *     `lanesReason` says which (`no-product`, `no-epics-table`, `empty-epics-table`).
 *     The name is matched exactly by listing the folder: `product.md` is not PRODUCT.md,
 *     on a case-insensitive macOS disk just as on Linux.
 *
 * ── The page ─────────────────────────────────────────────────────────────────────────
 * roadmap.html, at the project root or at --out. Read top to bottom: the project, which
 * close the data is from and a few counts; the tasks authorized to start without asking
 * (only when there are some); the queue, numbered, because its order is the information;
 * the lanes; and one line with the epics that only have backlog.
 *   - Self-contained: inline CSS, system fonts, no script, no image. Nothing loads from
 *     the network and nothing links to it: a URL in the repo's text is shown as text.
 *     Links go to the task files, relative to where the page lands (so --out works).
 *   - Every piece of repo text is escaped. Bold and code spans keep their formatting.
 *   - Light and dark follow the system (prefers-color-scheme).
 *   - The language is `lang` in .ae-control-center (`es` or `en`); a missing or malformed
 *     file, or any other value, gives English. The project's name is `name` there, else
 *     the folder's name.
 *   - Two runs over the same repo give the same file except the generation time, which
 *     lives in one <time class="gen"> element.
 *   - It never overwrites a roadmap.html it did not write (no `generator` meta of this
 *     script), nor one git tracks: it exits 4 and says why. The file is written to a
 *     temporary name and renamed, so a failed write leaves the old page whole.
 *
 * ── What it never does ───────────────────────────────────────────────────────────────
 * Fail the session close. A missing STATUS.md, an old-layout STATUS.md with no
 * `Next session`, or a missing tasks/ is exit 0 with an empty queue and `queueReason`
 * saying why. A malformed, retired-state or duplicated task file is skipped and counted
 * in `skipped`, never fatal: the index generator already refuses those on commit, and this
 * view's job is to show the rest.
 *
 * Usage:  roadmap.mjs [--json] [--root <path>] [--out <path>] [--open]
 *         --json         print the data model as JSON to stdout; writes no page
 *         --root <path>  the project root (default: the current directory)
 *         --out <path>   where to write the page (default: <root>/roadmap.html); an
 *                        existing folder gets roadmap.html inside it
 *         --open         open the page once written (`open` on macOS, else `xdg-open`);
 *                        failing to open only warns
 *         with no --json it writes the page and prints a one-line summary
 *
 * Exit codes:
 *   0  done, even when the queue is empty (`queueReason` says why)
 *   2  bad usage: an unknown option, --root missing or not a directory, or the folder of
 *      --out does not exist (nothing is written)
 *   3  an unexpected error, printed as one line; a defect of this script
 *   4  the page was not written: the file there was not generated by this script, git
 *      tracks it, or the write failed
 */

import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join, dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

function usage(msg) {
  console.error(`✗ ${msg}`);
  console.error('  Usage: roadmap.mjs [--json] [--root <path>] [--out <path>] [--open]');
  process.exit(2);
}

// ── Arguments ─────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let JSON_OUT = false;
let OPEN = false;
let root = process.cwd();
let outArg = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') JSON_OUT = true;
  else if (a === '--open') OPEN = true;
  else if (a === '--root' || a === '--out') {
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) usage(`${a} needs a path`);
    if (a === '--root') root = resolve(args[++i]); else outArg = resolve(args[++i]);
  } else usage(`unknown option: ${a}`);
}
if (!existsSync(root) || !statSync(root).isDirectory()) usage(`--root is not a directory: ${root}`);
let outPath = outArg ?? join(root, 'roadmap.html');
if (existsSync(outPath) && statSync(outPath).isDirectory()) outPath = join(outPath, 'roadmap.html');
if (!JSON_OUT && !(existsSync(dirname(outPath)) && statSync(dirname(outPath)).isDirectory())) {
  usage(`--out: the folder does not exist: ${dirname(outPath)} — nothing was written`);
}

// ── Markdown → segments ───────────────────────────────────────────────────────────────
// Only what STATUS.md uses: bold, code spans, links. A link keeps its text and drops its
// target: a URL from the repo is shown as text, never turned into something that loads.
const INLINE = /`([^`\n]+)`|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\[([^\]\n]+)\]\(([^)\n]*)\)/g;
function segments(src, bold = false) {
  const out = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), ...(bold && { bold }) });
    if (m[1] !== undefined) out.push({ text: m[1], code: true, ...(bold && { bold }) });
    else if (m[2] !== undefined || m[3] !== undefined) out.push(...segments(m[2] ?? m[3], true));
    else out.push(...segments(m[4], bold));
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), ...(bold && { bold }) });
  // Adjacent runs with the same formatting are one run.
  return out.reduce((acc, s) => {
    const p = acc[acc.length - 1];
    if (p && !!p.bold === !!s.bold && !!p.code === !!s.code) p.text += s.text;
    else acc.push(s);
    return acc;
  }, []);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────────────
// Read through the same reader as the index generator, so an id, a status and a title
// mean here exactly what they mean in TASKS.md.
const { readTasks } = await import(join(HERE, 'task-frontmatter.mjs'));

const SHORT = /^([A-Za-z]+-?\d+)(?=-|$)/;
const TOKEN = /(?<![A-Za-z0-9_-])([A-Z]+-?\d+)(?![A-Za-z0-9_])/g;

function loadTasks() {
  const read = readTasks(root);
  if (!read) return null;
  const skipped = [
    ...read.broken.map(([name, why]) => ({ file: `tasks/${name}`, why })),
    ...read.retired.map(([name, status]) => ({ file: `tasks/${name}`, why: `retired status \`${status}\`` })),
  ];
  // Two files with the same short id (T001-a.md, T001-b.md) make every mention ambiguous.
  // Neither is linked: picking one would show a task the item may not mean.
  const byShort = new Map();
  for (const t of read.tasks) {
    const short = (SHORT.exec(t.id) || [, t.id])[1];
    if (!byShort.has(short)) byShort.set(short, []);
    byShort.get(short).push(t);
  }
  const index = new Map();
  for (const [short, list] of byShort) {
    if (list.length === 1) index.set(short, list[0]);
    else for (const t of list) skipped.push({ file: t.file, why: `shares the id ${short} with another task file` });
  }
  // `all` is every task the queue could link: the duplicates are left out of the lanes too.
  return { index, skipped, all: [...index.values()] };
}

function linkTasks(raw, index) {
  const seen = new Set();
  const out = [];
  for (const m of raw.matchAll(TOKEN)) {
    const t = index.get(m[1]);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ ref: m[1], id: t.id, title: t.title, status: t.status, file: t.file });
  }
  return out;
}

// ── STATUS.md → Next session ──────────────────────────────────────────────────────────
const AUTHORIZED = /^authori[sz]ed to start without asking\b/i;
const MARKER = /^ ?(?:\d+[.)]|[-*+])\s+/;

function readNextSession(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Next session(\s*\(.*\))?\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }

  const queue = [];
  const authorized = [];
  let target = queue;
  let section = null;
  let cur = null;
  let prevBlank = true;

  const open = (first) => {
    cur = { lines: [first], ...(section && target === queue && { section }) };
    target.push(cur);
  };

  for (const line of lines.slice(start + 1, end)) {
    if (line.trim() === '') { prevBlank = true; continue; }
    const h = /^#{3,}\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = null; prevBlank = true;
      if (AUTHORIZED.test(h[1])) { target = authorized; section = null; }
      else { target = queue; section = h[1]; }
      continue;
    }
    if (/^\s*\{\{[^}]*\}\}\s*$/.test(line)) { prevBlank = true; continue; }

    if (MARKER.test(line)) open(line.replace(MARKER, '').trim());
    else if (/^(\s{2,}|\t)/.test(line) && cur) {
      const sub = line.trim();
      cur.lines.push(/^(?:\d+[.)]|[-*+])\s+/.test(sub) ? `\n- ${sub.replace(/^(?:\d+[.)]|[-*+])\s+/, '')}` : ` ${sub}`);
    } else if (cur && !prevBlank) cur.lines.push(` ${line.trim()}`);
    else open(line.trim());
    prevBlank = false;
  }
  return { queue, authorized };
}

function lastSession(text) {
  const m = /^##\s+Last session\s*\((.*?)\)\s*$/m.exec(text);
  if (!m) return { date: null };
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(m[1].trim()) ? m[1].trim() : null };
}

// ── PRODUCT.md → epics ────────────────────────────────────────────────────────────────
const EPIC_ID = /(?<![A-Za-z0-9])([A-Z]+-[0-9]+)(?![0-9])/g;
const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const plain = (cell) => cell.replace(/\*\*|__|`/g, '').trim();

// null when the table cannot be read, with the reason; otherwise the epics in table order.
function readEpics() {
  // Exact name, by listing: existsSync('PRODUCT.md') is true for product.md on macOS.
  if (!readdirSync(root).includes('PRODUCT.md')) return { reason: 'no-product' };
  const text = readFileSync(join(root, 'PRODUCT.md'), 'utf8').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+(Épicas|Epicas|Epics)\s*$/i.test(l));
  if (start === -1) return { reason: 'no-epics-table' };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  const body = lines.slice(start + 1, end);
  const h = body.findIndex((l, i) => /^\s*\|/.test(l) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(body[i + 1] || '') && body[i + 1].includes('-'));
  if (h === -1) return { reason: 'no-epics-table' };
  const header = cells(body[h]).map((c) => plain(c).toLowerCase());
  const col = (re) => header.findIndex((c) => re.test(c));
  let titleCol = col(/^(qué entrega|que entrega|what it delivers|delivers)$/);
  if (titleCol === -1) titleCol = header.length > 1 ? 1 : -1;
  const prioCol = col(/^(prioridad|priority)$/);

  const epics = [];
  const seen = new Set();
  for (let i = h + 2; i < body.length && /^\s*\|/.test(body[i]); i++) {
    const row = cells(body[i]);
    const m = [...plain(row[0] || '').matchAll(EPIC_ID)][0];
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    epics.push({
      id: m[1],
      title: titleCol >= 0 && row[titleCol] ? plain(row[titleCol]) : null,
      priority: prioCol >= 0 && row[prioCol] ? row[prioCol] : null,
    });
  }
  if (!epics.length) return { reason: 'empty-epics-table' };
  return { epics };
}

// ── Lanes ─────────────────────────────────────────────────────────────────────────────
const ACTIVE = ['in progress', 'waiting on owner', 'todo'];
const PRIORITY = { high: 0, alta: 0, medium: 1, media: 1, low: 2, baja: 2 };
const prioRank = (p) => PRIORITY[String(p ?? '').trim().toLowerCase()] ?? 3;
const byOrder = (a, b) =>
  ACTIVE.indexOf(a.status) - ACTIVE.indexOf(b.status) ||
  prioRank(a.priority) - prioRank(b.priority) ||
  a.id.localeCompare(b.id, 'en', { numeric: true });
const laneTask = (t) => ({
  id: t.id, title: t.title, status: t.status, priority: t.priority ?? null,
  waitingOn: t.status === 'waiting on owner' ? t.waiting_on ?? null : null, file: t.file,
});

function buildLanes(all) {
  const out = { lanesReason: null, lanes: [], backlogOnly: [] };
  const read = readEpics();
  if (!read.epics) {
    out.lanesReason = read.reason;
    for (const status of ACTIVE) {
      const tasks = all.filter((t) => t.status === status).sort(byOrder).map(laneTask);
      if (tasks.length) out.lanes.push({ kind: 'status', id: null, status, title: null, priority: null, tasks, backlogCount: null });
    }
    return out;
  }
  const known = new Set(read.epics.map((e) => e.id));
  const groups = new Map([...read.epics.map((e) => [e.id, []]), [null, []]]);
  for (const t of all) {
    const hit = [...String(t.epic ?? '').matchAll(EPIC_ID)].find((m) => known.has(m[1]));
    groups.get(hit ? hit[1] : null).push(t);
  }
  const place = (kind, epic, list) => {
    const tasks = list.filter((t) => ACTIVE.includes(t.status)).sort(byOrder).map(laneTask);
    const backlogCount = list.filter((t) => t.status === 'backlog').length;
    if (tasks.length) out.lanes.push({ kind, ...epic, tasks, backlogCount });
    else if (backlogCount) out.backlogOnly.push({ kind, id: epic.id, title: epic.title, backlogCount });
  };
  for (const e of read.epics) place('epic', e, groups.get(e.id));
  place('no-epic', { id: null, title: null, priority: null }, groups.get(null));
  return out;
}

// ── .ae-control-center → name and language ───────────────────────────────────────────
// The file the control center already keeps. Missing, unreadable or malformed reads as
// absent: the page is in English and carries the folder's name.
function projectInfo() {
  let cfg = {};
  try {
    const parsed = JSON.parse(readFileSync(join(root, '.ae-control-center'), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed;
  } catch { /* absent or malformed: defaults */ }
  const name = typeof cfg.name === 'string' && cfg.name.trim() ? cfg.name.trim() : basename(root);
  const lang = typeof cfg.lang === 'string' && cfg.lang.trim().toLowerCase() === 'es' ? 'es' : 'en';
  return { name, lang };
}

// ── The model ─────────────────────────────────────────────────────────────────────────
function build() {
  const model = {
    project: projectInfo(),
    generatedAt: new Date().toISOString(),
    lastSession: { date: null },
    counts: { inProgress: 0, waitingOnOwner: 0, todo: 0, backlog: 0 },
    statusShape: 'missing',
    queueReason: null,
    queue: [],
    authorized: [],
    lanesReason: null,
    lanes: [],
    backlogOnly: [],
    skipped: { count: 0, files: [] },
  };

  const tasks = loadTasks();
  if (tasks) {
    model.skipped = { count: tasks.skipped.length, files: tasks.skipped };
    const count = (st) => tasks.all.filter((t) => t.status === st).length;
    model.counts = { inProgress: count('in progress'), waitingOnOwner: count('waiting on owner'), todo: count('todo'), backlog: count('backlog') };
    Object.assign(model, buildLanes(tasks.all));
  } else model.lanesReason = 'no-tasks-dir';

  const file = join(root, 'STATUS.md');
  if (!existsSync(file)) { model.queueReason = 'no-status'; return model; }

  const text = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  model.lastSession = lastSession(text);
  const next = readNextSession(text);
  if (!next) { model.statusShape = 'old'; model.queueReason = 'no-next-session'; return model; }
  model.statusShape = 'current';

  if (!tasks) { model.queueReason = 'no-tasks-dir'; return model; }

  const item = (it) => {
    const raw = it.lines.join('').trim();
    const segs = segments(raw);
    return {
      text: segs.map((s) => s.text).join(''),
      segments: segs,
      tasks: linkTasks(raw, tasks.index),
      ...(it.section && { section: it.section }),
    };
  };
  model.queue = next.queue.map(item);
  model.authorized = next.authorized.map(item);
  if (!model.queue.length) model.queueReason = 'empty';
  return model;
}

// ── The page ──────────────────────────────────────────────────────────────────────────
const GENERATOR = '<meta name="generator" content="ae-kit roadmap.mjs">';

const COPY = {
  en: {
    title: 'Roadmap',
    closeOf: (d) => `Data from the close of ${d}`,
    closeUnknown: 'Close date unknown: STATUS.md has no dated «Last session»',
    generated: 'generated',
    counts: { inProgress: 'in progress', waitingOnOwner: 'waiting on owner', todo: 'to do', backlog: 'in backlog' },
    authorized: 'Authorized to start without asking',
    queue: 'Next',
    queueSub: 'In the order the last close left it in STATUS.md',
    queueEmpty: {
      'empty': 'No queue yet: «Next session» in STATUS.md is empty.',
      'no-status': 'No queue: this project has no STATUS.md.',
      'no-next-session': 'No queue: STATUS.md has the old shape, with no «Next session» section.',
      'no-tasks-dir': 'No queue: this project has no tasks/ folder.',
    },
    lanes: 'By epic',
    lanesByStatus: 'By status',
    lanesReason: {
      'no-product': 'No PRODUCT.md, so the work is grouped by status.',
      'no-epics-table': 'PRODUCT.md has no epics table, so the work is grouped by status.',
      'empty-epics-table': 'The epics table in PRODUCT.md has no rows, so the work is grouped by status.',
      'no-tasks-dir': 'No tasks/ folder: there is no work to show.',
    },
    lanesEmpty: 'No task in progress, waiting or to do.',
    noEpic: 'No epic',
    inBacklog: (n) => `+${n} in backlog`,
    backlogOnly: 'Only in backlog',
    priority: 'priority',
    asks: 'Asks',
    status: { 'in progress': 'in progress', 'waiting on owner': 'waiting on owner', todo: 'to do', backlog: 'backlog', done: 'done', dropped: 'dropped' },
    skipped: (n) => `${n} task file${n === 1 ? ' was' : 's were'} skipped: malformed, with a retired status, or sharing an id.`,
    footer: 'Read-only view of STATUS.md, PRODUCT.md and tasks/, written by roadmap.mjs.',
  },
  es: {
    title: 'Roadmap',
    closeOf: (d) => `Datos del cierre del ${d}`,
    closeUnknown: 'Cierre sin fecha conocida: STATUS.md no trae «Last session» con fecha',
    generated: 'generado',
    counts: { inProgress: 'en curso', waitingOnOwner: 'esperan al dueño', todo: 'por hacer', backlog: 'en backlog' },
    authorized: 'Autorizadas para arrancar sin preguntar',
    queue: 'Lo que sigue',
    queueSub: 'En el orden en que lo dejó el último cierre en STATUS.md',
    queueEmpty: {
      'empty': 'Todavía no hay cola: «Next session» está vacía en STATUS.md.',
      'no-status': 'No hay cola: este proyecto no tiene STATUS.md.',
      'no-next-session': 'No hay cola: STATUS.md tiene la forma vieja, sin la sección «Next session».',
      'no-tasks-dir': 'No hay cola: este proyecto no tiene carpeta tasks/.',
    },
    lanes: 'Por épica',
    lanesByStatus: 'Por estado',
    lanesReason: {
      'no-product': 'No hay PRODUCT.md, así que el trabajo se agrupa por estado.',
      'no-epics-table': 'PRODUCT.md no tiene tabla de épicas, así que el trabajo se agrupa por estado.',
      'empty-epics-table': 'La tabla de épicas de PRODUCT.md no tiene filas, así que el trabajo se agrupa por estado.',
      'no-tasks-dir': 'No hay carpeta tasks/: no hay trabajo que mostrar.',
    },
    lanesEmpty: 'Ninguna task en curso, en espera o por hacer.',
    noEpic: 'Sin épica',
    inBacklog: (n) => `+${n} en backlog`,
    backlogOnly: 'Sólo en backlog',
    priority: 'prioridad',
    asks: 'Pregunta',
    status: { 'in progress': 'en curso', 'waiting on owner': 'espera al dueño', todo: 'por hacer', backlog: 'backlog', done: 'hecha', dropped: 'descartada' },
    skipped: (n) => `Se ${n === 1 ? 'saltó 1 archivo' : `saltaron ${n} archivos`} de tasks/: mal formado${n === 1 ? '' : 's'}, con un estado retirado o con un id repetido.`,
    footer: 'Vista de sólo lectura de STATUS.md, PRODUCT.md y tasks/, escrita por roadmap.mjs.',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A bold run that holds a code span stays one <strong>, not three.
const inline = (segs) => {
  let h = '';
  let bold = false;
  for (const s of segs) {
    if (!!s.bold !== bold) { h += bold ? '</strong>' : '<strong>'; bold = !bold; }
    h += s.code ? `<code>${esc(s.text)}</code>` : esc(s.text);
  }
  return bold ? `${h}</strong>` : h;
};
const md = (text) => inline(segments(String(text ?? '')));
const stClass = (st) => `st-${String(st).replace(/\s+/g, '-')}`;
const shortId = (id) => (SHORT.exec(id) || [, id])[1];
const pad = (n) => String(n).padStart(2, '0');
const localTime = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const CSS = `
:root{color-scheme:light dark;
--bg:#f4f7f7;--surface:#fff;--ink:#132325;--ink-2:#46595b;--ink-3:#6f8284;--line:#d8e1e1;--line-2:#e8eeee;
--accent:#0d6964;--accent-ink:#fff;--accent-soft:#e0f0ee;--attn:#8a4300;--attn-bg:#ffe8c4;--attn-line:#dd9a36;--muted:#eef2f2;
--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{
--bg:#0e1617;--surface:#152022;--ink:#e2ebeb;--ink-2:#a5b5b6;--ink-3:#7c8e8f;--line:#263638;--line-2:#1d2a2c;
--accent:#55c2b9;--accent-ink:#04211f;--accent-soft:#143130;--attn:#ffc670;--attn-bg:#3b2a0f;--attn-line:#a8711f;--muted:#1b282a}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans)}
.wrap{max-width:62rem;margin:0 auto;padding:28px 16px 48px;display:flex;flex-direction:column;gap:36px}
a{color:inherit;text-decoration-color:var(--line);text-underline-offset:3px}
a:hover{text-decoration-color:currentColor}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
code{font-family:var(--mono);font-size:.88em;background:var(--muted);padding:.05em .3em;border-radius:3px}
h1,h2,h3{margin:0;line-height:1.25}
.num{font-variant-numeric:tabular-nums}
header{display:flex;flex-direction:column;gap:10px;padding-bottom:20px;border-bottom:1px solid var(--line)}
.eyebrow{font:600 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:26px;font-weight:650;letter-spacing:-.01em;overflow-wrap:anywhere}
.meta{color:var(--ink-2);font-size:14px}
.meta .unknown{color:var(--attn)}
.counts{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 0;padding:0;list-style:none}
.count{display:inline-flex;align-items:baseline;gap:6px;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:13px;color:var(--ink-2)}
.count b{font-variant-numeric:tabular-nums;font-weight:650;color:var(--ink)}
.count.attn{background:var(--attn-bg);border-color:var(--attn-line);color:var(--attn)}
.count.attn b{color:var(--attn)}
section{display:flex;flex-direction:column;gap:12px}
.sec-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
h2{font-size:17px;font-weight:650}
.sub{color:var(--ink-3);font-size:13px}
.note{color:var(--ink-2);font-size:14px;max-width:65ch;margin:0}
.empty{color:var(--ink-2);font-size:14px;max-width:65ch;margin:0;padding:14px 16px;border:1px dashed var(--line);border-radius:8px}
.queue{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;counter-reset:q var(--start,0)}
.queue>li{counter-increment:q;display:grid;grid-template-columns:2rem 1fr;gap:4px 10px;padding:12px 0;border-top:1px solid var(--line-2)}
.queue>li:first-child{border-top:0}
.queue>li::before{content:counter(q);font:600 14px/1.5 var(--mono);color:var(--accent);font-variant-numeric:tabular-nums;text-align:right}
.queue.plain>li{grid-template-columns:1fr}
.queue.plain>li::before{content:none}
.item{max-width:65ch;white-space:pre-line;overflow-wrap:anywhere}
.item strong{font-weight:620}
.chips{grid-column:2;display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.queue.plain .chips{grid-column:1}
.subhead{font-size:13px;font-weight:600;color:var(--ink-2);margin:10px 0 0}
.authorized{background:var(--accent-soft);border-radius:10px;padding:14px 16px}
.authorized h2{font-size:14px;color:var(--accent)}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1;padding:4px 8px 4px 6px;border-radius:5px;border:1px solid var(--line);background:var(--surface);text-decoration:none;white-space:nowrap}
.chip .cid{font-family:var(--mono);font-weight:600;color:var(--ink)}
.chip .cst{color:var(--ink-2)}
.chip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ink-3);flex:none}
.chip.st-in-progress::before{background:var(--accent)}
.chip.st-waiting-on-owner{border-color:var(--attn-line);background:var(--attn-bg)}
.chip.st-waiting-on-owner::before{background:var(--attn);border-radius:1px}
.chip.st-waiting-on-owner .cst{color:var(--attn);font-weight:600}
.chip.st-todo::before{background:transparent;border:1.5px solid var(--ink-2)}
.chip.st-backlog::before{background:transparent;border:1.5px dotted var(--ink-3)}
.chip.st-done,.chip.st-dropped{opacity:.62}
.chip.st-done::before{background:var(--ink-3)}
.chip.st-dropped .cid{text-decoration:line-through}
.lanes{display:flex;flex-direction:column;gap:14px}
.lane{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.lane-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:12px 16px;border-bottom:1px solid var(--line-2)}
.lane-id{font:600 12px/1 var(--mono);color:var(--accent);padding:3px 6px;border-radius:4px;background:var(--accent-soft)}
.lane-head h3{font-size:15px;font-weight:620;flex:1 1 12rem;min-width:0;overflow-wrap:anywhere}
.lane-prio{font-size:12px;color:var(--ink-2)}
.lane-backlog{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.rows{list-style:none;margin:0;padding:0}
.row{display:grid;grid-template-columns:5.5rem minmax(0,1fr) auto;align-items:baseline;gap:4px 12px;padding:9px 16px;border-top:1px solid var(--line-2)}
.row:first-child{border-top:0}
.rid{font:500 13px/1.5 var(--mono);color:var(--ink-2);overflow-wrap:anywhere}
.rtitle{min-width:0;overflow-wrap:anywhere}
.rside{display:flex;align-items:baseline;gap:10px;justify-self:end}
.rprio{font-size:12px;color:var(--ink-3);white-space:nowrap}
.pill{display:inline-block;font-size:12px;line-height:1;padding:4px 9px;white-space:nowrap;border:1px solid transparent}
.pill.st-in-progress{background:var(--accent);color:var(--accent-ink);border-radius:999px;font-weight:600}
.pill.st-waiting-on-owner{background:var(--attn-bg);color:var(--attn);border:1.5px solid var(--attn-line);border-radius:3px;font-weight:700}
.pill.st-todo{border-color:var(--ink-3);color:var(--ink-2);border-radius:999px}
.pill.st-backlog{border:1px dotted var(--ink-3);color:var(--ink-3);border-radius:999px}
.pill.st-done,.pill.st-dropped{background:var(--muted);color:var(--ink-3);border-radius:999px}
.ask{grid-column:2/-1;margin:2px 0 0;padding:6px 10px;border-left:2px solid var(--attn-line);background:color-mix(in srgb,var(--attn-bg) 45%,transparent);color:var(--ink-2);font-size:13px;max-width:65ch;overflow-wrap:anywhere}
.ask b{color:var(--attn);font-weight:600;margin-right:4px}
.backlog-only{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.backlog-only .label{font-size:13px;color:var(--ink-2);margin-right:4px}
.bchip{font:500 12px/1 var(--mono);padding:4px 8px;border-radius:5px;background:var(--muted);color:var(--ink-2);font-variant-numeric:tabular-nums}
footer{color:var(--ink-3);font-size:12px;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:14px}
footer .warn{color:var(--attn)}
footer details summary{cursor:pointer}
footer ul{margin:6px 0 0;padding-left:18px}
@media (max-width:560px){
.row{grid-template-columns:minmax(0,1fr) auto}
.rid{grid-column:1}.rside{grid-column:2;grid-row:1}.rtitle{grid-column:1/-1}.ask{grid-column:1/-1}
h1{font-size:22px}}
`;

function renderHtml(model, outDir) {
  const L = COPY[model.project.lang] || COPY.en;
  const href = (file) => relative(outDir, join(root, file)).split(sep).map(encodeURIComponent).join('/');
  const status = (st) => L.status[st] ?? st;

  const chip = (t) =>
    `<a class="chip ${stClass(t.status)}" href="${esc(href(t.file))}" title="${esc(t.title)}"><span class="cid">${esc(t.ref ?? shortId(t.id))}</span><span class="cst">${esc(status(t.status))}</span></a>`;
  const item = (q) =>
    `<li><div class="item">${inline(q.segments)}</div>${q.tasks.length ? `<div class="chips">${q.tasks.map(chip).join('')}</div>` : ''}</li>`;

  // Queue: one <ol> per ### subsection, numbered on from the previous one.
  const groups = [];
  for (const q of model.queue) {
    const g = groups[groups.length - 1];
    if (g && g.section === (q.section ?? null)) g.items.push(q);
    else groups.push({ section: q.section ?? null, items: [q] });
  }
  let n = 0;
  const queueHtml = model.queue.length
    ? groups.map((g) => {
        const start = n; n += g.items.length;
        return `${g.section ? `<h3 class="subhead">${md(g.section)}</h3>` : ''}<ol class="queue" start="${start + 1}" style="--start:${start}">${g.items.map(item).join('')}</ol>`;
      }).join('')
    : `<p class="empty">${esc(L.queueEmpty[model.queueReason] ?? L.queueEmpty.empty)}</p>`;

  const authorizedHtml = model.authorized.length
    ? `<section class="authorized" aria-labelledby="h-auth"><h2 id="h-auth">${esc(L.authorized)}</h2><ul class="queue plain">${model.authorized.map(item).join('')}</ul></section>`
    : '';

  const row = (t) => `<li class="row ${stClass(t.status)}">
<span class="rid">${esc(shortId(t.id))}</span>
<a class="rtitle" href="${esc(href(t.file))}">${md(t.title)}</a>
<span class="rside">${t.priority ? `<span class="rprio" title="${esc(L.priority)}">${esc(plain(String(t.priority)))}</span>` : ''}<span class="pill ${stClass(t.status)}">${esc(status(t.status))}</span></span>
${t.waitingOn ? `<p class="ask"><b>${esc(L.asks)}</b>${md(t.waitingOn)}</p>` : ''}</li>`;
  const lane = (l) => {
    const title = l.kind === 'status' ? status(l.status) : l.kind === 'no-epic' ? L.noEpic : (l.title ?? l.id);
    return `<article class="lane">
<div class="lane-head">${l.id ? `<span class="lane-id">${esc(l.id)}</span>` : ''}<h3>${l.kind === 'epic' && l.title ? md(title) : esc(title)}</h3>${l.priority ? `<span class="lane-prio">${esc(plain(String(l.priority)))}</span>` : ''}${l.backlogCount ? `<span class="lane-backlog">${esc(L.inBacklog(l.backlogCount))}</span>` : ''}</div>
<ul class="rows">${l.tasks.map(row).join('')}</ul>
</article>`;
  };
  const byStatus = model.lanesReason && model.lanesReason !== 'no-tasks-dir';
  const lanesNote = model.lanesReason ? `<p class="note">${esc(L.lanesReason[model.lanesReason] ?? '')}</p>` : '';
  const lanesHtml = model.lanes.length
    ? `<div class="lanes">${model.lanes.map(lane).join('\n')}</div>`
    : model.lanesReason === 'no-tasks-dir' ? '' : `<p class="empty">${esc(L.lanesEmpty)}</p>`;
  const backlogOnlyHtml = model.backlogOnly.length
    ? `<div class="backlog-only"><span class="label">${esc(L.backlogOnly)}</span>${model.backlogOnly.map((b) =>
        `<span class="bchip num"${b.title ? ` title="${esc(plain(b.title))}"` : ''}>${esc(b.id ?? L.noEpic)} · ${b.backlogCount}</span>`).join('')}</div>`
    : '';

  const c = model.counts;
  const countChip = (key, cls = '') => `<li class="count${cls}"><b>${c[key]}</b>${esc(L.counts[key])}</li>`;
  const close = model.lastSession.date
    ? esc(L.closeOf(model.lastSession.date))
    : `<span class="unknown">${esc(L.closeUnknown)}</span>`;
  const skippedHtml = model.skipped.count
    ? `<details><summary class="warn">${esc(L.skipped(model.skipped.count))}</summary><ul>${model.skipped.files.map((f) => `<li><code>${esc(f.file)}</code> — ${esc(f.why)}</li>`).join('')}</ul></details>`
    : '';

  return `<!doctype html>
<html lang="${model.project.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${GENERATOR}
<meta name="referrer" content="no-referrer">
<title>${esc(model.project.name)} — ${esc(L.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
<span class="eyebrow">${esc(L.title)}</span>
<h1>${esc(model.project.name)}</h1>
<div class="meta">${close} · ${esc(L.generated)} <time class="gen" datetime="${esc(model.generatedAt)}">${esc(localTime(model.generatedAt))}</time></div>
<ul class="counts">${countChip('inProgress')}${countChip('waitingOnOwner', c.waitingOnOwner ? ' attn' : '')}${countChip('todo')}${countChip('backlog')}</ul>
</header>
${authorizedHtml}
<section aria-labelledby="h-queue">
<div class="sec-head"><h2 id="h-queue">${esc(L.queue)}</h2>${model.queue.length ? `<span class="sub">${esc(L.queueSub)}</span>` : ''}</div>
${queueHtml}
</section>
<section aria-labelledby="h-lanes">
<div class="sec-head"><h2 id="h-lanes">${esc(byStatus ? L.lanesByStatus : L.lanes)}</h2></div>
${lanesNote}
${lanesHtml}
${backlogOnlyHtml}
</section>
<footer>
${skippedHtml}
<span>${esc(L.footer)}</span>
</footer>
</div>
</body>
</html>
`;
}

// ── Writing it ────────────────────────────────────────────────────────────────────────
// Refuses to replace a file it did not write, or one git tracks. Returns null when written,
// else the reason it was not.
function writePage(html) {
  if (existsSync(outPath)) {
    let current = '';
    try { current = readFileSync(outPath, 'utf8'); } catch { return `cannot read the existing ${outPath}`; }
    if (!current.includes(GENERATOR)) return `${outPath} exists and was not generated by roadmap.mjs (no generator marker); move it or pass --out`;
  }
  try {
    execFileSync('git', ['-C', dirname(outPath), 'ls-files', '--error-unmatch', '--', basename(outPath)], { stdio: 'ignore' });
    return `${outPath} is tracked by git; a generated page must not be committed — untrack it or pass --out`;
  } catch { /* untracked, not a repo, or no git: fine */ }
  const tmp = `${outPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, html);
    renameSync(tmp, outPath);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    return `could not write ${outPath}: ${e.message}`;
  }
  return null;
}

function openPage() {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const r = spawnSync(cmd, [outPath], { stdio: 'ignore', timeout: 10000 });
  if (r.error || r.status !== 0) {
    console.error(`! could not open it with \`${cmd}\` (${r.error ? r.error.code || r.error.message : `exit ${r.status}`}); open ${outPath} by hand`);
  }
}

try {
  const model = build();
  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(model, null, 2) + '\n');
    process.exit(0);
  }
  const refused = writePage(renderHtml(model, dirname(outPath)));
  if (refused) { console.error(`✗ roadmap.html not written: ${refused}`); process.exit(4); }
  const links = model.queue.reduce((k, q) => k + q.tasks.length, 0);
  const why = model.queueReason ? ` (${model.queueReason})` : '';
  const skip = model.skipped.count ? `; ${model.skipped.count} task file(s) skipped` : '';
  const lanes = `${model.lanes.length} lane(s)${model.lanesReason ? ` (${model.lanesReason})` : ''}`;
  console.log(`roadmap: ${model.queue.length} queue item(s)${why}, ${links} task link(s), ` +
    `${model.authorized.length} authorized to start, ${lanes}, ` +
    `${model.backlogOnly.length} backlog-only${skip}; wrote ${outPath}`);
  if (OPEN) openPage();
  process.exit(0);
} catch (e) {
  console.error(`✗ roadmap.mjs failed: ${e && e.message ? e.message : e}`);
  process.exit(3);
}
