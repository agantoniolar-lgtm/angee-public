#!/usr/bin/env node
/**
 * generate-task-index.mjs — build TASKS.md, BACKLOG.md and TASKS_ARCHIVE.md from tasks/.
 *
 * ── The failure this removes ─────────────────────────────────────────────────────────
 * The old model kept every task's full text inside two large files, so ordinary work
 * meant inserting or moving a block of text into the right place in a 700-line file.
 * That operation broke three separate times in the identical way — once leaving an index
 * listing 51 tasks the file no longer contained.
 *
 * One file per task removes the fragile operation entirely. Changing a task's status is
 * now editing one line of its own frontmatter; nothing moves between files, so nothing
 * can land in the wrong place. The indexes stop being documents that are maintained and
 * become artifacts that are regenerated.
 *
 * ── Consequence, handled ─────────────────────────────────────────────────────────────
 * This introduces a new failure mode: index and folder drifting apart. That is what the
 * `--check` mode exists for, and why it runs in pre-commit and in CI. One script both
 * generates and validates on purpose: a separate validator can drift from the generator
 * it validates, and then the check passes on output nobody would produce.
 *
 * ── What the state model fixes (2026-08-16) ──────────────────────────────────────────
 * This script used to define "active" as `in progress` + `in review` and send EVERYTHING
 * ELSE to the archive, under a heading that reads as finished work. That default — turn
 * a value you don't understand into the claim "done" — is how a consuming project ended
 * up with a high-priority bug counted among its completed tasks:
 * it had invented `status: backlog` because the kit gave it no such state.
 *
 * So: six states, an explicit index for each, and a hard stop on anything else. The
 * correct default in front of an unknown value is to refuse, never to classify.
 *
 * Usage:  generate-task-index.mjs [repoRoot] [--check]
 *         --check  don't write; exit 1 if what's on disk differs from what would be generated
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The state model lives in one file, imported by every script that reads a status —
// see task-states.mjs for why that stopped being optional. Reading tasks/ and judging a
// file well-formed lives in task-frontmatter.mjs for the same reason: `check-task-links.mjs`
// needs the identical judgement, and a second copy of it is how the two drift.
const { STATES, RETIRED, validStates } =
  await import(join(dirname(fileURLToPath(import.meta.url)), 'task-states.mjs'));
const { readTasks } =
  await import(join(dirname(fileURLToPath(import.meta.url)), 'task-frontmatter.mjs'));

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const root = resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
const tasksDir = join(root, 'tasks');

if (!existsSync(tasksDir)) {
  console.error(`✗ ${join(root, 'tasks')}/ does not exist — has the one-file-per-task migration run yet?`);
  process.exit(2);
}

const { tasks, broken, retired } = readTasks(root);

// ── The length notice (T054) ──────────────────────────────────────────────────────────
// A task file says where the work is going; what happened lives in its task log. A task
// file that keeps growing is narration landing in the wrong place, so --check (the
// pre-commit run) names the tasks that are STAGED in this commit, still open, and past
// the cap. Only staged ones: an old long task that nobody is touching would otherwise
// repeat the same line on every commit until people stop reading the output. Closed
// tasks are never named — they are not migrated. It never blocks.
//
// 150 lines, measured 2026-09-18: in an installed project (285 tasks) the median is 18 and the 95th
// percentile 115; here, with narration still inside, the median is 62.
const LONG_TASK_LINES = 150;
function warnLong() {
  const r = spawnSync('git', ['-C', root, 'diff', '--cached', '--name-only', '--relative', '--diff-filter=ACMR', '--', 'tasks/'], { encoding: 'utf8' });
  // --relative: paths relative to root, so a project living in a subfolder of its git repo
  // (a monorepo) still matches tasks/<id>.md.
  if (r.status !== 0) return; // not a git repo, or git missing: nothing is "in this commit"
  const staged = new Set(r.stdout.split('\n').filter(Boolean));
  for (const t of tasks) {
    if (!staged.has(t.file) || STATES[t.status].index === 'archive') continue;
    const text = readFileSync(join(root, t.file), 'utf8');
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (lines > LONG_TASK_LINES) {
      console.log(`  ⚠ ${t.file} has ${lines} lines (notice at ${LONG_TASK_LINES}). ` +
        `What happened goes in its task log, logs/tasks/<id>.md; the task keeps status, done-when and open blockers.`);
    }
  }
}

// ── A retired state gets its own message: this is a migration, not a malformed file ──
if (retired.length) {
  console.error(`\n✗ ${retired.length} task(s) usan un estado retirado. Los commits quedan bloqueados hasta migrarlas.\n`);
  for (const [name, status, fm] of retired) {
    const r = RETIRED[status];
    console.error(`  · tasks/${name}`);
    console.error(`      "${fm.title || fm.id}"`);
    console.error(`      \`${status}\` se retiró en ${r.since} — ${r.why}.`);
    console.error(`      Elige uno: ${r.options.map((o) => `\`${o}\``).join(' · ')}\n`);
  }
  console.error(`  Cómo se migra, y por qué a mano: no hay traducción automática correcta.`);
  console.error(`  Un estado que significaba tres cosas no tiene un destino único, así que`);
  console.error(`  mapearlas todas al mismo escribiría como hecho lo que es una suposición.`);
  console.error(`  Abre cada archivo de arriba, lee en qué punto está de verdad, y edita su`);
  console.error(`  \`status:\`. Si eliges \`waiting on owner\`, añade \`waiting_on:\` con la`);
  console.error(`  pregunta concreta que espera. Después corre este script otra vez.\n`);
  process.exit(1);
}

if (broken.length) {
  console.error(`✗ ${broken.length} archivo(s) de task mal formados:\n`);
  for (const [name, why] of broken) console.error(`  · ${name} — ${why}`);
  console.error(`\n  Estados válidos: ${validStates()}`);
  console.error(`\n  The index is not generated from incomplete data: a row with an empty field`);
  console.error(`  looks exactly like a correct one and hides the problem instead of showing it.\n`);
  process.exit(1);
}

// A duplicate id means two files claim the same task — the index would silently show one.
const byId = new Map();
for (const t of tasks) {
  if (byId.has(t.id)) {
    console.error(`✗ id repetido: "${t.id}" en ${byId.get(t.id).file} y en ${t.file}`);
    console.error(`  Un id pertenece a una sola task. Se renumera aquella a la que no apunta`);
    console.error(`  ningún enlace, tomando el id máximo existente más uno — nunca un hueco`);
    console.error(`  liberado, porque un id reutilizado hace revivir a un id muerto con otro`);
    console.error(`  significado. Deja la nota del id anterior en sus \`Notes\`.\n`);
    process.exit(1);
  }
  byId.set(t.id, t);
}

const inIndex = (which) => tasks.filter((t) => STATES[t.status].index === which);
const byState = (state) => tasks.filter((t) => t.status === state);

const active = inIndex('active');
const backlog = inIndex('backlog');
const archive = inIndex('archive');

// The invariant, asserted rather than assumed: every task lands in exactly one index.
// It holds by construction today; it stops holding the moment someone gives a state two
// homes, and an index that quietly lists a task twice is the drift this file exists to
// make impossible.
if (active.length + backlog.length + archive.length !== tasks.length) {
  console.error(`✗ Defecto del propio generador: ${tasks.length} tasks se repartieron en`);
  console.error(`  ${active.length + backlog.length + archive.length} filas. Un estado está`);
  console.error(`  cayendo en más de un índice, o en ninguno.\n`);
  process.exit(3);
}

function table(rows) {
  const head = ['id', 'title', 'category', 'status', 'updated'];
  const body = rows.map((t) =>
    `| [${t.id}](${t.file}) | ${t.title} | ${t.category} | ${t.status} | ${t.updated || t.created} |`
  );
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body].join('\n');
}

/**
 * An absent table and an empty table read the same at a glance and mean different things
 * — the first looks like a malformed file. So a state with no tasks still prints its
 * heading, with a line saying so.
 */
function section(state) {
  const rows = byState(state);
  return `### \`${state}\` — ${STATES[state].group}\n\n**${rows.length}**\n\n` +
    (rows.length ? table(rows) : `_Ninguna._`);
}

const GENERATED = `<!-- GENERATED by scripts/generate-task-index.mjs — do not hand-edit.
     Edit the task file under tasks/ and regenerate. Hand edits are lost, and the
     pre-commit check will reject a file that drifted from its source. -->`;

const activeDoc = `# Tasks — active work only

${GENERATED}

Sólo \`in progress\` y \`waiting on owner\` viven aquí, por construcción. Lo que tiene scope pero no ha empezado está en \`BACKLOG.md\`; lo terminado y lo cancelado, en \`TASKS_ARCHIVE.md\`. Cada fila enlaza al archivo de la task, que lleva su registro de auditoría completo.

Las dos tablas están separadas a propósito: *"¿qué se está construyendo?"* y *"¿qué espera una decisión mía?"* son dos preguntas distintas, y leerlas mezcladas fue lo que hizo ilegible al estado que \`waiting on owner\` reemplaza.

**${active.length} activas**

${section('in progress')}

${section('waiting on owner')}
`;

const backlogDoc = `# Backlog

${GENERATED}

Trabajo anotado que todavía no empieza. Cada fila enlaza al archivo de la task — **el contenido vive ahí, no aquí**: este archivo es un índice, igual que \`TASKS.md\`.

La diferencia entre las dos tablas es si el scope está escrito. Y la diferencia con \`PENDINGS.md\` es lo que le falta a cada cosa: **a una task de backlog le falta tiempo; a un pendiente le falta una decisión.** El tiempo resuelve la primera y empeora el segundo — por eso una se lista y el otro se cuenta.

**${backlog.length} sin empezar**

${section('backlog')}

${section('todo')}
`;

const archiveDoc = `# Tasks archive

${GENERATED}

Trabajo cerrado: lo entregado y lo cancelado, separados — porque *"se hizo"* y *"se decidió no hacerlo"* no son lo mismo y durante mucho tiempo se leyeron igual. La entrada completa vive en el archivo enlazado; esto es un índice para encontrarla, no una copia.

**${archive.length} cerradas**

${section('done')}

${section('dropped')}
`;

const targets = [
  [join(root, 'TASKS.md'), activeDoc],
  [join(root, 'BACKLOG.md'), backlogDoc],
  [join(root, 'TASKS_ARCHIVE.md'), archiveDoc],
];

/**
 * `BACKLOG.md` became a generated file in 0.29.0; before that, projects wrote it by hand.
 * Regenerating over a hand-written one rebuilds it from tasks/ — which, in a repo that
 * hasn't migrated yet, means zero rows. One consuming project keeps 62 hand-written rows
 * there, most with the scope written inside the cell. Overwriting that is a silent data
 * loss recoverable only from git, so it is refused instead.
 */
const handWritten = targets.filter(([p]) => {
  if (!existsSync(p)) return false;
  const text = readFileSync(p, 'utf8');
  if (text.includes('GENERATED by scripts/generate-task-index.mjs')) return false;
  // Data rows, not any pipe character: an empty table still has its header row and its
  // separator, and a brand-new project that starts from a template has exactly that.
  // Counting those as content would block the first commit of every new project — found
  // by checking this against the kit's own BACKLOG template rather than by reasoning.
  const rows = text.split('\n').filter((l) => l.trimStart().startsWith('|') && !/^\s*\|[\s:|-]*\|\s*$/.test(l));
  return rows.length > 1;
});

if (handWritten.length) {
  console.error(`\n✗ ${handWritten.length} índice(s) tienen filas escritas a mano y todavía no se han migrado:\n`);
  for (const [p] of handWritten) console.error(`  · ${p.replace(root + '/', '')}`);
  console.error(`\n  Este archivo pasó a ser generado, y regenerarlo lo reconstruye desde tasks/.`);
  console.error(`  En un repo sin migrar eso son cero filas: se perderían las que tiene ahora,`);
  console.error(`  y sólo sobrevivirían en git.\n`);
  console.error(`  El orden correcto es al revés: primero cada fila se vuelve un archivo en`);
  console.error(`  tasks/ con su \`status:\`, y después este script genera la tabla.\n`);
  process.exit(1);
}

if (CHECK_ONLY) {
  const stale = targets.filter(([p, want]) => !existsSync(p) || readFileSync(p, 'utf8') !== want);
  if (stale.length) {
    console.error(`✗ El índice no refleja tasks/:\n`);
    for (const [p] of stale) console.error(`  · ${p.replace(root + '/', '')} está desincronizado`);
    console.error(`\n  Corre: node scripts/generate-task-index.mjs\n`);
    process.exit(1);
  }
  console.log(`✓ Index in sync with tasks/ (${active.length} active, ${backlog.length} backlog, ${archive.length} closed).`);
  warnLong();
  process.exit(0);
}

for (const [p, content] of targets) writeFileSync(p, content);
console.log(`✓ Index generated from tasks/: ${active.length} active, ${backlog.length} backlog, ${archive.length} closed.`);
